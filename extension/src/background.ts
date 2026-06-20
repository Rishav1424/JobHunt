// Enable opening sidepanel on clicking extension icon
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

// Log startup
console.log('🤖 JobHunt Copilot Service Worker initialized.');

// Listener for application confirmation from content scripts
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'application_confirmed') {
    const { jobId } = message;
    const backendUrl = 'http://localhost:4000'; // Default fallback, next.js rewrites won't apply to background scripts
    
    chrome.storage.local.get(['token'], (result) => {
      const token = result.token;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      
      fetch(`${backendUrl}/api/jobs/${jobId}/status`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ status: 'APPLIED' }),
      })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP error ${res.status}`);
          return res.json();
        })
        .then((data) => {
          console.log('Successfully marked job as APPLIED:', data);
          sendResponse({ success: true });
          
          // Also show a chrome notification
          chrome.notifications.create(`applied-${jobId}`, {
            type: 'basic',
            iconUrl: 'assets/icon48.png', // Assuming it exists
            title: 'Application Confirmed!',
            message: `Your application to ${data.company || 'the job'} has been marked as APPLIED in JobHunt.`,
            priority: 2
          }, () => {});
        })
        .catch((err) => {
          console.error('Failed to update status to APPLIED:', err);
          sendResponse({ success: false, error: err.message });
        });
    });
    return true; // Keep channel open for async response
  }
});

