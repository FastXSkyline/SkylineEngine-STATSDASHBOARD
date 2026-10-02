const API_URL = "/api/stats";\nconst SEARCH_URL = "/api/search";


const $ = (id) => document.getElementById(id);

const state = {
  days: 1,
  scope: "launches", // "launches" | "new"
  mode: "flat", // "flat" | "grouped"
  series: [],
  ready: false
};

const RANGES = [1, 3, 7, 14, 30];
const PLATFORM_COLORS = [
  "#ff2d2d",
  "rgba(255,45,45,.55)",
  "rgba(255,255,255,.55)",
  "rgba(255,255,255,.3)",
  "rgba(255,255,255,.17)",
  "rgba(255,255,255,.09)"
];

async function openTelemetrySearch() {
  const query = window.prompt("Search users, IDs, sessions, versions, CPUs, GPUs, or operating systems:");
  if (query === null) return;
  const q = query.trim();
  if (!q) return;

  window.location.href = "/search.html?q=" + encodeURIComponent(q);
}

document.addEventListener("DOMContentLoaded", () => {
  const searchBtn = $("searchBtn");
  if (searchBtn) searchBtn.addEventListener("click", openTelemetrySearch);
});

/* ------------------------------------------------------------
   Helpers
   ------------------------------------------------------------ */
function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-US");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseUtc(value) {
  if (!value) return null;
  const iso = String(value).includes("T") ? String(value) : String(value).replace(" ", "T");
  const date = new Date(iso.endsWith("Z") || iso.includes("+") ? iso : iso + "Z");
  return Number.isNaN(date.getTime()) ? null : date;
}

function relativeTime(value) {
  const date = parseUtc(value);
  if (!date) return "—";

  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return Math.floor(seconds / 60) + "m ago";
  if (seconds < 86400) return Math.floor(seconds / 3600) + "h ago";
  if (seconds < 86400 * 7) return Math.floor(seconds / 86400) + "d ago";

  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

function dayLabel(day) {
  const hourly = day.length > 10;
  const date = new Date(hourly ? day : day + "T00:00:00Z");
  if (Number.isNaN(date.getTime())) return day;
  if (hourly) {
    return date.toLocaleTimeString(undefined, { hour: "numeric", timeZone: "UTC" });
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

function bucketTooltip(bucket) {
  const date = new Date(bucket);
  if (Number.isNaN(date.getTime())) return bucket;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: bucket.length > 10 ? "numeric" : undefined,
    timeZone: "UTC"
  });
}

function niceCeil(value) {
  if (value <= 1) return 1;
  const exponent = Math.floor(Math.log10(value));
  const magnitude = 10 ** exponent;
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

/* Catmull-Rom -> cubic bezier, gives the soft curves of the reference chart */
function smoothPath(points) {
  if (!points.length) return "";
  if (points.length === 1) return `M${points[0][0]},${points[0][1]}`;

  let path = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;

    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;

    path += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
  }
  return path;
}

/* ------------------------------------------------------------
   Main chart
   ------------------------------------------------------------ */
function renderChart(series) {
  const isHourly = Boolean(series[0]?.hourly);
  const primary = series.map((point) => point.launches);
  const secondary = series.map((point) => (state.scope === "new" ? point.newUsers : point.users));
  const hasData = series.some((point) => point.launches > 0 || point.users > 0 || point.newUsers > 0);

  state.series = series;

  const empty = $("chartEmpty");
  const W = 1000;
  const H = 300;
  const padTop = 20;
  const padBottom = 14;
  const n = series.length;

  if (!hasData || !n) {
    $("linePrimary").setAttribute("d", "");
    $("lineSecondary").setAttribute("d", "");
    $("areaFill").setAttribute("d", "");
    $("chartYAxis").innerHTML = "";
    $("chartXAxis").innerHTML = "";
    empty.hidden = false;
    $("chartEmptyTitle").textContent = "No activity in this range";
    $("chartEmptyText").textContent =
      "Charts will appear after new launches are recorded from the application.";
    $("chartNote").textContent =
      state.days === 1 ? "Last 24 hours · no activity" : `Last ${state.days} days · no activity`;
    return;
  }

  empty.hidden = true;

  const max = niceCeil(Math.max(1, ...primary, ...secondary));
  const x = (index) => (n === 1 ? W / 2 : (index / (n - 1)) * W);
  const y = (value) => H - padBottom - (value / max) * (H - padTop - padBottom);

  const primaryPoints = primary.map((value, index) => [x(index), y(value)]);
  const secondaryPoints = secondary.map((value, index) => [x(index), y(value)]);
  const primaryPath = smoothPath(primaryPoints);

  $("linePrimary").setAttribute("d", primaryPath);
  $("lineSecondary").setAttribute("d", smoothPath(secondaryPoints));
  $("areaFill").setAttribute("d", primaryPath ? `${primaryPath} L${W},${H} L0,${H} Z` : "");

  /* y axis labels */
  $("chartYAxis").innerHTML = [max, max / 2, 0]
    .map((value) => `<span style="top:${((y(value) / H) * 100).toFixed(2)}%">${formatNumber(value)}</span>`)
    .join("");

  /* x axis labels */
  const labelCount = Math.min(isHourly ? 6 : 5, n);
  const indexes = [];
  for (let i = 0; i < labelCount; i++) {
    indexes.push(Math.round((i * (n - 1)) / Math.max(1, labelCount - 1)));
  }
  const labelIndexes = [...new Set(indexes)];
  const plotWidth = $("chartPlot").clientWidth;
  const floatsOverlap = window.innerWidth > 1200 && plotWidth > 0;
  const maxLabelLeft = floatsOverlap ? plotWidth - 244 : plotWidth;

  $("chartXAxis").innerHTML = labelIndexes
    .map((index, position) => {
      const px = (x(index) / W) * plotWidth;
      if (floatsOverlap && px > maxLabelLeft) return "";

      const pct = ((x(index) / W) * 100).toFixed(2);
      const transform =
        position === 0
          ? "translateX(0)"
          : position === labelIndexes.length - 1
          ? "translateX(-100%)"
          : "translateX(-50%)";
      return `<span style="left:${pct}%;transform:${transform}">${dayLabel(series[index].day)}</span>`;
    })
    .filter(Boolean)
    .join("");

  const total = primary.reduce((sum, value) => sum + value, 0);
  const peakIndex = primary.indexOf(Math.max(...primary));
  const rangeText = state.days === 1 ? "Last 24 hours" : `Last ${state.days} days`;
  const peakLabel = series[peakIndex].hourly
    ? bucketTooltip(series[peakIndex].day)
    : dayLabel(series[peakIndex].day);
  $("chartNote").textContent = `${rangeText} · ${formatNumber(total)} launches · peak ${formatNumber(
    primary[peakIndex]
  )} at ${peakLabel}`;
}

function hideCrosshair() {
  $("chartCrosshair").hidden = true;
  $("chartTooltip").hidden = true;
}

function handleChartMove(event) {
  const series = state.series;
  if (!series.length) return;

  const plot = $("chartPlot");
  const rect = plot.getBoundingClientRect();
  const fraction = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);
  const index = Math.min(series.length - 1, Math.round(fraction * (series.length - 1)));

  const point = series[index];
  const secondaryValue = state.scope === "new" ? point.newUsers : point.users;

  const W = 1000;
  const H = 300;
  const padTop = 20;
  const padBottom = 14;
  const max = niceCeil(
    Math.max(
      1,
      ...series.map((entry) => entry.launches),
      ...series.map((entry) => (state.scope === "new" ? entry.newUsers : entry.users))
    )
  );
  const xPosition = series.length === 1 ? W / 2 : (index / (series.length - 1)) * W;
  const yOf = (value) => H - padBottom - (value / max) * (H - padTop - padBottom);

  const crosshair = $("chartCrosshair");
  crosshair.hidden = false;
  crosshair.style.left = `${((xPosition / W) * 100).toFixed(2)}%`;
  crosshair.querySelector(".dot-primary").style.top = `${((yOf(point.launches) / H) * 100).toFixed(2)}%`;
  crosshair.querySelector(".dot-secondary").style.top = `${((yOf(secondaryValue) / H) * 100).toFixed(2)}%`;

  const tooltip = $("chartTooltip");
  tooltip.hidden = false;
  tooltip.innerHTML =
    `<div class="tt-date">${escapeHtml(bucketTooltip(point.day))}</div>` +
    `<div class="tt-row"><i class="dot-accent"></i>Launches <b>${formatNumber(point.launches)}</b></div>` +
    `<div class="tt-row"><i class="dot-neutral"></i>${
      state.scope === "new" ? "New users" : "Unique users"
    } <b>${formatNumber(secondaryValue)}</b></div>`;

  const tooltipWidth = 160;
  const left = Math.min(
    Math.max(((xPosition / W) * rect.width - tooltipWidth / 2), 8),
    rect.width - tooltipWidth - 8
  );
  tooltip.style.left = `${left}px`;
  tooltip.style.top = "14px";
}

/* ------------------------------------------------------------
   Micro charts inside KPI cards
   ------------------------------------------------------------ */
function renderMicrocharts(series) {
  const launches = series.map((point) => point.launches);
  const users = series.map((point) => point.users);

  setSpark($("sparkLaunches"), launches);
  setSpark($("sparkUsers"), users);
  setBars($("barsToday"), launches.slice(-7));
  setRing($("ringActive"));

  const floatPath = $("floatSpark");
  if (floatPath) floatPath.setAttribute("d", sparkPath(launches, 48, 30));
}

function sparkPath(values, width, height) {
  const usable = values.filter((value) => Number.isFinite(value));
  if (usable.length < 2) return "";

  const max = Math.max(1, ...usable);
  const pad = 3;
  const points = usable.map((value, index) => [
    (index / (usable.length - 1)) * width,
    height - pad - (value / max) * (height - pad * 2)
  ]);
  return smoothPath(points);
}

function setSpark(pathElement, values) {
  if (!pathElement) return;
  pathElement.setAttribute("d", sparkPath(values, 72, 36));
}

function setBars(container, values) {
  if (!container) return;
  const bars = container.querySelectorAll("i");
  const max = Math.max(1, ...values);

  bars.forEach((bar, index) => {
    const value = values[index - (bars.length - values.length)] ?? 0;
    const clamped = Math.max(0, value);
    const height = clamped > 0 ? Math.max(6, Math.round((clamped / max) * 32)) : 4;
    bar.style.height = `${height}px`;
    bar.classList.toggle("is-empty", clamped === 0);
    bar.classList.toggle("is-peak", clamped === max && clamped > 0);
  });
}

function setRing(ring) {
  if (!ring) return;
  const users = state.users || 0;
  const active = state.activeUsers7d || 0;
  const pct = users > 0 ? Math.min((active / users) * 100, 100) : 0;
  ring.style.setProperty("--pct", pct.toFixed(1));
}

/* ------------------------------------------------------------
   Distribution cards
   ------------------------------------------------------------ */
function renderPlatforms(platforms, total) {
  const bar = $("platformBar");
  const list = $("platformList");

  if (!platforms.length || total === 0) {
    bar.innerHTML = "";
    list.innerHTML = '<li class="pc-empty">No platform data yet</li>';
    $("platformMeta").textContent = "—";
    return;
  }

  bar.innerHTML = platforms
    .map(
      (platform, index) =>
        `<span style="width:${Math.max(platform.pct, 0.5)}%;background:${
          PLATFORM_COLORS[index % PLATFORM_COLORS.length]
        }" title="${escapeHtml(platform.label)} ${platform.pct}%"></span>`
    )
    .join("");

  list.innerHTML = platforms
    .map(
      (platform, index) =>
        `<li><i style="background:${
          PLATFORM_COLORS[index % PLATFORM_COLORS.length]
        }"></i><span class="lg-label">${escapeHtml(platform.label)}</span><span class="lg-value">${
          platform.pct
        }%</span></li>`
    )
    .join("");

  $("platformMeta").textContent = `${platforms.length} platform${platforms.length === 1 ? "" : "s"}`;
}

function renderVersions(versions) {
  const list = $("versionList");

  if (!versions.length) {
    list.innerHTML = '<li class="pc-empty">No version data yet</li>';
    $("versionMeta").textContent = "—";
    return;
  }

  const max = Math.max(1, ...versions.map((version) => version.launches));

  list.innerHTML = versions
    .map(
      (version) =>
        `<li><span class="bl-label">${escapeHtml(version.version)}</span>` +
        `<span class="bl-track"><i style="width:${Math.max(
          Math.round((version.launches / max) * 100),
          3
        )}%"></i></span>` +
        `<span class="bl-value">${formatNumber(version.launches)}</span></li>`
    )
    .join("");

  const top = versions[0];
  $("versionMeta").textContent = `top ${top.version} · ${top.pct}%`;
}

function renderHardware(hardware) {
  const trio = $("hardwareTrio");
  const hasSamples = hardware && hardware.samples > 0;

  const items = hasSamples
    ? [
        ["Avg CPU", hardware.avgCores ? `${hardware.avgCores} cores` : "—"],
        ["Avg memory", hardware.avgRamGb ? `${hardware.avgRamGb} GB` : "—"],
        ["RAM used", hardware.avgRamUsedPct != null ? `${hardware.avgRamUsedPct}%` : "—"],
        ["Top resolution", hardware.commonScreen ? hardware.commonScreen.replace("x", " × ") : "—"]
      ]
    : [
        ["Avg CPU", "—"],
        ["Avg memory", "—"],
        ["RAM used", "—"],
        ["Top resolution", "—"]
      ];

  trio.innerHTML = items
    .map(([label, value]) => `<div class="trio-item"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`)
    .join("");

  $("hardwareMeta").textContent = hasSamples ? `${formatNumber(hardware.samples)} samples` : "no data";

  const renderModels = (id, rows, emptyLabel) => {
    const list = $(id);
    if (!list) return;
    if (!rows || !rows.length) {
      list.innerHTML = `<span>${emptyLabel}</span>`;
      return;
    }
    list.innerHTML = rows.slice(0, 3).map((row) =>
      `<span title="${escapeHtml(row.model)}">${escapeHtml(row.model)} <b>${formatNumber(row.launches)}</b></span>`
    ).join("");
  };
  renderModels("cpuModelsList", hardware.cpuModels, "No CPU model data");
  renderModels("gpuModelsList", hardware.gpuModels, "No GPU model data");
}

/* ------------------------------------------------------------
   Recent table
   ------------------------------------------------------------ */
const WINDOWS_ICON =
  '<svg class="ic ic-14" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6.4l7-1v6.1H4z"/><path d="M12.6 5.2l7.4-1.1v7.4h-7.4z"/><path d="M4 12.5h7v6.1l-7-1z"/><path d="M12.6 12.5H20v7.4l-7.4-1.1z"/></svg>';

function platformIcon(os) {
  if (String(os).toLowerCase().includes("windows")) return WINDOWS_ICON;
  return '<svg class="ic ic-14" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="13" rx="2"/><path d="M8 20.5h8"/></svg>';
}

function platformName(os, osVersion) {
  const name = String(os || "unknown").toLowerCase();
  const version = String(osVersion || "").trim();

  if (name === "windows") {
    if (!version || version === "unknown") return "Windows";
    return `Windows ${version}`;
  }
  if (name === "macos" || name === "mac") return "macOS";
  if (name === "linux") return "Linux";
  if (!name || name === "unknown") return "Unknown";
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function userCell(userName, userId) {
  const id = String(userId || "");
  const shortId = id.length > 14 ? `${id.slice(0, 14)}…` : id;
  const name = String(userName || "").trim();

  if (!name) {
    return `<span class="cell-id" title="${escapeHtml(id)}">${escapeHtml(shortId)}</span>`;
  }
  return (
    `<span class="user-cell">` +
    `<span class="user-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>` +
    `<span class="user-id" title="${escapeHtml(id)}">${escapeHtml(shortId)}</span>` +
    `</span>`
  );
}

function renderRecent(rows, mode) {
  const body = $("recentBody");
  const groupedBody = $("recentGroupedBody");

  if (groupedBody) groupedBody.hidden = mode !== "grouped";
  body.closest(".table-wrap").hidden = mode === "grouped";

  if (!rows || !rows.length) {
    if (mode === "grouped" && groupedBody) {
      groupedBody.innerHTML = `<div class="empty-table"><span class="empty-chip">${emptyChipIcon()}No launch records yet</span></div>`;
    } else {
      body.innerHTML = `<tr><td colspan="5" class="empty-table"><span class="empty-chip">${emptyChipIcon()}No launch records yet</span></td></tr>`;
    }
    return;
  }

  if (mode === "grouped") {
    renderRecentGrouped(rows);
    return;
  }

  /* flat list */
  body.innerHTML = rows
    .map((row) => {
      const name = platformName(row.os, row.osVersion);

      return (
        `<tr>` +
        `<td>${userCell(row.userName, row.userId)}</td>` +
        `<td><span class="cell-version">${escapeHtml(row.appVersion || "unknown")}</span></td>` +
        `<td><span class="cell-platform"><span class="platform-ic">${platformIcon(row.os)}</span>${escapeHtml(
          name
        )}</span></td>` +
        `<td><span class="badge ${row.isNew ? "badge-new" : "badge-repeat"}">${
          row.isNew ? "New" : "Returning"
        }</span></td>` +
        `<td class="num muted-cell">${relativeTime(row.createdAt)}</td>` +
        `</tr>`
      );
    })
    .join("");
}

/* Grouped view: one "pack" per user; click the header to expand its launch rows */
function renderRecentGrouped(rows) {
  const body = $("recentGroupedBody");
  const openUsers = new Set(
    [...body.querySelectorAll(".user-pack")]
      .filter((pack) => pack.querySelector(".user-pack-body")?.classList.contains("open"))
      .map((pack) => pack.dataset.user)
  );

  const groups = new Map();
  for (const row of rows) {
    const key = row.userId || `row-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
    if (!groups.has(key)) {
      groups.set(key, { id: key, name: row.userName || "Unknown", userId: row.userId, launches: [], total: 0 });
    }
    const group = groups.get(key);
    group.launches.push(row);
    group.total += (row.launches || 0) || 0;
  }

  const ordered = Array.from(groups.values()).sort((a, b) => {
    const aFirst = a.launches[0];
    const bFirst = b.launches[0];
    return (bFirst.createdAt || "") < (aFirst.createdAt || "") ? -1 : 1;
  });

  body.innerHTML = ordered
    .map((group) => {
      const rows = group.launches;
      const first = rows[0];
      const name = group.name || "Unknown";
      const shortId = group.userId ? (String(group.userId).length > 14 ? `${String(group.userId).slice(0, 14)}…` : String(group.userId)) : "";
      const badge = first.isNew ? "badge-new" : "badge-repeat";
      const badgeLabel = first.isNew ? "New" : "Returning";

      return (
        `<div class="user-pack" data-user="${escapeHtml(group.id)}">` +
        `<div class="user-pack-header">` +
        `<span class="user-pack-name">${escapeHtml(name)}</span>` +
        `<span class="user-pack-count">${rows.length} launch${rows.length === 1 ? "" : "s"} · ${group.total} run${group.total === 1 ? "" : "s"}</span>` +
        `<span class="user-pack-toggle" aria-expanded="false" aria-label="Toggle launches for ${escapeHtml(name)}">` +
        `<svg class="ic ic-14" viewBox="0 0 24 24" aria-hidden="true"><polyline points="6 9.5 12 15.5 18 9.5"/></svg>` +
        `</span>` +
        `</div>` +
        `<div class="user-pack-body">` +
        rows.map((row) => {
          const name = platformName(row.os, row.osVersion);
          return (
            `<div class="user-pack-row">` +
            `<span class="user-cell">` +
            (row.userName ? `<span class="user-name" title="${escapeHtml(row.userName)}">${escapeHtml(row.userName)}</span>` : ``) +
            `<span class="user-id" title="${escapeHtml(String(group.userId || "").slice(0, 14))}">${escapeHtml(shortId)}</span>` +
            `</span>` +
            `<span class="cell-version">${escapeHtml(row.appVersion || "unknown")}</span>` +
            `<span class="cell-platform"><span class="platform-ic">${platformIcon(row.os)}</span>${escapeHtml(name)}</span>` +
            `<span class="badge ${row.isNew ? "badge-new" : "badge-repeat"}">${badgeLabel}</span>` +
            `<span class="num muted-cell">${relativeTime(row.createdAt)}</span>` +
            `</div>`
          );
        }).join("") +
        `</div>` +
        `</div>`
      );
    })
    .join("");

  body.querySelectorAll(".user-pack").forEach((pack) => {
    if (!openUsers.has(pack.dataset.user)) return;
    const bodyEl = pack.querySelector(".user-pack-body");
    const toggle = pack.querySelector(".user-pack-toggle");
    if (bodyEl && toggle) {
      bodyEl.classList.add("open");
      toggle.setAttribute("aria-expanded", "true");
    }
  });

  /* toggle handlers on the new pack headers */
  body.querySelectorAll(".user-pack-header").forEach((header) => {
    header.addEventListener("click", (event) => {
      event.stopPropagation();
      const pack = header.closest(".user-pack");
      if (!pack) return;
      const bodyEl = pack.querySelector(".user-pack-body");
      const toggle = header.querySelector(".user-pack-toggle");
      const isOpen = bodyEl.classList.contains("open");

      body.querySelectorAll(".user-pack-body.open").forEach((other) => {
        if (other !== bodyEl) other.classList.remove("open");
        other.previousElementSibling.querySelector(".user-pack-toggle").setAttribute("aria-expanded", "false");
      });

      bodyEl.classList.toggle("open", !isOpen);
      toggle.setAttribute("aria-expanded", String(!isOpen));
    });
  });
}


function emptyChipIcon() {
  return '<svg class="ic ic-14" viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="6.2" rx="7.5" ry="2.9"/><path d="M4.5 6.2v5.6c0 1.6 3.4 2.9 7.5 2.9s7.5-1.3 7.5-2.9V6.2"/><path d="M4.5 11.8v5.6c0 1.6 3.4 2.9 7.5 2.9s7.5-1.3 7.5-2.9v-5.6"/></svg>';
}

/* ------------------------------------------------------------
   User details table
   ------------------------------------------------------------ */
function renderUserDetails(rows, totalUsers, degraded) {
  const body = $("userDetailsBody");
  const tag = $("usersTag");

  if (degraded) {
    tag.textContent = "Needs migration";
    body.innerHTML = `<tr><td colspan="6" class="empty-table"><span class="empty-chip">${emptyChipIcon()}Per-user details unlock after the D1 migration (migrations/0001_telemetry_columns.sql)</span></td></tr>`;
    return;
  }

  if (!rows || !rows.length) {
    tag.textContent = totalUsers > 0 ? formatNumber(totalUsers) + " users" : "—";
    body.innerHTML = `<tr><td colspan="6" class="empty-table"><span class="empty-chip">${emptyChipIcon()}No user activity recorded yet</span></td></tr>`;
    return;
  }

  tag.textContent = `${Math.min(rows.length, 20)} of ${formatNumber(totalUsers)}`;

  body.innerHTML = rows
    .map((row) => {
      const name = platformName(row.os, row.osVersion);

      return (
        `<tr>` +
        `<td>${userCell(row.userName, row.userId)}</td>` +
        `<td><span class="cell-launches">${formatNumber(row.launches)}</span></td>` +
        `<td><span class="cell-version">${escapeHtml(row.version || "unknown")}</span></td>` +
        `<td><span class="cell-platform"><span class="platform-ic">${platformIcon(row.os)}</span>${escapeHtml(
          name
        )}</span></td>` +
        `<td class="muted-cell">${row.firstSeen ? relativeTime(row.firstSeen) : "—"}</td>` +
        `<td class="num muted-cell">${row.lastSeen ? relativeTime(row.lastSeen) : "—"}</td>` +
        `</tr>`
      );
    })
    .join("");
}

/* ------------------------------------------------------------
   Apply stats
   ------------------------------------------------------------ */
function applyStats(data) {
  const launches = Number(data.launches || 0);
  const users = Number(data.users || 0);

  state.users = users;
  state.activeUsers7d = Number(data.activeUsers7d || 0);
  state.ready = true;

  const degraded = Boolean(data.degraded);

  $("totalLaunches").textContent = formatNumber(launches);
  $("totalUsers").textContent = formatNumber(users);
  $("todayLaunches").textContent = degraded ? "—" : formatNumber(data.launchesToday);
  $("activeUsers7d").textContent = degraded ? "—" : formatNumber(data.activeUsers7d);
  $("chipToday").textContent = degraded ? "Needs migration" : "UTC day";
  $("chipActive").textContent = degraded ? "Needs migration" : "Last 7 days";

  $("summaryLaunches").textContent = formatNumber(launches);
  $("summaryUsers").textContent = formatNumber(users);
  $("lastUpdated").textContent = new Date().toLocaleTimeString();

  $("floatLaunches").textContent = formatNumber(launches);
  $("floatLaunchesSub").textContent =
    Number(data.launchesToday) > 0
      ? `${formatNumber(data.launchesToday)} today`
      : "Synced from API";

  /* unique share donut */
  const hasData = launches > 0;
  const pct = hasData ? Math.min((users / launches) * 100, 100) : 0;
  $("uniqueShare").textContent = hasData ? pct.toFixed(1) + "%" : "—";
  $("shareSub").textContent = hasData
    ? `${formatNumber(users)} of ${formatNumber(launches)} launches`
    : "Awaiting launch data";
  $("shareRing").style.setProperty("--pct", hasData ? pct : 0);

  const series = Array.isArray(data.series) ? data.series : [];
  renderChart(series);
  renderMicrocharts(series);
  renderPlatforms(data.platforms || [], launches);
  renderVersions(data.versions || []);
  renderHardware(data.hardware || {});
  renderRecent(data.recent || [], state.mode);
  renderUserDetails(data.userDetails || [], users, degraded);

  if (degraded) {
    $("chartEmptyTitle").textContent = "Time-based data unavailable";
    $("chartEmptyText").textContent =
      "Run migrations/0001_telemetry_columns.sql against the D1 database, then refresh.";
    $("recentBody").innerHTML = `<tr><td colspan="5" class="empty-table"><span class="empty-chip">${emptyChipIcon()}Awaiting D1 migration — run migrations/0001_telemetry_columns.sql</span></td></tr>`;
  }
}

function syncRangeDefault() {
  const dropdown = $("rangeDropdown");
  const button = $("rangeBtn");
  const label = $("rangeLabel");
  if (!dropdown || !button || !label) return;

  state.days = 1;
  label.textContent = "Last 24 hours";

  dropdown.querySelectorAll(".dropdown-menu li").forEach((item) => {
    item.classList.toggle("selected", item.dataset.days === "1");
  });
}

syncRangeDefault();

/* ------------------------------------------------------------
   Data loading
   ------------------------------------------------------------ */
async function loadStats(options = {}) {
  const silent = Boolean(options.silent);
  const refreshBtn = $("refreshBtn");
  const refreshLabel = $("refreshLabel");
  const statsGrid = document.querySelector(".stats-grid");

  if (!silent) {
    refreshBtn.disabled = true;
    refreshBtn.classList.add("spin");
    refreshLabel.textContent = "Loading";
    statsGrid.classList.add("is-loading");
  }

  try {
    const response = await fetch(`${API_URL}?days=${state.days}&_=${Date.now()}`, { cache: "no-store", headers: { "Cache-Control": "no-cache" } });
    if (!response.ok) throw new Error("API returned " + response.status);

    applyStats(await response.json());
  } catch (error) {
    console.error("Failed to load stats:", error);
    $("lastUpdated").textContent = "Connection error";

    if (!state.ready) {
      $("chartEmpty").hidden = false;
      $("chartEmptyTitle").textContent = "Could not reach the Skyline API";
      $("chartEmptyText").textContent = "Press Refresh to retry.";
      $("recentBody").innerHTML = `<tr><td colspan="5" class="empty-table"><span class="empty-chip">${emptyChipIcon()}Could not reach the Skyline API</span></td></tr>`;
      $("userDetailsBody").innerHTML = `<tr><td colspan="6" class="empty-table"><span class="empty-chip">${emptyChipIcon()}Could not reach the Skyline API</span></td></tr>`;
    }
  } finally {
    if (!silent) {
      refreshBtn.disabled = false;
      refreshBtn.classList.remove("spin");
      refreshLabel.textContent = "Refresh";
      statsGrid.classList.remove("is-loading");
    }
  }
}

/* ------------------------------------------------------------
   Chart controls (dropdowns)
   ------------------------------------------------------------ */
function setupDropdown(id, onPick) {
  const dropdown = $(id);
  const button = dropdown.querySelector(".dropdown-btn");
  const items = dropdown.querySelectorAll(".dropdown-menu li");

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    const open = dropdown.classList.toggle("open");
    button.setAttribute("aria-expanded", String(open));
  });

  items.forEach((item) => {
    item.addEventListener("click", () => {
      items.forEach((other) => other.classList.remove("selected"));
      item.classList.add("selected");
      dropdown.classList.remove("open");
      button.setAttribute("aria-expanded", "false");
      onPick(item.dataset);
    });
  });

  return dropdown;
}

document.addEventListener("click", (event) => {
  document.querySelectorAll(".dropdown.open").forEach((dropdown) => {
    if (!dropdown.contains(event.target)) {
      dropdown.classList.remove("open");
      dropdown.querySelector(".dropdown-btn").setAttribute("aria-expanded", "false");
    }
  });
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    document.querySelectorAll(".dropdown.open").forEach((dropdown) => {
      dropdown.classList.remove("open");
      dropdown.querySelector(".dropdown-btn").setAttribute("aria-expanded", "false");
    });
  }
});

setupDropdown("rangeDropdown", (data) => {
  state.days = Number.parseInt(data.days, 10) || 1;
  $("rangeLabel").textContent =
    state.days === 1 ? "Last 24 hours" : `Last ${state.days} days`;
  loadStats();
});

setupDropdown("scopeDropdown", (data) => {
  state.scope = data.scope === "new" ? "new" : "launches";
  const isNew = state.scope === "new";
  $("scopeLabel").textContent = isNew ? "New users only" : "All launches";
  $("legendSecondary").textContent = isNew ? "New users" : "Unique users";
  $("chartSub").textContent = isNew
    ? state.days <= 3
      ? "First-time users per hour"
      : "First-time users per day"
    : state.days <= 3
    ? "Launches per hour"
    : "Daily application launches";
  renderChart(state.series);
});

setupDropdown("modeDropdown", (data) => {
  state.mode = data.mode === "grouped" ? "grouped" : "flat";
  $("modeLabel").textContent = state.mode === "grouped" ? "Group by user" : "Flat list";
  loadStats();
});

/* ------------------------------------------------------------
   Sidebar: desktop collapse + mobile drawer
   ------------------------------------------------------------ */
const layout = document.querySelector(".layout");
const navToggle = $("navToggle");
const mobileQuery = window.matchMedia("(max-width: 900px)");

function syncNavState() {
  const mobile = mobileQuery.matches;
  const open = mobile
    ? layout.classList.contains("nav-open")
    : !layout.classList.contains("sidebar-collapsed");
  navToggle.setAttribute("aria-expanded", String(open));
}

function toggleNav() {
  if (mobileQuery.matches) {
    layout.classList.toggle("nav-open");
  } else {
    layout.classList.toggle("sidebar-collapsed");
  }
  syncNavState();
}

function closeMobileNav() {
  if (mobileQuery.matches) {
    layout.classList.remove("nav-open");
    syncNavState();
  }
}

navToggle.addEventListener("click", toggleNav);
document.querySelectorAll("[data-close-nav]").forEach((el) =>
  el.addEventListener("click", closeMobileNav)
);
document.querySelectorAll(".nav-link").forEach((link) =>
  link.addEventListener("click", closeMobileNav)
);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeMobileNav();
});
mobileQuery.addEventListener("change", () => {
  layout.classList.remove("nav-open");
  syncNavState();
});
syncNavState();

/* ------------------------------------------------------------
   Wiring
   ------------------------------------------------------------ */
$("refreshBtn").addEventListener("click", loadStats);
$("logoutBtn").addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST" });
  location.replace("/login");
});

const chartPlot = $("chartPlot");
chartPlot.addEventListener("mousemove", handleChartMove);
chartPlot.addEventListener("mouseleave", hideCrosshair);
chartPlot.addEventListener("touchstart", (event) => {
  if (event.touches[0]) handleChartMove(event.touches[0]);
}, { passive: true });

loadStats();
setInterval(() => loadStats({ silent: true }), 5000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) loadStats();
});
