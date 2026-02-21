const statusEl = document.getElementById('status');
const tokenInput = document.getElementById('token');
const urlInput = document.getElementById('url');
const connectBtn = document.getElementById('connectBtn');
const disconnectBtn = document.getElementById('disconnectBtn');

// Load state
chrome.runtime.sendMessage({ type: 'getState' }, (state) => {
  if (state) {
    updateUI(state.isConnected);
    if (state.wsUrl) urlInput.value = state.wsUrl;
  }
});

chrome.storage.local.get(['authToken', 'wsUrl'], (data) => {
  if (data.authToken) tokenInput.value = data.authToken;
  if (data.wsUrl) urlInput.value = data.wsUrl;
});

connectBtn.addEventListener('click', () => {
  const token = tokenInput.value.trim();
  const url = urlInput.value.trim();
  if (!token) { statusEl.textContent = 'Please enter a token'; return; }
  chrome.runtime.sendMessage({ type: 'setConfig', authToken: token, wsUrl: url });
});

disconnectBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'disconnect' });
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'stateChanged') updateUI(msg.isConnected);
});

function updateUI(connected) {
  statusEl.textContent = connected ? 'Connected to Orthos Code' : 'Disconnected';
  statusEl.className = `status ${connected ? 'connected' : 'disconnected'}`;
}
