'use strict';

// ─── State ────────────────────────────────────────────────────────────────────
const tabClassificationMap = {}; // tabId → 'study' | 'rabbit_hole' | 'distraction'

// ─── Permanent hard-coded rules (injected on first install) ───────────────────
const PERMANENT_RULES = [
  { url: 'hello.iitk.ac.in',        classification: 'study',       isPermanent: true },
  { url: 'notebooklm.google.com',   classification: 'study',       isPermanent: true },
  { url: 'music.youtube.com',       classification: 'study',       isPermanent: true },
  { url: 'firewall.iitk.ac.in',     classification: 'ignored',     isPermanent: true },
  { url: 'webmail.iitk.ac.in',      classification: 'study',       isPermanent: true },
];

// ─── Step navigation ──────────────────────────────────────────────────────────
function goTo(step) {
  for (let i = 1; i <= 4; i++) {
    const card = document.getElementById(`step-${i}`);
    const dot  = document.getElementById(`dot-${i}`);
    if (card) card.classList.toggle('active', i === step);
    if (dot) {
      dot.classList.toggle('active', i === step);
      dot.classList.toggle('done',   i < step);
    }
    if (i < 4) {
      const line = document.getElementById(`line-${i}`);
      if (line) line.classList.toggle('done', i < step);
    }
  }
  // Populate tabs on step 3
  if (step === 3) populateTabTable();
}

// ─── Tab table population ─────────────────────────────────────────────────────
async function populateTabTable() {
  const tbody = document.getElementById('tab-rows');
  tbody.innerHTML = '<tr><td colspan="2" class="empty-tabs">Loading…</td></tr>';

  let tabs;
  try {
    tabs = await chrome.tabs.query({});
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="2" class="empty-tabs">Could not load tabs.</td></tr>';
    return;
  }

  // Filter out chrome:// and extension pages, and gemini itself
  tabs = tabs.filter(t => {
    if (!t.url) return false;
    if (t.url.startsWith('chrome://')) return false;
    if (t.url.startsWith('chrome-extension://')) return false;
    try {
      const host = new URL(t.url).hostname;
      if (host === 'gemini.google.com') return false;
    } catch { return false; }
    return true;
  });

  if (tabs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="2" class="empty-tabs">No classifiable tabs open right now.</td></tr>';
    return;
  }

  // Load existing classifications
  const stored = await chrome.storage.local.get(['tabClassifications']);
  const existing = stored.tabClassifications || [];

  tbody.innerHTML = '';
  tabs.forEach(tab => {
    let hostname = '';
    try { hostname = new URL(tab.url).hostname; } catch {}
    if (hostname.startsWith('www.')) hostname = hostname.slice(4);

    // Look up existing classification for this domain
    const existingEntry = existing.find(c => c.url === hostname);
    const currentClass  = tabClassificationMap[tab.id] ||
                          existingEntry?.classification ||
                          null;

    const tr = document.createElement('tr');

    // Tab info cell
    const tdInfo = document.createElement('td');
    tdInfo.innerHTML = `
      <div class="tab-title" title="${escHtml(tab.title || '')}">${
        escHtml(tab.title || '(Untitled)')
      }</div>
      <div class="tab-domain">${escHtml(hostname)}</div>
    `;

    // Classify buttons cell
    const tdBtns = document.createElement('td');
    const btnDiv = document.createElement('div');
    btnDiv.className = 'classify-btns';

    const kinds = [
      { label: 'Study',       cls: 'active-study',  val: 'study'       },
      { label: 'Rabbit Hole', cls: 'active-rabbit',  val: 'rabbit_hole' },
      { label: 'Distraction', cls: 'active-dist',    val: 'distraction' },
    ];

    kinds.forEach(({ label, cls, val }) => {
      const btn = document.createElement('button');
      btn.textContent = label;
      if (currentClass === val) btn.classList.add(cls);

      btn.addEventListener('click', () => {
        // Clear all sibling active classes
        btnDiv.querySelectorAll('button').forEach(b =>
          b.className = ''
        );
        btn.classList.add(cls);
        tabClassificationMap[tab.id] = val;
        // Also record the domain→classification
        tabClassificationMap[`domain:${hostname}`] = val;
      });

      btnDiv.appendChild(btn);
    });

    tdBtns.appendChild(btnDiv);
    tr.appendChild(tdInfo);
    tr.appendChild(tdBtns);
    tbody.appendChild(tr);
  });
}

// ─── Activate button ──────────────────────────────────────────────────────────
document.getElementById('activate-btn').addEventListener('click', async () => {
  const stored = await chrome.storage.local.get(['tabClassifications', 'sessions']);

  // Merge permanent rules + user classifications
  const now = Date.now();
  const existingPermanent = (stored.tabClassifications || []).filter(c => c.isPermanent);

  // Build permanent rules (deduplicated)
  const permanentMap = {};
  PERMANENT_RULES.forEach(r => { permanentMap[r.url] = r; });
  existingPermanent.forEach(r => { permanentMap[r.url] = r; });
  const permanentEntries = Object.values(permanentMap);

  // Build user-classified entries from tabClassificationMap
  const userEntries = [];
  Object.entries(tabClassificationMap).forEach(([key, val]) => {
    if (!key.startsWith('domain:')) return; // skip tabId entries
    const domain = key.replace('domain:', '');
    if (!domain) return;
    // Don't overwrite permanent rules
    if (permanentEntries.find(p => p.url === domain)) return;
    userEntries.push({
      url: domain,
      classification: val,
      setAt: now,
      isPermanent: false,
    });
  });

  // Start a new session
  const sessionId = now.toString();
  const sessions = stored.sessions || [];
  sessions.push({
    id: sessionId,
    startedAt: now,
    endedAt: null,
    timeLog: {},
    boomerangsTotal: 0,
    boomerangsCaught: 0,
  });

  await chrome.storage.local.set({
    tabClassifications: [...permanentEntries, ...userEntries],
    studyModeEnabled:   true,
    hasOnboarded:       true,
    sessions,
    activeSessionId:    sessionId,
  });

  // Close this onboarding tab
  const thisTabs = await chrome.tabs.query({ url: chrome.runtime.getURL('onboarding.html') });
  if (thisTabs.length > 0) {
    chrome.tabs.remove(thisTabs.map(t => t.id));
  }
});

// ─── Expose goTo globally (called by inline onclick) ─────────────────────────
window.goTo = goTo;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function escHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
