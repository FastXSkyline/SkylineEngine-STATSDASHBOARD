export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (url.pathname === "/api/auth/send" && request.method === "POST") return sendLoginCode(request, env);
    if (url.pathname === "/api/auth/verify" && request.method === "POST") return verifyLoginCode(request, env);
    if (url.pathname === "/api/auth/logout" && request.method === "POST") return logout(request, env);
    if (url.pathname === "/api/auth/session" && request.method === "GET") return json({ authenticated: await isAuthenticated(request, env) });

  if (
  (url.pathname === "/login" || url.pathname === "/login.html") &&
  request.method === "GET"
) {
  return env.ASSETS.fetch(
    new Request(new URL("/login.html", request.url), {
      method: "GET",
      headers: request.headers
    })
  );
}

if (
  url.pathname !== "/launch" &&
  !["/login.css", "/login.js"].includes(url.pathname) &&
  !(await isAuthenticated(request, env))
) {
  if (url.pathname.startsWith("/api/")) {
    return json({ error: "Unauthorized" }, 401);
  }

  return Response.redirect(new URL("/login", request.url), 302);
}

   if (
  (url.pathname === "/login" || url.pathname === "/login.html") &&
  request.method === "GET"
) {
  if (await isAuthenticated(request, env)) {
    return Response.redirect(new URL("/", request.url), 302);
  }

  return env.ASSETS.fetch(
    new Request(new URL("/login.html", request.url), request)
  );
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
               (user_id, user_name, app_version, os, os_version, arch, locale,
                tz_offset_min, screen_w, screen_h, cpu_cores, ram_gb, event, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                     strftime('%Y-%m-%d %H:%M:%S','now'))`
          )
            .bind(
              userId,
              text(body.user_name, 64, null),
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
          try {
            await env.DB.prepare(
              "INSERT INTO launches (user_id, app_version) VALUES (?, ?)"
            )
              .bind(userId, text(body.app_version, 64, "unknown"))
              .run();
          } catch (minimalError) {
            await env.DB.prepare(
              "INSERT INTO launches (user_id) VALUES (?)"
            ).bind(userId).run();
          }
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

const ADMIN_EMAILS = new Set(["fastxgod01@gmail.com", "hackdz2006@gmail.com"]);
const SESSION_COOKIE = "skyline_admin_session";

async function ensureAuthTables(db) {
  await db.prepare("CREATE TABLE IF NOT EXISTS admin_login_codes (email TEXT PRIMARY KEY, code_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS admin_sessions (token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, expires_at INTEGER NOT NULL)").run();
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function cookieValue(request, name) {
  const raw = request.headers.get("Cookie") || "";
  for (const part of raw.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return "";
}

async function isAuthenticated(request, env) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return false;
  await ensureAuthTables(env.DB);
  const tokenHash = await sha256(token);
  const session = await env.DB.prepare("SELECT email, expires_at FROM admin_sessions WHERE token_hash = ?").bind(tokenHash).first();
  if (!session || session.expires_at < Math.floor(Date.now() / 1000) || !ADMIN_EMAILS.has(session.email)) return false;
  return true;
}

async function sendLoginCode(request, env) {
  try {
    const body = await request.json();
    const email = String(body.email || "").trim().toLowerCase();
    if (!ADMIN_EMAILS.has(email)) return json({ error: "This email is not authorized." }, 403);
if (!env.V4) return json({ error: "Email service is not configured." }, 503);
    await ensureAuthTables(env.DB);
    const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0");
    const expiresAt = Math.floor(Date.now() / 1000) + 600;
    const codeHash = await sha256(`${email}:${code}`);
    await env.DB.prepare("INSERT INTO admin_login_codes (email, code_hash, expires_at, attempts) VALUES (?, ?, ?, 0) ON CONFLICT(email) DO UPDATE SET code_hash=excluded.code_hash, expires_at=excluded.expires_at, attempts=0").bind(email, codeHash, expiresAt).run();
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.V4}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: "Skyline Engine <onboarding@resend.dev>", to: [email], subject: "Your Skyline Engine login code", text: `Your Skyline Engine admin verification code is ${code}. It expires in 10 minutes.` })
    });
    if (!response.ok) {
      await env.DB.prepare("DELETE FROM admin_login_codes WHERE email = ?").bind(email).run();
      return json({ error: "Could not send the email. Check your Resend setup and verified domain." }, 502);
    }
    return json({ success: true });
  } catch (error) {
    return json({ error: "Could not send verification code." }, 500);
  }
}

async function verifyLoginCode(request, env) {
  try {
    const body = await request.json();
    const email = String(body.email || "").trim().toLowerCase();
    const code = String(body.code || "").trim();
    if (!ADMIN_EMAILS.has(email) || !/^\d{6}$/.test(code)) return json({ error: "Invalid email or code." }, 400);
    await ensureAuthTables(env.DB);
    const row = await env.DB.prepare("SELECT code_hash, expires_at, attempts FROM admin_login_codes WHERE email = ?").bind(email).first();
    if (!row || row.expires_at < Math.floor(Date.now() / 1000) || row.attempts >= 5) return json({ error: "Code expired. Request a new one." }, 400);
    const expected = await sha256(`${email}:${code}`);
    if (expected !== row.code_hash) {
      await env.DB.prepare("UPDATE admin_login_codes SET attempts = attempts + 1 WHERE email = ?").bind(email).run();
      return json({ error: "Incorrect verification code." }, 400);
    }
    await env.DB.prepare("DELETE FROM admin_login_codes WHERE email = ?").bind(email).run();
    const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
    const token = Array.from(tokenBytes, (b) => b.toString(16).padStart(2, "0")).join("");
    const expiresAt = Math.floor(Date.now() / 1000) + 7 * 86400;
    await env.DB.prepare("INSERT INTO admin_sessions (token_hash, email, expires_at) VALUES (?, ?, ?)").bind(await sha256(token), email, expiresAt).run();
    return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json", "Set-Cookie": `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${7 * 86400}`, ...corsHeaders() } });
  } catch (error) {
    return json({ error: "Could not verify code." }, 500);
  }
}

async function logout(request, env) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (token) {
    await ensureAuthTables(env.DB);
    await env.DB.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  }
  return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json", "Set-Cookie": `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`, ...corsHeaders() } });
}

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
  const hourSince = `-${days * 24} hours`;

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
      `SELECT date(created_at) AS day, strftime('%Y-%m-%dT%H:00:00', created_at) AS hour_bucket,
              COUNT(*) AS launches, COUNT(DISTINCT user_id) AS users
       FROM launches WHERE created_at >= datetime('now', ?)
       GROUP BY hour_bucket ORDER BY hour_bucket`
    ).bind(hourSince),
    db.prepare(
      `SELECT strftime('%Y-%m-%dT%H:00:00', first_at) AS hour_bucket, COUNT(*) AS users FROM
         (SELECT user_id, MIN(created_at) AS first_at FROM launches WHERE created_at IS NOT NULL GROUP BY user_id)
       WHERE first_at >= datetime('now', ?)
       GROUP BY hour_bucket ORDER BY hour_bucket`
    ).bind(hourSince),
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
              (SELECT l3.user_name FROM launches l3 WHERE l3.user_id = l.user_id AND l3.user_name IS NOT NULL ORDER BY l3.created_at DESC LIMIT 1) AS user_name,
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
              (SELECT l3.user_name FROM launches l3 WHERE l3.user_id = l.user_id AND l3.user_name IS NOT NULL ORDER BY l3.created_at DESC LIMIT 1) AS user_name,
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
      userName: row.user_name || "",
      appVersion: row.app_version,
      os: row.os,
      osVersion: row.os_version || "",
      createdAt: row.created_at,
      isNew: number(row.is_first) === 1
    })),

    userDetails: (userRows.results || []).map((row) => ({
      userId: row.user_id,
      userName: row.user_name || "",
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
  const hourly = days <= 3;
  const byBucket = new Map();
  const newByBucket = new Map();

  for (const row of launchRows) {
    byBucket.set(row.hour_bucket, { launches: number(row.launches), users: number(row.users) });
  }
  for (const row of newUserRows) {
    newByBucket.set(row.hour_bucket, number(row.users));
  }

  const series = [];
  if (hourly) {
    const now = new Date();
    const currentHour = Date.UTC(
      now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
      now.getUTCHours(), 0, 0, 0
    );
    const hourMs = 3600000;
    const totalHours = days * 24;

    for (let offset = totalHours - 1; offset >= 0; offset--) {
      const bucketMs = currentHour - offset * hourMs;
      const bucket = new Date(bucketMs).toISOString().slice(0, 13) + ":00:00";
      const entry = byBucket.get(bucket) || { launches: 0, users: 0 };
      series.push({
        day: bucket,
        hourly: true,
        launches: entry.launches,
        users: entry.users,
        newUsers: newByBucket.get(bucket) || 0
      });
    }
  } else {
    for (let offset = days - 1; offset >= 0; offset--) {
      const day = utcDay(-offset);
      const entry = byBucket.get(day) || { launches: 0, users: 0 };
      series.push({
        day,
        hourly: false,
        launches: entry.launches,
        users: entry.users,
        newUsers: newByBucket.get(day) || 0
      });
    }
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
