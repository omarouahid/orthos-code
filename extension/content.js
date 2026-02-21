// Orthos Code Browser Extension - Content Script
// Actions are handled via chrome.scripting.executeScript from the background service worker.
// This script is a placeholder for future enhancements like element highlighting.

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'ping') {
    sendResponse({ pong: true, url: window.location.href });
  }
  return true;
});
