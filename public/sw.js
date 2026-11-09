const BASE = new URL('./', self.location.href);
const CACHE_PREFIX = `sotto:${BASE.pathname}:`;
const CACHE = `${CACHE_PREFIX}v0.1.1`;
const localUrl = path => new URL(path, BASE).href;
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const shell = await fetch(BASE.href);
    const html = await shell.clone().text();
    const assets = [...html.matchAll(/(?:src|href)="([^\"]+)"/g)]
      .map(match => new URL(match[1], BASE))
      .filter(url => url.origin === BASE.origin && url.pathname.startsWith(BASE.pathname) && url.pathname.includes('/assets/'))
      .map(url => url.href);
    await cache.put(BASE.href, shell);
    await cache.addAll(['icon.svg', 'manifest.webmanifest', 'scores/julia-florida.sotto.json'].map(localUrl).concat(assets));
  })());
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== BASE.origin || !url.pathname.startsWith(BASE.pathname)) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy))); }
    return response;
  }).catch(async () => (await caches.match(event.request, { ignoreVary: true })) || (event.request.mode === 'navigate' ? await caches.match(BASE.href) : Response.error())));
});
