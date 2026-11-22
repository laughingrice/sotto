import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const option = process.argv.indexOf('--chrome');
const browser = await chromium.launch({ headless: true, executablePath: option < 0 ? process.env.CHROME_PATH : process.argv[option + 1] });
try {
  const page = await browser.newPage(); const base = process.env.BASE_URL || 'http://localhost:4186/sotto/';
  await page.goto(base); await page.getByRole('heading', { name: 'Étude Op. 60 No. 1', exact: true }).waitFor();
  await page.evaluate(() => navigator.serviceWorker.ready);
  const results = await page.evaluate(async () => {
    const callbacks = ['redirect.html', 'dropbox-redirect.html'];
    for (const path of callbacks) {
      const result = await fetch(`${path}?code=synthetic-test-code&state=invalid`);
      if (!result.ok || !(await result.text()).includes('/sotto/assets/')) throw new Error('Production callback missing its built entry');
    }
    const keys = await caches.keys();
    const urls = (await Promise.all(keys.map(async key => (await (await caches.open(key)).keys()).map(request => request.url)))).flat();
    return { keys, urls };
  });
  assert.ok(results.keys.some(key => key.endsWith('v0.5.7')));
  assert.ok(!results.urls.some(url => /\/(?:dropbox-)?redirect\.html/.test(url)), 'OAuth callbacks must never be cached');
  await page.goto(new URL('dropbox-redirect.html?code=synthetic-test-code&state=invalid', base).href);
  await page.getByRole('status').filter({ hasText: 'Dropbox sign-in expired' }).waitFor(); assert.ok(!page.url().includes('code='));
  console.log('PASS: production /sotto/ callbacks exist, the service worker excludes both OAuth callback URLs, and invalid Dropbox authorization is stripped/rejected.');
} finally { await browser.close(); }
