// Utility: Normalize a single URL string
function normalizeDomain(urlStr) {
  if (!urlStr) return null;
  let str = urlStr.trim().toLowerCase();
  if (str === '') return null;

  // Guard #12: Guard new URL() in try/catch
  try {
    // If it doesn't have a protocol, add one temporarily to parse it
    const urlObj = new URL(str.includes('://') ? str : 'https://' + str);

    if (!['http:', 'https:'].includes(urlObj.protocol)) return null;

    let hostname = urlObj.hostname;

    // Strip www.
    if (hostname.startsWith('www.')) {
      hostname = hostname.slice(4);
    }

    return hostname || null;
  } catch (e) {
    return null;
  }
}

// Parse input text block into an array of normalized domains
function parseDomainsInput(input) {
  if (!input) return [];
  // Split on comma or newline
  const parts = input.split(/,|\n/);
  const normalized = parts
    .map(p => normalizeDomain(p))
    .filter(p => p !== null && p !== '');

  // Deduplicate
  return [...new Set(normalized)];
}

// UI Elements
const studyModeToggle = document.getElementById('study-mode-toggle');

const studyTextarea = document.getElementById('study-domains');
const rabbitTextarea = document.getElementById('rabbit-domains');
const distractionTextarea = document.getElementById('distraction-domains');

const studyPreview = document.getElementById('study-preview');
const rabbitPreview = document.getElementById('rabbit-preview');
const distractionPreview = document.getElementById('distraction-preview');

const saveBtn = document.getElementById('save-btn');
const saveStatus = document.getElementById('save-status');

const statsList = document.getElementById('stats-list');

// Tab logic
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

    btn.classList.add('active');
    document.getElementById(btn.dataset.target).classList.add('active');
  });
});

// Update live previews
function updatePreview(textarea, previewEl) {
  const domains = parseDomainsInput(textarea.value);
  previewEl.textContent = domains.length ? domains.join(', ') : 'None';
}

studyTextarea.addEventListener('input', () => updatePreview(studyTextarea, studyPreview));
rabbitTextarea.addEventListener('input', () => updatePreview(rabbitTextarea, rabbitPreview));
distractionTextarea.addEventListener('input', () => updatePreview(distractionTextarea, distractionPreview));

// Load current state
async function init() {
  const data = await chrome.storage.local.get([
    'studyModeEnabled',
    'tabClassifications',
    'sessions',
    'activeSessionId'
  ]);

  // Toggle
  studyModeToggle.checked = !!data.studyModeEnabled;

  // Textareas
  const classifications = data.tabClassifications || [];

  const studyUrls = [];
  const rabbitUrls = [];
  const distractionUrls = [];

  classifications.forEach(c => {
    if (c.isPermanent) return; // Don't show permanent rules in user editable list

    if (c.classification === 'study') studyUrls.push(c.url);
    else if (c.classification === 'rabbit_hole') rabbitUrls.push(c.url);
    else if (c.classification === 'distraction') distractionUrls.push(c.url);
  });

  studyTextarea.value = studyUrls.join('\n');
  rabbitTextarea.value = rabbitUrls.join('\n');
  distractionTextarea.value = distractionUrls.join('\n');

  updatePreview(studyTextarea, studyPreview);
  updatePreview(rabbitTextarea, rabbitPreview);
  updatePreview(distractionTextarea, distractionPreview);

  // Stats rendering
  renderStats(data);
}

function formatTime(ms) {
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function renderStats(data) {
  let logData = null;

  // Try to show current active session, otherwise most recent session
  if (data.activeSessionId && data.sessions) {
    const session = data.sessions.find(s => s.id === data.activeSessionId);
    if (session) logData = session.timeLog;
  } else if (data.sessions && data.sessions.length > 0) {
    // get latest
    const session = data.sessions[data.sessions.length - 1];
    logData = session.timeLog;
  }

  if (!logData || Object.keys(logData).length === 0) {
    statsList.innerHTML = '<li style="color:#aaa;font-size:12px;padding-top:10px;">No session active or no time logged.</li>';
    return;
  }

  // filter > 5s and sort
  const entries = Object.entries(logData)
    .filter(([domain, time]) => time > 5000)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20); // Top 20

  if (entries.length === 0) {
    statsList.innerHTML = '<li style="color:#aaa;font-size:12px;padding-top:10px;">No domains tracked for >5 seconds.</li>';
    return;
  }

  statsList.innerHTML = '';
  entries.forEach(([domain, time]) => {
    const li = document.createElement('li');
    li.className = 'stats-item';

    const spanName = document.createElement('span');
    spanName.className = 'domain-name';
    spanName.title = domain;
    spanName.textContent = domain;

    const spanTime = document.createElement('span');
    spanTime.textContent = formatTime(time);

    li.appendChild(spanName);
    li.appendChild(spanTime);
    statsList.appendChild(li);
  });
}

// Master Toggle
studyModeToggle.addEventListener('change', async () => {
  const isEnabled = studyModeToggle.checked;
  const data = await chrome.storage.local.get(['sessions', 'activeSessionId']);

  let updates = { studyModeEnabled: isEnabled };

  if (isEnabled && !data.activeSessionId) {
    // Start session
    const sessionId = Date.now().toString();
    const sessions = data.sessions || [];
    sessions.push({
      id: sessionId,
      startedAt: Date.now(),
      endedAt: null,
      timeLog: {},
      boomerangsTotal: 0,
      boomerangsCaught: 0
    });
    updates.sessions = sessions;
    updates.activeSessionId = sessionId;
  } else if (!isEnabled && data.activeSessionId) {
    // Close session is handled by background.js, but we can do it here too just in case,
    // though background.js `storage.onChanged` should handle it.
    // Spec says: "When Study Mode is toggled OFF: close the active session (write endedAt: Date.now())" in popup.html behavior!
    let sessions = data.sessions || [];
    let session = sessions.find(s => s.id === data.activeSessionId);
    if (session) session.endedAt = Date.now();
    updates.sessions = sessions;
    updates.activeSessionId = null;
  }

  await chrome.storage.local.set(updates);
});

// Save Settings
saveBtn.addEventListener('click', async () => {
  const data = await chrome.storage.local.get(['tabClassifications']);
  const existing = data.tabClassifications || [];

  const permanentRules = existing.filter(c => c.isPermanent);

  const studyDomains = parseDomainsInput(studyTextarea.value);
  const rabbitDomains = parseDomainsInput(rabbitTextarea.value);
  const distractionDomains = parseDomainsInput(distractionTextarea.value);

  const now = Date.now();
  const newClassifications = [...permanentRules];

  studyDomains.forEach(domain => {
    newClassifications.push({ url: domain, classification: 'study', setAt: now, isPermanent: false });
  });

  rabbitDomains.forEach(domain => {
    newClassifications.push({ url: domain, classification: 'rabbit_hole', setAt: now, isPermanent: false });
  });

  distractionDomains.forEach(domain => {
    newClassifications.push({ url: domain, classification: 'distraction', setAt: now, isPermanent: false });
  });

  // Guard #6: Always await chrome.storage.local.set() BEFORE showing confirmation
  await chrome.storage.local.set({ tabClassifications: newClassifications });

  saveStatus.classList.add('show');
  setTimeout(() => {
    saveStatus.classList.remove('show');
  }, 2000);
});

// Fire up
document.addEventListener('DOMContentLoaded', init);