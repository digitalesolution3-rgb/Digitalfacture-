// sw.js — Service Worker DigitalFacture Pro
const CACHE_NAME = "digitalfacture-v3";

const urlsToCache = [
    "/",
    "/index.html",
    "/manifest.json",
    "/config.js",
    "/css/style.css",
    "/js/supabase_client.js",
    "/js/auth.js",
    "/js/sync.js",
    "/js/utils.js",
    "/js/facture.js",
    "/js/app.js",
    "/js/dev.js"
    // NE PAS cacher le CDN Tailwind ni Supabase SDK (URLs externes)
];

self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(urlsToCache))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", event => {
    if (event.request.method !== "GET") return;

    // Ne pas intercepter les requêtes Supabase (API, Realtime, Edge Functions)
    const url = event.request.url;
    if (url.includes("supabase.co") || url.includes("functions/v1")) return;

    event.respondWith(
        caches.match(event.request).then(response => {
            if (response) return response;
            return fetch(event.request).catch(() => {
                if (event.request.destination === "document") {
                    return caches.match("/index.html");
                }
            });
        })
    );
});
