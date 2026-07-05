// content.js
// Runs on youtube.com and m.youtube.com. When Study Mode is ON:
//   - Blocks playback of any watch-page video not covered by the whitelist
//     (by video ID, channel, or playlist).
//   - Blurs thumbnails/titles for non-whitelisted videos in feeds (home,
//     search, sidebar, Shorts shelf) and blocks clicking into them.
// When Study Mode is OFF, everything works normally.

// ---------- ID extraction ----------

function getVideoId(url) {
  try {
    const u = new URL(url, location.href);
    if (!u.hostname.includes("youtube.com")) return null;
    if (u.pathname === "/watch") return u.searchParams.get("v");
    if (u.pathname.startsWith("/shorts/")) return u.pathname.split("/")[2];
    if (u.pathname.startsWith("/embed/")) return u.pathname.split("/")[2];
  } catch (e) {
    /* ignore */
  }
  return null;
}

function getPlaylistId(url) {
  try {
    const u = new URL(url, location.href);
    return u.searchParams.get("list");
  } catch (e) {
    return null;
  }
}

function getCurrentChannelId() {
  const meta = document.querySelector('meta[itemprop="channelId"]');
  if (meta) return meta.content;
  const link = document.querySelector('link[itemprop="url"]');
  if (link) return link.href;
  return null;
}

// ---------- Storage helpers ----------

// Normalizes whitelist to the {videos, channels, playlists} shape,
// migrating from the old flat-array format if needed.
function normalizeWhitelist(raw) {
  if (Array.isArray(raw)) {
    return { videos: raw, channels: [], playlists: [] };
  }
  return {
    videos: raw?.videos || [],
    channels: raw?.channels || [],
    playlists: raw?.playlists || [],
  };
}

function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get({ whitelist: { videos: [], channels: [], playlists: [] }, enabled: true }, (data) => {
      resolve({ whitelist: normalizeWhitelist(data.whitelist), enabled: data.enabled });
    });
  });
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function bumpDailyStat(field) {
  chrome.storage.local.get({ stats: {} }, (data) => {
    const stats = data.stats;
    const key = todayKey();
    if (!stats[key]) stats[key] = { blocked: 0, allowed: 0 };
    stats[key][field] += 1;
    // Keep only the last 30 days to avoid unbounded growth.
    const keys = Object.keys(stats).sort();
    while (keys.length > 30) {
      delete stats[keys.shift()];
    }
    chrome.storage.local.set({ stats });
  });
}

// ---------- Allowed-check ----------

function isChannelAllowed(channelHrefOrId, channels) {
  if (!channelHrefOrId || channels.length === 0) return false;
  return channels.some((c) => channelHrefOrId.includes(c));
}

function isAllowed({ videoId, channelId, playlistId }, whitelist) {
  if (videoId && whitelist.videos.includes(videoId)) return true;
  if (playlistId && whitelist.playlists.includes(playlistId)) return true;
  if (channelId && isChannelAllowed(channelId, whitelist.channels)) return true;
  return false;
}

// ---------- In-page modal (replaces native alert) ----------

function showBlockModal(message) {
  if (document.getElementById("yt-allowlist-modal-backdrop")) return;
  const backdrop = document.createElement("div");
  backdrop.id = "yt-allowlist-modal-backdrop";
  backdrop.innerHTML = `
    <div id="yt-allowlist-modal">
      <div class="icon">🚫</div>
      <div class="title">Study Mode is on</div>
      <div class="body">${message}</div>
      <button id="yt-allowlist-modal-close">Got it</button>
    </div>
  `;
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector("#yt-allowlist-modal-close").addEventListener("click", close);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });
}

// ---------- Watch-page blocking ----------

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
    z-index:2147483000; font-family:Roboto,Arial,sans-serif; text-align:center; padding:24px;
  `;
  overlay.innerHTML = `
    <div style="font-size:22px; font-weight:600; margin-bottom:10px;">Study Mode is on 🚫</div>
    <div style="font-size:14px; opacity:0.8; max-width:320px;">
      This video isn't on your allowed list. Open the extension popup to add it, or turn Study Mode off if you're done studying.
    </div>
  `;
  target.appendChild(overlay);
}

function unblockWatchPage() {
  const overlay = document.getElementById("yt-blocker-overlay");
  if (overlay) overlay.remove();
}

let lastAlertedVideoId = null;
let lastCountedAllowedId = null;

async function checkWatchPage() {
  const { whitelist, enabled } = await getSettings();
  const videoId = getVideoId(location.href);

  if (!enabled) {
    unblockWatchPage();
    lastAlertedVideoId = null;
    return;
  }

  if (!videoId) {
    unblockWatchPage();
    lastAlertedVideoId = null;
    return;
  }

  const playlistId = getPlaylistId(location.href);
  const channelId = getCurrentChannelId();
  const allowed = isAllowed({ videoId, channelId, playlistId }, whitelist);

  if (allowed) {
    unblockWatchPage();
    lastAlertedVideoId = null;
    if (lastCountedAllowedId !== videoId) {
      lastCountedAllowedId = videoId;
      bumpDailyStat("allowed");
    }
  } else {
    blockVideo();
    if (lastAlertedVideoId !== videoId) {
      lastAlertedVideoId = videoId;
      bumpDailyStat("blocked");
      setTimeout(() => {
        showBlockModal(
          "This video isn't on your allowed list. Add it from the extension popup, or turn Study Mode off if you're finished studying."
        );
      }, 150);
    }
  }
}

// ---------- Feed blurring (homepage, search, sidebar, Shorts shelf) ----------

const FEED_ITEM_SELECTORS = [
  "ytd-rich-item-renderer",
  "ytd-video-renderer",
  "ytd-compact-video-renderer",
  "ytd-grid-video-renderer",
  "ytd-reel-item-renderer",
  "ytm-video-with-context-renderer", // mobile
  "ytm-compact-video-renderer", // mobile
];

function findThumbnailAnchor(item) {
  return item.querySelector("a#thumbnail, a.reel-item-endpoint, a[href*='/watch'], a[href*='/shorts/']");
}

function findChannelAnchor(item) {
  return item.querySelector("ytd-channel-name a, .ytd-channel-name a, a[href*='/@'], a[href*='/channel/']");
}

async function processFeedItem(item, whitelist) {
  if (item.dataset.ytAllowlistChecked === "1") return;

  const anchor = findThumbnailAnchor(item);
  if (!anchor || !anchor.href) return;

  const videoId = getVideoId(anchor.href);
  if (!videoId) return; // not a video card (e.g. a channel card, ad, etc.)

  item.dataset.ytAllowlistChecked = "1";

  const channelAnchor = findChannelAnchor(item);
  const channelHref = channelAnchor ? channelAnchor.href : null;

  const allowed = isAllowed({ videoId, channelId: channelHref, playlistId: null }, whitelist);
  if (allowed) return;

  item.classList.add("yt-allowlist-blurred");

  // Blur the title text as well, if we can find it.
  const titleEl = item.querySelector("#video-title, .yt-lockup-metadata-view-model-wiz__title, h3");
  if (titleEl) titleEl.classList.add("yt-allowlist-title-mask");

  // Small lock badge on the thumbnail.
  const thumbWrap = item.querySelector("ytd-thumbnail, .ytd-thumbnail, yt-image, #thumbnail");
  if (thumbWrap && getComputedStyle(thumbWrap).position === "static") {
    thumbWrap.style.position = "relative";
  }
  if (thumbWrap && !thumbWrap.querySelector(".yt-allowlist-lock-badge")) {
    const badge = document.createElement("div");
    badge.className = "yt-allowlist-lock-badge";
    badge.textContent = "🔒 blocked";
    thumbWrap.appendChild(badge);
  }

  // Intercept clicks so the person can't navigate straight into it.
  const clickBlocker = (e) => {
    e.preventDefault();
    e.stopPropagation();
    showBlockModal("This video isn't on your allowed list yet. Add it from the extension popup if you need it.");
  };
  item.querySelectorAll("a").forEach((a) => {
    a.addEventListener("click", clickBlocker, true);
  });
}

async function scanFeed() {
  const { whitelist, enabled } = await getSettings();
  if (!enabled) return;

  const selector = FEED_ITEM_SELECTORS.join(",");
  const items = document.querySelectorAll(selector);
  items.forEach((item) => processFeedItem(item, whitelist));
}

function resetFeedMarks() {
  document.querySelectorAll("[data-yt-allowlist-checked]").forEach((el) => {
    delete el.dataset.ytAllowlistChecked;
    el.classList.remove("yt-allowlist-blurred");
  });
}

// ---------- Master loop ----------

async function checkAndBlock() {
  const { enabled } = await getSettings();
  if (!enabled) {
    unblockWatchPage();
    lastAlertedVideoId = null;
    const backdrop = document.getElementById("yt-allowlist-modal-backdrop");
    if (backdrop) backdrop.remove();
  }
  await checkWatchPage();
  await scanFeed();
}

document.addEventListener("yt-navigate-finish", () => {
  resetFeedMarks();
  checkAndBlock();
});

checkAndBlock();

// Fallback poll: catches SPA transitions and newly-lazy-loaded feed items
// that mutation observers might miss timing-wise.
let lastUrl = location.href;
setInterval(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    resetFeedMarks();
  }
  checkAndBlock();
}, 1200);

// Watch for new feed items being added (infinite scroll, Shorts shelf, etc.)
const feedObserver = new MutationObserver(() => {
  scanFeed();
});
feedObserver.observe(document.body, { childList: true, subtree: true });

// React immediately if the whitelist or the on/off toggle changes.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && (changes.whitelist || changes.enabled)) {
    resetFeedMarks();
    checkAndBlock();
  }
});