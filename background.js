// --- Utility Functions ---

function extractBaseDomain(url) {
  try {
    const u = new URL(url);
    if (!['http:', 'https:'].includes(u.protocol)) return null;
    let hostname = u.hostname.toLowerCase();
    if (hostname.startsWith('www.')) hostname = hostname.slice(4);
    return hostname;
  } catch {
    return null;
  }
}

function domainMatches(currentHostname, storedDomain) {
  return currentHostname === storedDomain || currentHostname.endsWith('.' + storedDomain);
}

// --- Hardcoded Rules ---
const PERMANENT_RULES = [
  { url: 'hello.iitk.ac.in',      classification: 'study',   setAt: Date.now(), isPermanent: true },
  { url: 'notebooklm.google.com', classification: 'study',   setAt: Date.now(), isPermanent: true },
  { url: 'music.youtube.com',     classification: 'study',   setAt: Date.now(), isPermanent: true },
  { url: 'firewall.iitk.ac.in',   classification: 'ignored', setAt: Date.now(), isPermanent: true },
  { url: 'gateway.iitk.ac.in',    classification: 'ignored', setAt: Date.now(), isPermanent: true },
  { url: 'webmail.iitk.ac.in',    classification: 'study',   setAt: Date.now(), isPermanent: true },
];

// --- Initialization & Setup ---

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    await chrome.storage.local.set({
      studyModeEnabled: false,
      isGenerating: false,
      activeQueryOriginTabId: null,
      activeQueryOriginWindowId: null,
      activeQueryStartedAt: null,
      pendingQueries: [],
      activeTabDomain: null,
      activeTabSince: null,
      lastStudyTabId: null,
      lastStudyWindowId: null,
      isChromeFocused: true,
      lastNotifiedAt: null,
      sessions: [],
      activeSessionId: null,
      tabClassifications: PERMANENT_RULES,
      rabbitHoleDismissCount: 0,
      rabbitHoleLastDismissedAt: null,
      rabbitHoleTabId: null
    });
  }

  chrome.alarms.create('heartbeat', { periodInMinutes: 1 });
  cleanupOldClassifications();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'heartbeat') {
    await handleHeartbeat();
  } else if (alarm.name === 'observerTimeout') {
    await handleObserverTimeout();
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.studyModeEnabled) {
    const newValue = changes.studyModeEnabled.newValue;
    if (newValue === true) {
      cleanupOldClassifications();

      chrome.storage.local.get(['tabClassifications'], (result) => {
        let classifications = result.tabClassifications || [];
        let modified = false;
        PERMANENT_RULES.forEach(rule => {
          if (!classifications.some(c => c.url === rule.url)) {
            classifications.push(rule);
            modified = true;
          }
        });
        if (modified) chrome.storage.local.set({ tabClassifications: classifications });
      });
    } else {
      chrome.storage.local.get(['sessions', 'activeSessionId'], (res) => {
        if (res.activeSessionId && res.sessions) {
          const sessions = res.sessions;
          const session = sessions.find(s => s.id === res.activeSessionId);
          if (session && !session.endedAt) {
            session.endedAt = Date.now();
            chrome.storage.local.set({ sessions, activeSessionId: null });
          }
        }
      });
    }
  }
});

async function cleanupOldClassifications() {
  const { tabClassifications = [] } = await chrome.storage.local.get(['tabClassifications']);
  const now = Date.now();
  const sixMonths = 180 * 24 * 60 * 60 * 1000;
  const filtered = tabClassifications.filter(c => c.isPermanent || (now - c.setAt) <= sixMonths);
  await chrome.storage.local.set({ tabClassifications: filtered });
}

// --- Window Focus Tracking ---

let focusTimeoutId = null;

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (focusTimeoutId) { clearTimeout(focusTimeoutId); focusTimeoutId = null; }

  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    focusTimeoutId = setTimeout(async () => {
      const data = await chrome.storage.local.get(['activeTabSince', 'activeTabDomain', 'sessions', 'activeSessionId']);
      if (data.activeTabDomain && data.activeTabSince && data.activeSessionId) {
        let sessions = data.sessions || [];
        let activeSession = sessions.find(s => s.id === data.activeSessionId);
        if (activeSession) {
          const delta = Date.now() - data.activeTabSince;
          activeSession.timeLog[data.activeTabDomain] = (activeSession.timeLog[data.activeTabDomain] || 0) + delta;
          await chrome.storage.local.set({ sessions, isChromeFocused: false });
        }
      } else {
        await chrome.storage.local.set({ isChromeFocused: false });
      }
    }, 150);
  } else {
    chrome.storage.local.set({ isChromeFocused: true, activeTabSince: Date.now() });
  }
});

// --- Session Analytics Engine ---

async function commitTime(data) {
  if (!data.activeSessionId || !data.activeTabDomain || !data.activeTabSince || !data.isChromeFocused) return data;
  const delta = Date.now() - data.activeTabSince;
  if (delta < 0) return data;
  const sessions = data.sessions || [];
  const session = sessions.find(s => s.id === data.activeSessionId);
  if (session) {
    session.timeLog[data.activeTabDomain] = (session.timeLog[data.activeTabDomain] || 0) + delta;
  }
  return { ...data, sessions };
}

async function classifyUrl(url, classifications) {
  if (!url) return 'rabbit_hole';
  const fullUrlLower = url.toLowerCase();
  const domain = extractBaseDomain(url);
  if (!domain) return 'ignored';

  const permanentMatch = classifications.find(c => c.isPermanent && domainMatches(domain, c.url));
  if (permanentMatch) return permanentMatch.classification;

  const fullMatch = classifications.find(c => c.url === fullUrlLower);
  if (fullMatch) return fullMatch.classification;

  const domainMatch = classifications.find(c => domainMatches(domain, c.url));
  if (domainMatch) return domainMatch.classification;

  return 'unclassified';
}

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const data = await chrome.storage.local.get([
    'activeTabDomain', 'activeTabSince', 'isChromeFocused',
    'sessions', 'activeSessionId', 'tabClassifications',
    'lastStudyTabId', 'lastStudyWindowId', 'rabbitHoleLastDismissedAt', 'rabbitHoleDismissCount', 'rabbitHoleTabId'
  ]);

  let updates = await commitTime(data);
  const now = Date.now();

  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    const newDomain = extractBaseDomain(tab.url);
    updates.activeTabDomain = newDomain;
    updates.activeTabSince = now;

    const classification = await classifyUrl(tab.url, data.tabClassifications || []);

    if (classification === 'study') {
      updates.lastStudyTabId = activeInfo.tabId;
      updates.lastStudyWindowId = activeInfo.windowId;
    } else if (classification === 'rabbit_hole' || classification === 'unclassified') {
      if (data.rabbitHoleLastDismissedAt && (now - data.rabbitHoleLastDismissedAt < 15000)) {
        updates.rabbitHoleDismissCount = (data.rabbitHoleDismissCount || 0) + 1;
        if (updates.rabbitHoleDismissCount >= 5) {
          updates.rabbitHoleDismissCount = 0;
          updates.rabbitHoleTabId = activeInfo.tabId;
        }
      }
    }

    await chrome.storage.local.set(updates);
  } catch (e) {
    await chrome.storage.local.set(updates);
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.active) {
    const data = await chrome.storage.local.get([
      'activeTabDomain', 'activeTabSince', 'isChromeFocused',
      'sessions', 'activeSessionId', 'tabClassifications'
    ]);
    let updates = await commitTime(data);
    const newDomain = extractBaseDomain(tab.url);
    if (updates.activeTabDomain !== newDomain) {
      updates.activeTabDomain = newDomain;
      updates.activeTabSince = Date.now();
    }
    const classification = await classifyUrl(tab.url, data.tabClassifications || []);
    if (classification === 'study') {
      updates.lastStudyTabId = tabId;
      updates.lastStudyWindowId = tab.windowId;
    } else if (classification === 'unclassified' && newDomain !== null) {
      chrome.tabs.sendMessage(tabId, { action: 'classify_tab' }).catch(() => {});
    }
    await chrome.storage.local.set(updates);
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const data = await chrome.storage.local.get(['lastStudyTabId', 'pendingQueries']);
  let updates = {};
  let changed = false;
  if (data.lastStudyTabId === tabId) {
    updates.lastStudyTabId = null;
    updates.lastStudyWindowId = null;
    changed = true;
  }
  if (data.pendingQueries && data.pendingQueries.length > 0) {
    const filtered = data.pendingQueries.filter(q => q.originTabId !== tabId);
    if (filtered.length !== data.pendingQueries.length) {
      updates.pendingQueries = filtered;
      changed = true;
    }
  }
  if (changed) await chrome.storage.local.set(updates);
});

async function handleHeartbeat() {
  const data = await chrome.storage.local.get([
    'activeTabDomain', 'activeTabSince', 'isChromeFocused', 'sessions', 'activeSessionId',
    'rabbitHoleTabId', 'tabClassifications'
  ]);
  if (!data.activeSessionId) return;
  const updates = await commitTime(data);
  updates.activeTabSince = Date.now();

  if (data.activeTabDomain && data.isChromeFocused) {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, async (tabs) => {
      if (!tabs || tabs.length === 0) return;
      const tab = tabs[0];
      const classification = await classifyUrl(tab.url, data.tabClassifications || []);
      if (classification === 'rabbit_hole' || classification === 'unclassified') {
        const timeSpent = updates.sessions.find(s => s.id === data.activeSessionId)?.timeLog[data.activeTabDomain] || 0;
        if (timeSpent > 300000) updates.rabbitHoleTabId = tab.id;
      }
      chrome.storage.local.set(updates);
    });
  } else {
    await chrome.storage.local.set(updates);
  }
}

// --- Boomerang Execution Sequence ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'gemini_started') {
    handleGeminiStarted(sender);
  } else if (message.action === 'gemini_complete') {
    handleGeminiComplete();
  }
});

async function handleGeminiStarted(sender) {
  const data = await chrome.storage.local.get(['pendingQueries']);
  let pendingQueries = data.pendingQueries || [];
  pendingQueries.push({
    id: Date.now() + '-' + Math.random(),
    originTabId: sender.tab?.id ?? null,
    originWindowId: sender.tab?.windowId ?? null,
    startedAt: Date.now(),
    isSidePanel: sender.tab === undefined
  });
  await chrome.storage.local.set({
    pendingQueries,
    isGenerating: true,
    activeQueryOriginTabId: sender.tab?.id ?? null,
    activeQueryOriginWindowId: sender.tab?.windowId ?? null,
    activeQueryStartedAt: Date.now()
  });
  chrome.alarms.create('observerTimeout', { delayInMinutes: 8 });
}

async function handleObserverTimeout() {
  const data = await chrome.storage.local.get(['isGenerating']);
  if (data.isGenerating) {
    await chrome.storage.local.set({ isGenerating: false });
    chrome.notifications.create({
      type: 'basic', iconUrl: 'icons/icon48.png',
      title: 'Focus Boomerang',
      message: 'Gemini may have finished (timeout reached).'
    });
  }
}

async function handleGeminiComplete() {
  const data = await chrome.storage.local.get([
    'studyModeEnabled', 'isGenerating', 'pendingQueries', 'isChromeFocused',
    'lastStudyTabId', 'lastStudyWindowId', 'tabClassifications', 'lastNotifiedAt',
    'sessions', 'activeSessionId', 'rabbitHoleTabId'
  ]);

  if (!data.studyModeEnabled) return;
  if (!data.isGenerating) return;

  await chrome.storage.local.set({ isGenerating: false });
  chrome.alarms.clear('observerTimeout');

  let pendingQueries = data.pendingQueries || [];
  if (pendingQueries.length === 0) return;
  pendingQueries.sort((a, b) => a.startedAt - b.startedAt);
  const targetQuery = pendingQueries.shift();

  if (!data.isChromeFocused) {
    chrome.notifications.create({
      type: 'basic', iconUrl: 'icons/icon48.png',
      title: 'Focus Boomerang',
      message: 'Gemini is ready in your study tab'
    });
    await chrome.storage.local.set({ pendingQueries });
    return;
  }

  chrome.tabs.query({ active: true, lastFocusedWindow: true }, async (tabs) => {
    if (!tabs || tabs.length === 0) {
      await chrome.storage.local.set({ pendingQueries });
      return;
    }
    const currentTab = tabs[0];

    if (currentTab.discarded) {
      chrome.notifications.create({
        type: 'basic', iconUrl: 'icons/icon48.png',
        title: 'Focus Boomerang',
        message: 'Gemini ready — note: your study tab was reloaded by Chrome'
      });
      await chrome.storage.local.set({ pendingQueries });
      return;
    }

    const currentDomain = extractBaseDomain(currentTab.url);
    if (!currentDomain) {
      await chrome.storage.local.set({ pendingQueries });
      return;
    }

    let classification = await classifyUrl(currentTab.url, data.tabClassifications || []);
    if ((classification === 'rabbit_hole' || classification === 'unclassified') && data.rabbitHoleTabId === currentTab.id) {
      classification = 'distraction';
    }

    const now = Date.now();
    const lastNotifiedAt = data.lastNotifiedAt || 0;
    let sessions = data.sessions || [];
    let activeSession = sessions.find(s => s.id === data.activeSessionId);

    if (classification === 'study') {
      if (now - lastNotifiedAt >= 10000) {
        chrome.notifications.create({
          type: 'basic', iconUrl: 'icons/icon48.png',
          title: 'Focus Boomerang', message: 'Gemini answer is ready ✓'
        });
        await chrome.storage.local.set({ pendingQueries, lastNotifiedAt: now });
      } else {
        await chrome.storage.local.set({ pendingQueries });
      }
      return;
    }

    if (classification === 'ignored') {
      await chrome.storage.local.set({ pendingQueries });
      return;
    }

    if (classification === 'rabbit_hole' || classification === 'unclassified') {
      if (now - lastNotifiedAt >= 10000) {
        chrome.notifications.create({
          type: 'basic', iconUrl: 'icons/icon48.png',
          title: 'Focus Boomerang',
          message: "Gemini is done — come back when you're ready"
        });
        await chrome.storage.local.set({ pendingQueries, lastNotifiedAt: now, rabbitHoleLastDismissedAt: now });
      } else {
        await chrome.storage.local.set({ pendingQueries });
      }
      if (classification === 'unclassified') {
        chrome.tabs.sendMessage(currentTab.id, { action: 'classify_tab' }).catch(() => {});
      }
      return;
    }

    // Distraction path
    if (activeSession) {
      activeSession.boomerangsTotal = (activeSession.boomerangsTotal || 0) + 1;
      activeSession.boomerangsCaught = (activeSession.boomerangsCaught || 0) + 1;
    }

    let target = null;
    if (targetQuery.isSidePanel === false && targetQuery.originTabId) {
      target = { tabId: targetQuery.originTabId, windowId: targetQuery.originWindowId };
    } else if (data.lastStudyTabId) {
      try {
        const studyTab = await chrome.tabs.get(data.lastStudyTabId);
        target = { tabId: studyTab.id, windowId: data.lastStudyWindowId || studyTab.windowId };
      } catch (e) {
        await chrome.storage.local.set({ lastStudyTabId: null, lastStudyWindowId: null });
      }
    }

    if (!target) {
      chrome.notifications.create({
        type: 'basic', iconUrl: 'icons/icon48.png',
        title: 'Focus Boomerang',
        message: 'Gemini is ready — return to your study tab'
      });
      await chrome.storage.local.set({ pendingQueries, sessions });
      return;
    }

    try {
      await chrome.scripting.executeScript({
        target: { tabId: currentTab.id },
        func: () => {
          const vid = document.querySelector('video');
          if (vid) vid.pause();

          const overlay = document.createElement('div');
          overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.5);backdrop-filter:blur(8px);z-index:999999;display:flex;flex-direction:column;align-items:center;justify-content:center;color:white;font-family:sans-serif;';

          const text    = document.createElement('h1');
          text.textContent = 'Gemini finished answering';
          const subtext = document.createElement('p');
          subtext.textContent = 'Going back to your study tab…';
          const btn     = document.createElement('button');
          btn.textContent = 'Stay here';
          btn.style.cssText = 'margin-top:20px;padding:10px 20px;font-size:16px;cursor:pointer;border-radius:8px;border:none;background:#fff;color:#111;';
          btn.addEventListener('click', () => overlay.remove());

          overlay.appendChild(text);
          overlay.appendChild(subtext);
          overlay.appendChild(btn);
          document.body.appendChild(overlay);
        }
      }).catch(() => {});

      await chrome.tabs.update(target.tabId, { active: true });
      if (target.windowId) await chrome.windows.update(target.windowId, { focused: true });
    } catch (e) {
      // target tab died
    }

    await chrome.storage.local.set({ pendingQueries, sessions });
  });
}
