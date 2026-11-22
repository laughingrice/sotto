import { dropboxAuth } from './dropbox-auth';
void dropboxAuth.complete().then(() => {
  location.replace(new URL(import.meta.env.BASE_URL, location.href).href + '#dropbox');
}).catch(error => {
  const status = document.querySelector('[role="status"]');
  if (status) status.textContent = error instanceof Error ? error.message : 'Dropbox sign-in failed. Return to Sotto and try again.';
});
