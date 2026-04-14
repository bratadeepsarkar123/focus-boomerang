// --- Injection Guard ---
if (!window.__focusBoomerangInjected) {
  window.__focusBoomerangInjected = true;

  // --- State Variables ---
  let observerAttached = false;
  let isCurrentlyGenerating = false;
  let level1Observer = null;
  let level2Observer = null;
  let signalCDebounceTimer = null;
  let currentChatContainer = null;

  // --- Message Listener for UI Injections ---
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'show_boomerang_toast') {
      showBoomerangToast();
    } else if (message.action === 'show_distraction_overlay') {
      showDistractionOverlay();
    } else if (message.action === 'classify_tab') {
      // Classification bar (defer detailed implementation as per spec, just mock UI for now)
      showClassificationBar();
    }
  });

  function showBoomerangToast() {
    const toast = document.createElement('div');
    toast.style.position = 'fixed';
    toast.style.bottom = '20px';
    toast.style.right = '20px';
    toast.style.padding = '12px 24px';
    toast.style.backgroundColor = '#333';
    toast.style.color = 'white';
    toast.style.borderRadius = '8px';
    toast.style.zIndex = '999999';
    toast.style.fontFamily = 'sans-serif';
    toast.textContent = 'Gemini finished answering.';
    document.body.appendChild(toast);
    setTimeout(() => {
      if (toast.parentNode) toast.remove();
    }, 4000);
  }

  function showDistractionOverlay() {
    const vid = document.querySelector('video');
    if (vid) vid.pause();

    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.backgroundColor = 'rgba(0,0,0,0.5)';
    overlay.style.backdropFilter = 'blur(8px)';
    overlay.style.zIndex = '999999';
    overlay.style.display = 'flex';
    overlay.style.flexDirection = 'column';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.color = 'white';
    overlay.style.fontFamily = 'sans-serif';

    const text = document.createElement('h1');
    text.textContent = 'Gemini finished answering';

    const subtext = document.createElement('p');
    subtext.textContent = 'Going back...';

    const btn = document.createElement('button');
    btn.textContent = 'Go Back';
    btn.style.marginTop = '20px';
    btn.style.padding = '10px 20px';
    btn.style.fontSize = '16px';
    btn.style.cursor = 'pointer';
    btn.onclick = () => overlay.remove();

    overlay.appendChild(text);
    overlay.appendChild(subtext);
    overlay.appendChild(btn);
    document.body.appendChild(overlay);
  }

  function showClassificationBar() {
    // Basic mock of classification bar for Phase 2/Popup
    const bar = document.createElement('div');
    bar.style.position = 'fixed';
    bar.style.top = '0';
    bar.style.left = '0';
    bar.style.width = '100vw';
    bar.style.padding = '8px';
    bar.style.backgroundColor = '#ffeb3b';
    bar.style.color = '#000';
    bar.style.zIndex = '999999';
    bar.style.textAlign = 'center';
    bar.style.fontFamily = 'sans-serif';
    bar.textContent = 'Is this a Study tab or a Distraction?';

    const close = document.createElement('span');
    close.textContent = ' ✕';
    close.style.cursor = 'pointer';
    close.onclick = () => bar.remove();
    bar.appendChild(close);

    document.body.appendChild(bar);
  }

  // --- Two-Level Observer Strategy ---

  function startLevel1Observer() {
    if (observerAttached) return;

    level1Observer = new MutationObserver((mutations) => {
      // Find the chat container
      let container = document.querySelector('[role="main"]');
      if (!container) {
        // Fallback: look for aria-label containing "chat" or "conversation"
        const potentialContainers = document.querySelectorAll('[aria-label]');
        for (const el of potentialContainers) {
          const label = el.getAttribute('aria-label').toLowerCase();
          if (label.includes('chat') || label.includes('conversation')) {
            container = el;
            break;
          }
        }
      }

      if (container) {
        level1Observer.disconnect();
        level1Observer = null;
        observerAttached = true;
        currentChatContainer = container;
        startLevel2Observer(container);
      }
    });

    level1Observer.observe(document.body, { childList: true, subtree: true });
  }

  function startLevel2Observer(container) {
    level2Observer = new MutationObserver(handleLevel2Mutations);
    level2Observer.observe(container, { childList: true, subtree: true });
  }

  // --- Generation Signals Logic ---

  function handleLevel2Mutations(mutations) {
    // SPA Re-trigger Rule: check if container itself was removed
    if (!document.body.contains(currentChatContainer)) {
      if (level2Observer) level2Observer.disconnect();
      level2Observer = null;
      observerAttached = false;
      currentChatContainer = null;
      isCurrentlyGenerating = false;
      startLevel1Observer();
      return;
    }

    for (const mutation of mutations) {
      // Look for Signal A (Start) and Signal B (Complete)
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {

          // Signal A: "Stop" button appears
          if (!isCurrentlyGenerating) {
             const stopButton = findAriaElement(node, 'role', 'button', 'aria-label', 'stop');
             if (stopButton) {
               isCurrentlyGenerating = true;
               chrome.runtime.sendMessage({ action: 'gemini_started' }).catch(() => {});
             }
          }

          // Signal B: "Copy" or "Thumb up" / "Good response" appears
          if (isCurrentlyGenerating) {
             const copyOrThumb = findAriaElementMatch(node, 'aria-label', ['copy', 'thumb up', 'good response']);
             if (copyOrThumb) {
                // Verify it's in the latest response container
                const responses = currentChatContainer.querySelectorAll('[data-message-author-role="model"]');
                if (responses.length > 0) {
                   const latestResponse = responses[responses.length - 1];
                   if (latestResponse.contains(copyOrThumb)) {
                       isCurrentlyGenerating = false;
                       if (signalCDebounceTimer) clearTimeout(signalCDebounceTimer);
                       chrome.runtime.sendMessage({ action: 'gemini_complete' }).catch(() => {});
                   }
                }
             }
          }

          // Error check
          const alertNode = findAriaElement(node, 'role', 'alert');
          if (alertNode && isCurrentlyGenerating) {
              isCurrentlyGenerating = false;
              if (signalCDebounceTimer) clearTimeout(signalCDebounceTimer);
              chrome.runtime.sendMessage({ action: 'gemini_error' }).catch(() => {});
          }
        }
      }

      // Look for Signal C (Cancelled/Error via Stop disappearance)
      for (const node of mutation.removedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          if (isCurrentlyGenerating) {
             const stopButton = findAriaElement(node, 'role', 'button', 'aria-label', 'stop');
             if (stopButton) {
                // Debounce 500ms to see if Signal B arrives
                if (signalCDebounceTimer) clearTimeout(signalCDebounceTimer);
                signalCDebounceTimer = setTimeout(() => {
                   if (isCurrentlyGenerating) {
                      isCurrentlyGenerating = false;
                      chrome.runtime.sendMessage({ action: 'gemini_cancelled' }).catch(() => {});
                   }
                }, 500);
             }
          }
        }
      }
    }
  }

  // --- ARIA Utility Finders (NO CSS CLASS SELECTORS) ---

  function findAriaElement(root, attr1, val1, attr2, val2) {
    // Check root itself
    if (root.getAttribute(attr1) === val1) {
        if (!attr2) return root;
        const v2 = root.getAttribute(attr2);
        if (v2 && v2.toLowerCase().includes(val2)) return root;
    }

    // Check descendants using querySelector
    let selector = `[${attr1}="${val1}"]`;
    if (attr2) {
       // Since val2 can be a substring, we can't use exact match in querySelector,
       // but we can just find all by attr1 and filter, or use attribute *= selector.
       // The spec says case-insensitive "includes", so we iterate.
       const candidates = root.querySelectorAll(selector);
       for (const el of candidates) {
           const label = el.getAttribute(attr2);
           if (label && label.toLowerCase().includes(val2)) return el;
       }
       return null;
    } else {
       return root.querySelector(selector);
    }
  }

  function findAriaElementMatch(root, attr, possibleValues) {
     const v = root.getAttribute(attr);
     if (v) {
         const lower = v.toLowerCase();
         for (const p of possibleValues) {
             if (lower.includes(p)) return root;
         }
     }

     const candidates = root.querySelectorAll(`[${attr}]`);
     for (const el of candidates) {
         const label = el.getAttribute(attr).toLowerCase();
         for (const p of possibleValues) {
             if (label.includes(p)) return el;
         }
     }
     return null;
  }

  // Start the process
  startLevel1Observer();
}
