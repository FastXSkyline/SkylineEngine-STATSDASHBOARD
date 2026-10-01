const API_URL = "/api/stats";

const $ = (id) => document.getElementById(id);

function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-US");
}

function applyStats(data) {
  const launches = Number(data.launches || 0);
  const users = Number(data.users || 0);

  $("totalLaunches").textContent = formatNumber(launches);
  $("totalUsers").textContent = formatNumber(users);
  $("summaryLaunches").textContent = formatNumber(launches);
  $("summaryUsers").textContent = formatNumber(users);
  $("floatLaunches").textContent = formatNumber(launches);

  const hasData = launches > 0;
  const pct = hasData ? Math.min((users / launches) * 100, 100) : 0;
  $("uniqueShare").textContent = hasData ? pct.toFixed(1) + "%" : "—";
  $("shareSub").textContent = hasData
    ? formatNumber(users) + " of " + formatNumber(launches) + " launches"
    : "Awaiting launch data";
  $("shareRing").style.setProperty("--pct", hasData ? pct : 0);

  $("lastUpdated").textContent = new Date().toLocaleTimeString();
}

async function loadStats() {
  const refreshBtn = $("refreshBtn");
  const refreshLabel = $("refreshLabel");
  const statsGrid = document.querySelector(".stats-grid");

  refreshBtn.disabled = true;
  refreshBtn.classList.add("spin");
  refreshLabel.textContent = "Loading";
  statsGrid.classList.add("is-loading");

  try {
    const response = await fetch(API_URL, { cache: "no-store" });
    if (!response.ok) throw new Error("API returned " + response.status);

    applyStats(await response.json());
  } catch (error) {
    console.error("Failed to load stats:", error);
    $("lastUpdated").textContent = "Connection error";
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.classList.remove("spin");
    refreshLabel.textContent = "Refresh";
    statsGrid.classList.remove("is-loading");
  }
}

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
   Stats polling
   ------------------------------------------------------------ */
$("refreshBtn").addEventListener("click", loadStats);
loadStats();
setInterval(loadStats, 30000);
