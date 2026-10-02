export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (url.pathname === "/api/auth/login" && request.method === "POST") return keyAuthLogin(request, env);
    if (url.pathname === "/api/auth/logout" && request.method === "POST") return logout(request, env);
    if (url.pathname === "/api/auth/session" && request.method === "GET") {
      const authenticated = await isAuthenticated(request, env);
      return json({ authenticated });
    }

    if (url.pathname === "/" && request.method === "GET") {
      const authenticated = await isAuthenticated(request, env);
      if (!authenticated) {
        return env.ASSETS.fetch(new Request(new URL("/login.html", request.url), request));
      }
      await ensureFiveMSchema(env.DB);
    }

    if (url.pathname === "/api/stats" && request.method === "GET" && !(await isAuthenticated(request, env))) {
      return json({ error: "Authentication required." }, 401);
    }

    if (url.pathname === "/api/search" && request.method === "GET") {
      if (!(await isAuthenticated(request, env))) return json({ error: "Authentication required." }, 401);
      return searchTelemetry(request, env);
    }

    if ((url.pathname === "/launch" || url.pathname === "/launchstats" || url.pathname === "/api/launch" || url.pathname === "/api/launchstats" || url.pathname === "/stats/launch") && request.method === "POST") {
      try {
        const rawBody = await request.json();
        await ensureTelemetrySchema(env.DB);
        const body = rawBody?.launchstats && typeof rawBody.launchstats === "object"
          ? { ...rawBody.launchstats, ...rawBody }
          : rawBody;

        const userId = body.user_id ?? body.userId ?? body.userid ?? body.userID ?? body.id;
        if (!userId || (typeof userId !== "string" && typeof userId !== "number")) {
          return json({ error: "user_id is required" }, 400);
        }

        try {
          await env.DB.prepare(
            `INSERT INTO launches
               (user_id, user_name, app_version, os, os_version, arch, locale,
                tz_offset_min, screen_w, screen_h, cpu_cores, ram_gb, cpu_model, gpu_model, ram_free_gb, ram_used_pct, monitor_count, session_id, event, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                     strftime('%Y-%m-%d %H:%M:%S','now'))`
          )
            .bind(
              String(userId),
              text(body.user_name ?? body.userName ?? body.username, 64, null),
              text(body.app_version ?? body.appVersion ?? body.version, 64, "unknown"),
              text(body.os, 32, "unknown"),
              text(body.os_version, 32, null),
              text(body.arch, 16, null),
              text(body.locale, 24, null),
              int(body.tz_offset_min, -840, 840),
              int(body.screen_w, 0, 30000),
              int(body.screen_h, 0, 30000),
              int(body.cpu_cores, 0, 1024),
              int(body.ram_gb, 0, 102400),
              text(body.cpu_model, 128, null),
              text(body.gpu_model, 128, null),
              int(body.ram_free_gb, 0, 102400),
              int(body.ram_used_pct, 0, 100),
              int(body.monitor_count, 1, 32),
              text(body.session_id, 64, null),
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

    if (url.pathname === "/api/fivem/files" && request.method === "GET") {
      if (!(await isAuthenticated(request, env))) return json({ error: "Authentication required." }, 401);
      return listFiveMFiles(env.DB);
    }

    if (url.pathname === "/api/fivem/files" && request.method === "POST") {
      if (!(await isAuthenticated(request, env))) return json({ error: "Authentication required." }, 401);
      return createFiveMFile(request, env.DB);
    }

    if (url.pathname.startsWith("/api/fivem/files/") && request.method === "PUT") {
      if (!(await isAuthenticated(request, env))) return json({ error: "Authentication required." }, 401);
      return updateFiveMFile(request, env.DB, url.pathname.split("/").pop());
    }

    if (url.pathname.startsWith("/api/fivem/files/") && request.method === "DELETE") {
      if (!(await isAuthenticated(request, env))) return json({ error: "Authentication required." }, 401);
      return deleteFiveMFile(env.DB, url.pathname.split("/").pop());
    }

    if (url.pathname === "/api/stats" && request.method === "GET") {
      try {
        const days = clampInt(url.searchParams.get("days"), 14, 1, 90);
        await ensureTelemetrySchema(env.DB);
        return json(await buildStats(env.DB, days));
      } catch (error) {
        // Keep a useful response if a D1 query fails, but expose the reason instead of silently
        // turning the whole dashboard into an empty legacy view.
        try {
          const totals = await env.DB.prepare(
            "SELECT COUNT(*) AS launches, COUNT(DISTINCT user_id) AS users FROM launches"
          ).first();
          return json({ ...legacyStats(totals), errorState: true, errorMessage: String(error?.message || "Stats aggregation failed").slice(0, 300) });
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

const TELEMETRY_COLUMNS = [
  ["created_at", "TEXT"],
  ["os", "TEXT"],
  ["os_version", "TEXT"],
  ["arch", "TEXT"],
  ["locale", "TEXT"],
  ["tz_offset_min", "INTEGER"],
  ["screen_w", "INTEGER"],
  ["screen_h", "INTEGER"],
  ["cpu_cores", "INTEGER"],
  ["ram_gb", "INTEGER"],
  ["event", "TEXT DEFAULT 'launch'"],
  ["cpu_model", "TEXT"],
  ["gpu_model", "TEXT"],
  ["ram_free_gb", "INTEGER"],
  ["ram_used_pct", "INTEGER"],
  ["monitor_count", "INTEGER"],
  ["session_id", "TEXT"]
];

let telemetrySchemaPromise = null;

async function ensureTelemetrySchema(db) {
  if (telemetrySchemaPromise) return telemetrySchemaPromise;

  telemetrySchemaPromise = (async () => {
    for (const [column, definition] of TELEMETRY_COLUMNS) {
    try {
      await db.prepare(`ALTER TABLE launches ADD COLUMN ${column} ${definition}`).run();
    } catch (_) {}
  }

    try { await db.prepare("CREATE INDEX IF NOT EXISTS idx_launches_created_at ON launches(created_at)").run(); } catch (_) {}
    try { await db.prepare("CREATE INDEX IF NOT EXISTS idx_launches_cpu_model ON launches(cpu_model)").run(); } catch (_) {}
    try { await db.prepare("CREATE INDEX IF NOT EXISTS idx_launches_gpu_model ON launches(gpu_model)").run(); } catch (_) {}
    try { await db.prepare("CREATE INDEX IF NOT EXISTS idx_launches_session_id ON launches(session_id)").run(); } catch (_) {}
  })();

  return telemetrySchemaPromise;
}



async function ensureAuthTables(db) {
  await db.prepare("CREATE TABLE IF NOT EXISTS admin_login_codes (email TEXT PRIMARY KEY, code_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS admin_sessions (token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, expires_at INTEGER NOT NULL)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS keyauth_device_bindings (username TEXT PRIMARY KEY, device_hash TEXT NOT NULL, bound_at INTEGER NOT NULL)").run();
}


let fivemSchemaPromise = null;

async function ensureFiveMSchema(db) {
  if (fivemSchemaPromise) return fivemSchemaPromise;
  fivemSchemaPromise = (async () => {
    await db.prepare(
      `CREATE TABLE IF NOT EXISTS fivem_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        version TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        download_url TEXT NOT NULL DEFAULT '',
        file_name TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT 'Application',
        platform TEXT NOT NULL DEFAULT 'Windows',
        published INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
      )`
    ).run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_fivem_files_published ON fivem_files(published)").run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_fivem_files_updated_at ON fivem_files(updated_at)").run();
  })();
  return fivemSchemaPromise;
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
  if (!session || session.expires_at < Math.floor(Date.now() / 1000)) return false;
  return String(session.email || "").startsWith("keyauth:");
}

function getDeviceId(request) {
  const value = request.headers.get("X-Skyline-Device");
  return typeof value === "string" && value.length >= 32 && value.length <= 128 ? value : "";
}

async function keyAuthLogin(request, env) {
  try {
    const body = await request.json();
    const username = String(body.username || "").trim();
    const password = String(body.password || "");

    if (!username || !password || username.length > 128 || password.length > 256) {
      return json({ error: "Username and password are required." }, 400);
    }

    const initParams = new URLSearchParams({
      type: "init",
      ver: String(env.KEYAUTH_VERSION || "1.0"),
      name: String(env.KEYAUTH_NAME || "DashBoardStats"),
      ownerid: String(env.KEYAUTH_OWNERID || "2rnJ2XxHhk")
    });

    const initResponse = await fetch("https://keyauth.win/api/1.3/?" + initParams.toString());
    const initData = await initResponse.json().catch(() => null);

    if (!initResponse.ok || !initData?.success || !initData?.sessionid) {
      return json({ error: initData?.message || "KeyAuth initialization failed." }, 502);
    }

    const loginParams = new URLSearchParams({
      type: "login",
      username,
      pass: password,
      sessionid: String(initData.sessionid),
      name: String(env.KEYAUTH_NAME || "DashBoardStats"),
      ownerid: String(env.KEYAUTH_OWNERID || "2rnJ2XxHhk")
    });

    const loginResponse = await fetch("https://keyauth.win/api/1.3/?" + loginParams.toString());
    const loginData = await loginResponse.json().catch(() => null);

    if (!loginResponse.ok || !loginData?.success) {
      return json({ error: loginData?.message || "Invalid KeyAuth username or password." }, 401);
    }

    await ensureAuthTables(env.DB);

    const deviceId = getDeviceId(request);
    if (!deviceId) {
      return json({ error: "A browser device identifier is required." }, 400);
    }

    const deviceHash = await sha256(deviceId);
    const existingBinding = await env.DB.prepare(
      "SELECT device_hash FROM keyauth_device_bindings WHERE username = ?"
    ).bind(username).first();

    if (existingBinding && existingBinding.device_hash !== deviceHash) {
      return json({ error: "This KeyAuth account is already bound to another browser device." }, 403);
    }

    if (!existingBinding) {
      await env.DB.prepare(
        "INSERT INTO keyauth_device_bindings (username, device_hash, bound_at) VALUES (?, ?, ?)"
      ).bind(username, deviceHash, Math.floor(Date.now() / 1000)).run();
    }

    const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
    const token = Array.from(tokenBytes, (b) => b.toString(16).padStart(2, "0")).join("");
    const expiresAt = Math.floor(Date.now() / 1000) + 7 * 86400;

    await env.DB.prepare(
      "INSERT INTO admin_sessions (token_hash, email, expires_at) VALUES (?, ?, ?)"
    ).bind(await sha256(token), "keyauth:" + username, expiresAt).run();

    return new Response(JSON.stringify({
      success: true,
      username: loginData?.info?.username || username
    }), {
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": "skyline_admin_session=" + token + "; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=" + (7 * 86400),
        ...corsHeaders()
      }
    });
  } catch (error) {
    return json({ error: "Could not connect to KeyAuth." }, 502);
  }
}

async function sendLoginCode(request, env) {
  try {
    const body = await request.json();
    const email = String(body.email || "").trim().toLowerCase();
    if (!ADMIN_EMAILS.has(email)) return json({ error: "This email is not authorized." }, 403);

    const brevoApiKey = env.SkylineEngineV1;
    if (!brevoApiKey) return json({ error: "Email service is not configured." }, 503);

    await ensureAuthTables(env.DB);
    const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0");
    const expiresAt = Math.floor(Date.now() / 1000) + 600;
    const codeHash = await sha256(`${email}:${code}`);

    await env.DB.prepare(
      "INSERT INTO admin_login_codes (email, code_hash, expires_at, attempts) VALUES (?, ?, ?, 0) ON CONFLICT(email) DO UPDATE SET code_hash=excluded.code_hash, expires_at=excluded.expires_at, attempts=0"
    ).bind(email, codeHash, expiresAt).run();

    const senderEmail = env.BREVO_SENDER_EMAIL || "fastxgod01@gmail.com";
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": brevoApiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        sender: {
          name: "Skyline Engine",
          email: senderEmail
        },
        to: [{ email }],
        subject: "Your Skyline Engine login code",
        textContent: `Your Skyline Engine admin verification code is ${code}. It expires in 10 minutes.`
      })
    });

    if (!response.ok) {
      const responseText = await response.text();
      await env.DB.prepare("DELETE FROM admin_login_codes WHERE email = ?").bind(email).run();

      let resendError = "Brevo rejected the email.";
      try {
        const data = JSON.parse(responseText);
        if (typeof data?.message === "string" && data.message.trim()) {
          resendError = data.message.trim().slice(0, 300);
        }
      } catch {}

      return json({ error: resendError }, 502);
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

    if (!ADMIN_EMAILS.has(email) || !/^\d{6}$/.test(code)) {
      return json({ error: "Invalid email or code." }, 400);
    }

    await ensureAuthTables(env.DB);
    const row = await env.DB.prepare(
      "SELECT code_hash, expires_at, attempts FROM admin_login_codes WHERE email = ?"
    ).bind(email).first();

    if (!row || row.expires_at < Math.floor(Date.now() / 1000) || row.attempts >= 5) {
      return json({ error: "Code expired. Request a new one." }, 400);
    }

    const expected = await sha256(`${email}:${code}`);
    if (expected !== row.code_hash) {
      await env.DB.prepare("UPDATE admin_login_codes SET attempts = attempts + 1 WHERE email = ?").bind(email).run();
      return json({ error: "Incorrect verification code." }, 400);
    }

    await env.DB.prepare("DELETE FROM admin_login_codes WHERE email = ?").bind(email).run();

    const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
    const token = Array.from(tokenBytes, (b) => b.toString(16).padStart(2, "0")).join("");
    const expiresAt = Math.floor(Date.now() / 1000) + 7 * 86400;

    await env.DB.prepare(
      "INSERT INTO admin_sessions (token_hash, email, expires_at) VALUES (?, ?, ?)"
    ).bind(await sha256(token), email, expiresAt).run();

    return new Response(JSON.stringify({ success: true }), {
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${7 * 86400}`,
        ...corsHeaders()
      }
    });
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

async function searchTelemetry(request, env) {
  try {
    const url = new URL(request.url);
    const q = String(url.searchParams.get("q") || "").trim().slice(0, 120);
    const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get("limit") || "100", 10) || 100, 1), 100);

    if (!q) return json({ query: "", results: [] });

    await ensureTelemetrySchema(env.DB);
    const like = "%" + q + "%";
    const result = await env.DB.prepare(
      `SELECT user_id, user_name, app_version, os, os_version, cpu_model, gpu_model,
              ram_gb, ram_free_gb, ram_used_pct, monitor_count, screen_w, screen_h,
              session_id, event, created_at
       FROM launches
       WHERE CAST(user_id AS TEXT) LIKE ?
          OR COALESCE(user_name, '') LIKE ?
          OR COALESCE(app_version, '') LIKE ?
          OR COALESCE(os, '') LIKE ?
          OR COALESCE(os_version, '') LIKE ?
          OR COALESCE(cpu_model, '') LIKE ?
          OR COALESCE(gpu_model, '') LIKE ?
          OR COALESCE(session_id, '') LIKE ?
       ORDER BY created_at DESC
       LIMIT ?`
    ).bind(like, like, like, like, like, like, like, like, limit).all();

    return json({
      query: q,
      results: (result.results || []).map((row) => ({
        userId: row.user_id,
        userName: row.user_name || "",
        appVersion: row.app_version || "",
        os: row.os || "unknown",
        osVersion: row.os_version || "",
        cpuModel: row.cpu_model || "",
        gpuModel: row.gpu_model || "",
        ramGb: number(row.ram_gb),
        ramFreeGb: number(row.ram_free_gb),
        ramUsedPct: number(row.ram_used_pct),
        monitorCount: number(row.monitor_count),
        screen: row.screen_w && row.screen_h ? String(row.screen_w) + "x" + String(row.screen_h) : "",
        sessionId: row.session_id || "",
        event: row.event || "launch",
        createdAt: row.created_at
      }))
    });
  } catch (error) {
    return json({ error: String(error?.message || "Search failed.").slice(0, 300) }, 500);
  }
}

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
  const hourSince = `-${days * 24} hours`;

  // Keep the dashboard alive even when an optional telemetry column is
  // missing from an older D1 schema. One failed analytics query must not
  // blank the entire home page.
  const safeAll = async (statement) => {
    try {
      return await statement.all();
    } catch (_) {
      return { results: [] };
    }
  };

  const safeFirst = async (statement) => {
    try {
      return await statement.first();
    } catch (_) {
      return null;
    }
  };

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
    hardwareRow,
    cpuRows,
    gpuRows,
    recentRows,
    userRows
  ] = await Promise.all([
    safeFirst(db.prepare(
      "SELECT COUNT(*) AS launches, COUNT(DISTINCT user_id) AS users, MAX(created_at) AS last_launch_at FROM launches"
    )),
    safeFirst(db.prepare(
      "SELECT COUNT(*) AS launches, COUNT(DISTINCT user_id) AS users FROM launches WHERE date(created_at) = date('now')"
    )),
    safeFirst(db.prepare(
      "SELECT COUNT(*) AS launches, COUNT(DISTINCT user_id) AS users FROM launches WHERE created_at >= datetime('now','-7 days')"
    )),
    safeFirst(db.prepare(
      `SELECT COUNT(*) AS users FROM
         (SELECT user_id, MIN(created_at) AS first_at FROM launches WHERE created_at IS NOT NULL GROUP BY user_id)
       WHERE date(first_at) = date('now')`
    )),
    safeFirst(db.prepare(
      `SELECT COUNT(*) AS users FROM
         (SELECT user_id, MIN(created_at) AS first_at FROM launches WHERE created_at IS NOT NULL GROUP BY user_id)
       WHERE first_at >= datetime('now','-7 days')`
    )),
    safeAll(db.prepare(
      `SELECT date(created_at) AS day, strftime('%Y-%m-%dT%H:00:00', created_at) AS hour_bucket,
              COUNT(*) AS launches, COUNT(DISTINCT user_id) AS users
       FROM launches WHERE created_at >= datetime('now', ?)
       GROUP BY hour_bucket ORDER BY hour_bucket`
    ).bind(hourSince)),
    safeAll(db.prepare(
      `SELECT strftime('%Y-%m-%dT%H:00:00', first_at) AS hour_bucket, COUNT(*) AS users FROM
         (SELECT user_id, MIN(created_at) AS first_at FROM launches WHERE created_at IS NOT NULL GROUP BY user_id)
       WHERE first_at >= datetime('now', ?)
       GROUP BY hour_bucket ORDER BY hour_bucket`
    ).bind(hourSince)),
    safeAll(db.prepare(
      `SELECT COALESCE(NULLIF(os, ''), 'unknown') AS os,
              COALESCE(NULLIF(os_version, ''), '') AS os_version,
              COUNT(*) AS launches
       FROM launches GROUP BY os, os_version ORDER BY launches DESC LIMIT 6`
    )),
    safeAll(db.prepare(
      `SELECT COALESCE(app_version, 'unknown') AS version, COUNT(*) AS launches
       FROM launches GROUP BY app_version ORDER BY launches DESC LIMIT 5`
    )),
    safeFirst(db.prepare(
      `SELECT
         (SELECT ROUND(AVG(cpu_cores), 1) FROM launches WHERE cpu_cores > 0) AS avg_cores,
         (SELECT ROUND(AVG(ram_gb), 1) FROM launches WHERE ram_gb > 0) AS avg_ram,
         (SELECT ROUND(AVG(ram_used_pct), 1) FROM launches WHERE ram_used_pct >= 0) AS avg_ram_used_pct,
         (SELECT COUNT(*) FROM launches WHERE cpu_cores > 0) AS samples,
         (SELECT screen_w || 'x' || screen_h FROM launches WHERE screen_w > 0
          GROUP BY screen_w, screen_h ORDER BY COUNT(*) DESC LIMIT 1) AS common_screen`
    )),
    safeAll(db.prepare(
      `SELECT COALESCE(NULLIF(cpu_model, ''), 'Unknown CPU') AS model, COUNT(*) AS launches
       FROM launches WHERE cpu_model IS NOT NULL AND cpu_model <> ''
       GROUP BY cpu_model ORDER BY launches DESC LIMIT 5`
    )),
    safeAll(db.prepare(
      `SELECT COALESCE(NULLIF(gpu_model, ''), 'Unknown GPU') AS model, COUNT(*) AS launches
       FROM launches WHERE gpu_model IS NOT NULL AND gpu_model <> ''
       GROUP BY gpu_model ORDER BY launches DESC LIMIT 5`
    )),
    safeAll(db.prepare(
      `SELECT l.user_id AS user_id,
              (SELECT l3.user_name FROM launches l3 WHERE l3.user_id = l.user_id AND l3.user_name IS NOT NULL ORDER BY l3.created_at DESC LIMIT 1) AS user_name,
              l.app_version AS app_version,
              COALESCE(l.os, 'unknown') AS os,
              COALESCE(l.os_version, '') AS os_version,
              l.created_at AS created_at,
              l.cpu_model AS cpu_model,
              l.gpu_model AS gpu_model,
              l.ram_used_pct AS ram_used_pct,
              l.monitor_count AS monitor_count,
              l.session_id AS session_id,
              (l.created_at = (SELECT MIN(l2.created_at) FROM launches l2 WHERE l2.user_id = l.user_id)) AS is_first
       FROM launches l
       WHERE l.created_at IS NOT NULL
       ORDER BY l.created_at DESC
       LIMIT 1000`
    )),
    safeAll(db.prepare(
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
    ))
  ]);

  const totalsRow = totals || {};
  const launches = number(totalsRow.launches);
  const users = number(totalsRow.users);

  return {
    launches,
    users,
    launchesToday: number(today?.launches),
    usersToday: number(today?.users),
    newUsersToday: number(newToday?.users),
    launches7d: number(week?.launches),
    activeUsers7d: number(week?.users),
    newUsers7d: number(newWeek?.users),
    lastLaunchAt: totalsRow.last_launch_at || null,
    avgLaunchesPerUser: users > 0 ? round(launches / users, 2) : 0,
    days,

    series: buildSeries(days, seriesRows.results || [], newSeriesRows.results || []),
    platforms: buildPlatforms(platformRows.results || [], launches),
    versions: buildVersions(versionRows.results || [], launches),

    hardware: {
      avgCores: number(hardwareRow?.avg_cores) || null,
      avgRamGb: number(hardwareRow?.avg_ram) || null,
      commonScreen: hardwareRow?.common_screen || null,
      avgRamUsedPct: number(hardwareRow?.avg_ram_used_pct) || null,
      samples: number(hardwareRow?.samples),
      cpuModels: (cpuRows.results || []).map((r) => ({ model: r.model, launches: number(r.launches) })),
      gpuModels: (gpuRows.results || []).map((r) => ({ model: r.model, launches: number(r.launches) }))
    },

    recent: (recentRows.results || []).map((row) => ({
      userId: row.user_id,
      userName: row.user_name || "",
      appVersion: row.app_version || "unknown",
      os: row.os || "unknown",
      osVersion: row.os_version || "",
      createdAt: row.created_at,
      cpuModel: row.cpu_model || "",
      gpuModel: row.gpu_model || "",
      ramUsedPct: number(row.ram_used_pct),
      monitorCount: number(row.monitor_count),
      sessionId: row.session_id || "",
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

async function listFiveMFiles(db) {
  try {
    await ensureFiveMSchema(db);
    const result = await db.prepare("SELECT id, name, version, description, download_url, file_name, category, platform, published, created_at, updated_at FROM fivem_files ORDER BY updated_at DESC, id DESC").all();
    return json({ files: result.results || [] });
  } catch (error) {
    return json({ error: String(error?.message || "Failed to load FiveM files").slice(0, 300) }, 500);
  }
}

function fivemPayload(body) {
  const source = body && typeof body === "object" ? body : {};
  const payload = {
    name: text(source.name, 120, ""),
    version: text(source.version, 64, ""),
    description: text(source.description, 2000, ""),
    download_url: text(source.download_url ?? source.downloadUrl, 1000, ""),
    file_name: text(source.file_name ?? source.fileName, 255, ""),
    category: text(source.category, 64, "Application"),
    platform: text(source.platform, 32, "Windows"),
    published: source.published ? 1 : 0
  };
  if (!payload.name) return { error: "File name is required." };
  if (payload.download_url && !/^https?:\\/\\//i.test(payload.download_url)) return { error: "Download URL must start with http:// or https://." };
  return payload;
}

async function createFiveMFile(request, db) {
  try {
    const body = await request.json();
    const payload = fivemPayload(body);
    if (payload.error) return json({ error: payload.error }, 400);
    await ensureFiveMSchema(db);
    const result = await db.prepare("INSERT INTO fivem_files (name, version, description, download_url, file_name, category, platform, published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%d %H:%M:%S','now'), strftime('%Y-%m-%d %H:%M:%S','now'))").bind(payload.name, payload.version, payload.description, payload.download_url, payload.file_name, payload.category, payload.platform, payload.published).run();
    const file = await db.prepare("SELECT * FROM fivem_files WHERE id = ?").bind(result.meta?.last_row_id).first();
    return json({ success: true, file });
  } catch (error) {
    return json({ error: String(error?.message || "Failed to create file").slice(0, 300) }, 500);
  }
}

async function updateFiveMFile(request, db, id) {
  try {
    const fileId = Number.parseInt(id, 10);
    if (!Number.isInteger(fileId) || fileId < 1) return json({ error: "Invalid file id." }, 400);
    const existing = await db.prepare("SELECT id FROM fivem_files WHERE id = ?").bind(fileId).first();
    if (!existing) return json({ error: "File not found." }, 404);
    const body = await request.json();
    const payload = fivemPayload(body);
    if (payload.error) return json({ error: payload.error }, 400);
    await ensureFiveMSchema(db);
    await db.prepare("UPDATE fivem_files SET name=?, version=?, description=?, download_url=?, file_name=?, category=?, platform=?, published=?, updated_at=strftime('%Y-%m-%d %H:%M:%S','now') WHERE id=?").bind(payload.name, payload.version, payload.description, payload.download_url, payload.file_name, payload.category, payload.platform, payload.published, fileId).run();
    const file = await db.prepare("SELECT * FROM fivem_files WHERE id = ?").bind(fileId).first();
    return json({ success: true, file });
  } catch (error) {
    return json({ error: String(error?.message || "Failed to update file").slice(0, 300) }, 500);
  }
}

async function deleteFiveMFile(db, id) {
  try {
    const fileId = Number.parseInt(id, 10);
    if (!Number.isInteger(fileId) || fileId < 1) return json({ error: "Invalid file id." }, 400);
    const result = await db.prepare("DELETE FROM fivem_files WHERE id = ?").bind(fileId).run();
    if (!result.meta?.changes) return json({ error: "File not found." }, 404);
    return json({ success: true });
  } catch (error) {
    return json({ error: String(error?.message || "Failed to delete file").slice(0, 300) }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Pragma": "no-cache",
      ...corsHeaders()
    }
  });
}
