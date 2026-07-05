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
  // Accept raw handles (@name), raw channel IDs (UC...), or full URLs — store
  // whatever distinguishing string was given; matching is substring-based.
  try {
    const u = new URL(trimmed);
    return u.pathname.replace(/^\//, ""); // e.g. "@somechannel" or "channel/UC..."
  } catch (e) {
    return trimmed.replace(/^@?/, "@");
  }
}

// ---------- Storage ----------

function normalizeWhitelist(raw) {
  if (Array.isArray(raw)) return { videos: raw, channels: [], playlists: [] };
  return {
    videos: raw?.videos || [],
    channels: raw?.channels || [],
    playlists: raw?.playlists || [],
  };
}

function getWhitelist() {
  return new Promise((resolve) => {
    chrome.storage.sync.get({ whitelist: { videos: [], channels: [], playlists: [] } }, (data) =>
      resolve(normalizeWhitelist(data.whitelist))
    );
  });
}

function setWhitelist(whitelist) {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ whitelist }, resolve);
  });
}

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
}

document.getElementById("enabledToggle").addEventListener("change", async (e) => {
  await setEnabled(e.target.checked);
  renderToggle();
});

// ---------- Stats ----------

async function renderStats() {
  const stats = await getAllStats();
  const today = stats[todayKey()] || { blocked: 0, allowed: 0 };
  document.getElementById("blockedCount").textContent = today.blocked;
  document.getElementById("allowedCount").textContent = today.allowed;

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
        <div class="chart-bar blocked" style="height:${blockedH}px"></div>
        <div class="chart-bar allowed" style="height:${allowedH}px"></div>
      </div>
      <div class="chart-day">${d.label}</div>
    `;
    chart.appendChild(col);
  });
}

// ---------- Add-item tabs (video / channel / playlist) ----------

let activeAddType = "video";
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
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
    render();
  });
});

// ---------- Rendering the allowed list ----------

async function render() {
  const whitelist = await getWhitelist();
  const ul = document.getElementById("list");
  ul.innerHTML = "";
  const items = whitelist[activeListType] || [];

  if (items.length === 0) {
    ul.innerHTML = `<div class="empty">Nothing here yet.</div>`;
    return;
  }

  items.forEach((idOrString) => {
    const li = document.createElement("li");

    if (activeListType === "videos") {
      li.innerHTML = `
        <img src="" alt="" />
        <div class="info">
          <div class="title">Loading…</div>
          <div class="id">${idOrString}</div>
        </div>
        <button class="remove">✕</button>
      `;
      fetchVideoMeta(idOrString).then((meta) => {
        const img = li.querySelector("img");
        const title = li.querySelector(".title");
        if (meta.thumbnail) img.src = meta.thumbnail;
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
      const wl = await getWhitelist();
      wl[activeListType] = wl[activeListType].filter((v) => v !== idOrString);
      await setWhitelist(wl);
      render();
    });
    ul.appendChild(li);
  });
}

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
  if (btn.dataset.pending === "1") return; // already counting down

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
    if (listKeyForType(activeAddType) === activeListType) render();
  });
});

document.getElementById("currentBtn").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) return;
  const id = extractVideoId(tab.url);
  if (!id) {
    alert("Current tab doesn't look like a YouTube video page.");
    return;
  }
  await addToWhitelist("video", id);
  if (activeListType === "videos") render();
});

// ---------- Init ----------

render();
renderToggle();
renderStats();
applyTheme();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.stats) renderStats();
});