import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = join(process.cwd(), "public");
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

/* Shape mirrors src/index.js buildStats() so the UI can be QA'd locally. */
function buildMockStats(days) {
  const day = (offset) => new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10);

  const series = [];
  for (let offset = days - 1; offset >= 0; offset--) {
    const seed = (offset * 37 + 11) % 9;
    const weekend = new Date(day(offset) + "T00:00:00Z").getUTCDay();
    const base = weekend === 0 || weekend === 6 ? 6 : 18;
    const launches = Math.max(0, base + seed * 4 - offset);
    const users = Math.round(launches * 0.55);
    const newUsers = Math.round(launches * 0.2);
    series.push({ day: day(offset), launches, users, newUsers });
  }

  const totalLaunches = 12847;
  const totalUsers = 3921;

  return {
    launches: totalLaunches,
    users: totalUsers,
    launchesToday: series[series.length - 1].launches,
    usersToday: series[series.length - 1].users,
    newUsersToday: series[series.length - 1].newUsers,
    launches7d: series.slice(-7).reduce((sum, p) => sum + p.launches, 0),
    activeUsers7d: 1462,
    newUsers7d: series.slice(-7).reduce((sum, p) => sum + p.newUsers, 0),
    lastLaunchAt: new Date().toISOString().slice(0, 19).replace("T", " "),
    avgLaunchesPerUser: 3.28,
    days,
    series,
    platforms: [
      { key: "windows 11", label: "Windows 11", launches: 8034, pct: 62.5 },
      { key: "windows 10", label: "Windows 10", launches: 4111, pct: 32 },
      { key: "windows 8.1", label: "Windows 8.1", launches: 702, pct: 5.5 }
    ],
    versions: [
      { version: "1.0.0", launches: 9641, pct: 75 },
      { version: "0.9.4", launches: 2313, pct: 18 },
      { version: "0.9.2", launches: 633, pct: 4.9 },
      { version: "unknown", launches: 260, pct: 2.1 }
    ],
    hardware: { avgCores: 8.4, avgRamGb: 17, commonScreen: "1920x1080", samples: 9120 },
    recent: [
      { userId: "a7f3c9e21b48d056", appVersion: "1.0.0", os: "windows", osVersion: "11", createdAt: "2026-10-01 13:41:02", isNew: false },
      { userId: "5d21ba90f7c3e814", appVersion: "1.0.0", os: "windows", osVersion: "11", createdAt: "2026-10-01 12:58:47", isNew: true },
      { userId: "c04e81d762a9f35b", appVersion: "1.0.0", os: "windows", osVersion: "10", createdAt: "2026-10-01 11:20:19", isNew: false },
      { userId: "9b6f02ac47d15e83", appVersion: "0.9.4", os: "windows", osVersion: "11", createdAt: "2026-10-01 09:47:36", isNew: true },
      { userId: "31de7c05b8a2496f", appVersion: "1.0.0", os: "windows", osVersion: "10", createdAt: "2026-10-01 08:12:04", isNew: false },
      { userId: "77a0b3e91c5d2f64", appVersion: "0.9.4", os: "windows", osVersion: "8.1", createdAt: "2026-10-01 06:33:58", isNew: false }
    ],
    userDetails: [
      { userId: "a7f3c9e21b48d056", launches: 412, firstSeen: "2026-06-14 10:02:11", lastSeen: "2026-10-01 13:41:02", version: "1.0.0", os: "windows", osVersion: "11" },
      { userId: "5d21ba90f7c3e814", launches: 87, firstSeen: "2026-08-02 16:20:45", lastSeen: "2026-10-01 12:58:47", version: "1.0.0", os: "windows", osVersion: "11" },
      { userId: "c04e81d762a9f35b", launches: 34, firstSeen: "2026-09-11 09:14:30", lastSeen: "2026-10-01 11:20:19", version: "1.0.0", os: "windows", osVersion: "10" },
      { userId: "9b6f02ac47d15e83", launches: 12, firstSeen: "2026-09-28 19:41:03", lastSeen: "2026-10-01 09:47:36", version: "0.9.4", os: "windows", osVersion: "11" },
      { userId: "31de7c05b8a2496f", launches: 5, firstSeen: "2026-09-30 08:00:52", lastSeen: "2026-10-01 08:12:04", version: "1.0.0", os: "windows", osVersion: "10" },
      { userId: "77a0b3e91c5d2f64", launches: 1, firstSeen: "2026-10-01 06:33:58", lastSeen: "2026-10-01 06:33:58", version: "0.9.4", os: "windows", osVersion: "8.1" }
    ]
  };
}

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (url.pathname === "/api/stats") {
    const days = Math.min(Math.max(Number.parseInt(url.searchParams.get("days") || "14", 10) || 14, 1), 90);
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(buildMockStats(days)));
    return;
  }

  const file = normalize(join(root, url.pathname === "/" ? "index.html" : url.pathname));
  if (!file.startsWith(root)) {
    res.writeHead(403).end("Forbidden");
    return;
  }

  try {
    const body = await readFile(file);
    res.writeHead(200, {
      "Content-Type": types[extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<h1>404</h1>");
  }
}).listen(8788, "127.0.0.1", () => console.log("dev server on http://127.0.0.1:8788"));
