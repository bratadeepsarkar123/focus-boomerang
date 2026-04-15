document.addEventListener('DOMContentLoaded', async () => {
  // --- DOM Elements ---
  const masterToggle = document.getElementById('master-toggle');

  const studyInput = document.getElementById('study-input');
  const rabbitInput = document.getElementById('rabbit-input');
  const distractionInput = document.getElementById('distraction-input');

  const studyPreview = document.getElementById('study-preview');
  const rabbitPreview = document.getElementById('rabbit-preview');
  const distractionPreview = document.getElementById('distraction-preview');

  const saveBtn = document.getElementById('save-btn');
  const saveMsg = document.getElementById('save-msg');
  const statsContainer = document.getElementById('stats-container');

  const navTabs = document.querySelectorAll('.nav-tab');
  const tabContents = document.querySelectorAll('.tab-content');

  // --- Tab Switching Logic ---
  navTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      navTabs.forEach(t => t.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));

      tab.classList.add('active');
      document.getElementById(tab.getAttribute('data-target')).classList.add('active');
    });
  });

  // Initialization logic and actual implementation will follow...
});

  // --- Utility Functions ---
  function normalizeDomain(inputStr) {
    let str = inputStr.trim().toLowerCase();
    if (!str) return null;

    // Fallback if user doesn't type http
    if (!str.startsWith('http://') && !str.startsWith('https://')) {
      str = 'https://' + str;
    }

    try {
      const u = new URL(str);
      if (!['http:', 'https:'].includes(u.protocol)) return null;
      let hostname = u.hostname;
      if (hostname.startsWith('www.')) hostname = hostname.slice(4);
      return hostname;
    } catch {
      return null;
    }
  }

  function parseDomainsInput(text) {
    if (!text) return [];
    // Split by commas and newlines
    const parts = text.split(/[\n,]+/);
    const domains = parts
      .map(p => normalizeDomain(p))
      .filter(p => p !== null);
    // Deduplicate
    return [...new Set(domains)];
  }

  function updatePreview(inputEl, previewEl) {
    const domains = parseDomainsInput(inputEl.value);
    if (domains.length === 0) {
      previewEl.textContent = '';
    } else {
      previewEl.textContent = 'Parsed: ' + domains.join(', ');
    }
  }

  // Live Previews
  studyInput.addEventListener('input', () => updatePreview(studyInput, studyPreview));
  rabbitInput.addEventListener('input', () => updatePreview(rabbitInput, rabbitPreview));
  distractionInput.addEventListener('input', () => updatePreview(distractionInput, distractionPreview));


  // --- Study Mode Toggle ---
  masterToggle.addEventListener('change', async (e) => {
    const isEnabled = e.target.checked;
    const data = await chrome.storage.local.get(['sessions', 'activeSessionId']);

    if (isEnabled) {
      // Start a new session
      const newSessionId = Date.now().toString();
      const newSession = {
        id: newSessionId,
        startedAt: Date.now(),
        endedAt: null,
        timeLog: {},
        boomerangsTotal: 0,
        boomerangsCaught: 0
      };
      const sessions = data.sessions || [];
      sessions.push(newSession);

      await chrome.storage.local.set({
        studyModeEnabled: true,
        sessions: sessions,
        activeSessionId: newSessionId
      });
    } else {
      // Stop session
      if (data.activeSessionId && data.sessions) {
        const sessions = data.sessions;
        const session = sessions.find(s => s.id === data.activeSessionId);
        if (session && !session.endedAt) {
          session.endedAt = Date.now();
          await chrome.storage.local.set({
             sessions: sessions,
             activeSessionId: null,
             studyModeEnabled: false
          });
        } else {
          await chrome.storage.local.set({ studyModeEnabled: false });
        }
      } else {
        await chrome.storage.local.set({ studyModeEnabled: false });
      }
    }
  });


  // --- Save Logic ---
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    saveMsg.textContent = 'Saving...';

    const studyDomains = parseDomainsInput(studyInput.value);
    const rabbitDomains = parseDomainsInput(rabbitInput.value);
    const distractionDomains = parseDomainsInput(distractionInput.value);

    const data = await chrome.storage.local.get(['tabClassifications']);
    let classifications = data.tabClassifications || [];

    // Remove all non-permanent classifications so we can write the fresh ones
    classifications = classifications.filter(c => c.isPermanent);

    const now = Date.now();

    studyDomains.forEach(url => {
       classifications.push({ url, classification: 'study', setAt: now, isPermanent: false });
    });
    rabbitDomains.forEach(url => {
       classifications.push({ url, classification: 'rabbit_hole', setAt: now, isPermanent: false });
    });
    distractionDomains.forEach(url => {
       classifications.push({ url, classification: 'distraction', setAt: now, isPermanent: false });
    });

    // GUARD #6: Await storage set before showing confirmation
    await chrome.storage.local.set({ tabClassifications: classifications });

    saveMsg.textContent = '✓ Saved';
    saveBtn.disabled = false;
    setTimeout(() => {
      if (saveMsg.textContent === '✓ Saved') saveMsg.textContent = '';
    }, 2000);
  });


  // --- Stats Rendering ---
  function renderStats(sessions, activeSessionId) {
    statsContainer.innerHTML = '';
    if (!activeSessionId) {
       statsContainer.innerHTML = '<div style="color:#aaa;font-size:11px;text-align:center;padding:20px;">Study Mode is currently off.</div>';
       return;
    }

    const session = sessions.find(s => s.id === activeSessionId);
    if (!session || !session.timeLog || Object.keys(session.timeLog).length === 0) {
       statsContainer.innerHTML = '<div style="color:#aaa;font-size:11px;text-align:center;padding:20px;">No data for current session yet.</div>';
       return;
    }

    // Sort and filter: top 20, >5s (5000ms)
    const log = Object.entries(session.timeLog)
      .filter(([_, time]) => time >= 5000)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);

    if (log.length === 0) {
       statsContainer.innerHTML = '<div style="color:#aaa;font-size:11px;text-align:center;padding:20px;">No domains > 5s recorded.</div>';
       return;
    }

    log.forEach(([domain, timeMs]) => {
      const row = document.createElement('div');
      row.className = 'stat-row';

      const domSpan = document.createElement('div');
      domSpan.className = 'stat-domain';
      domSpan.textContent = domain;

      const timeSpan = document.createElement('div');
      timeSpan.className = 'stat-time';

      const seconds = Math.floor(timeMs / 1000);
      const m = Math.floor(seconds / 60);
      const s = seconds % 60;
      const h = Math.floor(m / 60);
      const remainingM = m % 60;

      let timeStr = '';
      if (h > 0) timeStr += `${h}h `;
      if (remainingM > 0 || h > 0) timeStr += `${remainingM}m `;
      timeStr += `${s}s`;

      timeSpan.textContent = timeStr;

      row.appendChild(domSpan);
      row.appendChild(timeSpan);
      statsContainer.appendChild(row);
    });
  }


  // --- Initialization ---
  async function init() {
    const data = await chrome.storage.local.get(['studyModeEnabled', 'tabClassifications', 'sessions', 'activeSessionId']);

    // Toggle
    masterToggle.checked = !!data.studyModeEnabled;

    // Stats
    renderStats(data.sessions || [], data.activeSessionId);

    // Hydrate Textareas
    const classifications = data.tabClassifications || [];
    const studyArr = classifications.filter(c => c.classification === 'study' && !c.isPermanent).map(c => c.url);
    const rabbitArr = classifications.filter(c => c.classification === 'rabbit_hole' && !c.isPermanent).map(c => c.url);
    const distractArr = classifications.filter(c => c.classification === 'distraction' && !c.isPermanent).map(c => c.url);

    studyInput.value = studyArr.join('\n');
    rabbitInput.value = rabbitArr.join('\n');
    distractionInput.value = distractArr.join('\n');

    // Initial Previews
    updatePreview(studyInput, studyPreview);
    updatePreview(rabbitInput, rabbitPreview);
    updatePreview(distractionInput, distractionPreview);
  }

  init();
