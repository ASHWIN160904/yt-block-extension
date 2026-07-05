// content.js
// Runs on every youtube.com page. When Study Mode is ON, checks the current
// video's ID against a whitelist stored in chrome.storage.sync, and blocks
// playback + shows an alert for anything not on the list. When Study Mode
// is OFF, everything plays normally.

function getVideoId(url) {
  try {
    const u = new URL(url);
    if (!u.hostname.includes("youtube.com")) return null;
    if (u.pathname === "/watch") return u.searchParams.get("v");
    if (u.pathname.startsWith("/shorts/")) return u.pathname.split("/")[2];
    if (u.pathname.startsWith("/embed/")) return u.pathname.split("/")[2];
  } catch (e) {
    /* ignore */
  }
  return null;
}

function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get({ whitelist: [], enabled: true }, (data) => resolve(data));
  });
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

async function recordBlockedAttempt() {
  chrome.storage.local.get({ stats: { date: "", blockedCount: 0, allowedWatches: 0 } }, (data) => {
    const stats = data.stats;
    const today = todayKey();
    if (stats.date !== today) {
      stats.date = today;
      stats.blockedCount = 0;
      stats.allowedWatches = 0;
    }
    stats.blockedCount += 1;
    chrome.storage.local.set({ stats });
  });
}

async function recordAllowedWatch() {
  chrome.storage.local.get({ stats: { date: "", blockedCount: 0, allowedWatches: 0 } }, (data) => {
    const stats = data.stats;
    const today = todayKey();
    if (stats.date !== today) {
      stats.date = today;
      stats.blockedCount = 0;
      stats.allowedWatches = 0;
    }
    stats.allowedWatches += 1;
    chrome.storage.local.set({ stats });
  });
}

function blockVideo() {
  const video = document.querySelector("video");
  if (video) {
    video.pause();
    try {
      video.currentTime = 0;
    } catch (e) {}
  }

  if (document.getElementById("yt-blocker-overlay")) return;

  const player =
    document.querySelector("#movie_player") ||
    document.querySelector("#player-container") ||
    document.querySelector("#player");

  const target = player || document.body;
  if (target && getComputedStyle(target).position === "static") {
    target.style.position = "relative";
  }

  const overlay = document.createElement("div");
  overlay.id = "yt-blocker-overlay";
  overlay.style.cssText = `
    position:absolute; inset:0; background:#0f0f0f; color:#fff;
    display:flex; flex-direction:column; align-items:center; justify-content:center;
    z-index:2147483647; font-family:Roboto,Arial,sans-serif; text-align:center; padding:24px;
  `;
  overlay.innerHTML = `
    <div style="font-size:22px; font-weight:600; margin-bottom:10px;">Study Mode is on 🚫</div>
    <div style="font-size:14px; opacity:0.8; max-width:320px;">
      This video isn't on your allowed list. Open the extension popup to add it, or turn Study Mode off if you're done studying.
    </div>
  `;
  target.appendChild(overlay);
}

function unblock() {
  const overlay = document.getElementById("yt-blocker-overlay");
  if (overlay) overlay.remove();
}

// Track which blocked video we've already alerted on, and which allowed
// video we've already counted, so we don't spam stats every poll cycle.
let lastAlertedVideoId = null;
let lastCountedAllowedId = null;

async function checkAndBlock() {
  const { whitelist, enabled } = await getSettings();
  const videoId = getVideoId(location.href);

  if (!enabled) {
    unblock();
    lastAlertedVideoId = null;
    return;
  }

  if (!videoId) {
    unblock();
    lastAlertedVideoId = null;
    return;
  }

  if (whitelist.includes(videoId)) {
    unblock();
    lastAlertedVideoId = null;
    if (lastCountedAllowedId !== videoId) {
      lastCountedAllowedId = videoId;
      recordAllowedWatch();
    }
  } else {
    blockVideo();
    if (lastAlertedVideoId !== videoId) {
      lastAlertedVideoId = videoId;
      recordBlockedAttempt();
      // Slight delay so the overlay renders before the blocking alert() fires.
      setTimeout(() => {
        alert("Study Mode is on — this video isn't on your allowed list.\n\nAdd it from the extension popup, or turn Study Mode off if you're finished studying.");
      }, 150);
    }
  }
}

// YouTube is a single-page app; it fires this custom event on navigation.
document.addEventListener("yt-navigate-finish", checkAndBlock);

// Initial check on load.
checkAndBlock();

// Fallback: watch for URL changes and re-assert the block, since YouTube
// sometimes re-renders the player and removes our overlay.
let lastUrl = location.href;
setInterval(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
  }
  checkAndBlock();
}, 1000);

// React immediately if the whitelist or the on/off toggle changes.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && (changes.whitelist || changes.enabled)) {
    checkAndBlock();
  }
});
