// Orthos Code Browser Extension - Background Service Worker
let ws = null;
let wsUrl = 'ws://127.0.0.1:18900';
let authToken = '';
let isConnected = false;
let reconnectTimer = null;
let keepAliveTimer = null;

// Load saved config on startup — auto-connect with default token if none saved
chrome.storage.local.get(['wsUrl', 'authToken', 'autoConnect'], (data) => {
  if (data.wsUrl) wsUrl = data.wsUrl;
  authToken = data.authToken || 'orthos-local-dev';
  if (data.autoConnect !== false) connect();
});

function connect() {
  if (ws) {
    try { ws.close(); } catch {}
    ws = null;
  }

  const url = `${wsUrl}?token=${encodeURIComponent(authToken)}`;

  try {
    ws = new WebSocket(url);
  } catch {
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    isConnected = true;
    clearTimeout(reconnectTimer);
    chrome.action.setBadgeText({ text: 'ON' });
    chrome.action.setBadgeBackgroundColor({ color: '#00C853' });
    broadcastState();
    startKeepAlive();
  };

  ws.onclose = () => {
    isConnected = false;
    ws = null;
    stopKeepAlive();
    chrome.action.setBadgeText({ text: 'OFF' });
    chrome.action.setBadgeBackgroundColor({ color: '#FF1744' });
    broadcastState();
    scheduleReconnect();
  };

  ws.onerror = () => {};

  ws.onmessage = async (event) => {
    try {
      const request = JSON.parse(event.data);
      const response = await handleRequest(request);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(response));
      }
    } catch (err) {
      console.error('Failed to handle request:', err);
    }
  };
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  if (authToken) {
    reconnectTimer = setTimeout(connect, 3000);
  }
}

function startKeepAlive() {
  stopKeepAlive();
  keepAliveTimer = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ id: 'keepalive' }));
    }
  }, 20000);
}

function stopKeepAlive() {
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}

// --- Action Handlers ---

async function handleRequest(request) {
  const { id, action, params } = request;

  try {
    let data;
    switch (action) {
      case 'navigate':     data = await handleNavigate(params); break;
      case 'click':        data = await handleClick(params); break;
      case 'type':         data = await handleType(params); break;
      case 'screenshot':   data = await handleScreenshot(); break;
      case 'readDOM':      data = await handleReadDOM(params); break;
      case 'fillForm':     data = await handleFillForm(params); break;
      case 'getTabs':      data = await handleGetTabs(); break;
      case 'executeJS':    data = await handleExecuteJS(params); break;
      case 'waitForSelector': data = await handleWaitForSelector(params); break;
      case 'scrollTo':     data = await handleScrollTo(params); break;
      case 'getPageInfo':  data = await handleGetPageInfo(); break;
      default:
        return { id, success: false, error: `Unknown action: ${action}` };
    }
    return { id, success: true, data };
  } catch (err) {
    return { id, success: false, error: err.message || 'Unknown error' };
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error('No active tab found');
  return tab;
}

async function handleNavigate({ url }) {
  const tab = await getActiveTab();
  await chrome.tabs.update(tab.id, { url });
  // Wait for page to load
  await new Promise((resolve) => {
    const listener = (tabId, changeInfo) => {
      if (tabId === tab.id && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(); }, 30000);
  });
  const updated = await chrome.tabs.get(tab.id);
  return { title: updated.title, url: updated.url };
}

async function handleClick({ selector }) {
  const tab = await getActiveTab();
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (sel) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error(`Element not found: ${sel}`);
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.click();
      return { tagName: el.tagName, text: (el.textContent || '').slice(0, 100) };
    },
    args: [selector],
  });
  if (results[0]?.error) throw new Error(results[0].error.message);
  return results[0]?.result;
}

async function handleType({ selector, text }) {
  const tab = await getActiveTab();
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (sel, txt) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error(`Element not found: ${sel}`);
      el.focus();
      el.value = txt;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { success: true };
    },
    args: [selector, text],
  });
  if (results[0]?.error) throw new Error(results[0].error.message);
  return results[0]?.result;
}

async function handleScreenshot() {
  const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png', quality: 85 });
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  return { base64, format: 'png' };
}

async function handleReadDOM({ selector }) {
  const tab = await getActiveTab();
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (sel) => {
      const el = sel ? document.querySelector(sel) : document.body;
      if (!el) throw new Error(`Element not found: ${sel}`);
      function extractText(node, depth) {
        if (depth > 8) return '';
        if (node.nodeType === Node.TEXT_NODE) return (node.textContent || '').trim();
        if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'IFRAME'].includes(node.tagName)) return '';
        const children = Array.from(node.childNodes).map(c => extractText(c, depth + 1)).filter(Boolean);
        if (children.length === 0) return '';
        const tag = (node.tagName || '').toLowerCase();
        const id = node.id ? `#${node.id}` : '';
        const cls = node.className && typeof node.className === 'string'
          ? '.' + node.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
        const href = node.getAttribute && node.getAttribute('href') ? ` href="${node.getAttribute('href')}"` : '';
        return `<${tag}${id}${cls}${href}>${children.join('\n')}</${tag}>`;
      }
      const text = extractText(el, 0);
      // Truncate to avoid overwhelming the LLM
      return { html: text.slice(0, 50000), url: location.href, title: document.title };
    },
    args: [selector || null],
  });
  if (results[0]?.error) throw new Error(results[0].error.message);
  return results[0]?.result;
}

async function handleFillForm({ fields }) {
  const tab = await getActiveTab();
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (fieldMap) => {
      const filled = [];
      for (const [selector, value] of Object.entries(fieldMap)) {
        const el = document.querySelector(selector);
        if (!el) { filled.push({ selector, success: false, error: 'Not found' }); continue; }
        el.focus();
        el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        filled.push({ selector, success: true });
      }
      return { results: filled };
    },
    args: [fields],
  });
  if (results[0]?.error) throw new Error(results[0].error.message);
  return results[0]?.result;
}

async function handleGetTabs() {
  const tabs = await chrome.tabs.query({});
  return {
    tabs: tabs.map(t => ({ id: t.id, title: t.title, url: t.url, active: t.active })),
  };
}

async function handleExecuteJS({ code }) {
  const tab = await getActiveTab();
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (c) => {
      try {
        const result = eval(c);
        return { result: typeof result === 'object' ? JSON.stringify(result) : String(result) };
      } catch (err) {
        return { error: err.message };
      }
    },
    args: [code],
  });
  if (results[0]?.error) throw new Error(results[0].error.message);
  return results[0]?.result;
}

async function handleWaitForSelector({ selector, timeout = 10000 }) {
  const tab = await getActiveTab();
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (sel, ms) => {
      return new Promise((resolve, reject) => {
        const el = document.querySelector(sel);
        if (el) { resolve({ found: true }); return; }
        const observer = new MutationObserver(() => {
          if (document.querySelector(sel)) {
            observer.disconnect();
            resolve({ found: true });
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => { observer.disconnect(); reject(new Error(`Timeout: ${sel} not found after ${ms}ms`)); }, ms);
      });
    },
    args: [selector, timeout],
  });
  if (results[0]?.error) throw new Error(results[0].error.message);
  return results[0]?.result;
}

async function handleScrollTo({ selector, direction }) {
  const tab = await getActiveTab();
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (sel, dir) => {
      if (sel) {
        const el = document.querySelector(sel);
        if (!el) throw new Error(`Element not found: ${sel}`);
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return { scrolledTo: sel };
      }
      if (dir === 'up') { window.scrollBy(0, -500); return { scrolled: 'up' }; }
      window.scrollBy(0, 500);
      return { scrolled: 'down' };
    },
    args: [selector || null, direction || 'down'],
  });
  if (results[0]?.error) throw new Error(results[0].error.message);
  return results[0]?.result;
}

async function handleGetPageInfo() {
  const tab = await getActiveTab();
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => ({
      url: location.href,
      title: document.title,
      meta: {
        description: document.querySelector('meta[name="description"]')?.getAttribute('content') || '',
        keywords: document.querySelector('meta[name="keywords"]')?.getAttribute('content') || '',
      },
      forms: document.querySelectorAll('form').length,
      links: document.querySelectorAll('a[href]').length,
      inputs: document.querySelectorAll('input, textarea, select').length,
    }),
  });
  if (results[0]?.error) throw new Error(results[0].error.message);
  return results[0]?.result;
}

// --- Chrome runtime messages (popup communication) ---

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'getState') {
    sendResponse({ isConnected, wsUrl, hasToken: !!authToken });
    return true;
  }
  if (msg.type === 'setConfig') {
    if (msg.wsUrl) wsUrl = msg.wsUrl;
    if (msg.authToken) authToken = msg.authToken;
    chrome.storage.local.set({ wsUrl, authToken, autoConnect: true });
    connect();
    sendResponse({ ok: true });
    return true;
  }
  if (msg.type === 'disconnect') {
    clearTimeout(reconnectTimer);
    if (ws) ws.close();
    chrome.storage.local.set({ autoConnect: false });
    sendResponse({ ok: true });
    return true;
  }
  return false;
});

function broadcastState() {
  chrome.runtime.sendMessage({ type: 'stateChanged', isConnected }).catch(() => {});
}
