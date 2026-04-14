# Focus Boomerang — Supplementary Reference: Bugs, Guards & Test Scenarios

> **For the coding agent:** This file contains ONLY the engineering guardrails, known limitations, decision log, and test scenarios. All feature descriptions, storage schemas, and implementation logic are in `01_PRIMARY_SPEC.md` — that file is your canonical source of truth. This file exists solely to prevent silent failures during implementation.

---

## 1. Decision Log

Decisions are permanent. Do not reverse them without updating this log.

| # | Decision | Options Considered | Choice | Rationale |
|---|---|---|---|---|
| 1 | MV3 timer persistence | In-memory vs. storage | `chrome.storage.local` | Service workers die; storage survives |
| 2 | Completion signal | Signal A (Stop disappears) vs. Signal B (action buttons appear) | Signal B primary, Signal A secondary | Signal A fires on manual cancellation too — Signal B is completion-only |
| 3 | DOM selectors | CSS classes vs. ARIA attributes | ARIA only | CSS classes are internal; ARIA is an accessibility contract, more stable |
| 4 | Neutral domain default | Treat as distraction / treat as study / notification only | Treat as Rabbit Hole (3-tier system) | Least intrusive; user didn't classify it |
| 5 | Sidebar/no-tabId fallback | Fail silently / open new tab | Open new tab | Better UX; Gemini URL is safe to open |
| 6 | YouTube subdomain matching | Exact match only / subdomain match | Subdomain match | `music.youtube.com` should match `youtube.com`; consistent mental model |
| 7 | Onboarding YouTube advice | Show in onboarding / leave undocumented | Show in Screen 3 | Prevents early uninstalls from lecture watchers being interrupted |
| 8 | `onInstalled` defaults guard | Always overwrite / guard with `reason` | Guard with `reason === 'install'` | Updates must never wipe user's domain lists |
| 9 | Signal B timeout | Hardcoded / configurable in storage | Configurable (`observerTimeoutMinutes`, default 8) | Gemini research mode can take >5 min; 8 min is safer |
| 10 | Textarea input delimiter | Comma only / comma + newline | Both | Users naturally press Enter; both are valid |

---

## 2. Known Limitations (Do Not Fix in Phase 1)

These are documented constraints, not bugs to solve:

1. **60-second data loss window** — Time data can be lost for up to 60 seconds if Chrome crashes between heartbeats. Acceptable for a productivity tool.
2. **Multiple simultaneous Gemini tabs** — If two Gemini tabs are both generating, only the one that fires `gemini_complete` first triggers the boomerang logic. The second is silently ignored. The user gets boomeranged to whichever tab fired first, which may not be the one they care about.
3. **Cold-start miss** — If the user installs the extension while Gemini is already mid-generation, the `gemini_started` signal is never received. The subsequent `gemini_complete` is correctly ignored (`isGenerating = false`), but the user misses boomerang coverage for that first generation.
4. **Signal B breakage on Gemini UI updates** — Google's ARIA labels may change. When `isActionButtonRow()` stops matching, Signal B stops firing silently. The 8-minute `observerTimeout` fallback partially mitigates this. After major Gemini UI updates, verify `[aria-label*="Copy"]` and `[aria-label*="Good response"]` still match.
5. **Chrome Side Panel (no tabId)** — When Gemini is open only in Chrome's built-in Side Panel, `sender.tab` is undefined. The extension falls back to opening `gemini.google.com` as a new tab. This is the correct behavior.
6. **Up to 60 seconds of session time can be lost** if Chrome is force-quit between alarm heartbeats — known acceptable limitation of MV3 service worker lifecycle.
7. **Tab Memory Saver reload** — if a study tab is discarded by Chrome's Memory Saver and the boomerang fires, the tab will reload on switch (scroll position lost); extension sends notification warning in this case.

---

## 3. Implementation Guards (Read Before Coding)

These are the exact traps that would produce silent failures. Each is a numbered rule.

1. **Never trust in-memory state in background.js.** Every variable that matters must be read from `chrome.storage.local` at the start of every function that needs it. The service worker may have been killed and restarted between calls.
2. **Never use `setInterval` in background.js.** It will silently stop working after ~30 seconds. Use `chrome.alarms` only.
3. **Never call `chrome.storage.local.set()` with all defaults on `onInstalled` without the `reason === 'install'` guard.** Extension updates fire `onInstalled` too. Without this guard, an update wipes the user's saved domain lists.
4. **Never rely on CSS class selectors in content.js.** Google changes Gemini's internal class names frequently. Use only `role`, `aria-label`, and `data-*` attributes.
5. **Always handle `chrome.windows.WINDOW_ID_NONE`.** This is `-1`. It fires when the user switches to a non-Chrome application. Treat it as "pause timing entirely." Debounce by 150ms before acting — Windows OS fires `WINDOW_ID_NONE` spuriously during Chrome window switches.
6. **Always `await` the `chrome.storage.local.set()` call in popup.js before showing confirmation.** The popup can be garbage-collected before a non-awaited write completes.
7. **Always handle the case where `geminiTabId` is null or stale** (tab was closed). Fall back to `chrome.tabs.create({ url: 'https://gemini.google.com/' })`.
8. **The `generationGuard` / `isCurrentlyGenerating` flag in content.js prevents duplicate `gemini_complete` messages** for the same generation. Reset it only when `gemini_started` fires again (new generation begins).
9. **On `gemini_complete`, set `isGenerating = false` FIRST (Step 3 in PRIMARY spec) before any conditional logic.** This prevents race conditions where two rapid completions double-fire the boomerang.
10. **Signal C (cancellation) uses a 500ms `setTimeout` to debounce.** The Stop button disappears briefly during normal completion too. The 500ms window lets Signal B arrive first if it's coming.
11. **Never hold `activeTabSince` only in memory.** Always write it to `chrome.storage.local` immediately on tab change. The service worker will be killed and revived; the timestamp must survive.
12. **Always guard `new URL(url)` in a try/catch.** `chrome://`, `about:blank`, and `file://` URLs will throw and must be handled silently (return null).
13. **`mutation.addedNodes` only for completion detection** — never use `querySelectorAll` in the MutationObserver callback. Existing DOM nodes must not trigger `gemini_complete`.
14. **`sender.tab` can be `undefined`** when content.js runs in the Chrome Side Panel. Always use optional chaining: `sender.tab?.id`.
15. **`lastStudyTabId` validation** — always call `chrome.tabs.get(lastStudyTabId)` before using it. If it throws, the tab was closed; clear the field and fall back to notification.
16. **`scripting` permission is NOT in manifest.json** (for static content scripts). Including it triggers unnecessary Web Store warnings. However, if the overlay injection approach requires `chrome.scripting.executeScript`, add `scripting` with narrow host scope.
17. **Never key time data by `tabId`.** Tab IDs are ephemeral and change on browser restart. Always use `baseDomain` as the key in `timeLog`.

---

## 4. Test Scenarios (Verify All Before Shipping)

### Happy Path
1. Open Gemini, send a query → `gemini_started` fires → switch to YouTube → answer completes → tab snaps back to Gemini → boomerang overlay appears on distraction tab
2. Same as above but Study Mode is OFF → no snap-back, no notification

### Notification Path
3. Open Gemini, send a query → switch to `hello.iitk.ac.in` (study domain) → answer completes → desktop notification fires → click notification → Gemini tab focuses
4. Open Gemini, send a query → switch to `github.com` (unclassified, defaults to Rabbit Hole) → answer completes → gentle notification fires

### Rabbit Hole Escalation
5. User is on a Rabbit Hole tab → dismisses notification 5 times within 15s each → tab escalates to distraction → next `gemini_complete` triggers full boomerang overlay
6. User stays on Rabbit Hole tab for >5 minutes → treated as distraction → full boomerang triggers

### Cancellation / Error
7. Send a query → switch to YouTube → manually click "Stop generating" → no snap-back occurs
8. Send a query → Gemini returns an error → no snap-back occurs

### Ghost Boomerang Prevention
9. `gemini_complete` fires but `isGenerating` is already `false` → exit silently, no boomerang (ghost boomerang guard)

### Service Worker Restart
10. Send a query → disable/re-enable the extension (simulates service worker restart) → answer completes → boomerang still fires (because state was persisted to storage)

### Sidebar / No TabId
11. Open Gemini only in Side Panel (not a regular tab) → send a query → switch to YouTube → answer completes → new Gemini tab opens

### Parent Context Tab
12. User is on study tab → switches to distraction → `gemini_complete` fires → boomerang target is `lastStudyTabId` (the study tab, not the Gemini tab)
13. `lastStudyTabId` points to a tab that was closed → boomerang falls back to notification

### Discarded Tab
14. Study tab was discarded by Chrome Memory Saver → boomerang fires → notification warns "your study tab was reloaded by Chrome"

### Edge Cases
15. Toggle Study Mode OFF while query is generating → `isGenerating` becomes false → answer completes → no snap-back
16. Two Gemini tabs generating simultaneously → first completion fires → snap-back occurs → second completion → `isGenerating = false`, silently ignored
17. Observer timeout (8 min, no Signal B) → fallback notification fires: "Gemini may have finished"
18. First-install: `hasOnboarded = false` → onboarding flow appears → user completes setup → main UI shown
19. Extension update (not first install) → `onInstalled` fires with `reason = 'update'` → user domain lists are NOT overwritten
20. Tab URL is `chrome://settings` → `extractBaseDomain` returns null → exit silently, no classification prompt

---

*End of supplementary reference. All implementation logic is in `01_PRIMARY_SPEC.md`.*
