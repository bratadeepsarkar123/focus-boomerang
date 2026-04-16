'use strict';

// ---------------------------------------------------------------------------
// Utilities — identical logic to popup.js (no shared module in MV3)
// ---------------------------------------------------------------------------

/**
 * Guard #12: new URL() wrapped in try/catch.
 * Returns normalised hostname (no www, lowercase) or null.
 */
function normalizeDomain(raw) {
  if (!raw) return null;
  const str = raw.trim().toLowerCase();
  if (!str) return null;
  try {
    const url = new URL(str.includes('://') ? str : 'https://' + str);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    let host = url.hostname;
    if (host.startsWith('www.')) host = host.slice(4);
    return host || null;
  } catch {
    return null;
  }
}

/**
 * Split on comma or newline, normalise, deduplicate.
 */
function parseDomainsInput(text) {
  if (!text) return [];
  return [...new Set(
    text.split(/[,\n]+/)
        .map(normalizeDomain)
        .filter(Boolean)
  )];
}

function updatePreview(textarea, previewEl) {
  const domains = parseDomainsInput(textarea.value);
  previewEl.textContent = domains.length ? 'Parsed: ' + domains.join(', ') : '';
}

// ---------------------------------------------------------------------------
// Wizard state
// ---------------------------------------------------------------------------

const TOTAL_STEPS = 4;
let currentStep = 0;

const screens     = document.querySelectorAll('.screen');
const progressPips = Array.from({ length: TOTAL_STEPS }, (_, i) => document.getElementById('ps-' + i));

function showStep(n) {
  screens.forEach((s, i) => s.classList.toggle('active', i === n));
  progressPips.forEach((p, i) => {
    p.classList.remove('active', 'done');
    if (i < n)  p.classList.add('done');
    if (i === n) p.classList.add('active');
  });
  currentStep = n;
}

// ---------------------------------------------------------------------------
// Textarea elements
// ---------------------------------------------------------------------------

const studyInput   = document.getElementById('study-input');
const rabbitInput  = document.getElementById('rabbit-input');
const distractInput = document.getElementById('distract-input');

const studyPreview   = document.getElementById('study-preview');
const rabbitPreview  = document.getElementById('rabbit-preview');
const distractPreview = document.getElementById('distract-preview');

// Live previews
studyInput.addEventListener('input',    () => updatePreview(studyInput,    studyPreview));
rabbitInput.addEventListener('input',   () => updatePreview(rabbitInput,   rabbitPreview));
distractInput.addEventListener('input', () => updatePreview(distractInput, distractPreview));

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

document.getElementById('next-0').addEventListener('click', () => showStep(1));

document.getElementById('back-1').addEventListener('click', () => showStep(0));
document.getElementById('next-1').addEventListener('click', () => showStep(2));

document.getElementById('back-2').addEventListener('click', () => showStep(1));
document.getElementById('next-2').addEventListener('click', () => saveDomainsAndContinue());

document.getElementById('back-3').addEventListener('click', () => showStep(2));
document.getElementById('btn-go').addEventListener('click', () => activateAndClose());

// ---------------------------------------------------------------------------
// Step 2 → 3: save domain classifications
// ---------------------------------------------------------------------------

async function saveDomainsAndContinue() {
  const studyDomains    = parseDomainsInput(studyInput.value);
  const rabbitDomains   = parseDomainsInput(rabbitInput.value);
  const distractDomains = parseDomainsInput(distractInput.value);

  const { tabClassifications = [] } = await chrome.storage.local.get(['tabClassifications']);

  // Keep permanent rules; replace all user-set ones with fresh data
  const permanentRules = tabClassifications.filter(c => c.isPermanent);
  const now = Date.now();

  const newClassifications = [
    ...permanentRules,
    ...studyDomains.map(url    => ({ url, classification: 'study',       setAt: now, isPermanent: false })),
    ...rabbitDomains.map(url   => ({ url, classification: 'rabbit_hole', setAt: now, isPermanent: false })),
    ...distractDomains.map(url => ({ url, classification: 'distraction', setAt: now, isPermanent: false }))
  ];

  // Guard #6: await storage write BEFORE proceeding to next step
  await chrome.storage.local.set({ tabClassifications: newClassifications });

  showStep(3);
}

// ---------------------------------------------------------------------------
// Step 3: activate Study Mode and close tab
// ---------------------------------------------------------------------------

async function activateAndClose() {
  const btn = document.getElementById('btn-go');
  btn.disabled = true;
  btn.textContent = 'Starting…';

  // Start a new session
  const sessionId = Date.now().toString();
  const newSession = {
    id: sessionId,
    startedAt: Date.now(),
    endedAt: null,
    timeLog: {},
    boomerangsTotal: 0,
    boomerangsCaught: 0
  };

  const { sessions = [] } = await chrome.storage.local.get(['sessions']);
  sessions.push(newSession);

  // Guard #6: await all writes before closing tab
  await chrome.storage.local.set({
    studyModeEnabled: true,
    hasOnboarded: true,
    sessions,
    activeSessionId: sessionId
  });

  // Close this onboarding tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    chrome.tabs.remove(tab.id);
  }
}

// ---------------------------------------------------------------------------
// Init: hydrate textareas if user navigated back
// ---------------------------------------------------------------------------

async function init() {
  const { tabClassifications = [] } = await chrome.storage.local.get(['tabClassifications']);

  const studyArr    = tabClassifications.filter(c => c.classification === 'study'       && !c.isPermanent).map(c => c.url);
  const rabbitArr   = tabClassifications.filter(c => c.classification === 'rabbit_hole' && !c.isPermanent).map(c => c.url);
  const distractArr = tabClassifications.filter(c => c.classification === 'distraction' && !c.isPermanent).map(c => c.url);

  studyInput.value    = studyArr.join('\n');
  rabbitInput.value   = rabbitArr.join('\n');
  distractInput.value = distractArr.join('\n');

  updatePreview(studyInput,    studyPreview);
  updatePreview(rabbitInput,   rabbitPreview);
  updatePreview(distractInput, distractPreview);
}

document.addEventListener('DOMContentLoaded', init);
