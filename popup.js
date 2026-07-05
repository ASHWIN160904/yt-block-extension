// ---------- Toast notifications ----------

function showToast(message, type = "success") {
  const container = document.getElementById("toastContainer");
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 250);
  }, 2200);
}

// ---------- ID/URL parsing ----------

function extractVideoId(input) {
  const trimmed = input.trim();
  if (/^[a-zA-Z0-9_-]{10,12}$/.test(trimmed) && !trimmed.includes("/")) {
    return trimmed;
  }
  try {
    const u = new URL(trimmed);
    if (u.hostname.includes("youtu.be")) return u.pathname.replace("/", "");
    if (u.hostname.includes("youtube.com")) {
      if (u.pathname === "/watch") return u.searchParams.get("v");
      if (u.pathname.startsWith("/shorts/")) return u.pathname.split("/")[2];
      if (u.pathname.startsWith("/embed/")) return u.pathname.split("/")[2];
    }
  } catch (e) {}
  return null;
}

function extractPlaylistId(input) {
  const trimmed = input.trim();
  if (/^[a-zA-Z0-9_-]{10,50}$/.test(trimmed) && !trimmed.includes("/")) return trimmed;
  try {
    const u = new URL(trimmed);
    return u.searchParams.get("list");
  } catch (e) {
    return null;
  }
}

function extractChannelIdentifier(input) {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    return u.pathname.replace(/^\//, "");
  } catch (e) {
    return trimmed.replace(/^@?/, "@");
  }
}

// ---------- Storage: Study Profiles ----------

function normalizeWhitelist(raw) {
  if (Array.isArray(raw)) return { videos: raw, channels: [], playlists: [] };
  return {
    videos: raw?.videos || [],
    channels: raw?.channels || [],
    playlists: raw?.playlists || [],
  };
}

function getProfilesState() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      { profiles: null, activeProfile: "default", whitelist: null },
      async (data) => {
        let profiles = data.profiles;
        if (!profiles || Object.keys(profiles).length === 0) {
          const legacy = normalizeWhitelist(data.whitelist || { videos: [], channels: [], playlists: [] });
          profiles = { default: legacy };
          await new Promise((r) => chrome.storage.sync.set({ profiles, activeProfile: "default" }, r));
        }
        const activeProfile = profiles[data.activeProfile] ? data.activeProfile : Object.keys(profiles)[0];
        resolve({ profiles, activeProfile });
      }
    );
  });
}

function saveProfiles(profiles) {
  return new Promise((resolve) => chrome.storage.sync.set({ profiles }, resolve));
}

function setActiveProfileName(name) {
  return new Promise((resolve) => chrome.storage.sync.set({ activeProfile: name }, resolve));
}

async function getWhitelist() {
  const { profiles, activeProfile } = await getProfilesState();
  return normalizeWhitelist(profiles[activeProfile]);
}

async function setWhitelist(whitelist) {
  const { profiles, activeProfile } = await getProfilesState();
  profiles[activeProfile] = whitelist;
  await saveProfiles(profiles);
}

async function createProfile(name) {
  const trimmed = name.trim();
  if (!trimmed) return;
  const { profiles } = await getProfilesState();
  if (profiles[trimmed]) {
    await setActiveProfileName(trimmed);
    return;
  }
  profiles[trimmed] = { videos: [], channels: [], playlists: [] };
  await saveProfiles(profiles);
  await setActiveProfileName(trimmed);
}

async function deleteActiveProfile() {
  const { profiles, activeProfile } = await getProfilesState();
  const names = Object.keys(profiles);
  if (names.length <= 1) {
    profiles[activeProfile] = { videos: [], channels: [], playlists: [] };
    await saveProfiles(profiles);
    return;
  }
  delete profiles[activeProfile];
  await saveProfiles(profiles);
  const remaining = Object.keys(profiles);
  await setActiveProfileName(remaining[0]);
}

async function renderProfileSelector() {
  const { profiles, activeProfile } = await getProfilesState();
  const select = document.getElementById("profileSelect");
  select.innerHTML = "";
  Object.keys(profiles).forEach((name) => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    if (name === activeProfile) opt.selected = true;
    select.appendChild(opt);
  });
}

document.getElementById("profileSelect").addEventListener("change", async (e) => {
  await setActiveProfileName(e.target.value);
  showToast(`Switched to "${e.target.value}"`, "success");
  render();
});

document.getElementById("newProfileBtn").addEventListener("click", () => {
  const row = document.getElementById("newProfileRow");
  row.style.display = row.style.display === "none" ? "flex" : "none";
  document.getElementById("newProfileInput").focus();
});

document.getElementById("createProfileBtn").addEventListener("click", async () => {
  const input = document.getElementById("newProfileInput");
  if (!input.value.trim()) return;
  const name = input.value.trim();
  await createProfile(name);
  input.value = "";
  document.getElementById("newProfileRow").style.display = "none";
  showToast(`Profile "${name}" ready`, "success");
  renderProfileSelector();
  render();
});

document.getElementById("deleteProfileBtn").addEventListener("click", async () => {
  const { activeProfile } = await getProfilesState();
  const confirmed = confirm(`Delete profile "${activeProfile}"? This removes its allowed videos/channels/playlists.`);
  if (!confirmed) return;
  await deleteActiveProfile();
  showToast(`Deleted "${activeProfile}"`, "error");
  renderProfileSelector();
  render();
});

function getEnabled() {
  return new Promise((resolve) => {
    chrome.storage.sync.get({ enabled: true }, (data) => resolve(data.enabled));
  });
}

function setEnabled(value) {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ enabled: value }, resolve);
  });
}

function getTheme() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ theme: "dark" }, (data) => resolve(data.theme));
  });
}

function setTheme(theme) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ theme }, resolve);
  });
}

function todayKey(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getAllStats() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ stats: {} }, (data) => resolve(data.stats));
  });
}

function getMetaCache() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ metaCache: {} }, (data) => resolve(data.metaCache));
  });
}

async function fetchVideoMeta(videoId) {
  const cache = await getMetaCache();
  if (cache[videoId]) return cache[videoId];
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
    );
    if (!res.ok) throw new Error("oEmbed failed");
    const data = await res.json();
    const meta = { title: data.title, thumbnail: data.thumbnail_url };
    cache[videoId] = meta;
    chrome.storage.local.set({ metaCache: cache });
    return meta;
  } catch (e) {
    return { title: videoId, thumbnail: "" };
  }
}

// ---------- Theme ----------

async function applyTheme() {
  const theme = await getTheme();
  document.body.dataset.theme = theme;
  document.getElementById("themeBtn").textContent = theme === "dark" ? "🌙" : "☀️";
}

document.getElementById("themeBtn").addEventListener("click", async () => {
  const current = await getTheme();
  await setTheme(current === "dark" ? "light" : "dark");
  applyTheme();
});

// ---------- Study Mode toggle ----------

async function renderToggle() {
  const enabled = await getEnabled();
  document.getElementById("enabledToggle").checked = enabled;
  document.getElementById("statusLabel").textContent = `Study Mode: ${enabled ? "ON" : "OFF"}`;
  document.getElementById("statusDot").classList.toggle("on", enabled);
  document.getElementById("heroCard").classList.toggle("glowing", enabled);
}

document.getElementById("enabledToggle").addEventListener("change", async (e) => {
  await setEnabled(e.target.checked);
  renderToggle();
  showToast(e.target.checked ? "Study Mode on — stay focused!" : "Study Mode off", e.target.checked ? "success" : "error");
});

// ---------- Break reminders ----------

function getBreakSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get({ breakIntervalMinutes: 45, breakRemindersEnabled: true }, resolve);
  });
}

function setBreakSettings(settings) {
  return new Promise((resolve) => chrome.storage.sync.set(settings, resolve));
}

async function renderBreakSettings() {
  const { breakIntervalMinutes, breakRemindersEnabled } = await getBreakSettings();
  document.getElementById("breakToggle").checked = breakRemindersEnabled;
  document.getElementById("breakIntervalSelect").value = String(breakIntervalMinutes);
}

document.getElementById("breakToggle").addEventListener("change", async (e) => {
  await setBreakSettings({ breakRemindersEnabled: e.target.checked });
});

document.getElementById("breakIntervalSelect").addEventListener("change", async (e) => {
  await setBreakSettings({ breakIntervalMinutes: parseInt(e.target.value, 10) });
});

// Live "focused for Xm" readout in the hero card, using the session start
// time tracked by background.js.
function getSessionStart() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ studyStartedAt: null }, (data) => resolve(data.studyStartedAt));
  });
}

async function renderSessionTimer() {
  const enabled = await getEnabled();
  const heroSub = document.getElementById("heroSub");
  if (!enabled) {
    heroSub.textContent = "Only allowed content can play";
    return;
  }
  const startedAt = await getSessionStart();
  if (!startedAt) {
    heroSub.textContent = "Only allowed content can play";
    return;
  }
  const minutes = Math.max(0, Math.round((Date.now() - startedAt) / 60000));
  heroSub.textContent = minutes < 1 ? "Just started focusing" : `Focused for ${minutes} min`;
}

setInterval(renderSessionTimer, 15000);

// ---------- Stats ----------

function animateNumber(el, target) {
  const start = parseInt(el.textContent, 10) || 0;
  if (start === target) return;
  const duration = 400;
  const startTime = performance.now();
  function step(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(start + (target - start) * eased);
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

async function renderStats() {
  const stats = await getAllStats();
  const today = stats[todayKey()] || { blocked: 0, allowed: 0 };
  animateNumber(document.getElementById("blockedCount"), today.blocked);
  animateNumber(document.getElementById("allowedCount"), today.allowed);

  const days = [];
  for (let i = 6; i >= 0; i--) {
    const key = todayKey(i);
    const entry = stats[key] || { blocked: 0, allowed: 0 };
    const label = new Date(key).toLocaleDateString(undefined, { weekday: "short" }).slice(0, 2);
    days.push({ label, ...entry });
  }
  const max = Math.max(1, ...days.map((d) => Math.max(d.blocked, d.allowed)));

  const chart = document.getElementById("weekChart");
  chart.innerHTML = "";
  days.forEach((d) => {
    const col = document.createElement("div");
    col.className = "chart-col";
    const blockedH = Math.round((d.blocked / max) * 54);
    const allowedH = Math.round((d.allowed / max) * 54);
    col.innerHTML = `
      <div class="chart-bars" title="Blocked: ${d.blocked}, Watched: ${d.allowed}">
        <div class="chart-bar blocked" style="height:0px" data-h="${blockedH}"></div>
        <div class="chart-bar allowed" style="height:0px" data-h="${allowedH}"></div>
      </div>
      <div class="chart-day">${d.label}</div>
    `;
    chart.appendChild(col);
  });
  requestAnimationFrame(() => {
    chart.querySelectorAll(".chart-bar").forEach((bar) => {
      bar.style.height = `${bar.dataset.h}px`;
    });
  });
}

// ---------- Add-item tabs (video / channel / playlist) ----------

let activeAddType = "video";

function moveTabIndicator(index) {
  const indicator = document.getElementById("tabIndicator");
  indicator.style.transform = `translateX(${index * 100}%)`;
}

document.querySelectorAll(".tab").forEach((tab, index) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    moveTabIndicator(index);
    activeAddType = tab.dataset.type;
    const input = document.getElementById("urlInput");
    const placeholders = {
      video: "Paste YouTube video URL or ID",
      channel: "Paste channel URL or @handle",
      playlist: "Paste playlist URL or ID",
    };
    input.placeholder = placeholders[activeAddType];
  });
});

// ---------- Allowed-list tabs (videos / channels / playlists) ----------

let activeListType = "videos";
document.querySelectorAll(".list-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".list-tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    activeListType = tab.dataset.list;
    document.getElementById("searchInput").value = "";
    render();
  });
});

// ---------- Rendering the allowed list ----------

function getSearchTerm() {
  return (document.getElementById("searchInput").value || "").trim().toLowerCase();
}

async function render() {
  const whitelist = await getWhitelist();
  const ul = document.getElementById("list");
  ul.innerHTML = "";
  const allItems = whitelist[activeListType] || [];
  const search = getSearchTerm();
  const items = search ? allItems.filter((v) => v.toLowerCase().includes(search)) : allItems;

  if (allItems.length === 0) {
    const emptyCopy = {
      videos: ["🎬", "No videos allowed yet", "Add one below to get started"],
      channels: ["📺", "No channels allowed yet", "Whitelist an entire channel above"],
      playlists: ["🎞️", "No playlists allowed yet", "Whitelist a full playlist above"],
    }[activeListType];
    ul.innerHTML = `
      <div class="empty">
        <div class="empty-icon">${emptyCopy[0]}</div>
        <div class="empty-title">${emptyCopy[1]}</div>
        <div class="empty-sub">${emptyCopy[2]}</div>
      </div>`;
    return;
  }
  if (items.length === 0) {
    ul.innerHTML = `
      <div class="empty">
        <div class="empty-icon">🔍</div>
        <div class="empty-title">No matches</div>
        <div class="empty-sub">Nothing found for "${search}"</div>
      </div>`;
    return;
  }

  items.forEach((idOrString, i) => {
    const li = document.createElement("li");
    li.classList.add("item-enter");
    li.style.animationDelay = `${Math.min(i, 8) * 25}ms`;

    if (activeListType === "videos") {
      li.innerHTML = `
        <img class="thumb-shimmer" src="" alt="" />
        <div class="info">
          <div class="title">Loading…</div>
          <div class="id">${idOrString}</div>
        </div>
        <button class="remove">✕</button>
      `;
      fetchVideoMeta(idOrString).then((meta) => {
        const img = li.querySelector("img");
        const title = li.querySelector(".title");
        if (meta.thumbnail) {
          img.src = meta.thumbnail;
          img.onload = () => img.classList.remove("thumb-shimmer");
        } else {
          img.classList.remove("thumb-shimmer");
        }
        title.textContent = meta.title;
        title.title = meta.title;
      });
    } else {
      const icon = activeListType === "channels" ? "📺" : "🎞️";
      li.innerHTML = `
        <div class="info">
          <div class="title">${icon} ${idOrString}</div>
        </div>
        <button class="remove">✕</button>
      `;
    }

    li.querySelector(".remove").addEventListener("click", async () => {
      li.classList.add("item-leave");
      li.addEventListener(
        "transitionend",
        async () => {
          const wl = await getWhitelist();
          wl[activeListType] = wl[activeListType].filter((v) => v !== idOrString);
          await setWhitelist(wl);
          showToast("Removed from list", "error");
          render();
        },
        { once: true }
      );
    });
    ul.appendChild(li);
  });
}

document.getElementById("searchInput").addEventListener("input", () => render());

// ---------- Adding with a short confirm-delay (light friction) ----------

const CONFIRM_DELAY_SECONDS = 4;

function extractByType(type, value) {
  if (type === "video") return extractVideoId(value);
  if (type === "playlist") return extractPlaylistId(value);
  if (type === "channel") return extractChannelIdentifier(value);
  return null;
}

function listKeyForType(type) {
  return type === "video" ? "videos" : type === "playlist" ? "playlists" : "channels";
}

async function addToWhitelist(type, id) {
  const wl = await getWhitelist();
  const key = listKeyForType(type);
  if (!wl[key].includes(id)) {
    wl[key].push(id);
    await setWhitelist(wl);
  }
}

function startAddConfirmation(addBtn, onConfirm) {
  let remaining = CONFIRM_DELAY_SECONDS;
  addBtn.disabled = true;
  addBtn.textContent = `Wait ${remaining}s…`;
  const interval = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(interval);
      addBtn.disabled = false;
      addBtn.textContent = "Confirm add";
      addBtn.onclick = () => {
        onConfirm();
        addBtn.textContent = "Add";
        addBtn.onclick = null;
        addBtn.dataset.pending = "";
      };
    } else {
      addBtn.textContent = `Wait ${remaining}s…`;
    }
  }, 1000);
}

document.getElementById("addBtn").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  if (btn.dataset.pending === "1") return;

  const input = document.getElementById("urlInput");
  const id = extractByType(activeAddType, input.value);
  if (!id) {
    input.style.border = "1px solid #ff0033";
    return;
  }
  input.style.border = "";

  btn.dataset.pending = "1";
  startAddConfirmation(btn, async () => {
    await addToWhitelist(activeAddType, id);
    input.value = "";
    btn.dataset.pending = "";
    showToast(`Added to ${listKeyForType(activeAddType)}`, "success");
    if (listKeyForType(activeAddType) === activeListType) render();
  });
});

document.getElementById("currentBtn").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) return;
  const id = extractVideoId(tab.url);
  if (!id) {
    showToast("Current tab isn't a YouTube video page", "error");
    return;
  }
  await addToWhitelist("video", id);
  showToast("Current video added", "success");
  if (activeListType === "videos") render();
});

// ---------- Init ----------

render();
renderToggle();
renderStats();
applyTheme();
renderProfileSelector();
renderBreakSettings();
renderSessionTimer();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.stats) renderStats();
  if (area === "local" && changes.studyStartedAt) renderSessionTimer();
  if (area === "sync" && (changes.profiles || changes.activeProfile)) {
    renderProfileSelector();
    render();
  }
});