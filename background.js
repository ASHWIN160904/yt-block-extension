// background.js
// Tracks how long Study Mode has been continuously ON, and fires a system
// notification reminding the person to take a break after a configurable
// interval. Runs in the background, so it works even if the person isn't
// currently on a YouTube tab.

const CHECK_ALARM = "study-break-check";

function getBreakSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get({ breakIntervalMinutes: 45, breakRemindersEnabled: true }, resolve);
  });
}

function getSessionState() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ studyStartedAt: null, lastBreakReminderAt: null }, resolve);
  });
}

function setSessionState(state) {
  return new Promise((resolve) => chrome.storage.local.set(state, resolve));
}

async function startSession() {
  const { studyStartedAt } = await getSessionState();
  if (!studyStartedAt) {
    await setSessionState({ studyStartedAt: Date.now(), lastBreakReminderAt: null });
  }
  chrome.alarms.create(CHECK_ALARM, { periodInMinutes: 1 });
}

async function endSession() {
  await setSessionState({ studyStartedAt: null, lastBreakReminderAt: null });
  chrome.alarms.clear(CHECK_ALARM);
}

// React to Study Mode being toggled from the popup.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.enabled) {
    if (changes.enabled.newValue) {
      startSession();
    } else {
      endSession();
    }
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== CHECK_ALARM) return;

  const { breakIntervalMinutes, breakRemindersEnabled } = await getBreakSettings();
  if (!breakRemindersEnabled) return;

  const { studyStartedAt, lastBreakReminderAt } = await getSessionState();
  if (!studyStartedAt) return;

  const since = lastBreakReminderAt || studyStartedAt;
  const elapsedMinutes = (Date.now() - since) / 60000;

  if (elapsedMinutes >= breakIntervalMinutes) {
    chrome.notifications.create(`study-break-${Date.now()}`, {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "Time for a short break 🧠",
      message: `You've been focused for a while. Stand up, stretch, and rest your eyes for a few minutes.`,
      priority: 1,
    });
    await setSessionState({ studyStartedAt, lastBreakReminderAt: Date.now() });
  }
});

// If the browser restarts or the extension reloads while Study Mode was
// already on, resume tracking instead of losing the session.
chrome.storage.sync.get({ enabled: true }, (data) => {
  if (data.enabled) startSession();
});