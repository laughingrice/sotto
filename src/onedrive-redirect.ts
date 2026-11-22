import { broadcastResponseToMainFrame } from '@azure/msal-browser/redirect-bridge';
void broadcastResponseToMainFrame().catch(() => {
  document.body.textContent = 'Microsoft sign-in could not be completed. Return to Sotto and try Sign in to OneDrive again.';
});
