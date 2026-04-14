# Focus Boomerang — Phased Jules Prompts

> **How to use:** Copy-paste each prompt into the Jules Web UI, one at a time. 
> Wait for Jules to create a PR → Review it → Merge it → Then paste the next prompt.
> Each phase builds on the merged code from the previous phase.

---

## ⚠️ BEFORE YOU START

Make sure your repo (`bratadeepsarkar123/focus-boomerang`) has these files on `main`:
- `spec/00_FILE_GUIDE.md`
- `spec/01_PRIMARY_SPEC.md`  
- `spec/02_BUGS_AND_GUARDS.md`

Jules will read these during each session.

---

## Phase 1 of 5 — Foundation: manifest.json + background.js

```
CONTEXT: You are building a Chrome extension called "Focus Boomerang." 
Read these files first (in order):
1. spec/00_FILE_GUIDE.md — context and glossary only, do not implement from this file
2. spec/01_PRIMARY_SPEC.md — this is the CANONICAL implementation spec
3. spec/02_BUGS_AND_GUARDS.md — apply every guard during implementation

TASK: Create manifest.json and background.js. Nothing else in this phase.

manifest.json:
- Copy the exact JSON from Section 3 of 01_PRIMARY_SPEC.md
- host_permissions MUST include BOTH "*://gemini.google.com/*" AND "*://*/*"
- The *://*/* permission is required for chrome.tabs.query to return non-redacted URLs
- Do NOT include the "scripting" permission (static content scripts don't need it)

background.js:
- Implement the FULL Session Analytics Engine (Section 9 of 01_PRIMARY_SPEC.md)
- Implement the FULL Boomerang Execution Sequence (Section 11 of 01_PRIMARY_SPEC.md)  
- Implement the chrome.runtime.onInstalled handler with the reason === 'install' guard
- Implement the chrome.alarms heartbeat (60s interval)
- Implement the chrome.windows.onFocusChanged handler with 150ms WINDOW_ID_NONE debounce
- Implement extractBaseDomain() with try/catch around new URL()
- Implement domainMatches() using RFC-correct suffix matching (exact || endsWith('.' + stored))
- Implement handleGeminiComplete() — MUST set isGenerating = false FIRST before conditional logic
- Implement the Ghost Boomerang Guard: boomerang fires ONLY on isGenerating true→false transition
- Implement lastStudyTabId validation: always chrome.tabs.get() before using — if it throws, clear and fall back to notification
- Implement the observer timeout alarm handler (8-minute fallback)
- Implement chrome.storage.onChanged listener for mid-generation Study Mode toggle-off

CRITICAL GUARDS TO APPLY (from 02_BUGS_AND_GUARDS.md):
- Guard #1: Never trust in-memory state — read from chrome.storage.local at the start of every function
- Guard #2: Never use setInterval — use chrome.alarms only
- Guard #3: onInstalled defaults guard — reason === 'install' check
- Guard #5: Debounce WINDOW_ID_NONE by 150ms
- Guard #7: Always handle stale geminiTabId — fall back to chrome.tabs.create
- Guard #9: On gemini_complete, set isGenerating = false FIRST
- Guard #11: Never hold activeTabSince only in memory
- Guard #12: Always guard new URL(url) in try/catch
- Guard #17: Never key time data by tabId — use baseDomain

Also create placeholder icon files:
- icons/icon16.png (16x16)
- icons/icon48.png (48x48)  
- icons/icon128.png (128x128)
These can be simple colored squares for now.

Do NOT create content.js, popup.html, popup.js, onboarding.html, or onboarding.js yet.
```

---

## Phase 2 of 5 — DOM Observer: content.js

```
CONTEXT: You are continuing work on the "Focus Boomerang" Chrome extension.
Phase 1 (manifest.json + background.js) is already merged and working.

Read these files first:
1. spec/01_PRIMARY_SPEC.md — Sections 10 and 7 are your primary reference
2. spec/02_BUGS_AND_GUARDS.md — apply every guard

TASK: Create content.js. Nothing else in this phase.

content.js:
- Implement the FULL Two-Level Observer Strategy (Section 10 of 01_PRIMARY_SPEC.md)
- Level 1: watches document.body for the chat container using ARIA selectors
- Level 2: attaches to the chat container and watches for generation signals
- Signal A (gemini_started): Stop button appears → send message to background.js
- Signal B (gemini_complete): Action buttons row appears (Copy + Thumbs Up) → send message to background.js
- Signal C (gemini_cancelled / gemini_error): Stop button disappears WITHOUT Signal B → 500ms debounce → send message
- Implement the duplicate injection guard: if (window.__focusBoomerangInjected) return
- Implement the generationGuard flag to prevent duplicate gemini_complete messages per generation
- Implement SPA navigation handler: when the chat container is removed from DOM, disconnect Level 2 and restart Level 1
- Implement the boomerang toast: chrome.runtime.onMessage listener for 'show_boomerang_toast' → fixed-position toast with auto-dismiss after 4s
- Implement the distraction overlay: chrome.runtime.onMessage listener for 'show_distraction_overlay' → full-screen blur overlay with "Go Back" button, auto-pause any playing video

CRITICAL: Use ONLY ARIA-based selectors. NEVER use CSS class selectors.
- Stop button: [aria-label*="Stop"]
- Action buttons: [aria-label*="Copy"] AND [aria-label*="Good response"] or [aria-label*="Thumbs up"]
- Error state: [role="alert"]
- Chat container: [aria-label*="Chat messages"] or [role="main"]

CRITICAL GUARDS:
- Guard #4: Never rely on CSS class selectors — ARIA only
- Guard #8: generationGuard prevents duplicate gemini_complete
- Guard #10: Signal C uses 500ms setTimeout debounce
- Guard #13: mutation.addedNodes ONLY — never querySelectorAll in observer callback
- Guard #14: sender.tab can be undefined (Side Panel) — use optional chaining

Verify that the message actions sent match what background.js expects:
- 'gemini_started'
- 'gemini_complete'  
- 'gemini_cancelled'
- 'gemini_error'
```

---

## Phase 3 of 5 — Popup UI: popup.html + popup.js

```
CONTEXT: You are continuing work on the "Focus Boomerang" Chrome extension.
Phase 1 (manifest.json + background.js) and Phase 2 (content.js) are already merged.

Read these files first:
1. spec/01_PRIMARY_SPEC.md — Section 8 (Popup Design) is your primary reference
2. spec/02_BUGS_AND_GUARDS.md — apply every guard

TASK: Create popup.html and popup.js. Nothing else in this phase.

popup.html:
- Width: 360px, dark theme (#0f0f1a background)
- Three-tab layout: Settings | Stats | About
- Header with "Focus Boomerang" logo and Study Mode master toggle
- Settings tab: THREE textareas (not two!) for the 3-tier classification system:
  * Study Domains — quiet notification when user is here
  * Rabbit Hole Domains — gentle notification, escalates to distraction after 5 dismissals or 5-min overstay
  * Distraction Domains — force-switch back to Gemini
- Each textarea gets a live-parsed preview showing normalized domains
- "One domain per line, or comma-separated" hint text
- Save button with async save confirmation
- Stats tab: sorted domain time log (top 20, >5s filter)
- About tab: privacy messaging + version

popup.js:
- Implement normalizeDomain(): strip protocol, path, query, www prefix, lowercase
- Implement parseDomainsInput(): split on comma + newline, normalize, deduplicate
- Implement the Study Mode toggle: writes studyModeEnabled to chrome.storage.local
- Implement Save button: await chrome.storage.local.set() BEFORE showing "✓ Saved" confirmation
- Implement Stats rendering: read timeLog from storage, format as hours/minutes
- Implement init(): hydrate toggle, textareas, and previews from stored values
- Live preview updates as user types in any textarea
- Tab switching logic between Settings/Stats/About panels

CRITICAL: This is a 3-TIER system (Study / Rabbit Hole / Distraction).
The PRIMARY spec Section 8 describes the popup with three domain lists.
Do NOT build a 2-tier popup — that is the outdated design.

CRITICAL GUARDS:
- Guard #6: Always await chrome.storage.local.set() in popup.js before showing confirmation
- Guard #12: Guard new URL() in try/catch within normalizeDomain
```

---

## Phase 4 of 5 — Onboarding: onboarding.html + onboarding.js

```
CONTEXT: You are continuing work on the "Focus Boomerang" Chrome extension.
Phases 1-3 (manifest, background, content, popup) are already merged.

Read these files first:
1. spec/01_PRIMARY_SPEC.md — Section 13 (Onboarding Flow) is your primary reference
2. spec/02_BUGS_AND_GUARDS.md — Section 2, Limitation #3 (cold-start) is relevant context

TASK: Create onboarding.html and onboarding.js. Nothing else in this phase.

onboarding.html:
- Full-page dark theme onboarding flow (opened via chrome.runtime.onInstalled in background.js)
- 3 screens with step indicator dots and Next/Back navigation:

Screen 1 — Welcome:
  "You ask Gemini a question. While it thinks, you switch to YouTube. 
   Ten minutes later, you forgot why."
  "This extension fixes that. The moment Gemini finishes, it snaps you back —
   but only if you've wandered to a distraction site."

Screen 2 — How It Works:
  Explain the 3-tier system:
  - Distraction domains → force-switch back to Gemini
  - Rabbit Hole domains → gentle notification, escalates if you ignore it
  - Study domains → quiet notification, no interruption
  "You define all three lists yourself. We never assume."

Screen 3 — Pro Tip:
  "Not sure where to put YouTube? Start with Rabbit Hole. 
   If gentle isn't enough, move it to Distraction later."
  "Get Started" button → saves hasOnboarded: true to storage → closes onboarding tab

onboarding.js:
- Step navigation (next/back) with dot indicator updates
- "Get Started" button handler: 
  await chrome.storage.local.set({ hasOnboarded: true })
  then window.close() or navigate to a success state

Also verify that background.js already opens onboarding.html on first install.
If it doesn't, add the chrome.tabs.create call inside the onInstalled handler
(guarded by reason === 'install' AND !hasOnboarded).
```

---

## Phase 5 of 5 — Integration Audit + Polish

```
CONTEXT: You are doing the final review of the "Focus Boomerang" Chrome extension.
All 4 previous phases are merged: manifest.json, background.js, content.js, 
popup.html/js, onboarding.html/js.

Read these files:
1. spec/01_PRIMARY_SPEC.md — full document
2. spec/02_BUGS_AND_GUARDS.md — full document (focus on Section 3: Guards and Section 4: Test Scenarios)

TASK: Audit the entire codebase for correctness and fix any issues.

AUDIT CHECKLIST:

1. Message Contract: Verify that every message action sent by content.js 
   (gemini_started, gemini_complete, gemini_cancelled, gemini_error)
   is handled by background.js's chrome.runtime.onMessage listener.

2. Storage Schema: Verify that every key written by popup.js 
   (studyDomains, rabbitHoleDomains, distractionDomains, studyModeEnabled)
   is read correctly by background.js with the same key names.

3. Ghost Boomerang Guard: Trace the isGenerating flag through the full lifecycle:
   gemini_started → isGenerating = true
   gemini_complete → check isGenerating was true → set false → execute boomerang
   Verify that a gemini_complete when isGenerating is already false does NOTHING.

4. 3-Tier Classification: Verify that background.js classifies tabs into 
   Study / Rabbit Hole / Distraction correctly. 
   Unclassified domains default to Rabbit Hole behavior.

5. Rabbit Hole Escalation: Verify these two triggers exist:
   - 5 notification dismissals → escalate to Distraction
   - 5-minute overstay timer → escalate to Distraction

6. All 17 Implementation Guards: Go through Guards #1-#17 in 
   spec/02_BUGS_AND_GUARDS.md Section 3 and verify each one is correctly 
   implemented in the codebase. List any violations and fix them.

7. Test Scenario Trace: For each of the 20 test scenarios in 
   spec/02_BUGS_AND_GUARDS.md Section 4, mentally trace the code path 
   and verify it produces the expected outcome. Fix any failures.

8. Permission Check: Verify manifest.json has:
   - host_permissions: ["*://gemini.google.com/*", "*://*/*"]
   - permissions: ["storage", "tabs", "alarms", "notifications"]
   - NO "scripting" permission
   
9. Overlay: Verify content.js implements the distraction overlay 
   (full-screen blur + Go Back button + video auto-pause).

10. Onboarding: Verify background.js opens onboarding.html on first install only
    (reason === 'install' AND !hasOnboarded).

Fix every issue you find. Do not skip any check.
Open a PR with all fixes.
```

---

## Summary: Your Workflow

| Step | Action | Wait for |
|------|--------|----------|
| 1 | Paste Phase 1 prompt into Jules | PR created → review → merge |
| 2 | Paste Phase 2 prompt into Jules | PR created → review → merge |
| 3 | Paste Phase 3 prompt into Jules | PR created → review → merge |
| 4 | Paste Phase 4 prompt into Jules | PR created → review → merge |
| 5 | Paste Phase 5 prompt into Jules | PR created → review → merge |
| 6 | Load unpacked extension in Chrome → test manually | 🎉 |
