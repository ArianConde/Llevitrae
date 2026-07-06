/**
 * LLevitrae — Service Worker
 * Estrategia: Cache-First para assets estáticos,
 *             Network-First para Supabase y APIs externas,
 *             Offline fallback para páginas de la app.
 */

const APP_VERSION  = 'v1.0.0';
const CACHE_STATIC = `llevitrae-static-${APP_VERSION}`;
const CACHE_PAGES  = `llevitrae-pages-${APP_VERSION}`;

/* ── Assets que se precargan en la instalación ── */
const PRECACHE = [
  './',
  './index.html',
  './cliente.html',
  './repartidor.html',
  './estilos.css',
  './manifest.json',
  /* Fuentes e iconos */
  'https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap',
  'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@latest/tabler-icons.min.css',
];

/* ── Dominios que NUNCA se cachean (tiempo real) ── */
const BYPASS = [
  'supabase.co',
  'brevo.com',
  'emailjs.com',
  'nominatim.openstreetmap.org',  // geocoder — siempre fresco
];

/* ════════════════════════════════════════════
   INSTALL — precachear shell de la app
════════════════════════════════════════════ */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_STATIC).then(cache => {
      return cache.addAll(PRECACHE.map(url => {
        /* Para URLs absolutas (CDN), usar { url, mode: 'no-cors' }
           para evitar errores CORS en la caché */
        if (url.startsWith('http')) {
          return new Request(url, { mode: 'no-cors' });
        }
        return url;
      }));
    }).catch(err => console.warn('[SW] Error en precaché:', err))
  );
  self.skipWaiting(); // activar inmediatamente
});

/* ════════════════════════════════════════════
   ACTIVATE — limpiar cachés viejas
════════════════════════════════════════════ */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_STATIC && k !== CACHE_PAGES)
          .map(k => {
            console.log('[SW] Borrando caché vieja:', k);
            return caches.delete(k);
          })
      )
    )
  );
  self.clients.claim(); // tomar control de todas las pestañas
});

/* ════════════════════════════════════════════
   FETCH — estrategia por tipo de recurso
════════════════════════════════════════════ */
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  /* 1. Ignorar métodos no-GET */
  if (request.method !== 'GET') return;

  /* 2. Bypasear dominios de tiempo real */
  if (BYPASS.some(domain => url.hostname.includes(domain))) {
    return; // deja que el browser lo maneje
  }

  /* 3. Páginas HTML de la app → Network-First con fallback */
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstPage(request));
    return;
  }

  /* 4. Assets estáticos (CSS, JS, imágenes, fuentes) → Cache-First */
  event.respondWith(cacheFirst(request));
});

/* ── Network-First para navegación ── */
async function networkFirstPage(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_PAGES);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    /* Sin red: devolver la página cacheada */
    const cached = await caches.match(request);
    if (cached) return cached;
    /* Último recurso: index.html como shell offline */
    return caches.match('./index.html');
  }
}

/* ── Cache-First para assets ── */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok || response.type === 'opaque') {
      const cache = await caches.open(CACHE_STATIC);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    console.warn('[SW] Sin red y sin caché:', request.url);
    /* Para imágenes offline, devolver SVG placeholder */
    if (request.destination === 'image') {
      return new Response(
        '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#e5e7eb"/></svg>',
        { headers: { 'Content-Type': 'image/svg+xml' } }
      );
    }
    return new Response('Offline', { status: 503 });
  }
}

/* ════════════════════════════════════════════
   BACKGROUND SYNC — reintento de pedidos fallidos
   (si el navegador lo soporta)
════════════════════════════════════════════ */
self.addEventListener('sync', event => {
  if (event.tag === 'sync-orders') {
    event.waitUntil(syncPendingOrders());
  }
});

async function syncPendingOrders() {
  /* Placeholder: aquí se procesaría la cola de pedidos
     guardados en IndexedDB mientras no había red */
  console.log('[SW] Background sync: sync-orders');
}

/* ════════════════════════════════════════════
   PUSH NOTIFICATIONS (base lista para activar)
════════════════════════════════════════════ */
self.addEventListener('push', event => {
  if (!event.data) return;
  let payload;
  try { payload = event.data.json(); }
  catch { payload = { title: 'LLevitrae', body: event.data.text() }; }

  const options = {
    body: payload.body || '¡Tienes una notificación!',
    icon: './assets/llevitrae.png',
    badge: './assets/llevitrae.png',
    vibrate: [200, 100, 200],
    data: payload.data || {},
    actions: payload.actions || [],
  };
  event.waitUntil(
    self.registration.showNotification(payload.title || 'LLevitrae', options)
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || './index.html';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.includes(url) && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
