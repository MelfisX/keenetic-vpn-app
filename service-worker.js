const CACHE_NAME = 'keenetic-vpn-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/style.css',
  '/main.js',
  '/renderer.js',
  '/web-api.js',
  '/manifest.json',
  '/icons/icon.png'
];

// Установка Service Worker и кеширование ресурсов
self.addEventListener('install', (event) => {
  console.log('Service Worker: установка');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Service Worker: кеширование ресурсов');
      return cache.addAll(ASSETS_TO_CACHE).catch((err) => {
        console.log('Service Worker: ошибка кеширования', err);
      });
    })
  );
  self.skipWaiting();
});

// Активация Service Worker
self.addEventListener('activate', (event) => {
  console.log('Service Worker: активация');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Service Worker: удаление старого кеша', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Обработка запросов (стратегия: кеш, потом сеть)
self.addEventListener('fetch', (event) => {
  const { request } = event;
  
  // Пропускаем POST и другие небезопасные методы
  if (request.method !== 'GET') {
    return;
  }

  event.respondWith(
    caches.match(request).then((response) => {
      if (response) {
        console.log('Service Worker: из кеша', request.url);
        return response;
      }

      return fetch(request).then((response) => {
        // Не кешируем, если статус 404
        if (!response || response.status !== 200) {
          return response;
        }

        // Клонируем ответ для кеширования
        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(request, responseToCache);
        });

        console.log('Service Worker: из сети', request.url);
        return response;
      }).catch(() => {
        console.log('Service Worker: ошибка сети', request.url);
        return caches.match(request);
      });
    })
  );
});
