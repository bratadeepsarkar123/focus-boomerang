# Jules Task Prompt — Focus Boomerang Chrome Extension

## Reading Order (MANDATORY — read before writing any code)

Read the following files in this exact order. Do not skip any file. Do not write code until all three are read.

1. **`spec/00_FILE_GUIDE.md`** — Context document. Read the TL;DR, Evolution Timeline, and Glossary sections. This gives you the vocabulary and design history. Do NOT implement anything from this file — it is reference only.

2. **`spec/01_PRIMARY_SPEC.md`** — **This is the canonical implementation specification.** Every section in this file is an instruction. Implement every feature, schema, object shape, execution sequence, and module described. When in doubt, this file wins over everything else.

3. **`spec/02_BUGS_AND_GUARDS.md`** — **Supplementary reference.** Contains the decision log, known limitations, 17 implementation guards that prevent silent failures, and 20 test scenarios. Read the entire file and apply every guard during implementation.

4. **`spec/03_JULES_API_MASTER_REF.md`** — **Automation Toolkit.** Technical reference for your own API and CLI tools available in this repo.

---

## What to Build

A **Manifest V3 Chrome Extension** called "Focus Boomerang" — a working memory preservation system that detects when Gemini finishes generating a response and pulls the user's focus back if they've strayed to a distraction site.

## Key Architecture Decisions (already locked — do not deviate)

- **Three-tier tab classification:** Study / Rabbit Hole / Distraction (NOT two-tier)
- **Rabbit Hole escalation:** Two triggers — 5-dismiss cycle OR 5-minute overstay on a Rabbit Hole tab
- **Ghost boomerang prevention:** `isGenerating` flag in `chrome.storage.local` — boomerang fires ONLY when transitioning from `true → false`
- **All state in `chrome.storage.local`** — never trust in-memory JS variables in `background.js` (service worker dies after ~30s)
- **`chrome.alarms` only** — never use `setInterval` in background.js
- **ARIA selectors only** in `content.js` — never use CSS class selectors (Google changes them)
- **`host_permissions: ["*://gemini.google.com/*", "*://*/*"]`** — the `*://*/*` is required for `chrome.tabs.query` to return non-redacted URLs for domain classification
- **Privacy-first:** Zero external databases, no URLs leave the device, no `unlimitedStorage`

## Implementation Order

Build files in this exact order:
1. `manifest.json` — copy the exact JSON from Section 3 of the PRIMARY spec
2. `background.js` — implement Sections 9 and 11 (Session Engine + Boomerang Logic)
3. `content.js` — implement Section 10 (DOM Observer with two-level strategy)
4. `popup.html` + `popup.js` — implement Section 8 (Popup UI)
5. `onboarding.html` + `onboarding.js` — implement Section 13 (Onboarding)
6. `icons/` — create simple placeholder colored squares (16x16, 48x48, 128x128 PNGs)

## Critical Implementation Guards (from supplementary spec)

These will cause SILENT failures if ignored:

1. **Never hold `activeTabSince` only in memory** — always write it to `chrome.storage.local` immediately on tab change
2. **Never use `setInterval`** — MV3 service workers are killed after ~30s of inactivity
3. **Always guard `new URL(url)` in try/catch** — `chrome://`, `about:blank`, and `file://` URLs throw
4. **`mutation.addedNodes` ONLY for completion detection** — never use `querySelectorAll` in MutationObserver callback (existing DOM nodes must not trigger `gemini_complete`)
5. **`sender.tab` can be `undefined`** when content.js runs in Chrome Side Panel — always use optional chaining: `sender.tab?.id`
6. **Debounce `WINDOW_ID_NONE` by 150ms** before pausing timer — Windows OS fires it spuriously during window switches
7. **Validate `lastStudyTabId` with `chrome.tabs.get()` before using** — if it throws, the tab is stale; clear the field
8. **On `gemini_complete`, set `isGenerating = false` FIRST** before any conditional logic — prevents race conditions from rapid double-fires
9. **Signal C (cancellation) uses 500ms `setTimeout` debounce** — the Stop button disappears briefly during normal completion too
10. **Always `await` the `chrome.storage.local.set()` in popup.js** before showing confirmation — the popup can be garbage-collected before a non-awaited write completes

## Deliverables

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

No build tools. No bundler. The Chrome Extension files MUST be static, vanilla JS/HTML/CSS. 

(Note: The `package.json` and `node_modules` in this repo are for your **API/CLI control tools** only — do not import them into the extension code).
