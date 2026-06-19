// Enable opening sidepanel on clicking extension icon
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

// Log startup
console.log('🤖 JobHunt Copilot Service Worker initialized.');
