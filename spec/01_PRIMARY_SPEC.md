# Focus Boomerang — Complete Implementation Spec for Jules
**Version:** 2.0 — Final  
**Status:** Architecture locked. Ready for implementation.  
**Author:** Product Manager (via Lead Engineer audit)

---

## 1. Product Overview

### The Core Problem
The user studies with a PDF on the left and an AI sidebar (Gemini, NotebookLM, Perplexity) on the right. When the AI takes 15–30 seconds to respond, the user drifts to YouTube and loses 15 minutes. Their working memory — holding the context of what they were reading and what they asked — is wiped. The Boomerang closes that gap window entirely.

### What This Extension Is
A **working memory preservation system**, not a tab blocker. It tracks which tabs are "safe" and which are "traps," detects when an AI query finishes, and violently pulls the user's focus back to their study context before the distraction can take hold.

### Hard Constraints
- **Manifest V3** compliance throughout
- **Zero external databases.** All state lives in `chrome.storage.local` only
- **Privacy-first.** No URLs, domains, or session data ever leave the device
- **10MB storage quota** is more than sufficient; no `unlimitedStorage` permission needed

---

## 2. File Structure

```
focus-boomerang/
├── manifest.json
├── background.js
├── content.js
├── popup.html
├── popup.js
├── onboarding.html
├── onboarding.js
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## 3. manifest.json — Complete, Exact JSON

```json
{
  "manifest_version": 3,
  "name": "Focus Boomerang",
  "version": "1.0.0",
  "description": "Pulls your focus back to your study tab the moment your AI finishes answering.",

  "permissions": [
    "tabs",
    "storage",
    "alarms",
    "notifications"
  ],

  "host_permissions": [
    "*://gemini.google.com/*",
    "*://*/*"
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
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },

  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

**Permission rationale (for Web Store reviewers):**
- `tabs` — reads active tab URL to check against user-defined classification lists. No URLs stored externally.
- `storage` — all state is local only.
- `alarms` — 60-second heartbeat to commit session time without relying on `setInterval` (MV3 requirement).
- `notifications` — gentle desktop ping for Study and Rabbit Hole tab states.
- `host_permissions: gemini.google.com` — content script must inject into Gemini to detect when generation completes.
- `host_permissions: *://*/*` — required to read the URL of the currently active tab via `chrome.tabs.query` for domain classification. Without it, Chrome returns redacted (empty) URLs. No content scripts are injected into non-Gemini pages.

---

## 4. Complete `chrome.storage.local` Schema

This is the single source of truth. Every field, its type, default value, who sets it, and when.

### 4.1 Settings (written by popup.js)

| Field | Type | Default | Description |
|---|---|---|---|
| `studyModeEnabled` | `boolean` | `false` | Master on/off toggle |

### 4.2 Runtime State (written by background.js)

| Field | Type | Default | Set When |
|---|---|---|---|
| `isGenerating` | `boolean` | `false` | `true` on `gemini_started`; `false` after boomerang resolves |
| `activeQueryOriginTabId` | `number\|null` | `null` | On `gemini_started` — the tab ID where the query was sent |
| `activeQueryOriginWindowId` | `number\|null` | `null` | On `gemini_started` — the window ID of the origin tab |
| `activeQueryStartedAt` | `number\|null` | `null` | Epoch ms when `gemini_started` was received |
| `pendingQueries` | `PendingQuery[]` | `[]` | Array of all in-flight queries (see shape below) |
| `activeTabDomain` | `string\|null` | `null` | Base domain of currently active tab |
| `activeTabSince` | `number\|null` | `null` | Epoch ms when active tab was last focused — MUST be in storage, never in memory |
| `lastStudyTabId` | `number\|null` | `null` | Tab ID of last study-domain tab the user was on before switching away |
| `lastStudyWindowId` | `number\|null` | `null` | Window ID matching `lastStudyTabId` |
| `isChromeFocused` | `boolean` | `true` | Updated by `windows.onFocusChanged` with 150ms debounce |
| `lastNotifiedAt` | `number\|null` | `null` | Epoch ms of last notification sent — lives in storage, not memory |

### 4.3 Analytics (written by background.js)

| Field | Type | Default | Description |
|---|---|---|---|
| `sessions` | `Session[]` | `[]` | Array of completed and active sessions (see shape below) |
| `activeSessionId` | `string\|null` | `null` | ID of current active session, null when Study Mode is OFF |

### 4.4 Tab Classification (written by popup.js and background.js)

| Field | Type | Default | Description |
|---|---|---|---|
| `tabClassifications` | `TabClassification[]` | `[]` | URL-level classifications with timestamps (see shape below) |

### 4.5 Rabbit Hole Escalation State (written by background.js)

| Field | Type | Default | Description |
|---|---|---|---|
| `rabbitHoleDismissCount` | `number` | `0` | Times user dismissed RH notification and returned to RH within 15s |
| `rabbitHoleLastDismissedAt` | `number\|null` | `null` | Epoch ms of last dismissal |
| `rabbitHoleTabId` | `number\|null` | `null` | Tab ID currently being tracked for RH escalation |

---

## 5. Object Shapes

### PendingQuery
```js
{
  id:           string,   // Date.now() + Math.random() as string
  originTabId:  number,   // Tab ID where the Gemini query was sent from
  originWindowId: number, // Window ID of that tab
  startedAt:    number,   // Epoch ms
  isSidePanel:  boolean   // true if sender.tab was undefined
}
```

### Session
```js
{
  id:                string,  // Date.now() as string, set when Study Mode turns ON
  startedAt:         number,  // Epoch ms
  endedAt:           number | null, // null if session still active
  timeLog:           { [baseDomain: string]: number }, // ms spent per domain in THIS session
  boomerangsTotal:   number,  // total boomerang triggers
  boomerangsCaught:  number   // boomerangs where user was on a Distraction domain
}
```

### TabClassification
```js
{
  url:            string,  // Full URL (key). Normalized: lowercased, no trailing slash, no query params EXCEPT for YouTube (keep full URL for YouTube to distinguish lectures from entertainment)
  classification: 'study' | 'rabbit_hole' | 'distraction' | 'ignored',
  setAt:          number,  // Epoch ms — used for 6-month expiry
  isPermanent:    boolean  // true for hardcoded rules; never expires
}
```

---

## 6. Permanent Hard-Coded Rules

These are injected into `tabClassifications` on first install and on every Study Mode enable. They have `isPermanent: true` and are never deleted by the 6-month cleanup.

| URL Pattern (domain match) | Classification | Notes |
|---|---|---|
| `hello.iitk.ac.in` | `study` | Always |
| `notebooklm.google.com` | `study` | Always |
| `music.youtube.com` | `study` | Background music, never boomeranged |
| `firewall.iitk.ac.in` | `ignored` | Internet auth page, never tracked, never prompted |
| `webmail.iitk.ac.in` | `study` | Neutral communication tool |

**Note:** `firewall.iitk.ac.in` domain is fully ignored — no classification prompt, no time tracking, no boomerang logic runs against it.

---

## 7. Domain Matching Algorithm

Used everywhere a URL is checked against a classification list.

```js
function extractBaseDomain(url) {
  try {
    let hostname = new URL(url).hostname.toLowerCase();
    if (hostname.startsWith('www.')) hostname = hostname.slice(4);
    return hostname;
  } catch {
    return null; // handles chrome://, about:blank, file://, etc.
  }
}

function domainMatches(currentHostname, storedDomain) {
  // Exact match OR subdomain match (dot-prefix)
  return currentHostname === storedDomain ||
         currentHostname.endsWith('.' + storedDomain);
}
```

**Special YouTube rule:** For YouTube URLs, store the FULL URL (not just domain) to distinguish `youtube.com/watch?v=HarvardLectureID` (study) from `youtube.com/watch?v=MemeCompilation` (distraction). When checking YouTube, try full URL match first, then fall back to domain-level classification.

**Priority rule (check in this exact order):**
1. Is URL on permanent hard-coded rules? → use that classification, STOP
2. Is full URL in `tabClassifications`? → use saved classification, STOP
3. Is base domain in `tabClassifications`? → use saved classification, STOP
4. Unclassified → treat as Rabbit Hole, fire classification prompt

---

## 8. Module 1 — Popup UI (popup.html + popup.js)

### Layout
- **Header:** Extension logo + "Focus Boomerang" title + Study Mode master toggle (ON/OFF)
- **Tab List Section:** All currently open tabs, one per row. Each row shows: favicon, truncated page title, full URL on hover. Three-button toggle per row: `Study | Rabbit Hole | Distraction`. Pre-populated from saved `tabClassifications`.
- **Phase 2 placeholder:** `<!-- ANALYTICS DASHBOARD (Phase 2) -->`
- **Footer:** "Save & Close" button

### Behaviour
- On `DOMContentLoaded`: read `chrome.storage.local`, hydrate toggle and tab list
- Tab rows are populated via `chrome.tabs.query({ currentWindow: true })`
- Saving a classification writes to `tabClassifications` array with `setAt: Date.now(), isPermanent: false`
- Study Mode toggle writes `studyModeEnabled` to storage
- When Study Mode is toggled ON: start a new Session object, write `activeSessionId`
- When Study Mode is toggled OFF: close the active session (write `endedAt: Date.now()`)

### Classification Prompt (New Tab)
- Triggered by `background.js` sending `{ action: "classify_tab", tabId, url, title }` to popup
- Renders as a **slim floating bar at the TOP of the new tab page** (injected via content script or notification)
- Contains tab title + three buttons: `Study | Rabbit Hole | Distraction`
- **Does NOT auto-dismiss.** Stays until user explicitly classifies
- On classify: writes to `tabClassifications`, removes the bar

---

## 9. Module 2 — Session Analytics Engine (background.js)

### 9.1 Event Listeners to Register

```
chrome.tabs.onActivated         → handle tab switch
chrome.tabs.onUpdated           → handle URL change within a tab
chrome.tabs.onRemoved           → clean up stale tab IDs
chrome.windows.onFocusChanged   → handle window focus/blur (with 150ms debounce)
chrome.alarms.onAlarm           → handle heartbeat + rabbit hole inactivity check
chrome.runtime.onMessage        → handle messages from content.js
```

### 9.2 Time Tracking Logic

**On tab switch (`tabs.onActivated` or `tabs.onUpdated`):**
1. Read `activeTabDomain` and `activeTabSince` from storage
2. If both exist AND `isChromeFocused` is true: calculate `delta = Date.now() - activeTabSince`
3. Add `delta` to `sessions[activeSessionId].timeLog[activeTabDomain]`
4. Write new `activeTabDomain` = base domain of newly active tab
5. Write new `activeTabSince` = `Date.now()`
6. **IMPORTANT:** If the tab being deactivated was a study domain → update `lastStudyTabId` and `lastStudyWindowId` to that tab's ID and window ID

**On window focus change:**
- Uses a 150ms debounce to handle the `WINDOW_ID_NONE` → `windowId` double-fire on Windows
- If `WINDOW_ID_NONE` persists > 150ms: set `isChromeFocused = false`, commit current tab's elapsed time to storage
- If a real `windowId` fires: set `isChromeFocused = true`, reset `activeTabSince = Date.now()`

**On `chrome.alarms` heartbeat (every 60 seconds):**
1. Read `activeTabDomain`, `activeTabSince`, `isChromeFocused` from storage
2. If all valid: commit delta to `sessions[activeSessionId].timeLog[activeTabDomain]`
3. Reset `activeTabSince = Date.now()`
4. Check Rabbit Hole inactivity (see Section 11.3)

**On `tabs.onRemoved`:**
- If removed tab's ID matches `lastStudyTabId` → set `lastStudyTabId = null`, `lastStudyWindowId = null`
- If removed tab's ID matches any `pendingQueries[n].originTabId` → remove that query from `pendingQueries`

### 9.3 URL Classification Prompt on New Tab

On `tabs.onUpdated` where `changeInfo.status === 'complete'`:
1. Extract full URL of the tab
2. Check permanent rules first
3. If unclassified: send a message to inject the classification bar into that tab
4. If classified: silently apply, no prompt

### 9.4 Storage Cleanup (6-Month Expiry)

Run on extension startup and on Study Mode toggle ON:
```
filter tabClassifications where:
  isPermanent === false AND
  Date.now() - setAt > (180 * 24 * 60 * 60 * 1000)  // 6 months in ms
→ delete those entries
```

---

## 10. Module 3 — DOM Observer (content.js)

### 10.1 Responsibilities
- Detect when Gemini **starts** generating (→ `gemini_started`)
- Detect when Gemini **finishes** generating (→ `gemini_complete`)
- Handle Gemini as both a full-page SPA and a sidebar iframe
- Never leak memory via unconnected MutationObservers

### 10.2 Two-Level Observer Strategy

**Level 1 — Container Finder (runs on script load):**
- Target: `document.body`
- Config: `{ childList: true, subtree: true }`
- Purpose: wait for the main chat container to appear in the DOM
- Finding the container: look for `[role="main"]`. If not found, walk from any element with `aria-label` containing "chat" or "conversation"
- When found: disconnect Level 1, attach Level 2, set module-level `observerAttached = true`
- Guard: check `observerAttached` flag before creating — never create two Level 1 observers

**Level 2 — State Observer (attached to the found container):**
- Target: the chat container element found by Level 1
- Config: `{ childList: true, subtree: true }`
- Purpose: detect generation start and end within `mutation.addedNodes` ONLY

**Trigger: `gemini_started`**
- Iterate `mutation.addedNodes` in each MutationRecord
- Check if any added node or its descendants contain an element with `aria-label` that includes the word "Stop" (case-insensitive) with `role="button"`
- On match: `chrome.runtime.sendMessage({ action: "gemini_started" })`
- Set module-level `isCurrentlyGenerating = true`

**Trigger: `gemini_complete`**
- Only fire if `isCurrentlyGenerating === true` (prevents ghost completions)
- Iterate `mutation.addedNodes` (NEVER `querySelectorAll` — existing nodes must be ignored)
- Check if any added node contains children with `aria-label` matching "Copy" OR "Thumb up" (Google's action bar buttons)
- Verify these buttons are inside the **last response container** (the most recently added `[data-message-author-role="model"]` element), not an earlier response
- On match: `chrome.runtime.sendMessage({ action: "gemini_complete" })`, set `isCurrentlyGenerating = false`

**SPA Re-trigger Rule:**
- Also watch for the chat container node *itself* being removed from the DOM (Gemini navigating to new conversation)
- On removal: disconnect Level 2, reset `observerAttached = false`, re-activate Level 1
- This handles React/Angular SPA navigation within Gemini

### 10.3 Side Panel Detection
- `sender.tab` in `chrome.runtime.sendMessage` will be `undefined` when running inside the Chrome Side Panel
- The content script itself does NOT need to detect this — it just sends the message
- `background.js` handles the `undefined` sender case (see Section 11)

---

## 11. Module 4 — Boomerang Logic (background.js)

### 11.1 On `gemini_started` Message

1. Create a new `PendingQuery` object:
   ```js
   {
     id: Date.now() + '-' + Math.random(),
     originTabId: sender.tab?.id ?? null,
     originWindowId: sender.tab?.windowId ?? null,
     startedAt: Date.now(),
     isSidePanel: sender.tab === undefined
   }
   ```
2. Push to `pendingQueries` array in storage
3. Set `isGenerating = true` in storage

### 11.2 On `gemini_complete` Message — Boomerang Execution Sequence

Execute in EXACTLY this order. Do not reorder.

```
STEP 1: Is studyModeEnabled? 
  → NO: exit silently

STEP 2: Is isGenerating true? 
  → NO: exit silently (ghost boomerang guard)

STEP 3: Set isGenerating = false immediately (prevent double-fires from rapid messages)

STEP 4: Identify the target query
  → Find the PendingQuery in pendingQueries with the EARLIEST startedAt value
  → Remove it from pendingQueries array
  → Store as targetQuery

STEP 5: Is isChromeFocused true?
  → NO: send notification "Gemini is ready in your study tab", exit

STEP 6: Get current active tab
  → chrome.tabs.query({ active: true, lastFocusedWindow: true })
  → Store as currentTab

STEP 7: Is currentTab.discarded true?
  → YES: send notification "Gemini ready — note: your study tab was reloaded by Chrome", exit

STEP 8: Extract currentDomain from currentTab.url
  → Use extractBaseDomain(). If returns null (chrome://, etc.): exit silently

STEP 9: Classify currentDomain using PRIORITY ORDER:
  a. Matches permanent hard-coded rules as 'study'?    → go to STEP 9-STUDY
  b. Matches permanent hard-coded rules as 'ignored'?  → exit silently
  c. Matches tabClassifications as 'study'?            → go to STEP 9-STUDY
  d. Matches tabClassifications as 'rabbit_hole'?      → go to STEP 9-RABBIT
  e. Matches tabClassifications as 'distraction'?      → go to STEP 9-DISTRACTION
  f. Unclassified?                                     → go to STEP 9-RABBIT (default)

STEP 9-STUDY:
  → Check throttle: if Date.now() - lastNotifiedAt < 10000, exit
  → Send notification: "Gemini answer is ready ✓"
  → Write lastNotifiedAt = Date.now()
  → Exit

STEP 9-RABBIT:
  → Check throttle: if Date.now() - lastNotifiedAt < 10000, exit
  → Send gentle notification: "Gemini is done — come back when you're ready"
  → Write lastNotifiedAt = Date.now()
  → Start Rabbit Hole inactivity timer (see Section 11.3)
  → If tab is unclassified: also send classify_tab message to inject classification bar
  → Exit

STEP 9-DISTRACTION:
  → Increment sessions[activeSessionId].boomerangsTotal
  → Increment sessions[activeSessionId].boomerangsCaught
  → Determine boomerang target (STEP 10)

STEP 10: Determine boomerang target
  → If targetQuery.isSidePanel === false AND targetQuery.originTabId is valid:
       target = { tabId: targetQuery.originTabId, windowId: targetQuery.originWindowId }
  → Else if lastStudyTabId is not null:
       validate lastStudyTabId still exists via chrome.tabs.get()
       if exists: target = { tabId: lastStudyTabId, windowId: lastStudyWindowId }
       if not exists: clear lastStudyTabId, send notification only, exit
  → Else: send notification "Gemini is ready — return to your study tab", exit

STEP 11: Execute boomerang
  → chrome.tabs.update(target.tabId, { active: true })
  → chrome.windows.update(target.windowId, { focused: true })
  → Inject overlay into the CURRENT (distraction) tab before switching
    (overlay shows: time spent on distraction tab + "Gemini is done, going back...")
  → The overlay should auto-pause any playing video in the distraction tab

STEP 12: Write updated pendingQueries, sessions back to storage
```

### 11.3 Rabbit Hole Escalation Logic

**Trigger A — Dismissal Loop:**
- On each Rabbit Hole notification: record `rabbitHoleLastDismissedAt = Date.now()`
- On `tabs.onActivated`: if user returns to a study tab within 15 seconds of `rabbitHoleLastDismissedAt`, then immediately re-switches to Rabbit Hole tab → increment `rabbitHoleDismissCount`
- If `rabbitHoleDismissCount >= 5`:
  - Reclassify `rabbitHoleTabId` as distraction **for this session only** (do not write to persistent `tabClassifications`)
  - Clear `rabbitHoleDismissCount = 0`
  - Trigger full boomerang overlay on next `gemini_complete`

**Trigger B — Time Overstay:**
- On `gemini_complete` for a Rabbit Hole tab: record `rabbitHoleEntryTime = Date.now()`
- On each alarm heartbeat: if current active tab is the Rabbit Hole tab AND `Date.now() - rabbitHoleEntryTime > 300000` (5 minutes):
  - Treat as distraction, trigger full boomerang

**Natural End Detection (Option A — confirmed):**
- On each alarm heartbeat: if user has been on Rabbit Hole tab AND no `chrome.tabs.onUpdated` activity (no navigation, no new messages detected) for 3 continuous minutes:
  - Send gentle toast notification: "Looks like you're done here. Back to study?"
  - This is notification only, not a force-switch

**Escalation Overlay Message:**
```
"You've been on this idea tab for X min / dismissed Y times.
Your study tab is waiting."
[Go Back]
```

---

## 12. The Boomerang Overlay (Injected into Distraction Tab)

The overlay is injected into the distraction tab via `chrome.scripting.executeScript` (note: this requires adding `scripting` permission back, scoped to the specific distraction tab's URL — this is the ONLY place `scripting` is used).

**Alternatively:** inject via a content script declared in manifest with broad match patterns. Use whichever approach avoids broad host_permissions.

### Overlay Behaviour
- **Full-screen blur** on the page behind it (`backdrop-filter: blur(8px)`)
- **Center card** showing:
  - "Gemini finished answering"
  - Time spent on this tab: *"You were here for 2m 14s"*
  - Single button: **"Go Back"** (no snooze, no dismiss)
- **Auto-pauses video:** inject `document.querySelector('video')?.pause()` before showing overlay
- **"Go Back" click:** executes `chrome.tabs.update` and `chrome.windows.update` as in Step 11

---

## 13. Onboarding (onboarding.html + onboarding.js)

**Trigger:** On first install, check `chrome.storage.local` for `hasOnboarded` flag. If missing, open `onboarding.html` as a new tab.

**Screens (single scrolling page or 3-step wizard):**
1. **The Problem** — brief explanation of the working memory hijack
2. **The Three Tiers** — explain Study / Rabbit Hole / Distraction with examples
3. **Setup** — list all currently open tabs, let user classify each before activating
4. **Activate** — "Turn on Study Mode" button → writes `studyModeEnabled = true`, `hasOnboarded = true`, closes onboarding tab

---

## 14. Known Limitations (Document for Future Versions)

- **Lyric detection on YouTube Music** — future feature; currently YouTube Music is permanently whitelisted
- **NotebookLM / Perplexity generation detection** — content.js only injects into Gemini. Future versions should extend the observer pattern to other AI tools
- **Severity slider** — currently accountability coach mode only; future version adds gentle/firm/hard modes
- **Browser-agnostic AI sidebar** — currently Chrome + Gemini only; future support for Copilot (Edge), Brave AI, etc.
- **Up to 60 seconds of session time can be lost** if Chrome is force-quit between alarm heartbeats — known acceptable limitation of MV3 service worker lifecycle
- **Tab Memory Saver reload** — if a study tab is discarded by Chrome's Memory Saver and the boomerang fires, the tab will reload on switch (scroll position lost); extension sends notification warning in this case

---

## 15. Implementation Notes for Jules

1. **Never use `setInterval` in background.js.** MV3 service workers are killed after 30s of inactivity. Use only `chrome.alarms` for recurring logic.
2. **Never store the active tab start timestamp in a JS variable.** It will be wiped when the service worker sleeps. Always read `activeTabSince` from `chrome.storage.local`.
3. **Never key time data by `tabId`.** Tab IDs are ephemeral. Always use `baseDomain` as the key in `timeLog`.
4. **Always guard `new URL(url)`** in a try/catch. `chrome://`, `about:blank`, and `file://` URLs throw and must be handled silently.
5. **`mutation.addedNodes` only for completion detection** — never use `querySelectorAll` in the MutationObserver callback. Existing DOM nodes must not trigger `gemini_complete`.
6. **`sender.tab` can be `undefined`** when content.js runs in the Chrome Side Panel. Always use optional chaining: `sender.tab?.id`.
7. **Debounce `WINDOW_ID_NONE`** by 150ms before pausing the timer — Windows OS fires it spuriously during Chrome window switches.
8. **`lastStudyTabId` validation** — always call `chrome.tabs.get(lastStudyTabId)` before using it. If it throws, the tab is stale; clear the field and fall back to notification.

