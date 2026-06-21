// Enable opening sidepanel on clicking extension icon
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

// Log startup
console.log('🤖 JobHunt Copilot Service Worker initialized.');

// Listen for tab updates to auto-open the side panel
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    chrome.tabs.sendMessage(tabId, { action: 'check_jh_pending' }, (response) => {
      if (chrome.runtime.lastError || !response?.jobId) return;

      // Auto-open sidepanel for this tab
      console.log(`Auto-opening sidepanel for tab ${tabId} with jobId ${response.jobId}`);
      chrome.sidePanel.open({ tabId }).catch((err) => {
        console.error('Failed to open sidePanel:', err);
      });
    });
  }
});

/**
 * Fetch the latest email OTP code from Gmail using OAuth
 */
async function fetchLatestGmailOTP(): Promise<string | null> {
  return new Promise((resolve) => {
    chrome.identity.getAuthToken({ interactive: true }, async (token) => {
      if (chrome.runtime.lastError || !token) {
        console.error('Failed to get Google OAuth token:', chrome.runtime.lastError);
        resolve(null);
        return;
      }

      try {
        const query = 'subject:(verification OR OTP OR code) newer_than:5m';
        const listRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=3`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!listRes.ok) throw new Error(`List messages failed: ${listRes.statusText}`);
        const listData = await listRes.json();
        if (!listData.messages || listData.messages.length === 0) {
          resolve(null);
          return;
        }

        // Fetch details of the latest message
        const messageId = listData.messages[0].id;
        const msgRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!msgRes.ok) throw new Error(`Get message failed: ${msgRes.statusText}`);
        const msgData = await msgRes.json();

        // Extract body text
        let body = msgData.snippet || '';
        if (msgData.payload) {
          const getBodyText = (part: any): string => {
            if (part.body && part.body.data) {
              return atob(part.body.data.replace(/-/g, '+').replace(/_/g, '/'));
            }
            if (part.parts) {
              return part.parts.map(getBodyText).join('\n');
            }
            return '';
          };
          body += '\n' + getBodyText(msgData.payload);
        }

        // Match 4-8 digit numeric code
        const otpMatch = body.match(/\b(\d{4,8})\b/);
        if (otpMatch) {
          resolve(otpMatch[1]);
        } else {
          resolve(null);
        }
      } catch (err) {
        console.error('Error fetching Gmail OTP:', err);
        resolve(null);
      }
    });
  });
}

/**
 * Fetch the latest email verification or magic link from Gmail using OAuth
 */
async function fetchLatestVerificationLink(): Promise<string | null> {
  return new Promise((resolve) => {
    chrome.identity.getAuthToken({ interactive: true }, async (token) => {
      if (chrome.runtime.lastError || !token) {
        console.error('Failed to get Google OAuth token for verification link:', chrome.runtime.lastError);
        resolve(null);
        return;
      }

      try {
        const query = 'subject:(verify OR verification OR confirm OR activate OR "magic link") newer_than:5m';
        const listRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=3`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!listRes.ok) throw new Error(`List messages failed: ${listRes.statusText}`);
        const listData = await listRes.json();
        if (!listData.messages || listData.messages.length === 0) {
          resolve(null);
          return;
        }

        // Fetch details of the latest message
        const messageId = listData.messages[0].id;
        const msgRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!msgRes.ok) throw new Error(`Get message failed: ${msgRes.statusText}`);
        const msgData = await msgRes.json();

        // Extract body text
        let body = msgData.snippet || '';
        if (msgData.payload) {
          const getBodyText = (part: any): string => {
            if (part.body && part.body.data) {
              return atob(part.body.data.replace(/-/g, '+').replace(/_/g, '/'));
            }
            if (part.parts) {
              return part.parts.map(getBodyText).join('\n');
            }
            return '';
          };
          body += '\n' + getBodyText(msgData.payload);
        }

        // Extract all HTTP/HTTPS links
        const urlRegex = /https?:\/\/[^\s"'<>]+/g;
        const matches = body.match(urlRegex);
        if (!matches) {
          resolve(null);
          return;
        }

        // Find the most likely verification link
        const verificationLink = matches.find((url: string) =>
          /verify|confirm|activate|magic|login|signin/i.test(url) &&
          !/unsubscribe|google|facebook|twitter|linkedin/i.test(url)
        );

        resolve(verificationLink || null);
      } catch (err) {
        console.error('Error fetching Gmail verification link:', err);
        resolve(null);
      }
    });
  });
}

// Listener for application confirmation and other actions
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'set_pending_job' && sender.tab?.id) {
    chrome.storage.session.set({ [`pending_job_${sender.tab.id}`]: message.jobId }).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.action === 'get_gmail_otp') {
    fetchLatestGmailOTP().then((otp) => {
      sendResponse({ otp });
    });
    return true;
  }

  if (message.action === 'get_gmail_verification') {
    fetchLatestVerificationLink().then((url) => {
      sendResponse({ url });
    });
    return true;
  }

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
          }, () => { });
        })
        .catch((err) => {
          console.error('Failed to update status to APPLIED:', err);
          sendResponse({ success: false, error: err.message });
        });
    });
    return true; // Keep channel open for async response
  }
});

