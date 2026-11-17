const BASE = new URL('./', self.location.href);
const CACHE_PREFIX = `sotto:${BASE.pathname}:`;
const CACHE = `${CACHE_PREFIX}v0.3.10`;
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
    await cache.addAll(['icon.svg', 'manifest.webmanifest', 'rhythm-worklet.js', 'scores/samples/carcassi.sotto', 'scores/samples/catalog.json'].map(localUrl).concat(assets));
    const manifestResponse = await fetch(localUrl('samples/manifest.json'));
    if (!manifestResponse.ok) throw new Error('Instrument recordings could not be cached.');
    const manifest = await manifestResponse.clone().json();
    await cache.put(localUrl('samples/manifest.json'), manifestResponse);
    await cache.addAll(manifest.files.map(file => localUrl(`samples/${file.path}`)));
  })());
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== BASE.origin || !url.pathname.startsWith(BASE.pathname)) return;
  // Download library scores only on demand. The app's IndexedDB resume slot
  // stores one song; Cache Storage must not silently retain the entire library.
  if ((/\.sotto(?:\.json)?$/i.test(url.pathname) && url.href !== localUrl('scores/samples/carcassi.sotto')) || url.pathname.endsWith('-source.zip')) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy))); }
    return response;
  }).catch(async () => (await caches.match(event.request, { ignoreVary: true })) || (event.request.mode === 'navigate' ? await caches.match(BASE.href) : Response.error())));
});
