var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

var index_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
    // === VERSION CHECK: visit /api/version to verify optimized code is running ===
    if (url.pathname === "/api/version" && request.method === "GET") {
      return new Response(JSON.stringify({ version: "optimized-v6", cacheEnabled: true, cacheTTL: "5min", fixes: ["stats-cache-5min", "stable-cache-key", "client-polling-60s", "auth-schema-cached", "auth-session-cached-60s", "query-indexes", "shared-d1-releases", "all-users-cache-60s", "recent-grouped-single-scan"], deployedAt: new Date().toISOString() }), { headers: { "Content-Type": "application/json", "X-Skyline-Optimized": "v6", ...corsHeaders() } });
    }
    if (url.pathname === "/api/auth/login" && request.method === "POST") return keyAuthLogin(request, env);
    if (url.pathname === "/api/auth/logout" && request.method === "POST") return logout(request, env);
    if (url.pathname === "/api/auth/session" && request.method === "GET") return json({ authenticated: await isAuthenticated(request, env) });
    if (url.pathname === "/" && request.method === "GET") {
      if (!await isAuthenticated(request, env)) return env.ASSETS.fetch(new Request(new URL("/login.html", request.url), request));
      await ensureFiveMSchema(env.DB);
    }
    if (url.pathname === "/api/stats" && request.method === "GET" && !await isAuthenticated(request, env)) return json({ error: "Authentication required." }, 401);
    if (url.pathname === "/api/search" && request.method === "GET") {
      if (!await isAuthenticated(request, env)) return json({ error: "Authentication required." }, 401);
      return searchTelemetry(request, env);
    }
    if (["/launch","/launchstats","/api/launch","/api/launchstats","/stats/launch"].includes(url.pathname) && request.method === "POST") {
      try {
        const rawBody = await request.json();
        await ensureTelemetrySchema(env.DB);
        const body = rawBody?.launchstats && typeof rawBody.launchstats === "object" ? { ...rawBody.launchstats, ...rawBody } : rawBody;
        const userId = body.user_id ?? body.userId ?? body.userid ?? body.userID ?? body.id;
        if (!userId) return json({ error: "user_id is required" }, 400);
        try { await env.DB.prepare("INSERT INTO launches (user_id, user_name, app_version, os, os_version, arch, locale, tz_offset_min, screen_w, screen_h, cpu_cores, ram_gb, cpu_model, gpu_model, ram_free_gb, ram_used_pct, monitor_count, session_id, event, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,strftime('%Y-%m-%d %H:%M:%S','now'))").bind(String(userId), text(body.user_name ?? body.userName ?? body.username, 64, null), text(body.app_version ?? body.appVersion ?? body.version, 64, "unknown"), text(body.os, 32, "unknown"), text(body.os_version, 32, null), text(body.arch, 16, null), text(body.locale, 24, null), int(body.tz_offset_min, -840, 840), int(body.screen_w, 0, 3e4), int(body.screen_h, 0, 3e4), int(body.cpu_cores, 0, 1024), int(body.ram_gb, 0, 102400), text(body.cpu_model, 128, null), text(body.gpu_model, 128, null), int(body.ram_free_gb, 0, 102400), int(body.ram_used_pct, 0, 100), int(body.monitor_count, 1, 32), text(body.session_id, 64, null), text(body.event, 32, "launch")).run(); }
        catch (e) { try { await env.DB.prepare("INSERT INTO launches (user_id, app_version) VALUES (?, ?)").bind(userId, text(body.app_version, 64, "unknown")).run(); } catch (e2) { await env.DB.prepare("INSERT INTO launches (user_id) VALUES (?)").bind(userId).run(); } }
        return json({ success: true });
      } catch (error) { return json({ error: "Failed to record launch" }, 500); }
    }
    if (url.pathname === "/api/public/fivem/files" && request.method === "GET") {
      try {
        await ensureFiveMSchema(env.DB);
        let r;
        try { r = await env.DB.prepare("SELECT id, name, version, description, download_url, file_name, category, platform, downloadable, license_key, rar_password, created_at, updated_at FROM fivem_files WHERE published = 1 ORDER BY updated_at DESC, id DESC").all(); }
        catch (_) { r = await env.DB.prepare("SELECT id, name, version, description, download_url, file_name, category, platform, created_at, updated_at FROM fivem_files WHERE published = 1 ORDER BY updated_at DESC, id DESC").all(); }
        const response = json({ files: (r.results || []).map(f => ({ ...f, downloadable: f.downloadable === void 0 ? 1 : f.downloadable })) });
        response.headers.set("Cache-Control", "public, max-age=60, s-maxage=60");
        return response;
      } catch (error) { return json({ error: "Failed to load published FiveM files." }, 500); }
    }
    if (url.pathname.startsWith("/api/public/fivem/files/") && url.pathname.endsWith("/download") && request.method === "POST") return incrementFiveMDownload(env.DB, url.pathname.split("/")[5]);
    if (url.pathname === "/api/fivem/files" && request.method === "GET") { if (!await isAuthenticated(request, env)) return json({ error: "Authentication required." }, 401); return listFiveMFiles(env.DB); }
    if (url.pathname === "/api/fivem/files" && request.method === "POST") { if (!await isAuthenticated(request, env)) return json({ error: "Authentication required." }, 401); return createFiveMFile(request, env.DB); }
    if (url.pathname.startsWith("/api/fivem/files/") && request.method === "PUT") { if (!await isAuthenticated(request, env)) return json({ error: "Authentication required." }, 401); return updateFiveMFile(request, env.DB, url.pathname.split("/").pop()); }
    if (url.pathname.startsWith("/api/fivem/files/") && request.method === "DELETE") { if (!await isAuthenticated(request, env)) return json({ error: "Authentication required." }, 401); return deleteFiveMFile(env.DB, url.pathname.split("/").pop()); }
    if (url.pathname === "/api/stats" && request.method === "GET") {
      // === Optimized stats cache: stable query key + 5-minute edge cache ===
      const cacheKey = new Request(new URL("/api/stats" + url.search, url.origin).toString(), request);
      const cache = caches.default;
      const cached = await cache.match(cacheKey);
      if (cached) return cached;
      try {
        const days = clampInt(url.searchParams.get("days"), 14, 1, 90);
        const recentMode = url.searchParams.get("recentMode") === "flat" ? "flat" : "grouped";
        const recentPage = clampInt(url.searchParams.get("recentPage"), 1, 1, 1e5);
        await ensureTelemetrySchema(env.DB);
        const statsData = await buildStats(env.DB, days, recentMode, recentPage);
        const response = json(statsData);
        response.headers.set("Cache-Control", "public, max-age=300, s-maxage=300");
        await cache.put(cacheKey, response.clone());
        return response;
      } catch (error) {
        try { const totals = await env.DB.prepare("SELECT COUNT(*) AS launches, COUNT(DISTINCT user_id) AS users FROM launches").first(); return json({ ...legacyStats(totals), errorState: true, errorMessage: String(error?.message || "Stats aggregation failed").slice(0, 300) }); }
        catch (_) { return json({ error: "Failed to fetch stats" }, 500); }
      }
    }
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Not found", { status: 404, headers: corsHeaders() });
  }
};

var SESSION_COOKIE = "skyline_admin_session";
var TELEMETRY_COLUMNS = [["created_at","TEXT"],["os","TEXT"],["os_version","TEXT"],["arch","TEXT"],["locale","TEXT"],["tz_offset_min","INTEGER"],["screen_w","INTEGER"],["screen_h","INTEGER"],["cpu_cores","INTEGER"],["ram_gb","INTEGER"],["event","TEXT DEFAULT 'launch'"],["cpu_model","TEXT"],["gpu_model","TEXT"],["ram_free_gb","INTEGER"],["ram_used_pct","INTEGER"],["monitor_count","INTEGER"],["session_id","TEXT"]];

var telemetrySchemaPromise = null;
async function ensureTelemetrySchema(db) {
  if (telemetrySchemaPromise) return telemetrySchemaPromise;
  telemetrySchemaPromise = (async () => {
    for (const [c, d] of TELEMETRY_COLUMNS) { try { await db.prepare("ALTER TABLE launches ADD COLUMN " + c + " " + d).run(); } catch (_) {} }
    for (const idx of ["idx_launches_created_at ON launches(created_at)","idx_launches_user_id ON launches(user_id)","idx_launches_user_created_at ON launches(user_id, created_at)","idx_launches_cpu_model ON launches(cpu_model)","idx_launches_gpu_model ON launches(gpu_model)","idx_launches_session_id ON launches(session_id)","idx_launches_app_version ON launches(app_version)","idx_launches_os_version ON launches(os, os_version)"]) { try { await db.prepare("CREATE INDEX IF NOT EXISTS " + idx).run(); } catch (_) {} }
  })();
  return telemetrySchemaPromise;
}
__name(ensureTelemetrySchema, "ensureTelemetrySchema");

// === FIX 2: Cache ensureAuthTables with module-level promise ===
var authSchemaPromise = null;
async function ensureAuthTables(db) {
  if (authSchemaPromise) return authSchemaPromise;
  authSchemaPromise = (async () => {
    await db.prepare("CREATE TABLE IF NOT EXISTS admin_login_codes (email TEXT PRIMARY KEY, code_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0)").run();
    await db.prepare("CREATE TABLE IF NOT EXISTS admin_sessions (token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, expires_at INTEGER NOT NULL)").run();
    await db.prepare("CREATE TABLE IF NOT EXISTS keyauth_device_bindings (username TEXT PRIMARY KEY, device_hash TEXT NOT NULL, bound_at INTEGER NOT NULL)").run();
  })();
  return authSchemaPromise;
}
__name(ensureAuthTables, "ensureAuthTables");

// === FIX 3: Cache auth session lookups for 60 seconds ===
var authCache = new Map();
var AUTH_CACHE_TTL = 6e4;

var fivemSchemaPromise = null;
async function ensureFiveMSchema(db) {
  if (fivemSchemaPromise) return fivemSchemaPromise;
  fivemSchemaPromise = (async () => {
    await db.prepare("CREATE TABLE IF NOT EXISTS fivem_files (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, version TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', download_url TEXT NOT NULL DEFAULT '', file_name TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT 'Application', platform TEXT NOT NULL DEFAULT 'Windows', published INTEGER NOT NULL DEFAULT 0, downloadable INTEGER NOT NULL DEFAULT 1, license_key TEXT NOT NULL DEFAULT '', rar_password TEXT NOT NULL DEFAULT '', download_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')))").run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_fivem_files_published ON fivem_files(published)").run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_fivem_files_updated_at ON fivem_files(updated_at)").run();
    for (const col of ["downloadable INTEGER NOT NULL DEFAULT 1","license_key TEXT NOT NULL DEFAULT ''","rar_password TEXT NOT NULL DEFAULT ''","download_count INTEGER NOT NULL DEFAULT 0"]) { try { await db.prepare("ALTER TABLE fivem_files ADD COLUMN " + col).run(); } catch (_) {} }
  })();
  return fivemSchemaPromise;
}
__name(ensureFiveMSchema, "ensureFiveMSchema");

async function sha256(v) { const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)); return Array.from(new Uint8Array(d), b => b.toString(16).padStart(2, "0")).join(""); }
__name(sha256, "sha256");

function cookieValue(request, name) { const raw = request.headers.get("Cookie") || ""; for (const part of raw.split(";")) { const [k, ...v] = part.trim().split("="); if (k === name) return v.join("="); } return ""; }
__name(cookieValue, "cookieValue");

async function isAuthenticated(request, env) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return false;
  const now = Date.now();
  const cached = authCache.get(token);
  if (cached && cached.expiresAt > now) return cached.authenticated;
  await ensureAuthTables(env.DB);
  const tokenHash = await sha256(token);
  const session = await env.DB.prepare("SELECT email, expires_at FROM admin_sessions WHERE token_hash = ?").bind(tokenHash).first();
  const authenticated = !!(session && session.expires_at >= Math.floor(now / 1e3) && String(session.email || "").startsWith("keyauth:"));
  authCache.set(token, { authenticated, expiresAt: now + AUTH_CACHE_TTL });
  return authenticated;
}
__name(isAuthenticated, "isAuthenticated");

function getDeviceId(request) { const v = request.headers.get("X-Skyline-Device"); return typeof v === "string" && v.length >= 32 && v.length <= 128 ? v : ""; }
__name(getDeviceId, "getDeviceId");

async function keyAuthLogin(request, env) {
  try {
    const body = await request.json();
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    if (!username || !password || username.length > 128 || password.length > 256) return json({ error: "Username and password are required." }, 400);
    const initParams = new URLSearchParams({ type: "init", ver: String(env.KEYAUTH_VERSION || "1.0"), name: String(env.KEYAUTH_NAME || "DashBoardStats"), ownerid: String(env.KEYAUTH_OWNERID || "2rnJ2XxHhk") });
    const initResponse = await fetch("https://keyauth.win/api/1.3/?" + initParams.toString());
    const initData = await initResponse.json().catch(() => null);
    if (!initResponse.ok || !initData?.success || !initData?.sessionid) return json({ error: initData?.message || "KeyAuth initialization failed." }, 502);
    const loginParams = new URLSearchParams({ type: "login", username, pass: password, sessionid: String(initData.sessionid), name: String(env.KEYAUTH_NAME || "DashBoardStats"), ownerid: String(env.KEYAUTH_OWNERID || "2rnJ2XxHhk") });
    const loginResponse = await fetch("https://keyauth.win/api/1.3/?" + loginParams.toString());
    const loginData = await loginResponse.json().catch(() => null);
    if (!loginResponse.ok || !loginData?.success) return json({ error: loginData?.message || "Invalid KeyAuth username or password." }, 401);
    await ensureAuthTables(env.DB);
    const deviceId = getDeviceId(request);
    if (!deviceId) return json({ error: "A browser device identifier is required." }, 400);
    const deviceHash = await sha256(deviceId);
    const existingBinding = await env.DB.prepare("SELECT device_hash FROM keyauth_device_bindings WHERE username = ?").bind(username).first();
    if (existingBinding && existingBinding.device_hash !== deviceHash) return json({ error: "This KeyAuth account is already bound to another browser device." }, 403);
    if (!existingBinding) await env.DB.prepare("INSERT INTO keyauth_device_bindings (username, device_hash, bound_at) VALUES (?, ?, ?)").bind(username, deviceHash, Math.floor(Date.now() / 1e3)).run();
    const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
    const token = Array.from(tokenBytes, b => b.toString(16).padStart(2, "0")).join("");
    const expiresAt = Math.floor(Date.now() / 1e3) + 604800;
    await env.DB.prepare("INSERT INTO admin_sessions (token_hash, email, expires_at) VALUES (?, ?, ?)").bind(await sha256(token), "keyauth:" + username, expiresAt).run();
    return new Response(JSON.stringify({ success: true, username: loginData?.info?.username || username }), { headers: { "Content-Type": "application/json", "Set-Cookie": "skyline_admin_session=" + token + "; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800", ...corsHeaders() } });
  } catch (error) { return json({ error: "Could not connect to KeyAuth." }, 502); }
}
__name(keyAuthLogin, "keyAuthLogin");

async function logout(request, env) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (token) { authCache.delete(token); await ensureAuthTables(env.DB); await env.DB.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").bind(await sha256(token)).run(); }
  return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json", "Set-Cookie": SESSION_COOKIE + "=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0", ...corsHeaders() } });
}
__name(logout, "logout");

async function searchTelemetry(request, env) {
  try {
    const url = new URL(request.url);
    const q = String(url.searchParams.get("q") || "").trim().slice(0, 120);
    const mode = ["everything", "users", "all-users", "investigate"].includes(url.searchParams.get("mode"))
      ? url.searchParams.get("mode")
      : "users";
    const requestedLimit = Number.parseInt(url.searchParams.get("limit") || "", 10);
    const limit = mode === "all-users" ? Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 100, 1), 100) : mode === "investigate"
      ? Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 500, 1), 500)
      : Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 100, 1), 100);
    const targetUser = String(url.searchParams.get("user") || "").trim().slice(0, 120);

    if (mode === "all-users") {
      const cache = caches.default;
      const cacheKey = new Request(new URL("/api/search?mode=all-users&limit=" + limit + "&v=7", url.origin).toString(), { method: "GET" });
      const cached = await cache.match(cacheKey);
      if (cached) return cached;

      const result = await env.DB.prepare("WITH normalized AS (SELECT rowid AS launch_rowid, user_id, user_name, app_version, os, os_version, cpu_model, gpu_model, ram_gb, ram_free_gb, ram_used_pct, monitor_count, screen_w, screen_h, session_id, event, created_at, CASE WHEN user_id IS NOT NULL AND TRIM(CAST(user_id AS TEXT)) <> '' THEN 'id:' || CAST(user_id AS TEXT) ELSE 'name:' || LOWER(TRIM(COALESCE(user_name, ''))) END AS user_key FROM launches WHERE (user_id IS NOT NULL AND TRIM(CAST(user_id AS TEXT)) <> '') OR TRIM(COALESCE(user_name, '')) <> ''), users AS (SELECT user_key, MAX(created_at) AS last_at, COUNT(*) AS matched_logs FROM normalized GROUP BY user_key), latest AS (SELECT n.user_id, n.user_name, n.app_version, n.os, n.os_version, n.cpu_model, n.gpu_model, n.ram_gb, n.ram_free_gb, n.ram_used_pct, n.monitor_count, n.screen_w, n.screen_h, n.session_id, n.event, n.created_at, u.matched_logs, u.last_at, ROW_NUMBER() OVER (PARTITION BY n.user_key ORDER BY CASE WHEN n.created_at IS NULL THEN 1 ELSE 0 END, n.created_at DESC, n.launch_rowid DESC) AS rn FROM normalized n JOIN users u ON u.user_key = n.user_key) SELECT user_id, user_name, app_version, os, os_version, cpu_model, gpu_model, ram_gb, ram_free_gb, ram_used_pct, monitor_count, screen_w, screen_h, session_id, event, created_at, matched_logs FROM latest WHERE rn = 1 ORDER BY CASE WHEN last_at IS NULL THEN 1 ELSE 0 END, last_at DESC LIMIT ?").bind(limit).all();
      const rows = result.results || [];
      const mapped = rows.map(row => ({ userId: row.user_id, userName: row.user_name || "", appVersion: row.app_version || "unknown", os: row.os || "unknown", osVersion: row.os_version || "", cpuModel: row.cpu_model || "", gpuModel: row.gpu_model || "", ramGb: number(row.ram_gb), ramFreeGb: number(row.ram_free_gb), ramUsedPct: number(row.ram_used_pct), monitorCount: number(row.monitor_count), screen: row.screen_w && row.screen_h ? String(row.screen_w) + "x" + String(row.screen_h) : "", sessionId: row.session_id || "", event: row.event || "launch", createdAt: row.created_at, matchedLogs: number(row.matched_logs) }));
      const response = json({ query: "", mode, user: null, results: mapped, total: mapped.length, truncated: mapped.length >= limit, limit });
      response.headers.set("Cache-Control", "public, max-age=30, s-maxage=60");
      await cache.put(cacheKey, response.clone());
      return response;
    }

    if (!q && !targetUser) return json({ query: "", mode, results: [], total: 0 });

    await ensureTelemetrySchema(env.DB);

    let where;
    let binds;

    if (mode === "investigate" && targetUser) {
      where = "CAST(user_id AS TEXT) = ?";
      binds = [targetUser];
    } else {
      const like = "%" + q + "%";
      where = "CAST(user_id AS TEXT) LIKE ? OR COALESCE(user_name, '') LIKE ? OR COALESCE(app_version, '') LIKE ? OR COALESCE(os, '') LIKE ? OR COALESCE(os_version, '') LIKE ? OR COALESCE(cpu_model, '') LIKE ? OR COALESCE(gpu_model, '') LIKE ? OR COALESCE(session_id, '') LIKE ?";
      binds = [like, like, like, like, like, like, like, like];
    }

    let sql;
    if (mode === "users") {
      sql = `WITH matched AS (
        SELECT user_id, user_name, app_version, os, os_version, cpu_model, gpu_model, ram_gb, ram_free_gb,
               ram_used_pct, monitor_count, screen_w, screen_h, session_id, event, created_at,
               COUNT(*) OVER (PARTITION BY user_id) AS matched_logs,
               ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) AS rn
        FROM launches
        WHERE ${where}
      )
      SELECT user_id, user_name, app_version, os, os_version, cpu_model, gpu_model, ram_gb, ram_free_gb,
             ram_used_pct, monitor_count, screen_w, screen_h, session_id, event, created_at, matched_logs
      FROM matched
      WHERE rn = 1
      ORDER BY created_at DESC
      LIMIT ?`;
    } else {
      sql = `SELECT user_id, user_name, app_version, os, os_version, cpu_model, gpu_model, ram_gb, ram_free_gb,
                    ram_used_pct, monitor_count, screen_w, screen_h, session_id, event, created_at
             FROM launches
             WHERE ${where}
             ORDER BY created_at DESC
             LIMIT ?`;
    }

    const result = await env.DB.prepare(sql).bind(...binds, limit).all();
    const rows = result.results || [];
    const mapped = rows.map(row => ({
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
      createdAt: row.created_at,
      matchedLogs: number(row.matched_logs)
    }));

    return json({
      query: q,
      mode,
      user: targetUser || null,
      results: mapped,
      total: mapped.length,
      truncated: mode !== "users" && mapped.length >= limit,
      limit
    });
  } catch (error) {
    return json({ error: String(error?.message || "Search failed.").slice(0, 300) }, 500);
  }
}
__name(searchTelemetry, "searchTelemetry");

function legacyStats(row) { const launches = number(row?.launches), users = number(row?.users); return { launches, users, launchesToday: 0, usersToday: 0, newUsersToday: 0, launches7d: 0, activeUsers7d: 0, newUsers7d: 0, lastLaunchAt: null, avgLaunchesPerUser: users > 0 ? round(launches / users, 2) : 0, days: 14, series: [], platforms: [], versions: [], hardware: { avgCores: null, avgRamGb: null, commonScreen: null, samples: 0 }, recent: [], userDetails: [], degraded: true }; }
__name(legacyStats, "legacyStats");

async function buildStats(db, days, recentMode, recentPage) {
  recentMode = recentMode || "grouped"; recentPage = recentPage || 1;
  const hourSince = "-" + days * 24 + " hours";
  const safeAll = async (s) => { try { return await s.all(); } catch (_) { return { results: [] }; } };
  const safeFirst = async (s) => { try { return await s.first(); } catch (_) { return null; } };
  const [totals, today, week, newToday, newWeek, seriesRows, newSeriesRows, platformRows, versionRows, hardwareRow, cpuRows, gpuRows, recentRows, recentUserCount, userRows] = await Promise.all([
    safeFirst(db.prepare("SELECT COUNT(*) AS launches, COUNT(DISTINCT user_id) AS users, MAX(created_at) AS last_launch_at FROM launches")),
    safeFirst(db.prepare("SELECT COUNT(*) AS launches, COUNT(DISTINCT user_id) AS users FROM launches WHERE created_at >= strftime('%Y-%m-%d 00:00:00','now')")),
    safeFirst(db.prepare("SELECT COUNT(*) AS launches, COUNT(DISTINCT user_id) AS users FROM launches WHERE created_at >= datetime('now','-7 days')")),
    safeFirst(db.prepare("SELECT COUNT(*) AS users FROM (SELECT user_id, MIN(created_at) AS first_at FROM launches WHERE created_at IS NOT NULL GROUP BY user_id) WHERE date(first_at) = date('now')")),
    safeFirst(db.prepare("SELECT COUNT(*) AS users FROM (SELECT user_id, MIN(created_at) AS first_at FROM launches WHERE created_at IS NOT NULL GROUP BY user_id) WHERE first_at >= datetime('now','-7 days')")),
    safeAll(db.prepare("SELECT date(created_at) AS day, strftime('%Y-%m-%dT%H:00:00', created_at) AS hour_bucket, COUNT(*) AS launches, COUNT(DISTINCT user_id) AS users FROM launches WHERE created_at >= datetime('now', ?) GROUP BY hour_bucket ORDER BY hour_bucket").bind(hourSince)),
    safeAll(db.prepare("SELECT strftime('%Y-%m-%dT%H:00:00', first_at) AS hour_bucket, COUNT(*) AS users FROM (SELECT user_id, MIN(created_at) AS first_at FROM launches WHERE created_at IS NOT NULL GROUP BY user_id) WHERE first_at >= datetime('now', ?) GROUP BY hour_bucket ORDER BY hour_bucket").bind(hourSince)),
    safeAll(db.prepare("SELECT COALESCE(NULLIF(os, ''), 'unknown') AS os, COALESCE(NULLIF(os_version, ''), '') AS os_version, COUNT(*) AS launches FROM launches GROUP BY os, os_version ORDER BY launches DESC LIMIT 6")),
    safeAll(db.prepare("SELECT COALESCE(app_version, 'unknown') AS version, COUNT(*) AS launches FROM launches GROUP BY app_version ORDER BY launches DESC LIMIT 5")),
    // === OPTIMIZED: single pass instead of 5 subqueries ===
    safeFirst(db.prepare("SELECT ROUND(AVG(CASE WHEN cpu_cores > 0 THEN cpu_cores END), 1) AS avg_cores, ROUND(AVG(CASE WHEN ram_gb > 0 THEN ram_gb END), 1) AS avg_ram, ROUND(AVG(CASE WHEN ram_used_pct >= 0 THEN ram_used_pct END), 1) AS avg_ram_used_pct, COUNT(CASE WHEN cpu_cores > 0 THEN 1 END) AS samples FROM launches")),
    safeAll(db.prepare("SELECT COALESCE(NULLIF(cpu_model, ''), 'Unknown CPU') AS model, COUNT(*) AS launches FROM launches WHERE cpu_model IS NOT NULL AND cpu_model <> '' GROUP BY cpu_model ORDER BY launches DESC LIMIT 5")),
    safeAll(db.prepare("SELECT COALESCE(NULLIF(gpu_model, ''), 'Unknown GPU') AS model, COUNT(*) AS launches FROM launches WHERE gpu_model IS NOT NULL AND gpu_model <> '' GROUP BY gpu_model ORDER BY launches DESC LIMIT 5")),
    // === OPTIMIZED: window functions instead of correlated subqueries ===
    safeAll(db.prepare(recentMode === "grouped" ? "WITH top_users AS (SELECT user_id, COUNT(*) AS user_launches, MIN(created_at) AS first_at, MAX(created_at) AS last_at FROM launches WHERE created_at IS NOT NULL GROUP BY user_id ORDER BY last_at DESC LIMIT ? OFFSET ?) SELECT l.user_id, l.user_name, l.app_version, COALESCE(l.os, 'unknown') AS os, COALESCE(l.os_version, '') AS os_version, l.created_at, l.cpu_model, l.gpu_model, l.ram_used_pct, l.monitor_count, l.session_id, t.user_launches, (l.created_at = t.first_at) AS is_first FROM top_users t JOIN launches l ON l.user_id = t.user_id AND l.created_at = t.last_at ORDER BY t.last_at DESC" : "SELECT user_id, user_name, app_version, COALESCE(os, 'unknown') AS os, COALESCE(os_version, '') AS os_version, created_at, cpu_model, gpu_model, ram_used_pct, monitor_count, session_id, 1 AS user_launches, 0 AS is_first FROM launches WHERE created_at IS NOT NULL ORDER BY created_at DESC LIMIT 1000").bind(...recentMode === "grouped" ? [25, (recentPage - 1) * 25] : [])),
    safeFirst(db.prepare("SELECT COUNT(DISTINCT user_id) AS users FROM launches WHERE created_at IS NOT NULL")),
    // === OPTIMIZED: single query with window functions instead of 4 correlated subqueries per user ===
    safeAll(db.prepare("WITH ranked AS (SELECT user_id, user_name, app_version, os, os_version, created_at, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) AS rn, COUNT(*) OVER (PARTITION BY user_id) AS launches, MIN(created_at) OVER (PARTITION BY user_id) AS first_at, MAX(created_at) OVER (PARTITION BY user_id) AS last_at FROM launches WHERE created_at IS NOT NULL) SELECT user_id, user_name, launches, first_at, last_at, app_version AS last_version, COALESCE(NULLIF(os, ''), 'unknown') AS last_os, COALESCE(os_version, '') AS last_os_version FROM ranked WHERE rn = 1 ORDER BY last_at DESC LIMIT 20"))
  ]);
  const totalsRow = totals || {};
  const launches = number(totalsRow.launches), users = number(totalsRow.users);
  return { launches, users, launchesToday: number(today?.launches), usersToday: number(today?.users), newUsersToday: number(newToday?.users), launches7d: number(week?.launches), activeUsers7d: number(week?.users), newUsers7d: number(newWeek?.users), lastLaunchAt: totalsRow.last_launch_at || null, avgLaunchesPerUser: users > 0 ? round(launches / users, 2) : 0, days, series: buildSeries(days, seriesRows.results || [], newSeriesRows.results || []), platforms: buildPlatforms(platformRows.results || [], launches), versions: buildVersions(versionRows.results || [], launches), hardware: { avgCores: number(hardwareRow?.avg_cores) || null, avgRamGb: number(hardwareRow?.avg_ram) || null, commonScreen: null, avgRamUsedPct: number(hardwareRow?.avg_ram_used_pct) || null, samples: number(hardwareRow?.samples), cpuModels: (cpuRows.results || []).map(r => ({ model: r.model, launches: number(r.launches) })), gpuModels: (gpuRows.results || []).map(r => ({ model: r.model, launches: number(r.launches) })) }, recentTotalUsers: number(recentUserCount?.users), recentPage, recentPageSize: 25, recent: (recentRows.results || []).map(row => ({ userId: row.user_id, userName: row.user_name || "", appVersion: row.app_version || "unknown", os: row.os || "unknown", osVersion: row.os_version || "", createdAt: row.created_at, cpuModel: row.cpu_model || "", gpuModel: row.gpu_model || "", ramUsedPct: number(row.ram_used_pct), monitorCount: number(row.monitor_count), sessionId: row.session_id || "", isNew: number(row.is_first) === 1 })), userDetails: (userRows.results || []).map(row => ({ userId: row.user_id, userName: row.user_name || "", launches: number(row.launches), firstSeen: row.first_at, lastSeen: row.last_at, version: row.last_version || "unknown", os: row.last_os || "unknown", osVersion: row.last_os_version || "" })) };
}
__name(buildStats, "buildStats");

function buildSeries(days, launchRows, newUserRows) {
  const hourly = days <= 3;
  const byBucket = new Map(), newByBucket = new Map();
  for (const row of launchRows) byBucket.set(row.hour_bucket, { launches: number(row.launches), users: number(row.users) });
  for (const row of newUserRows) newByBucket.set(row.hour_bucket, number(row.users));
  const series = [];
  if (hourly) {
    const now = new Date();
    const currentHour = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), 0, 0, 0);
    const hourMs = 36e5;
    const totalHours = days * 24;
    for (let offset = totalHours - 1; offset >= 0; offset--) {
      const bucketMs = currentHour - offset * hourMs;
      const bucket = new Date(bucketMs).toISOString().slice(0, 13) + ":00:00";
      const entry = byBucket.get(bucket) || { launches: 0, users: 0 };
      series.push({ day: bucket, hourly: true, launches: entry.launches, users: entry.users, newUsers: newByBucket.get(bucket) || 0 });
    }
  } else {
    for (let offset = days - 1; offset >= 0; offset--) {
      const day = utcDay(-offset);
      const entry = byBucket.get(day) || { launches: 0, users: 0 };
      series.push({ day, hourly: false, launches: entry.launches, users: entry.users, newUsers: newByBucket.get(day) || 0 });
    }
  }
  return series;
}
__name(buildSeries, "buildSeries");

function buildPlatforms(rows, totalLaunches) {
  return rows.map(row => { const launches = number(row.launches); return { key: (row.os + " " + row.os_version).trim(), label: platformLabel(row.os, row.os_version), launches, pct: totalLaunches > 0 ? round(launches / totalLaunches * 100, 1) : 0 }; });
}
__name(buildPlatforms, "buildPlatforms");

function buildVersions(rows, totalLaunches) {
  return rows.map(row => { const launches = number(row.launches); return { version: String(row.version || "unknown"), launches, pct: totalLaunches > 0 ? round(launches / totalLaunches * 100, 1) : 0 }; });
}
__name(buildVersions, "buildVersions");

function platformLabel(os, osVersion) {
  const name = String(os || "unknown").toLowerCase(), version = String(osVersion || "").trim();
  if (name === "windows") { if (!version || version === "unknown") return "Windows"; return "Windows " + version; }
  if (name === "macos" || name === "mac") return "macOS";
  if (name === "linux") return "Linux";
  if (name === "unknown" || !name) return "Unknown";
  return name.charAt(0).toUpperCase() + name.slice(1);
}
__name(platformLabel, "platformLabel");

function utcDay(offsetDays) { return new Date(Date.now() + offsetDays * 864e5).toISOString().slice(0, 10); }
__name(utcDay, "utcDay");

function text(value, max, fallback) { if (typeof value !== "string") return fallback; const clean = value.trim().slice(0, max); return clean.length ? clean : fallback; }
__name(text, "text");

function int(value, min, max) { const parsed = Number.parseInt(value, 10); if (!Number.isFinite(parsed)) return null; return Math.min(Math.max(parsed, min), max); }
__name(int, "int");

function clampInt(value, fallback, min, max) { const parsed = Number.parseInt(value, 10); if (!Number.isFinite(parsed)) return fallback; return Math.min(Math.max(parsed, min), max); }
__name(clampInt, "clampInt");

function number(value) { const parsed = Number(value || 0); return Number.isFinite(parsed) ? parsed : 0; }
__name(number, "number");

function round(value, digits) { const factor = Math.pow(10, digits); return Math.round(value * factor) / factor; }
__name(round, "round");

function corsHeaders() { return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" }; }
__name(corsHeaders, "corsHeaders");

async function incrementFiveMDownload(db, id) {
  try {
    const fileId = Number.parseInt(id, 10);
    if (!Number.isInteger(fileId) || fileId < 1) return json({ error: "Invalid file id." }, 400);
    await ensureFiveMSchema(db);
    const result = await db.prepare("UPDATE fivem_files SET download_count = download_count + 1 WHERE id = ? AND published = 1 AND downloadable = 1").bind(fileId).run();
    if (!result.meta?.changes) return json({ error: "Release not found or unavailable." }, 404);
    const row = await db.prepare("SELECT download_count FROM fivem_files WHERE id = ?").bind(fileId).first();
    return json({ success: true, downloadCount: number(row?.download_count) });
  } catch (error) { return json({ error: "Failed to record download." }, 500); }
}
__name(incrementFiveMDownload, "incrementFiveMDownload");

async function listFiveMFiles(db) {
  try {
    await ensureFiveMSchema(db);
    const result = await db.prepare("SELECT id, name, version, description, download_url, file_name, category, platform, published, downloadable, license_key, rar_password, download_count, created_at, updated_at FROM fivem_files ORDER BY updated_at DESC, id DESC").all();
    return json({ files: result.results || [] });
  } catch (error) { return json({ error: String(error?.message || "Failed to load FiveM files").slice(0, 300) }, 500); }
}
__name(listFiveMFiles, "listFiveMFiles");

function fivemPayload(body) {
  const s = body && typeof body === "object" ? body : {};
  const p = { name: text(s.name, 120, ""), version: text(s.version, 64, ""), description: text(s.description, 2e3, ""), download_url: text(s.download_url ?? s.downloadUrl, 1e3, ""), file_name: text(s.file_name ?? s.fileName, 255, ""), category: text(s.category, 64, "Application"), platform: text(s.platform, 32, "Windows"), published: s.published ? 1 : 0, downloadable: s.downloadable !== false ? 1 : 0, license_key: text(s.license_key ?? s.licenseKey, 512, ""), rar_password: text(s.rar_password ?? s.rarPassword, 512, "") };
  if (!p.name) return { error: "File name is required." };
  if (p.download_url && !/^https?:\/\//i.test(p.download_url)) return { error: "Download URL must start with http:// or https://." };
  return p;
}
__name(fivemPayload, "fivemPayload");

async function createFiveMFile(request, db) {
  try {
    const body = await request.json();
    const payload = fivemPayload(body);
    if (payload.error) return json({ error: payload.error }, 400);
    await ensureFiveMSchema(db);
    const result = await db.prepare("INSERT INTO fivem_files (name, version, description, download_url, file_name, category, platform, published, downloadable, license_key, rar_password, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%d %H:%M:%S','now'), strftime('%Y-%m-%d %H:%M:%S','now'))").bind(payload.name, payload.version, payload.description, payload.download_url, payload.file_name, payload.category, payload.platform, payload.published, payload.downloadable, payload.license_key, payload.rar_password).run();
    const file = await db.prepare("SELECT * FROM fivem_files WHERE id = ?").bind(result.meta?.last_row_id).first();
    return json({ success: true, file });
  } catch (error) { return json({ error: String(error?.message || "Failed to create file").slice(0, 300) }, 500); }
}
__name(createFiveMFile, "createFiveMFile");

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
    await db.prepare("UPDATE fivem_files SET name=?, version=?, description=?, download_url=?, file_name=?, category=?, platform=?, published=?, downloadable=?, license_key=?, rar_password=?, updated_at=strftime('%Y-%m-%d %H:%M:%S','now') WHERE id=?").bind(payload.name, payload.version, payload.description, payload.download_url, payload.file_name, payload.category, payload.platform, payload.published, payload.downloadable, payload.license_key, payload.rar_password, fileId).run();
    const file = await db.prepare("SELECT * FROM fivem_files WHERE id = ?").bind(fileId).first();
    return json({ success: true, file });
  } catch (error) { return json({ error: String(error?.message || "Failed to update file").slice(0, 300) }, 500); }
}
__name(updateFiveMFile, "updateFiveMFile");

async function deleteFiveMFile(db, id) {
  try {
    const fileId = Number.parseInt(id, 10);
    if (!Number.isInteger(fileId) || fileId < 1) return json({ error: "Invalid file id." }, 400);
    const result = await db.prepare("DELETE FROM fivem_files WHERE id = ?").bind(fileId).run();
    if (!result.meta?.changes) return json({ error: "File not found." }, 404);
    return json({ success: true });
  } catch (error) { return json({ error: String(error?.message || "Failed to delete file").slice(0, 300) }, 500); }
}
__name(deleteFiveMFile, "deleteFiveMFile");

function json(data, status) {
  return new Response(JSON.stringify(data), { status: status || 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store, no-cache, must-revalidate", "Pragma": "no-cache", ...corsHeaders() } });
}
__name(json, "json");

export { index_default as default };
