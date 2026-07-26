/**
 * IndexedDB wrapper for polling agent offline-first functionality.
 * Stores encrypted drafts and queued submissions that sync when back online.
 */

const DB_NAME = "lm-agent-db";
const DB_VERSION = 2;

export interface DraftSubmission {
  id: string; // UUID generated client-side
  stationId: string;
  electionId: string;
  agentId: string;
  // Ballot accounting
  registeredVoters?: number;
  ballotsReceived?: number;
  ballotsIssued?: number;
  unusedBallots?: number;
  spoiltBallots?: number;
  rejectedBallots?: number;
  totalValidVotes?: number;
  totalVotesCast?: number;
  openingTime?: string;
  closingTime?: string;
  // Candidate votes: { candidateId: votes }
  candidateVotes: Record<string, { name: string; party?: string; votes: number }>;
  // Observations
  agentSigned?: boolean;
  agentReceivedCopy?: boolean;
  resultsDisplayed?: boolean;
  objectionRaised?: boolean;
  agentComments?: string;
  // Images (local blob URLs or object paths after upload)
  images: Array<{
    id: string;
    imageType: string;
    localBlobUrl?: string;
    objectPath?: string;
    hash?: string;
    uploaded: boolean;
  }>;
  // Metadata
  deviceId: string;
  gpsLat?: number;
  gpsLon?: number;
  offlineCapturedAt: string;
  updatedAt: string;
  isDirty: boolean; // has unsaved changes
}

export interface QueuedSubmission {
  id: string;
  stationId: string;
  electionId: string;
  endpoint: string;
  method: "POST" | "PATCH";
  payload: unknown;
  syncStatus: "pending" | "sent" | "error";
  errorMessage?: string;
  queuedAt: string;
  sentAt?: string;
  serverResponse?: unknown;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
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
    req.onsuccess = (event) => resolve((event.target as IDBOpenDBRequest).result);
    req.onerror = (event) => reject((event.target as IDBOpenDBRequest).error);
  });
}

function req<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = (e) => resolve((e.target as IDBRequest<T>).result);
    request.onerror = (e) => reject((e.target as IDBRequest<T>).error);
  });
}

// ── Draft CRUD ─────────────────────────────────────────────────────────────────

export async function getDraft(id: string): Promise<DraftSubmission | undefined> {
  const db = await openDB();
  const tx = db.transaction("drafts", "readonly");
  const result = await req(tx.objectStore("drafts").get(id));
  db.close();
  return result;
}

export async function getDraftByStation(stationId: string, electionId: string): Promise<DraftSubmission | undefined> {
  const db = await openDB();
  const tx = db.transaction("drafts", "readonly");
  const store = tx.objectStore("drafts");
  const allDrafts: DraftSubmission[] = await req(store.getAll());
  db.close();
  return allDrafts.find(d => d.stationId === stationId && d.electionId === electionId);
}

export async function listDrafts(): Promise<DraftSubmission[]> {
  const db = await openDB();
  const tx = db.transaction("drafts", "readonly");
  const result = await req(tx.objectStore("drafts").getAll());
  db.close();
  return result;
}

export async function saveDraft(draft: DraftSubmission): Promise<void> {
  const db = await openDB();
  const tx = db.transaction("drafts", "readwrite");
  await req(tx.objectStore("drafts").put({ ...draft, updatedAt: new Date().toISOString() }));
  db.close();
}

export async function deleteDraft(id: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction("drafts", "readwrite");
  await req(tx.objectStore("drafts").delete(id));
  db.close();
}

// ── Submission Queue ───────────────────────────────────────────────────────────

export async function enqueueSubmission(item: Omit<QueuedSubmission, "queuedAt" | "syncStatus">): Promise<void> {
  const db = await openDB();
  const tx = db.transaction("submission_queue", "readwrite");
  await req(tx.objectStore("submission_queue").put({
    ...item,
    syncStatus: "pending",
    queuedAt: new Date().toISOString(),
  }));
  db.close();

  // Request background sync if available
  if ("serviceWorker" in navigator && "SyncManager" in window) {
    const reg = await navigator.serviceWorker.ready;
    await (reg as ServiceWorkerRegistration & { sync?: { register: (tag: string) => Promise<void> } }).sync?.register("result-submission-sync");
  }
}

export async function listQueuedSubmissions(): Promise<QueuedSubmission[]> {
  const db = await openDB();
  const tx = db.transaction("submission_queue", "readonly");
  const result = await req(tx.objectStore("submission_queue").getAll());
  db.close();
  return result;
}

export async function getPendingCount(): Promise<number> {
  const db = await openDB();
  const tx = db.transaction("submission_queue", "readonly");
  const index = tx.objectStore("submission_queue").index("syncStatus");
  const count = await req(index.count(IDBKeyRange.only("pending")));
  db.close();
  return count;
}

export async function markSubmissionSent(id: string, serverResponse: unknown): Promise<void> {
  const db = await openDB();
  const tx = db.transaction("submission_queue", "readwrite");
  const store = tx.objectStore("submission_queue");
  const item: QueuedSubmission = await req(store.get(id));
  if (item) {
    item.syncStatus = "sent";
    item.sentAt = new Date().toISOString();
    item.serverResponse = serverResponse;
    await req(store.put(item));
  }
  db.close();
}

// ── Device ID ──────────────────────────────────────────────────────────────────

export function getDeviceId(): string {
  let id = localStorage.getItem("lm-device-id");
  if (!id) {
    id = `device-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    localStorage.setItem("lm-device-id", id);
  }
  return id;
}

// ── SMS Fallback Code ──────────────────────────────────────────────────────────
// Generates a structured short code for SMS fallback submission

export function generateSmsCode(draft: DraftSubmission): string {
  const parts = [
    "LM2027",
    draft.stationId.slice(0, 8).toUpperCase(),
    draft.totalValidVotes ?? 0,
    Object.values(draft.candidateVotes)
      .map(v => v.votes)
      .join("-"),
  ];
  return parts.join("|");
}
