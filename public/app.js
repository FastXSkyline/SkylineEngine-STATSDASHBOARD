const API_URL = "/api/stats";

const $ = (id) => document.getElementById(id);

function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-US");
}

async function loadStats() {
  const refreshBtn = $("refreshBtn");
  refreshBtn.disabled = true;
  refreshBtn.textContent = "↻ Loading...";

  try {
    const response = await fetch(API_URL, { cache: "no-store" });
    if (!response.ok) throw new Error("API returned " + response.status);

    const data = await response.json();
    $("totalLaunches").textContent = formatNumber(data.launches);
    $("totalUsers").textContent = formatNumber(data.users);
    $("summaryLaunches").textContent = formatNumber(data.launches);
    $("summaryUsers").textContent = formatNumber(data.users);
    $("lastUpdated").textContent = new Date().toLocaleTimeString();
  } catch (error) {
    console.error("Failed to load stats:", error);
    $("lastUpdated").textContent = "Connection error";
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.textContent = "↻ Refresh";
  }
}

$("refreshBtn").addEventListener("click", loadStats);
loadStats();
setInterval(loadStats, 30000);
