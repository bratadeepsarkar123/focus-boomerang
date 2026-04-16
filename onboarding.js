// Utility: Normalize a single URL string (reused from popup.js)
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

// Update live previews
function updatePreview(textarea, previewEl) {
  const domains = parseDomainsInput(textarea.value);
  previewEl.textContent = domains.length ? domains.join(', ') : 'None';
}

const studyTextarea = document.getElementById('study-domains');
const rabbitTextarea = document.getElementById('rabbit-domains');
const distractionTextarea = document.getElementById('distraction-domains');

const studyPreview = document.getElementById('study-preview');
const rabbitPreview = document.getElementById('rabbit-preview');
const distractionPreview = document.getElementById('distraction-preview');

studyTextarea.addEventListener('input', () => updatePreview(studyTextarea, studyPreview));
rabbitTextarea.addEventListener('input', () => updatePreview(rabbitTextarea, rabbitPreview));
distractionTextarea.addEventListener('input', () => updatePreview(distractionTextarea, distractionPreview));

// Navigation Logic
let currentStep = 1;
const totalSteps = 5;

function showStep(step) {
  // Hide all steps
  for (let i = 1; i <= totalSteps; i++) {
    document.getElementById(`step-${i}`).classList.remove('active');
  }
  // Show target step
  document.getElementById(`step-${step}`).classList.add('active');

  // Update dots
  const dots = document.querySelectorAll('.dot');
  dots.forEach((dot, index) => {
    if (index < step) {
      dot.classList.add('active');
    } else {
      dot.classList.remove('active');
    }
  });
}

// Save specific step domains to storage
async function saveStepData(type, textarea) {
  const domains = parseDomainsInput(textarea.value);
  const data = await chrome.storage.local.get(['tabClassifications']);
  const existing = data.tabClassifications || [];

  // Remove existing classifications of this type that are not permanent
  const filtered = existing.filter(c => c.classification !== type || c.isPermanent);

  const now = Date.now();
  domains.forEach(domain => {
    filtered.push({ url: domain, classification: type, setAt: now, isPermanent: false });
  });

  // Guard #6: Always await chrome.storage.local.set() before proceeding
  await chrome.storage.local.set({ tabClassifications: filtered });
}

// Event Listeners for Navigation
document.getElementById('next-1').addEventListener('click', () => {
  currentStep = 2;
  showStep(currentStep);
});

document.getElementById('back-2').addEventListener('click', () => {
  currentStep = 1;
  showStep(currentStep);
});

document.getElementById('next-2').addEventListener('click', async () => {
  await saveStepData('study', studyTextarea);
  currentStep = 3;
  showStep(currentStep);
});

document.getElementById('back-3').addEventListener('click', () => {
  currentStep = 2;
  showStep(currentStep);
});

document.getElementById('next-3').addEventListener('click', async () => {
  await saveStepData('rabbit_hole', rabbitTextarea);
  currentStep = 4;
  showStep(currentStep);
});

document.getElementById('back-4').addEventListener('click', () => {
  currentStep = 3;
  showStep(currentStep);
});

document.getElementById('next-4').addEventListener('click', async () => {
  await saveStepData('distraction', distractionTextarea);
  currentStep = 5;
  showStep(currentStep);
});

document.getElementById('back-5').addEventListener('click', () => {
  currentStep = 4;
  showStep(currentStep);
});

// Final Finish Button
document.getElementById('finish-btn').addEventListener('click', async () => {
  const data = await chrome.storage.local.get(['sessions', 'activeSessionId']);
  let updates = {
    studyModeEnabled: true,
    hasOnboarded: true
  };

  // Start a session if one doesn't exist
  if (!data.activeSessionId) {
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
  }

  // Guard #6: Always await chrome.storage.local.set()
  await chrome.storage.local.set(updates);

  // Close the onboarding tab
  chrome.tabs.getCurrent((tab) => {
    if (tab && tab.id) {
      chrome.tabs.remove(tab.id);
    }
  });
});
