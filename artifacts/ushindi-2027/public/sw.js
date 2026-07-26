// Linda Mwananchi Campaign – Service Worker (Offline-first for polling agents)
// Supports: static caching, offline result draft persistence, submission queue with background sync

const CACHE_VERSION = "lm-cache-v2";
const SYNC_TAG = "result-submission-sync";

// Assets to precache for offline app shell
const PRECACHE = [
  "/",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/logo.svg",
];

// ── Install: precache app shell ────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: clean old caches ─────────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ── Fetch: stale-while-revalidate for app shell; pass-through for API ──────────
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never intercept API calls — let them through to network
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/ushindi-2027/api/")) {
    return;
  }

  // Only cache GET requests
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request)
        .then((response) => {
          if (response && response.status === 200 && response.type === "basic") {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached || caches.match("/"));

      // Return cached immediately (stale-while-revalidate) or wait for network
      return cached || fetchPromise;
    })
  );
});

// ── Background Sync: flush queued submissions when back online ─────────────────
self.addEventListener("sync", (event) => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(flushSubmissionQueue());
  }
});

// ── Push: handle server-pushed notifications ───────────────────────────────────
self.addEventListener("push", (event) => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || "Linda Mwananchi", {
      body: data.body || "",
      icon: "/logo.svg",
      badge: "/favicon.svg",
      tag: data.tag || "lm-notification",
    })
  );
});

// ── Message: commands from the page ───────────────────────────────────────────
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
  if (event.data?.type === "REQUEST_SYNC") {
    // Page requests immediate sync attempt
    self.registration.sync.register(SYNC_TAG).catch(() => {
      // Background sync not available — attempt immediately
      flushSubmissionQueue();
    });
  }
});

// ── Flush queue: send all pending submissions to the API ──────────────────────
async function flushSubmissionQueue() {
  let db;
  try {
    db = await openAgentDB();
    const tx = db.transaction("submission_queue", "readwrite");
    const store = tx.objectStore("submission_queue");
    const allItems = await promisifyRequest(store.getAll());

    for (const item of allItems) {
      if (item.syncStatus === "sent") continue;

      try {
        const response = await fetch(item.endpoint, {
          method: item.method || "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(item.payload),
        });

        if (response.ok) {
          const txUpdate = db.transaction("submission_queue", "readwrite");
          const storeUpdate = txUpdate.objectStore("submission_queue");
          item.syncStatus = "sent";
          item.sentAt = new Date().toISOString();
          item.serverResponse = await response.json().catch(() => null);
          await promisifyRequest(storeUpdate.put(item));

          // Notify all open windows that a submission synced
          const clients = await self.clients.matchAll({ type: "window" });
          clients.forEach((client) =>
            client.postMessage({ type: "SUBMISSION_SYNCED", id: item.id })
          );
        }
      } catch (err) {
        // Network error — leave in queue, will retry on next sync
        console.warn("[SW] Failed to sync submission", item.id, err);
      }
    }
  } catch (err) {
    console.error("[SW] DB error during sync flush", err);
  } finally {
    if (db) db.close();
  }
}

// ── IndexedDB helpers (no idb library dependency) ─────────────────────────────
function openAgentDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("lm-agent-db", 2);
    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains("drafts")) {
        const drafts = db.createObjectStore("drafts", { keyPath: "id" });
        drafts.createIndex("stationId", "stationId", { unique: false });
        drafts.createIndex("electionId", "electionId", { unique: false });
      }
      if (!db.objectStoreNames.contains("submission_queue")) {
        const queue = db.createObjectStore("submission_queue", { keyPath: "id" });
        queue.createIndex("syncStatus", "syncStatus", { unique: false });
        queue.createIndex("stationId", "stationId", { unique: false });
      }
    };
    req.onsuccess = (event) => resolve(event.target.result);
    req.onerror = (event) => reject(event.target.error);
  });
}

function promisifyRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error);
  });
}
