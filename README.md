# YouTube Video Allowlist (Chrome Extension)

Blocks every YouTube video except the ones you explicitly allow.

## How it works
- A content script runs on youtube.com, reads the current video ID from the URL,
  and checks it against a whitelist stored in `chrome.storage.sync`.
- A **Study Mode** toggle in the popup turns the whole thing on/off. When it's OFF,
  every video plays normally — flip it back ON when you sit down to study again.
- When Study Mode is ON and you land on a video that's not on your allowed list:
  playback is paused, an overlay covers the player, and you get a one-time browser
  alert saying the video is blocked (it won't spam you again for the same video
  unless the page is fully reloaded).
- The popup lets you add videos by pasting a URL/ID, or one-click "allow current tab".
- Works with YouTube's SPA navigation (no full page reloads needed) and re-checks
  instantly whenever the whitelist or toggle changes.
- **Daily stats**: the popup shows how many blocked attempts and how many allowed
  watches happened today, resetting automatically at midnight. This is meant purely
  as visibility into your own patterns, not a limit — nothing is capped.
- **Thumbnails & titles**: the allowed-videos list shows the real video thumbnail
  and title (pulled from YouTube's public oEmbed endpoint, cached locally) instead
  of a bare video ID, so it's easier to recognize what's actually on your list.

## Load it in Chrome
1. Go to `chrome://extensions`
2. Turn on "Developer mode" (top right)
3. Click "Load unpacked"
4. Select this folder (`yt-block-extension`)
5. Pin the extension, open its popup, and add video IDs/URLs you want to allow

## Notes / limitations
- This only blocks *watch page playback* — YouTube's homepage/search/thumbnails will
  still render normally (that's a good next step to add if you want a stricter block).
- Anyone with access to `chrome://extensions` can disable this, since Chrome doesn't
  support tamper-proof self-restriction. If you want it harder to circumvent, you'd
  typically pair this with OS-level parental controls or a separate limited browser profile.
- Whitelist is stored in `chrome.storage.sync`, so it'll sync across your signed-in
  Chrome browsers.

## Extending it
Ideas if you want to go further:
- Also hide/blur video thumbnails on the homepage and search results unless whitelisted.
- Add a "reason" field and daily time limit per allowed video.
- Add a passcode requirement in the popup before adding new videos (self-commitment device).
