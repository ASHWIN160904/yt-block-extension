function extractVideoId(input) {
  const trimmed = input.trim();
  if (/^[a-zA-Z0-9_-]{10,12}$/.test(trimmed) && !trimmed.includes("/")) {
    return trimmed;
  }
  try {
    const u = new URL(trimmed);
    if (u.hostname.includes("youtu.be")) {
      return u.pathname.replace("/", "");
    }
    if (u.hostname.includes("youtube.com")) {
      if (u.pathname === "/watch") return u.searchParams.get("v");
      if (u.pathname.startsWith("/shorts/")) return u.pathname.split("/")[2];
      if (u.pathname.startsWith("/embed/")) return u.pathname.split("/")[2];
    }
  } catch (e) {
    /* not a URL */
  }
  return null;
}

function getWhitelist() {
  return new Promise((resolve) => {
    chrome.storage.sync.get({ whitelist: [] }, (data) => resolve(data.whitelist));
  });
}

function setWhitelist(list) {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ whitelist: list }, resolve);
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

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function getStats() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ stats: { date: "", blockedCount: 0, allowedWatches: 0 } }, (data) => {
      const stats = data.stats;
      if (stats.date !== todayKey()) {
        resolve({ date: todayKey(), blockedCount: 0, allowedWatches: 0 });
      } else {
        resolve(stats);
      }
    });
  });
}

// Cache of videoId -> {title, thumbnail} pulled from YouTube's public oEmbed
// endpoint, stored locally so we don't refetch every time the popup opens.
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

async function renderStats() {
  const stats = await getStats();
  document.getElementById("blockedCount").textContent = stats.blockedCount;
  document.getElementById("allowedCount").textContent = stats.allowedWatches;
}

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

async function render() {
  const list = await getWhitelist();
  const ul = document.getElementById("list");
  ul.innerHTML = "";
  if (list.length === 0) {
    ul.innerHTML = `<div class="empty">No videos allowed yet.</div>`;
    return;
  }

  // Render placeholders immediately, then fill in metadata as it arrives.
  list.forEach((id) => {
    const li = document.createElement("li");
    li.dataset.id = id;
    li.innerHTML = `
      <img src="" alt="" />
      <div class="info">
        <div class="title">Loading…</div>
        <div class="id">${id}</div>
      </div>
      <button class="remove">✕</button>
    `;
    li.querySelector(".remove").addEventListener("click", async () => {
      const updated = (await getWhitelist()).filter((v) => v !== id);
      await setWhitelist(updated);
      render();
    });
    ul.appendChild(li);

    fetchVideoMeta(id).then((meta) => {
      const img = li.querySelector("img");
      const title = li.querySelector(".title");
      if (meta.thumbnail) img.src = meta.thumbnail;
      title.textContent = meta.title;
      title.title = meta.title;
    });
  });
}

document.getElementById("addBtn").addEventListener("click", async () => {
  const input = document.getElementById("urlInput");
  const id = extractVideoId(input.value);
  if (!id) {
    input.style.border = "1px solid #ff0033";
    return;
  }
  input.style.border = "1px solid #333";
  const list = await getWhitelist();
  if (!list.includes(id)) {
    list.push(id);
    await setWhitelist(list);
  }
  input.value = "";
  render();
});

document.getElementById("currentBtn").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) return;
  const id = extractVideoId(tab.url);
  if (!id) {
    alert("Current tab doesn't look like a YouTube video page.");
    return;
  }
  const list = await getWhitelist();
  if (!list.includes(id)) {
    list.push(id);
    await setWhitelist(list);
  }
  render();
});

render();
renderToggle();
renderStats();

// Keep stats live if the popup stays open while blocks/watches happen elsewhere.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.stats) renderStats();
});
