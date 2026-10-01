export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (url.pathname === "/launch" && request.method === "POST") {
      try {
        const body = await request.json();

        const userId = body.user_id;
        if (!userId || typeof userId !== "string") {
          return json({ error: "user_id is required" }, 400);
        }

        try {
          await env.DB.prepare(
            `INSERT INTO launches
               (user_id, app_version, os, os_version, arch, locale,
                tz_offset_min, screen_w, screen_h, cpu_cores, ram_gb, event, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                     strftime('%Y-%m-%d %H:%M:%S','now'))`
          )
            .bind(
              userId,
              text(body.app_version, 64, "unknown"),
              text(body.os, 32, "unknown"),
              text(body.os_version, 32, null),
              text(body.arch, 16, null),
              text(body.locale, 24, null),
              int(body.tz_offset_min, -840, 840),
              int(body.screen_w, 0, 30000),
              int(body.screen_h, 0, 30000),
              int(body.cpu_cores, 0, 1024),
              int(body.ram_gb, 0, 102400),
              text(body.event, 32, "launch")
            )
            .run();
        } catch (schemaError) {
          // New telemetry columns not migrated yet — record the launch with
          // the original minimal schema so no data is lost.
          await env.DB.prepare(
            "INSERT INTO launches (user_id, app_version) VALUES (?, ?)"
          )
            .bind(userId, text(body.app_version, 64, "unknown"))
            .run();
        }

        return json({ success: true });
      } catch (error) {
        return json({ error: "Failed to record launch" }, 500);
      }
    }

    if (url.pathname === "/api/stats" && request.method === "GET") {
      try {
        const days = clampInt(url.searchParams.get("days"), 14, 1, 90);
        return json(await buildStats(env.DB, days));
      } catch (error) {
        // Full aggregation failed — most likely the telemetry columns from
        // migrations/0001_telemetry_columns.sql haven't been applied yet.
        // Fall back to the legacy totals so the dashboard keeps working.
        try {
          const totals = await env.DB.prepare(
            "SELECT COUNT(*) AS launches, COUNT(DISTINCT user_id) AS users FROM launches"
          ).first();
          return json(legacyStats(totals));
        } catch (fallbackError) {
          return json({ error: "Failed to fetch stats" }, 500);
        }
      }
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not found", {
      status: 404,
      headers: corsHeaders()
    });
  }
};

/* ------------------------------------------------------------
   Stats aggregation
   ------------------------------------------------------------ */
function legacyStats(row) {
  const launches = number(row?.launches);
  const users = number(row?.users);

  return {
    launches,
    users,
    launchesToday: 0,
    usersToday: 0,
    newUsersToday: 0,
    launches7d: 0,
    activeUsers7d: 0,
    newUsers7d: 0,
    lastLaunchAt: null,
    avgLaunchesPerUser: users > 0 ? round(launches / users, 2) : 0,
    days: 14,
    series: [],
    platforms: [],
    versions: [],
    hardware: { avgCores: null, avgRamGb: null, commonScreen: null, samples: 0 },
    recent: [],
    userDetails: [],
    degraded: true
  };
}

async function buildStats(db, days) {
  const since = `-${days} days`;

  const [
    totals,
    today,
    week,
    newToday,
    newWeek,
    seriesRows,
    newSeriesRows,
    platformRows,
    versionRows,
    hardwareRows,
    recentRows,
    userRows
  ] = await db.batch([
    db.prepare(
      "SELECT COUNT(*) AS launches, COUNT(DISTINCT user_id) AS users, MAX(created_at) AS last_launch_at FROM launches"
    ),
    db.prepare(
      "SELECT COUNT(*) AS launches, COUNT(DISTINCT user_id) AS users FROM launches WHERE date(created_at) = date('now')"
    ),
    db.prepare(
      "SELECT COUNT(*) AS launches, COUNT(DISTINCT user_id) AS users FROM launches WHERE created_at >= datetime('now','-7 days')"
    ),
    db.prepare(
      `SELECT COUNT(*) AS users FROM
         (SELECT user_id, MIN(created_at) AS first_at FROM launches WHERE created_at IS NOT NULL GROUP BY user_id)
       WHERE date(first_at) = date('now')`
    ),
    db.prepare(
      `SELECT COUNT(*) AS users FROM
         (SELECT user_id, MIN(created_at) AS first_at FROM launches WHERE created_at IS NOT NULL GROUP BY user_id)
       WHERE first_at >= datetime('now','-7 days')`
    ),
    db.prepare(
      `SELECT date(created_at) AS day, COUNT(*) AS launches, COUNT(DISTINCT user_id) AS users
       FROM launches WHERE created_at >= date('now', ?)
       GROUP BY day ORDER BY day`
    ).bind(since),
    db.prepare(
      `SELECT date(first_at) AS day, COUNT(*) AS users FROM
         (SELECT user_id, MIN(created_at) AS first_at FROM launches WHERE created_at IS NOT NULL GROUP BY user_id)
       WHERE first_at >= date('now', ?)
       GROUP BY day ORDER BY day`
    ).bind(since),
    db.prepare(
      `SELECT COALESCE(NULLIF(os, ''), 'unknown') AS os, COALESCE(NULLIF(os_version, ''), '') AS os_version, COUNT(*) AS launches
       FROM launches GROUP BY os, os_version ORDER BY launches DESC LIMIT 6`
    ),
    db.prepare(
      `SELECT COALESCE(app_version, 'unknown') AS version, COUNT(*) AS launches
       FROM launches GROUP BY app_version ORDER BY launches DESC LIMIT 5`
    ),
    db.prepare(
      `SELECT
         (SELECT ROUND(AVG(cpu_cores), 1) FROM launches WHERE cpu_cores > 0) AS avg_cores,
         (SELECT ROUND(AVG(ram_gb)) FROM launches WHERE ram_gb > 0) AS avg_ram,
         (SELECT COUNT(*) FROM launches WHERE cpu_cores > 0) AS samples,
         (SELECT screen_w || 'x' || screen_h FROM launches WHERE screen_w > 0
          GROUP BY screen_w, screen_h ORDER BY COUNT(*) DESC LIMIT 1) AS common_screen`
    ),
    db.prepare(
      `SELECT l.user_id AS user_id,
              l.app_version AS app_version,
              COALESCE(l.os, 'unknown') AS os,
              COALESCE(l.os_version, '') AS os_version,
              l.created_at AS created_at,
              (l.created_at = (SELECT MIN(l2.created_at) FROM launches l2 WHERE l2.user_id = l.user_id)) AS is_first
       FROM launches l
       WHERE l.created_at IS NOT NULL
       ORDER BY l.created_at DESC
       LIMIT 10`
    ),
    db.prepare(
      `SELECT user_id,
              COUNT(*) AS launches,
              MIN(created_at) AS first_at,
              MAX(created_at) AS last_at,
              (SELECT l2.app_version FROM launches l2
                WHERE l2.user_id = l.user_id AND l2.created_at IS NOT NULL
                ORDER BY l2.created_at DESC LIMIT 1) AS last_version,
              (SELECT COALESCE(NULLIF(l2.os, ''), 'unknown') FROM launches l2
                WHERE l2.user_id = l.user_id AND l2.created_at IS NOT NULL
                ORDER BY l2.created_at DESC LIMIT 1) AS last_os,
              (SELECT COALESCE(l2.os_version, '') FROM launches l2
                WHERE l2.user_id = l.user_id AND l2.created_at IS NOT NULL
                ORDER BY l2.created_at DESC LIMIT 1) AS last_os_version
       FROM launches l
       WHERE created_at IS NOT NULL
       GROUP BY user_id
       ORDER BY last_at DESC
       LIMIT 20`
    )
  ]);

  const launches = number(totals.results?.[0]?.launches);
  const users = number(totals.results?.[0]?.users);

  return {
    /* legacy keys kept for compatibility */
    launches,
    users,

    launchesToday: number(today.results?.[0]?.launches),
    usersToday: number(today.results?.[0]?.users),
    newUsersToday: number(newToday.results?.[0]?.users),

    launches7d: number(week.results?.[0]?.launches),
    activeUsers7d: number(week.results?.[0]?.users),
    newUsers7d: number(newWeek.results?.[0]?.users),

    lastLaunchAt: totals.results?.[0]?.last_launch_at || null,
    avgLaunchesPerUser: users > 0 ? round(launches / users, 2) : 0,
    days,

    series: buildSeries(days, seriesRows.results || [], newSeriesRows.results || []),
    platforms: buildPlatforms(platformRows.results || [], launches),
    versions: buildVersions(versionRows.results || [], launches),

    hardware: {
      avgCores: number(hardwareRows.results?.[0]?.avg_cores) || null,
      avgRamGb: number(hardwareRows.results?.[0]?.avg_ram) || null,
      commonScreen: hardwareRows.results?.[0]?.common_screen || null,
      samples: number(hardwareRows.results?.[0]?.samples)
    },

    recent: (recentRows.results || []).map((row) => ({
      userId: row.user_id,
      appVersion: row.app_version,
      os: row.os,
      osVersion: row.os_version || "",
      createdAt: row.created_at,
      isNew: number(row.is_first) === 1
    })),

    userDetails: (userRows.results || []).map((row) => ({
      userId: row.user_id,
      launches: number(row.launches),
      firstSeen: row.first_at,
      lastSeen: row.last_at,
      version: row.last_version || "unknown",
      os: row.last_os || "unknown",
      osVersion: row.last_os_version || ""
    }))
  };
}

function buildSeries(days, launchRows, newUserRows) {
  const byDay = new Map();
  const newByDay = new Map();

  for (const row of launchRows) {
    byDay.set(row.day, { launches: number(row.launches), users: number(row.users) });
  }
  for (const row of newUserRows) {
    newByDay.set(row.day, number(row.users));
  }

  const series = [];
  for (let offset = days - 1; offset >= 0; offset--) {
    const day = utcDay(-offset);
    const entry = byDay.get(day) || { launches: 0, users: 0 };
    series.push({
      day,
      launches: entry.launches,
      users: entry.users,
      newUsers: newByDay.get(day) || 0
    });
  }
  return series;
}

function buildPlatforms(rows, totalLaunches) {
  return rows.map((row) => {
    const launches = number(row.launches);
    return {
      key: `${row.os} ${row.os_version}`.trim(),
      label: platformLabel(row.os, row.os_version),
      launches,
      pct: totalLaunches > 0 ? round((launches / totalLaunches) * 100, 1) : 0
    };
  });
}

function buildVersions(rows, totalLaunches) {
  return rows.map((row) => {
    const launches = number(row.launches);
    return {
      version: String(row.version || "unknown"),
      launches,
      pct: totalLaunches > 0 ? round((launches / totalLaunches) * 100, 1) : 0
    };
  });
}

function platformLabel(os, osVersion) {
  const name = String(os || "unknown").toLowerCase();
  const version = String(osVersion || "").trim();

  if (name === "windows") {
    if (!version || version === "unknown") return "Windows";
    if (/^\d+$/.test(version)) return `Windows ${version}`;
    return `Windows ${version}`;
  }
  if (name === "macos" || name === "mac") return "macOS";
  if (name === "linux") return "Linux";
  if (name === "unknown" || !name) return "Unknown";
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function utcDay(offsetDays) {
  const date = new Date(Date.now() + offsetDays * 86400000);
  return date.toISOString().slice(0, 10);
}

/* ------------------------------------------------------------
   Input helpers
   ------------------------------------------------------------ */
function text(value, max, fallback) {
  if (typeof value !== "string") return fallback;
  const clean = value.trim().slice(0, max);
  return clean.length ? clean : fallback;
}

function int(value, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(Math.max(parsed, min), max);
}

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders()
    }
  });
}
