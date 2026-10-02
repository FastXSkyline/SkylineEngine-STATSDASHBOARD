const RELEASES_URL = "/api/public/fivem/files";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(value) {
  if (!value) return "—";
  const normalized = String(value).includes("T") ? String(value) : String(value).replace(" ", "T") + "Z";
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

function releaseCard(file) {
  const version = file.version ? "v" + file.version.replace(/^v/i, "") : "Release";
  const downloadable = Number(file.downloadable) !== 0;
  const url = String(file.download_url || "").trim();
  const downloadAction = downloadable && /^https?:\/\//i.test(url)
    ? '<a class="update-download" href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">Download</a>'
    : '<span class="update-download is-disabled" aria-disabled="true">Not downloadable</span>';

  return '<article class="update-card">' +
    '<div class="update-card-top"><div>' +
    '<span class="update-version">' + escapeHtml(version) + '</span>' +
    '<h3 class="update-title">' + escapeHtml(file.name || "Skyline Engine") + '</h3>' +
    '<p class="update-description">' + escapeHtml(file.description || "Latest Skyline Engine release.") + '</p>' +
    '</div><span class="update-status">Published release</span></div>' +
    '<div class="update-meta">' +
    '<div class="update-meta-item"><span class="update-meta-label">Version</span><span class="update-meta-value">' + escapeHtml(file.version || "—") + '</span></div>' +
    '<div class="update-meta-item"><span class="update-meta-label">Release date</span><span class="update-meta-value">' + escapeHtml(formatDate(file.updated_at || file.created_at)) + '</span></div>' +
    '<div class="update-meta-item"><span class="update-meta-label">Status</span><span class="update-meta-value">' + (downloadable ? "Available" : "Info only") + '</span></div>' +
    '</div>' +
    '<div class="update-file-info">' +
    '<div class="file-info-item"><span class="file-info-label">File</span><span class="file-info-value">' + escapeHtml(file.file_name || "Not specified") + '</span></div>' +
    '<div class="file-info-item"><span class="file-info-label">Type</span><span class="file-info-value">' + escapeHtml(file.category || "Application") + '</span></div>' +
    '<div class="file-info-item"><span class="file-info-label">Platform</span><span class="file-info-value">' + escapeHtml(file.platform || "Windows") + '</span></div>' +
    '<div class="file-info-item"><span class="file-info-label">Delivery</span><span class="file-info-value">' + (downloadable ? "Direct download" : "Unavailable") + '</span></div>' +
    '</div>' +
    '<div class="update-actions">' + downloadAction + '</div>' +
    '</article>';
}

function renderState(title, text, status) {
  const list = document.getElementById("updatesList");
  if (!list) return;
  list.innerHTML =
    '<article class="update-card">' +
    '<div class="update-card-top"><div>' +
    '<span class="update-version">' + escapeHtml(status) + '</span>' +
    '<h3 class="update-title">' + escapeHtml(title) + '</h3>' +
    '<p class="update-description">' + escapeHtml(text) + '</p>' +
    '</div><span class="update-status">Release feed</span></div>' +
    '</article>';
}

async function loadReleases() {
  try {
    const response = await fetch(RELEASES_URL + "?_=" + Date.now(), {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || "Release request failed.");

    const files = Array.isArray(data.files) ? data.files : [];
    const list = document.getElementById("updatesList");
    if (!list) return;

    if (!files.length) {
      renderState("No published releases", "There are no published releases available right now.", "EMPTY");
      return;
    }

    list.innerHTML = files.map(releaseCard).join("");
  } catch (error) {
    renderState(
      "Could not load releases",
      "The release feed could not be reached. Please refresh the page and try again.",
      "OFFLINE"
    );
  }
}

document.addEventListener("DOMContentLoaded", loadReleases);
