# Focus Boomerang — Complete Engineering Specification
### Version 1.1 | Status: Ready for Implementation

---

## Quick-Start for Jules (AI Coding Agent)

**You are being given this document as your complete implementation brief. Do not ask clarifying questions — every decision, edge case, and known limitation is documented below. Read all sections before writing any code. Implementation order: manifest.json → background.js → content.js → popup.html → popup.js.**

**Target repo:** `bratadeepsarkar123/focus-boomerang`
**Target branch:** `main`
**Deliverables:** `manifest.json`, `background.js`, `content.js`, `popup.html`, `popup.js` — all in the repo root.

---

## 1. Problem Statement & Vision

The "vulnerability window" is the 15–30 seconds between sending a complex Gemini query and receiving its response. In that window, the user tab-switches to a distraction site (YouTube, Reddit) and loses 15–30 minutes. This is not a willpower failure — it is a timing and attention architecture failure.

**Focus Boomerang is an invisible tether.** It watches for the exact millisecond Gemini finishes generating and, if the user has strayed to a known distraction site, snaps them back. If they are on a study site, it sends a quiet notification instead. It never interrupts productive waiting.

---

## 2. What This Extension Is NOT

- Not a website blocker
- Not a Pomodoro timer
- Not a productivity dashboard
- Not an AI API consumer
- Not synced across devices
- Not connected to any external server or database

---

## 3. Phase 2 Deferred Features (Do NOT implement in Phase 1)

- Daily/weekly time-log reset
- YouTube URL-path classification (lecture vs. entertainment)
- Streak tracking
- Cross-device sync
- Multi-AI-provider support (Claude, ChatGPT)
- Analytics charts in popup
- Per-conversation boomerang pause

---

## 4. MVP Contract (Read This First)

This table is the single operational truth for Phase 1. Every section below elaborates on it.

| Condition | Study Mode | Current Tab Domain | Action |
|---|---|---|---|
| `gemini_complete` fires | OFF | any | Do nothing |
| `gemini_complete` fires | ON | in `distractionDomains` | Force tab switch to Gemini + `boomerangArmed = false` |
| `gemini_complete` fires | ON | in `studyDomains` | Desktop notification only + `boomerangArmed = false` |
| `gemini_complete` fires | ON | in neither list (neutral) | Desktop notification only + `boomerangArmed = false` |
| `gemini_complete` fires | ON | already on Gemini | Do nothing + `boomerangArmed = false` |
| `gemini_started` fires | any | any | `boomerangArmed = true`, record `tabDomainAtGenStart` |
| User cancels generation | any | any | `boomerangArmed = false` (Signal C fires) |
| Study Mode toggled OFF | — | — | `boomerangArmed = false` immediately |

**State that MUST be persisted to `chrome.storage.local` at all times (never trust in-memory):**
- `boomerangArmed`
- `activeTabDomain`
- `activeTabSince`
- `geminiTabId`
- `geminiWindowId`
- `tabDomainAtGenStart`

---

## 5. File Structure

```
focus-boomerang/
├── manifest.json
├── background.js
├── content.js
├── popup.html
└── popup.js
```

No build tools. No npm. No bundler. Static files only.

---

## 6. manifest.json — Complete Specification

```json
{
  "manifest_version": 3,
  "name": "Focus Boomerang",
  "version": "1.0.0",
  "description": "Snaps you back to Gemini the moment it finishes generating — but only if you've wandered to a distraction site.",

  "permissions": [
    "tabs",
    "storage",
    "alarms",
    "notifications"
  ],

  "host_permissions": [
    "*://gemini.google.com/*"
  ],

  "background": {
    "service_worker": "background.js"
  },

  "content_scripts": [
    {
      "matches": ["*://gemini.google.com/*"],
      "js": ["content.js"],
      "run_at": "document_idle",
      "all_frames": true
    }
  ],

  "action": {
    "default_popup": "popup.html",
    "default_title": "Focus Boomerang"
  },

  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

**Permission rationale (for Web Store review):**
- `tabs` — required to read active tab URL for domain classification and to execute tab switches
- `storage` — required for local-only persistence of user settings and session data
- `alarms` — required for the 60-second heartbeat that commits time-tracking data before service worker is killed
- `notifications` — required to send gentle desktop pings when user is on a study/neutral domain
- `scripting` is intentionally ABSENT — content scripts are declared statically, so scripting permission is not needed and would trigger unnecessary Web Store warnings
- `host_permissions` scoped to `*://gemini.google.com/*` only — no broad host access

**Note on icons:** Create a simple placeholder `icons/` folder with three PNG files. If icons are missing, the extension will still load but show a default puzzle piece icon.

---

## 7. Storage Schema — Single Source of Truth

All data lives in `chrome.storage.local`. This is the complete schema. Every key must be initialized in the `chrome.runtime.onInstalled` handler (guarded by `reason === 'install'`).

```javascript
{
  // --- User Settings ---
  studyModeEnabled:       boolean,   // Default: false
  studyDomains:           string[],  // Default: []  — normalized base domains
  distractionDomains:     string[],  // Default: []  — normalized base domains

  // --- Boomerang State ---
  boomerangArmed:         boolean,   // Default: false
  tabDomainAtGenStart:    string|null, // Default: null — domain user was on when gemini_started fired
  geminiTabId:            number|null, // Default: null
  geminiWindowId:         number|null, // Default: null

  // --- Session Tracking ---
  activeTabDomain:        string|null, // Default: null
  activeTabSince:         number|null, // Default: null — epoch ms, persisted immediately on tab change
  timeLog:                object,      // Default: {} — { "youtube.com": 123456, ... } ms accumulated

  // --- Onboarding ---
  onboardingComplete:     boolean,   // Default: false

  // --- Health / Diagnostics ---
  lastGeminiStarted:      number|null, // Default: null — epoch ms of last gemini_started signal
  lastGeminiCompleted:    number|null, // Default: null — epoch ms of last gemini_complete signal
  observerTimeoutMinutes: number,      // Default: 8 — configurable Signal B timeout
}
```

**Key rules:**
1. NEVER read these from in-memory variables in background.js. Always call `chrome.storage.local.get(...)`.
2. Write `activeTabDomain` and `activeTabSince` synchronously (do not batch) on every tab activation event.
3. `timeLog` values are cumulative milliseconds since installation. They are never reset in Phase 1. The popup label must say "Total Focus" — not "Today's Focus" or "Session Focus".

---

## 8. Domain Normalization — Algorithm

This function must be used everywhere a domain string is processed: in popup.js at save time, and in background.js at match time.

```javascript
function normalizeDomain(input) {
  let s = input.trim().toLowerCase();
  // Strip protocol
  s = s.replace(/^https?:\/\//, '');
  // Strip path, query, hash
  s = s.replace(/[/?#].*$/, '');
  // Strip leading www.
  s = s.replace(/^www\./, '');
  // Return empty string if nothing left
  return s.length > 0 ? s : null;
}
```

**Matching rule:** A tab's URL matches a domain entry if:
```javascript
function domainMatches(tabUrl, domainEntry) {
  try {
    let hostname = new URL(tabUrl).hostname.toLowerCase().replace(/^www\./, '');
    // Exact match OR subdomain match (e.g., m.youtube.com matches youtube.com)
    return hostname === domainEntry || hostname.endsWith('.' + domainEntry);
  } catch {
    return false;
  }
}
```

**Special case — YouTube:** `music.youtube.com` matches `youtube.com` by the subdomain rule above. This is intentional (Decision #6 — see Section 16). Users who want YouTube Music whitelisted must add it explicitly to `studyDomains`. The popup onboarding screen explicitly advises users to put `youtube.com` in neither list as a neutral middle ground if they watch lectures.

**Textarea parsing:** Split on both commas AND newlines. Users naturally press Enter between entries.
```javascript
function parseDomainsInput(rawText) {
  return rawText
    .split(/[,\n]+/)
    .map(normalizeDomain)
    .filter(Boolean)
    .filter((v, i, arr) => arr.indexOf(v) === i); // deduplicate
}
```

---

## 9. background.js — Complete Specification

### 9.1 Initialization (`chrome.runtime.onInstalled`)

```javascript
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    // Only set defaults on FIRST install — never on update.
    // Updating without this guard would wipe the user's saved domain lists.
    await chrome.storage.local.set({
      studyModeEnabled:       false,
      studyDomains:           [],
      distractionDomains:     [],
      boomerangArmed:         false,
      tabDomainAtGenStart:    null,
      geminiTabId:            null,
      geminiWindowId:         null,
      activeTabDomain:        null,
      activeTabSince:         null,
      timeLog:                {},
      onboardingComplete:     false,
      lastGeminiStarted:      null,
      lastGeminiCompleted:    null,
      observerTimeoutMinutes: 8,
    });
  }
  // Register heartbeat alarm on both install AND update
  // Use getAll first to avoid duplicate alarm registration
  const existing = await chrome.alarms.get('heartbeat');
  if (!existing) {
    chrome.alarms.create('heartbeat', { periodInMinutes: 1 });
  }
  const existingTimeout = await chrome.alarms.get('observerTimeout');
  // observerTimeout alarm is created dynamically — do not create here
});
```

### 9.2 Gemini Tab Tracking

Track the Gemini tab proactively — do not rely on `sender.tab` from content script messages (unreliable for sidebar iframes).

```javascript
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && tab.url && tab.url.startsWith('https://gemini.google.com/')) {
    chrome.storage.local.set({
      geminiTabId: tabId,
      geminiWindowId: tab.windowId,
    });
  }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tab = await chrome.tabs.get(activeInfo.tabId);
  if (tab.url && tab.url.startsWith('https://gemini.google.com/')) {
    await chrome.storage.local.set({
      geminiTabId: activeInfo.tabId,
      geminiWindowId: activeInfo.windowId,
    });
  }
});
```

### 9.3 Session Time Tracking

**The cardinal rule:** `activeTabSince` is ALWAYS written to storage immediately. Never store it only in memory.

```javascript
// Helper: commit elapsed time for the current domain to timeLog
async function commitCurrentSession() {
  const { activeTabDomain, activeTabSince, timeLog } = await chrome.storage.local.get([
    'activeTabDomain', 'activeTabSince', 'timeLog'
  ]);
  if (!activeTabDomain || !activeTabSince) return;
  const elapsed = Date.now() - activeTabSince;
  if (elapsed <= 0 || isNaN(elapsed)) return; // guard against NaN delta
  const updated = { ...timeLog };
  updated[activeTabDomain] = (updated[activeTabDomain] || 0) + elapsed;
  await chrome.storage.local.set({ timeLog: updated, activeTabSince: Date.now() });
}

// Helper: switch to a new active tab
async function switchActiveTab(tabId, windowId) {
  await commitCurrentSession();
  const tab = await chrome.tabs.get(tabId);
  const domain = tab.url ? extractBaseDomain(tab.url) : null;
  await chrome.storage.local.set({
    activeTabDomain: domain,
    activeTabSince: Date.now(),
  });
}

function extractBaseDomain(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}
```

**Tab activation event:**
```javascript
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  // Get focused window to avoid counting time in background windows
  const focusedWindow = await chrome.windows.getLastFocused();
  if (focusedWindow.id !== activeInfo.windowId) return;
  await switchActiveTab(activeInfo.tabId, activeInfo.windowId);
});
```

**Window focus change event:**
```javascript
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    // User left Chrome entirely — pause timer, commit what we have
    await commitCurrentSession();
    await chrome.storage.local.set({ activeTabDomain: null, activeTabSince: null });
    return;
  }
  // Find the active tab in the newly focused window
  const [activeTab] = await chrome.tabs.query({ active: true, windowId });
  if (activeTab) {
    await switchActiveTab(activeTab.id, windowId);
  }
});
```

**Heartbeat alarm (every 60 seconds):**
```javascript
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'heartbeat') {
    await commitCurrentSession();
  }
  if (alarm.name === 'observerTimeout') {
    await handleObserverTimeout();
  }
});
```

### 9.4 Message Handler (from content.js)

```javascript
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse);
  return true; // keep channel open for async response
});

async function handleMessage(message, sender) {
  switch (message.action) {

    case 'gemini_started': {
      // Record the domain the user is currently on when generation begins.
      // This is used later to cross-reference with the domain at completion time.
      const { activeTabDomain } = await chrome.storage.local.get('activeTabDomain');
      await chrome.storage.local.set({
        boomerangArmed: true,
        tabDomainAtGenStart: activeTabDomain,
        lastGeminiStarted: Date.now(),
      });
      // Start the observer timeout alarm
      await chrome.alarms.clear('observerTimeout');
      const { observerTimeoutMinutes } = await chrome.storage.local.get('observerTimeoutMinutes');
      chrome.alarms.create('observerTimeout', { delayInMinutes: observerTimeoutMinutes || 8 });
      return { ok: true };
    }

    case 'gemini_complete': {
      await chrome.alarms.clear('observerTimeout');
      await chrome.storage.local.set({ lastGeminiCompleted: Date.now() });
      await executeBoomerangLogic();
      return { ok: true };
    }

    case 'gemini_cancelled': {
      // Signal C: user manually cancelled generation
      await chrome.alarms.clear('observerTimeout');
      await chrome.storage.local.set({ boomerangArmed: false, tabDomainAtGenStart: null });
      return { ok: true };
    }

    case 'gemini_error': {
      // Signal C variant: Gemini returned an error state — disarm silently
      await chrome.alarms.clear('observerTimeout');
      await chrome.storage.local.set({ boomerangArmed: false, tabDomainAtGenStart: null });
      return { ok: true };
    }

    default:
      return { ok: false, error: 'unknown action' };
  }
}
```

### 9.5 Boomerang Execution Logic

```javascript
async function executeBoomerangLogic() {
  const storage = await chrome.storage.local.get([
    'studyModeEnabled',
    'boomerangArmed',
    'studyDomains',
    'distractionDomains',
    'geminiTabId',
    'geminiWindowId',
  ]);

  // Step 1: Disarm immediately regardless of outcome
  await chrome.storage.local.set({ boomerangArmed: false, tabDomainAtGenStart: null });

  // Step 2: Check master toggle
  if (!storage.studyModeEnabled) return;

  // Step 3: Was the boomerang even armed?
  if (!storage.boomerangArmed) return;

  // Step 4: Get the current active tab (what the user is looking at RIGHT NOW)
  let currentTab;
  try {
    [currentTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  } catch {
    return;
  }
  if (!currentTab || !currentTab.url) return;

  // Step 5: If user is already on Gemini, do nothing
  if (currentTab.url.startsWith('https://gemini.google.com/')) return;

  const currentDomain = extractBaseDomain(currentTab.url);

  // Step 6: Classify the current tab
  const isDistraction = storage.distractionDomains.some(d => domainMatches(currentTab.url, d));
  const isStudy = storage.studyDomains.some(d => domainMatches(currentTab.url, d));

  if (isDistraction) {
    // CONDITION A: Force-switch back to Gemini
    if (storage.geminiTabId) {
      try {
        await chrome.tabs.update(storage.geminiTabId, { active: true });
        await chrome.windows.update(storage.geminiWindowId, { focused: true });
        // Fire a brief in-tab notification via content script
        chrome.tabs.sendMessage(storage.geminiTabId, {
          action: 'show_boomerang_toast',
          fromDomain: currentDomain,
        });
      } catch {
        // geminiTabId is stale (tab was closed) — open a new Gemini tab
        chrome.tabs.create({ url: 'https://gemini.google.com/' });
      }
    } else {
      // Gemini was in sidebar — open as full tab
      chrome.tabs.create({ url: 'https://gemini.google.com/' });
    }
  } else {
    // CONDITION B (study) or CONDITION C (neutral): Gentle notification
    const label = isStudy ? 'Keep it up' : 'Heads up';
    chrome.notifications.create('gemini-ready', {
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'Gemini answer is ready',
      message: `${label} — your answer finished while you were on ${currentDomain || 'another tab'}.`,
      priority: 1,
    });
  }
}

// Notification click → take user to Gemini
chrome.notifications.onClicked.addListener(async (notificationId) => {
  if (notificationId !== 'gemini-ready') return;
  chrome.notifications.clear(notificationId);
  const { geminiTabId, geminiWindowId } = await chrome.storage.local.get(['geminiTabId', 'geminiWindowId']);
  if (geminiTabId) {
    try {
      await chrome.tabs.update(geminiTabId, { active: true });
      await chrome.windows.update(geminiWindowId, { focused: true });
    } catch {
      chrome.tabs.create({ url: 'https://gemini.google.com/' });
    }
  } else {
    chrome.tabs.create({ url: 'https://gemini.google.com/' });
  }
});
```

### 9.6 Observer Timeout Handler (Signal B Graceful Degradation)

If `gemini_started` was received but `gemini_complete` never arrives within `observerTimeoutMinutes`, assume the observer is stale and fire a fallback notification.

```javascript
async function handleObserverTimeout() {
  const { boomerangArmed, studyModeEnabled } = await chrome.storage.local.get([
    'boomerangArmed', 'studyModeEnabled'
  ]);
  if (!boomerangArmed || !studyModeEnabled) return;
  // Disarm and notify
  await chrome.storage.local.set({ boomerangArmed: false, tabDomainAtGenStart: null });
  chrome.notifications.create('gemini-timeout', {
    type: 'basic',
    iconUrl: 'icons/icon48.png',
    title: 'Gemini may have finished',
    message: 'We lost track of the response — check your Gemini tab.',
    priority: 1,
  });
}
```

### 9.7 Study Mode Toggle Mid-Generation Handler

When the user turns Study Mode OFF while a generation is in progress:

```javascript
chrome.storage.onChanged.addListener(async (changes) => {
  if (changes.studyModeEnabled && changes.studyModeEnabled.newValue === false) {
    // Disarm the boomerang immediately
    await chrome.storage.local.set({ boomerangArmed: false, tabDomainAtGenStart: null });
    await chrome.alarms.clear('observerTimeout');
  }
});
```

---

## 10. content.js — Complete Specification

### 10.1 Purpose

Injected into every frame on `gemini.google.com`. Watches the DOM for three signals:
- **Signal A** (`gemini_started`): The "Stop generating" button appears
- **Signal B** (`gemini_complete`): The action buttons row (Copy, Thumbs Up) appears at the bottom of the response
- **Signal C** (`gemini_cancelled` / `gemini_error`): The "Stop" button disappears WITHOUT Signal B firing, OR an error state appears

### 10.2 Guard: Run Only Once Per Frame

```javascript
if (window.__focusBoomerangInjected) {
  // Already running in this frame — do not attach duplicate observers
} else {
  window.__focusBoomerangInjected = true;
  initFocusBoomerang();
}
```

### 10.3 Two-Level Observer Strategy

**Level 1** watches `document.body` for the appearance of the main chat container. It must be extremely cheap — do minimal work per mutation.

**Level 2** attaches to the found container and watches for generation signals.

```javascript
function initFocusBoomerang() {
  let level2Observer = null;
  let stopButtonPresent = false;
  let generationGuard = false; // prevents duplicate gemini_complete messages per generation

  // --- Level 1: Find the chat container ---
  const level1Observer = new MutationObserver(() => {
    const container = findChatContainer();
    if (container && !level2Observer) {
      level1Observer.disconnect();
      attachLevel2(container);
    }
  });
  level1Observer.observe(document.body, { childList: true, subtree: true });

  // Also try immediately on script load
  const container = findChatContainer();
  if (container) {
    level1Observer.disconnect();
    attachLevel2(container);
  }

  // --- Container detection (ARIA-based, no CSS classes) ---
  function findChatContainer() {
    // Prefer the most specific ARIA landmark available
    // Priority order: specific chat label > generic role=main
    return (
      document.querySelector('[aria-label*="Chat messages"]') ||
      document.querySelector('[aria-label*="Conversation"]') ||
      document.querySelector('[data-test-id*="conversation"]') ||
      document.querySelector('[role="main"]')
    );
  }

  // --- Level 2: Watch for generation signals ---
  function attachLevel2(container) {
    level2Observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        // Check added nodes for Signal A (Stop button appeared) and Signal B (action buttons)
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;

          // Signal A: Stop generating button appeared
          if (isStopButton(node) || node.querySelector('[aria-label*="Stop"]')) {
            if (!stopButtonPresent) {
              stopButtonPresent = true;
              generationGuard = false; // reset for new generation
              chrome.runtime.sendMessage({ action: 'gemini_started' });
            }
          }

          // Signal B: Action buttons row appeared (Copy, Thumbs Up)
          if (!generationGuard && isActionButtonRow(node)) {
            generationGuard = true;
            stopButtonPresent = false;
            chrome.runtime.sendMessage({ action: 'gemini_complete' });
          }

          // Signal C (error): Error state appeared
          if (isErrorState(node)) {
            stopButtonPresent = false;
            generationGuard = false;
            chrome.runtime.sendMessage({ action: 'gemini_error' });
          }
        }

        // Check removed nodes for Signal C (Stop button disappeared without Signal B)
        for (const node of mutation.removedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          if (isStopButton(node) || node.querySelector('[aria-label*="Stop"]')) {
            stopButtonPresent = false;
            // Do NOT fire gemini_cancelled here — wait a tick to see if Signal B fires first
            setTimeout(() => {
              if (!generationGuard && stopButtonPresent === false) {
                // Stop button gone, no Signal B fired — treat as cancellation
                chrome.runtime.sendMessage({ action: 'gemini_cancelled' });
              }
            }, 500);
          }
        }
      }
    });

    level2Observer.observe(container, { childList: true, subtree: true });

    // --- SPA Navigation: Re-attach when Gemini navigates to a new conversation ---
    // Watch for the container itself being removed from DOM (full SPA re-render)
    const containerWatcher = new MutationObserver(() => {
      if (!document.body.contains(container)) {
        level2Observer.disconnect();
        level2Observer = null;
        containerWatcher.disconnect();
        // Re-start Level 1 to find the new container
        level1Observer.observe(document.body, { childList: true, subtree: true });
      }
    });
    containerWatcher.observe(document.body, { childList: true });
  }

  // --- ARIA-based element detection helpers (NO CSS class selectors) ---

  function isStopButton(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    const label = node.getAttribute('aria-label') || '';
    const role = node.getAttribute('role') || '';
    return (
      (role === 'button' && label.toLowerCase().includes('stop')) ||
      node.querySelector('[role="button"][aria-label*="Stop"]') !== null
    );
  }

  function isActionButtonRow(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    // Action row contains Copy button AND at least one of: Thumbs Up, Share, Export
    const hasCopy = node.querySelector('[aria-label*="Copy"]') !== null;
    const hasThumbsUp = node.querySelector('[aria-label*="Good response"]') !== null ||
                        node.querySelector('[aria-label*="Thumbs up"]') !== null;
    return hasCopy && hasThumbsUp;
  }

  function isErrorState(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    const role = node.getAttribute('role') || '';
    const label = node.getAttribute('aria-label') || '';
    return (
      role === 'alert' ||
      label.toLowerCase().includes('error') ||
      node.querySelector('[role="alert"]') !== null
    );
  }

  // --- Boomerang Toast (shown when background.js force-switches back to this tab) ---
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'show_boomerang_toast') {
      showBoomerangToast(message.fromDomain);
    }
  });

  function showBoomerangToast(fromDomain) {
    const existing = document.getElementById('focus-boomerang-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'focus-boomerang-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 999999;
      background: #1a1a2e;
      color: #e0e0e0;
      font-family: sans-serif;
      font-size: 13px;
      padding: 10px 16px;
      border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.4);
      max-width: 280px;
      line-height: 1.4;
      cursor: pointer;
      transition: opacity 0.3s ease;
    `;
    toast.textContent = `⚡ Boomerang: brought you back from ${fromDomain || 'a distraction site'}`;
    toast.title = 'Click to dismiss';
    toast.onclick = () => toast.remove();
    document.body.appendChild(toast);

    // Auto-dismiss after 4 seconds
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }
}
```

---

## 11. popup.html — Complete Specification

Single HTML file with embedded styles. No external CSS files.

### 11.1 Layout

Width: 360px. Three tabs: **Settings**, **Stats**, **About**.

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Focus Boomerang</title>
  <style>
    /* Reset */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      width: 360px;
      min-height: 400px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 13px;
      background: #0f0f1a;
      color: #d4d4e8;
      line-height: 1.5;
    }

    /* Header */
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 16px 10px;
      border-bottom: 1px solid #1e1e3a;
    }
    .logo { font-size: 15px; font-weight: 700; color: #a78bfa; letter-spacing: -0.3px; }
    .logo span { color: #60a5fa; }

    /* Master toggle */
    .toggle-wrap { display: flex; align-items: center; gap: 8px; }
    .toggle-label { font-size: 11px; color: #8888aa; text-transform: uppercase; letter-spacing: 0.6px; }
    .toggle { position: relative; width: 36px; height: 20px; }
    .toggle input { opacity: 0; width: 0; height: 0; }
    .toggle-slider {
      position: absolute; inset: 0; border-radius: 20px; background: #2a2a4a; cursor: pointer;
      transition: background 0.2s;
    }
    .toggle-slider::before {
      content: ''; position: absolute; width: 14px; height: 14px; left: 3px; top: 3px;
      border-radius: 50%; background: #666; transition: transform 0.2s, background 0.2s;
    }
    .toggle input:checked + .toggle-slider { background: #5b21b6; }
    .toggle input:checked + .toggle-slider::before { transform: translateX(16px); background: #a78bfa; }

    /* Tabs */
    .tabs { display: flex; border-bottom: 1px solid #1e1e3a; }
    .tab {
      flex: 1; padding: 9px 0; text-align: center; font-size: 12px; color: #6666aa; cursor: pointer;
      border: none; background: none; transition: color 0.2s;
    }
    .tab.active { color: #a78bfa; border-bottom: 2px solid #a78bfa; margin-bottom: -1px; }

    /* Panel */
    .panel { display: none; padding: 16px; }
    .panel.active { display: block; }

    /* Form elements */
    label { display: block; font-size: 11px; color: #8888aa; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 5px; }
    textarea {
      width: 100%; height: 72px; padding: 8px 10px; border-radius: 6px;
      background: #15152a; border: 1px solid #2a2a4a; color: #d4d4e8;
      font-size: 12px; font-family: inherit; resize: vertical; outline: none;
      transition: border-color 0.2s;
    }
    textarea:focus { border-color: #5b21b6; }
    .field { margin-bottom: 14px; }
    .field-hint { font-size: 11px; color: #555577; margin-top: 4px; }
    .parsed-preview { font-size: 10px; color: #5b21b6; margin-top: 3px; min-height: 14px; }

    /* Save button */
    .save-btn {
      width: 100%; padding: 9px; border-radius: 6px; border: none;
      background: #5b21b6; color: #e0d0ff; font-size: 13px; font-weight: 600;
      cursor: pointer; transition: background 0.2s;
    }
    .save-btn:hover { background: #6d28d9; }
    .save-msg { text-align: center; font-size: 11px; color: #a78bfa; margin-top: 8px; min-height: 16px; opacity: 0; transition: opacity 0.3s; }
    .save-msg.show { opacity: 1; }

    /* Stats */
    .stat-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #1a1a2e; }
    .stat-domain { font-size: 12px; color: #c4c4e0; }
    .stat-time { font-size: 12px; color: #a78bfa; font-weight: 600; font-variant-numeric: tabular-nums; }
    .stat-header { font-size: 11px; color: #555577; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 10px; }
    .stat-empty { font-size: 12px; color: #555577; text-align: center; padding: 24px 0; }

    /* About */
    .about-text { font-size: 12px; color: #8888aa; line-height: 1.7; }
    .about-text strong { color: #c4c4e0; }
    .version { font-size: 11px; color: #444466; margin-top: 16px; }

    /* Onboarding overlay */
    .onboarding-overlay {
      position: fixed; inset: 0; background: #0f0f1a; z-index: 100;
      display: flex; flex-direction: column; padding: 20px 18px;
    }
    .ob-step { display: none; }
    .ob-step.active { display: flex; flex-direction: column; flex: 1; }
    .ob-title { font-size: 16px; font-weight: 700; color: #a78bfa; margin-bottom: 8px; }
    .ob-body { font-size: 13px; color: #c4c4e0; line-height: 1.6; flex: 1; }
    .ob-body code { background: #1e1e3a; padding: 1px 5px; border-radius: 3px; font-size: 11px; color: #60a5fa; }
    .ob-nav { display: flex; justify-content: space-between; align-items: center; margin-top: 16px; }
    .ob-dots { display: flex; gap: 5px; }
    .ob-dot { width: 6px; height: 6px; border-radius: 50%; background: #2a2a4a; }
    .ob-dot.active { background: #a78bfa; }
    .ob-btn {
      padding: 8px 18px; border-radius: 6px; border: none; background: #5b21b6; color: #e0d0ff;
      font-size: 13px; font-weight: 600; cursor: pointer;
    }
  </style>
</head>
<body>

  <!-- Onboarding overlay (hidden after first run) -->
  <div class="onboarding-overlay" id="onboarding" style="display:none">
    <div class="ob-step active" id="ob1">
      <div class="ob-title">⚡ Welcome to Focus Boomerang</div>
      <div class="ob-body">
        <p>You ask Gemini a question. While it thinks, you switch to YouTube. Ten minutes later, you forgot why.</p>
        <br>
        <p><strong>This extension fixes that.</strong> The moment Gemini finishes, it snaps you back — but only if you've wandered to a distraction site. If you're reading notes, we stay quiet.</p>
      </div>
      <div class="ob-nav">
        <div class="ob-dots"><div class="ob-dot active"></div><div class="ob-dot"></div><div class="ob-dot"></div></div>
        <button class="ob-btn" onclick="obNext(1)">Next →</button>
      </div>
    </div>
    <div class="ob-step" id="ob2">
      <div class="ob-title">🎯 How It Works</div>
      <div class="ob-body">
        <p><strong>Distraction domains</strong> — sites where we forcefully interrupt you: <code>youtube.com</code>, <code>reddit.com</code>, <code>instagram.com</code></p>
        <br>
        <p><strong>Study domains</strong> — sites where we send a quiet ping instead: <code>hello.iitk.ac.in</code>, <code>notebooklm.google.com</code></p>
        <br>
        <p>You define both lists yourself. We never assume.</p>
      </div>
      <div class="ob-nav">
        <div class="ob-dots"><div class="ob-dot"></div><div class="ob-dot active"></div><div class="ob-dot"></div></div>
        <button class="ob-btn" onclick="obNext(2)">Next →</button>
      </div>
    </div>
    <div class="ob-step" id="ob3">
      <div class="ob-title">💡 One Tip Before You Start</div>
      <div class="ob-body">
        <p>Not sure where to put <strong>YouTube</strong>?</p>
        <br>
        <p>Leave it off <em>both</em> lists. We'll send a <strong>notification</strong> instead of force-switching. Good for lecture watchers who want a reminder, not an interruption.</p>
        <br>
        <p>You can always move it to the distraction list later if gentle isn't enough. 🙂</p>
      </div>
      <div class="ob-nav">
        <div class="ob-dots"><div class="ob-dot"></div><div class="ob-dot"></div><div class="ob-dot active"></div></div>
        <button class="ob-btn" onclick="obFinish()">Get Started</button>
      </div>
    </div>
  </div>

  <!-- Main UI -->
  <div id="main-ui">
    <div class="header">
      <div class="logo">Focus <span>Boomerang</span></div>
      <div class="toggle-wrap">
        <span class="toggle-label" id="mode-label">OFF</span>
        <label class="toggle" title="Study Mode">
          <input type="checkbox" id="study-mode-toggle">
          <span class="toggle-slider"></span>
        </label>
      </div>
    </div>

    <div class="tabs">
      <button class="tab active" data-tab="settings">Settings</button>
      <button class="tab" data-tab="stats">Stats</button>
      <button class="tab" data-tab="about">About</button>
    </div>

    <!-- Settings Panel -->
    <div class="panel active" id="panel-settings">
      <div class="field">
        <label for="distraction-input">Distraction Domains</label>
        <textarea id="distraction-input" placeholder="youtube.com, reddit.com&#10;(comma or newline separated)"></textarea>
        <div class="parsed-preview" id="distraction-preview"></div>
        <div class="field-hint">Force-switch back to Gemini when you're on these.</div>
      </div>
      <div class="field">
        <label for="study-input">Study Domains</label>
        <textarea id="study-input" placeholder="hello.iitk.ac.in&#10;notebooklm.google.com"></textarea>
        <div class="parsed-preview" id="study-preview"></div>
        <div class="field-hint">Send a quiet notification instead of interrupting.</div>
      </div>
      <button class="save-btn" id="save-btn">Save Settings</button>
      <div class="save-msg" id="save-msg">✓ Saved</div>
    </div>

    <!-- Stats Panel -->
    <div class="panel" id="panel-stats">
      <div class="stat-header">Total Focus Time by Domain</div>
      <div id="stats-list"><div class="stat-empty">No data yet — start a study session.</div></div>
    </div>

    <!-- About Panel -->
    <div class="panel" id="panel-about">
      <div class="about-text">
        <p><strong>Focus Boomerang</strong> watches Gemini and snaps your attention back the moment it finishes — but only when you've wandered somewhere distracting.</p>
        <br>
        <p>All data is stored locally on your device. No accounts. No servers. No tracking.</p>
        <br>
        <p>Your domain lists, session times, and settings never leave your browser.</p>
      </div>
      <div class="version">v1.0.0 · Built for focus</div>
    </div>
  </div>

  <script src="popup.js"></script>
</body>
</html>
```

---

## 12. popup.js — Complete Specification

```javascript
// popup.js — runs in the context of popup.html

// --- Domain parsing (mirrors normalization in background.js) ---
function normalizeDomain(input) {
  let s = input.trim().toLowerCase();
  s = s.replace(/^https?:\/\//, '');
  s = s.replace(/[/?#].*$/, '');
  s = s.replace(/^www\./, '');
  return s.length > 0 ? s : null;
}

function parseDomainsInput(rawText) {
  return rawText
    .split(/[,\n]+/)
    .map(normalizeDomain)
    .filter(Boolean)
    .filter((v, i, arr) => arr.indexOf(v) === i);
}

function formatTime(ms) {
  if (ms < 60000) return '<1 min';
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
}

// --- Onboarding ---
function obNext(currentStep) {
  document.getElementById(`ob${currentStep}`).classList.remove('active');
  document.getElementById(`ob${currentStep + 1}`).classList.add('active');
}

function obFinish() {
  chrome.storage.local.set({ onboardingComplete: true });
  document.getElementById('onboarding').style.display = 'none';
}

// --- Tab switching ---
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`panel-${tab.dataset.tab}`).classList.add('active');
    if (tab.dataset.tab === 'stats') renderStats();
  });
});

// --- Live preview as user types ---
function updatePreview(textarea, preview) {
  const domains = parseDomainsInput(textarea.value);
  preview.textContent = domains.length > 0 ? `→ ${domains.join(', ')}` : '';
}

document.getElementById('distraction-input').addEventListener('input', function() {
  updatePreview(this, document.getElementById('distraction-preview'));
});
document.getElementById('study-input').addEventListener('input', function() {
  updatePreview(this, document.getElementById('study-preview'));
});

// --- Study Mode toggle ---
const toggle = document.getElementById('study-mode-toggle');
const modeLabel = document.getElementById('mode-label');

toggle.addEventListener('change', async () => {
  const enabled = toggle.checked;
  modeLabel.textContent = enabled ? 'ON' : 'OFF';
  await chrome.storage.local.set({ studyModeEnabled: enabled });
  // Background.js storage.onChanged listener handles disarming the boomerang if turned OFF
});

// --- Save button ---
// IMPORTANT: await the storage write before showing confirmation.
// The popup can close before a non-awaited set() completes.
document.getElementById('save-btn').addEventListener('click', async () => {
  const distractionRaw = document.getElementById('distraction-input').value;
  const studyRaw = document.getElementById('study-input').value;

  const distractionDomains = parseDomainsInput(distractionRaw);
  const studyDomains = parseDomainsInput(studyRaw);

  await chrome.storage.local.set({ distractionDomains, studyDomains });

  const msg = document.getElementById('save-msg');
  msg.classList.add('show');
  setTimeout(() => msg.classList.remove('show'), 2000);
});

// --- Stats rendering ---
async function renderStats() {
  const { timeLog } = await chrome.storage.local.get('timeLog');
  const list = document.getElementById('stats-list');
  if (!timeLog || Object.keys(timeLog).length === 0) {
    list.innerHTML = '<div class="stat-empty">No data yet — start a study session.</div>';
    return;
  }
  const sorted = Object.entries(timeLog)
    .filter(([, ms]) => ms > 5000)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 20);

  list.innerHTML = sorted.map(([domain, ms]) => `
    <div class="stat-row">
      <span class="stat-domain">${domain}</span>
      <span class="stat-time">${formatTime(ms)}</span>
    </div>
  `).join('');
}

// --- Load saved settings on popup open ---
async function init() {
  const data = await chrome.storage.local.get([
    'studyModeEnabled',
    'studyDomains',
    'distractionDomains',
    'onboardingComplete',
  ]);

  // Show onboarding on first install
  if (!data.onboardingComplete) {
    document.getElementById('onboarding').style.display = 'flex';
  }

  // Hydrate toggle
  toggle.checked = !!data.studyModeEnabled;
  modeLabel.textContent = data.studyModeEnabled ? 'ON' : 'OFF';

  // Hydrate domain textareas
  const distInput = document.getElementById('distraction-input');
  const studyInput = document.getElementById('study-input');
  distInput.value = (data.distractionDomains || []).join('\n');
  studyInput.value = (data.studyDomains || []).join('\n');
  updatePreview(distInput, document.getElementById('distraction-preview'));
  updatePreview(studyInput, document.getElementById('study-preview'));
}

init();
```

---

## 13. Decision Log

Decisions are permanent. Do not reverse them without updating this log.

| # | Decision | Options Considered | Choice | Rationale |
|---|---|---|---|---|
| 1 | MV3 timer persistence | In-memory vs. storage | `chrome.storage.local` | Service workers die; storage survives |
| 2 | Completion signal | Signal A (Stop disappears) vs. Signal B (action buttons appear) | Signal B primary, Signal A secondary | Signal A fires on manual cancellation too — Signal B is completion-only |
| 3 | DOM selectors | CSS classes vs. ARIA attributes | ARIA only | CSS classes are internal; ARIA is an accessibility contract, more stable |
| 4 | Neutral domain default | Treat as distraction / treat as study / notification only | Notification only | Least intrusive; user didn't classify it |
| 5 | Sidebar/no-tabId fallback | Fail silently / open new tab | Open new tab | Better UX; Gemini URL is safe to open |
| 6 | YouTube subdomain matching | Exact match only / subdomain match | Subdomain match | `music.youtube.com` should match `youtube.com`; consistent mental model |
| 7 | Onboarding YouTube advice | Show in onboarding / leave undocumented | Show in Screen 3 | Prevents early uninstalls from lecture watchers being interrupted |
| 8 | `onInstalled` defaults guard | Always overwrite / guard with `reason` | Guard with `reason === 'install'` | Updates must never wipe user's domain lists |
| 9 | Signal B timeout | Hardcoded / configurable in storage | Configurable (`observerTimeoutMinutes`, default 8) | Gemini research mode can take >5 min; 8 min is safer |
| 10 | Textarea input delimiter | Comma only / comma + newline | Both | Users naturally press Enter; both are valid |

---

## 14. Known Limitations (Do Not Fix in Phase 1)

1. **60-second data loss window** — Time data can be lost for up to 60 seconds if Chrome crashes between heartbeats. Acceptable for a productivity tool.
2. **Multiple simultaneous Gemini tabs** — If two Gemini tabs are both generating, only the one that fires `gemini_complete` first triggers the boomerang logic. The second is silently ignored. The user gets boomeranged to whichever tab fired first, which may not be the one they care about.
3. **Cold-start miss** — If the user installs the extension while Gemini is already mid-generation, the `gemini_started` signal is never received. The subsequent `gemini_complete` is correctly ignored (boomerangArmed = false), but the user misses boomerang coverage for that first generation.
4. **Signal B breakage on Gemini UI updates** — Google's ARIA labels may change. When `isActionButtonRow()` stops matching, Signal B stops firing silently. The 8-minute `observerTimeout` fallback partially mitigates this. After major Gemini UI updates, verify `[aria-label*="Copy"]` and `[aria-label*="Good response"]` still match.
5. **Chrome Side Panel (no tabId)** — When Gemini is open only in Chrome's built-in Side Panel, `sender.tab` is undefined. The extension falls back to opening `gemini.google.com` as a new tab. This is the correct behavior.

---

## 15. Implementation Guards (Read Before Coding)

1. **Never trust in-memory state in background.js.** Every variable that matters must be read from `chrome.storage.local` at the start of every function that needs it. The service worker may have been killed and restarted between calls.
2. **Never use `setInterval` in background.js.** It will silently stop working after ~30 seconds. Use `chrome.alarms` only.
3. **Never call `chrome.storage.local.set()` with all defaults on `onInstalled` without the `reason === 'install'` guard.** Extension updates fire `onInstalled` too.
4. **Never rely on CSS class selectors in content.js.** Google changes Gemini's internal class names frequently. Use only `role`, `aria-label`, and `data-*` attributes.
5. **Always handle `chrome.windows.WINDOW_ID_NONE`.** This is `-1`. It fires when the user switches to a non-Chrome application. Treat it as "pause timing entirely."
6. **Always `await` the `chrome.storage.local.set()` call in popup.js before showing confirmation.** The popup can be garbage-collected before a non-awaited write completes.
7. **Always handle the case where `geminiTabId` is null or stale** (tab was closed). Fall back to `chrome.tabs.create({ url: 'https://gemini.google.com/' })`.
8. **The `generationGuard` flag in content.js prevents duplicate `gemini_complete` messages** for the same generation. Reset it only when `gemini_started` fires again (new generation begins).
9. **On `gemini_complete`, disarm `boomerangArmed` FIRST (Step 1) before any conditional logic.** This prevents race conditions where two rapid completions double-fire the boomerang.
10. **Signal C (cancellation) uses a 500ms `setTimeout` to debounce.** The Stop button disappears briefly during normal completion too. The 500ms window lets Signal B arrive first if it's coming.

---

## 16. Test Scenarios (Verify All Before Shipping)

### Happy Path
1. Open Gemini, send a query → `gemini_started` fires → switch to YouTube → answer completes → tab snaps back to Gemini → boomerang toast appears
2. Same as above but Study Mode is OFF → no snap-back, no notification

### Notification Path
3. Open Gemini, send a query → switch to `hello.iitk.ac.in` (study domain) → answer completes → desktop notification fires → click notification → Gemini tab focuses
4. Open Gemini, send a query → switch to `github.com` (neutral, neither list) → answer completes → desktop notification fires

### Cancellation / Error
5. Send a query → switch to YouTube → manually click "Stop generating" → no snap-back occurs
6. Send a query → Gemini returns an error → no snap-back occurs

### Service Worker Restart
7. Send a query → disable/re-enable the extension (simulates service worker restart) → answer completes → boomerang still fires (because state was persisted to storage)

### Sidebar / No TabId
8. Open Gemini only in Side Panel (not a regular tab) → send a query → switch to YouTube → answer completes → new Gemini tab opens

### Edge Cases
9. Toggle Study Mode OFF while query is generating → `boomerangArmed` becomes false → answer completes → no snap-back
10. Two Gemini tabs generating simultaneously → first completion fires → snap-back occurs → second completion → `boomerangArmed = false`, silently ignored
11. Observer timeout (8 min, no Signal B) → fallback notification fires: "Gemini may have finished"
12. First-install: `onboardingComplete = false` → onboarding overlay appears → user completes 3 screens → main UI shown
13. Extension update (not first install) → `onInstalled` fires with `reason = 'update'` → user domain lists are NOT overwritten

---

*End of specification. All decisions are final for Phase 1. Implement exactly as written.*
