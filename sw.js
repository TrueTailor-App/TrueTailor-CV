/* =========================================================================
   TrueTailor CV — service worker

   WHY NETWORK FIRST AND NOT THE USUAL CACHE FIRST

   The textbook service worker serves the cached page instantly and refreshes it
   in the background, so the visitor sees the previous version once and the new
   one on the visit after that. For most sites that is a fair trade. Here it is
   not: this app ships as one file, several times a week, and a stale copy would
   mean somebody running an old scoring engine while believing they are on the
   current one, with no way to tell and nothing on screen that looks wrong.

   So anything from this origin is fetched from the network first, and the cache
   is only the fallback for when the network is not there. Online, you are always
   on the version that was deployed last. Offline, you get the last one you
   loaded, which is the whole point of installing it.

   The libraries are the opposite case and get the opposite rule. Their URLs
   carry a version number, so a given URL always answers with the same bytes and
   can be trusted from the cache for ever. That is where the speed comes from.

   Nothing that involves the API is touched. Requests to Google are not
   intercepted, not cached and not replayed: this worker never sees a resume.
   ========================================================================= */

var SHELL = 'tt-shell-v1';        /* this origin: network first, cache as fallback */
var LIBS  = 'tt-libs-v1';         /* version pinned third party files: cache first */

/* The libraries the page needs before it can do anything. Fetched on install so
   that the first offline open works rather than the second. A failure here must
   not fail the install: a worker that refuses to install leaves the visitor with
   no offline copy at all, which is worse than an incomplete one. */
var PRECACHE_LIBS = [
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
];

self.addEventListener('install', function (ev) {
  self.skipWaiting();
  ev.waitUntil(
    caches.open(LIBS).then(function (c) {
      return Promise.all(PRECACHE_LIBS.map(function (u) {
        return c.add(new Request(u, { mode: 'no-cors' }))['catch'](function () {});
      }));
    })['catch'](function () {})
  );
});

self.addEventListener('activate', function (ev) {
  ev.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.map(function (n) {
        if (n !== SHELL && n !== LIBS) return caches['delete'](n);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (ev) {
  var req = ev.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (e) { return; }

  /* Never anywhere near the model, the analytics or anything else that carries
     content. Only this origin and the four libraries are handled at all. */
  var sameOrigin = url.origin === self.location.origin;
  var isLib = PRECACHE_LIBS.some(function (u) { return req.url.indexOf(u) === 0; });
  if (!sameOrigin && !isLib) return;

  if (isLib) {
    ev.respondWith(
      caches.match(req).then(function (hit) {
        if (hit) return hit;
        return fetch(req).then(function (res) {
          var copy = res.clone();
          caches.open(LIBS).then(function (c) { c.put(req, copy); })['catch'](function () {});
          return res;
        });
      })
    );
    return;
  }

  ev.respondWith(
    fetch(req).then(function (res) {
      /* Only a real answer is worth keeping. An error page cached here would be
         served as the app for as long as the visitor stayed offline. */
      if (res && res.ok && res.type === 'basic') {
        var copy = res.clone();
        caches.open(SHELL).then(function (c) { c.put(req, copy); })['catch'](function () {});
      }
      return res;
    })['catch'](function () {
      return caches.match(req).then(function (hit) {
        if (hit) return hit;
        /* A navigation that misses still has somewhere to land: the page itself,
           which is the only document this site has. */
        if (req.mode === 'navigate') return caches.match('./');
        return Response.error();
      });
    })
  );
});
