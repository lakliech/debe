/**
 * Offline-first context for election result submissions.
 *
 * Queue lifecycle:
 *   PENDING  → retried up to MAX_RETRIES times on network errors / 5xx
 *   FAILED   → moved to failedQueue on 4xx (non-retryable) or retry exhaustion
 *
 * Draft lifecycle:
 *   - Created at station lookup, persisted immediately to AsyncStorage
 *   - Cleared ONLY after server returns 2xx (handled by form.tsx)
 *   - While queued the draft stays intact as a recoverable copy
 *   - When a queued item finally succeeds, the draft whose queueItemId matches
 *     is cleared automatically here
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { useAuth } from '@clerk/expo';

const DRAFT_KEY = 'agent_draft_v1';
const QUEUE_KEY = 'agent_queue_v1';
const FAILED_KEY = 'agent_failed_queue_v1';
const DEVICE_KEY = 'agent_device_id';
const REF_CACHE_KEY = 'agent_ref_cache_v1';
const MAX_RETRIES = 4; // 4 network attempts before moving to failed queue

/**
 * Reference data cached from the server while online.
 * Enables cold-start offline submissions without any live network requests.
 */
export interface CachedStation {
  id: string;
  name: string;
  code: string;
  registeredVoters?: number;
}

export interface CachedCandidate {
  id: string;
  fullName: string;
  partyAbbreviation?: string;
}

export interface ReferenceCache {
  agent?: { id: string; fullName: string; status: string };
  election?: { id: string; name: string; isActive: boolean };
  assignedStation?: CachedStation;
  recentStations?: CachedStation[]; // last 5 searched/used
  candidates?: CachedCandidate[];
  candidatesForElection?: string; // electionId the candidates belong to
}

export interface CandidateVote {
  name: string;
  party?: string;
  votes: number;
}

export interface Draft {
  id: string;
  stationId: string;
  stationName?: string;
  stationCode?: string;
  electionId: string;
  agentId: string;
  // Ballot accounting
  registeredVoters?: number;
  ballotsReceived?: number;
  ballotsIssued?: number;
  unusedBallots?: number;
  spoiltBallots?: number;
  rejectedBallots?: number;
  totalVotesCast?: number;
  totalValidVotes?: number;
  // Candidate votes
  candidateVotes: Record<string, CandidateVote>;
  // Observations
  agentSigned: boolean;
  agentReceivedCopy: boolean;
  resultsDisplayed: boolean;
  objectionRaised: boolean;
  agentComments?: string;
  // Evidence
  photoUri?: string;
  gpsLat?: number;
  gpsLon?: number;
  // Sync tracking
  queueItemId?: string; // Set when draft is queued for background sync
  // Meta
  deviceId: string;
  capturedAt: string;
  updatedAt: string;
}

export interface QueueItem {
  id: string;
  payload: {
    endpoint: string;
    method: string;
    body: Record<string, unknown>;
    /** Local device URI of the Form 34A photo to upload before this item is submitted. */
    pendingPhotoUri?: string;
  };
  attempts: number;
  createdAt: string;
  lastError?: string;
  /**
   * Set to true when a Form 34A photo upload failed during the last sync attempt
   * but the item is still in the pending queue (not yet exhausted MAX_RETRIES).
   * Drives the "photo could not be uploaded" warning banner on the dashboard.
   * Cleared automatically when the photo upload succeeds or when the agent
   * taps "Retry" via retryPhotoUpload().
   */
  photoUploadFailed?: boolean;
  /** Display label for the submission (e.g. station name) — set at enqueue time for UI hints. */
  label?: string;
}

interface OfflineContextValue {
  draft: Draft | null;
  setDraft: (draft: Draft | null) => void;
  updateDraft: (updates: Partial<Draft>) => void;
  saveDraft: () => Promise<void>;
  clearDraft: () => Promise<void>;
  queue: QueueItem[];
  pendingCount: number;
  failedQueue: QueueItem[];
  failedCount: number;
  clearFailedItem: (id: string) => Promise<void>;
  enqueueItem: (item: QueueItem) => Promise<void>;
  isOnline: boolean;
  isSyncing: boolean;
  syncNow: () => Promise<void>;
  deviceId: string;
  lastSyncAt: Date | null;
  /** Reference data cached from last online session — safe to use when offline */
  refCache: ReferenceCache;
  saveRefCache: (updates: Partial<ReferenceCache>) => void;
  /**
   * Pending queue items whose Form 34A photo upload failed on the last sync
   * attempt but still have retry budget remaining.
   * Drives the warning banner on the agent dashboard.
   */
  failedPhotoUploads: QueueItem[];
  /**
   * Reset a photo-failed queue item so it will retry the photo upload on the
   * next sync. Clears photoUploadFailed and resets the attempt counter.
   * Call syncNow() afterwards to trigger an immediate retry.
   */
  retryPhotoUpload: (id: string) => void;
}

const OfflineContext = createContext<OfflineContextValue | null>(null);

export function OfflineProvider({ children }: { children: React.ReactNode }) {
  const { getToken } = useAuth();
  const [draft, setDraftState] = useState<Draft | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [failedQueue, setFailedQueue] = useState<QueueItem[]>([]);
  const [isOnline, setIsOnline] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [deviceId, setDeviceId] = useState('');
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const [refCache, setRefCacheState] = useState<ReferenceCache>({});
  const isSyncingRef = useRef(false);
  // Keep a ref to the latest draft so syncNow can clear it when matched
  const draftRef = useRef<Draft | null>(null);
  // Mirror of queue state kept in a ref so syncNow always reads the current
  // snapshot, even when called synchronously after retryPhotoUpload(). Without
  // this, syncNow's useCallback closure captures stale queue state and can run
  // the just-reset item with its old attempts count.
  const queueRef = useRef<QueueItem[]>([]);

  // Initialize device ID and restore persisted state
  useEffect(() => {
    const init = async () => {
      let id = await AsyncStorage.getItem(DEVICE_KEY);
      if (!id) {
        id = Date.now().toString() + Math.random().toString(36).substr(2, 9);
        await AsyncStorage.setItem(DEVICE_KEY, id);
      }
      setDeviceId(id);

      const draftStr = await AsyncStorage.getItem(DRAFT_KEY);
      if (draftStr) {
        try {
          const d = JSON.parse(draftStr) as Draft;
          setDraftState(d);
          draftRef.current = d;
        } catch { /* ignore corrupt data */ }
      }

      const queueStr = await AsyncStorage.getItem(QUEUE_KEY);
      if (queueStr) {
        try {
          const parsedQueue = JSON.parse(queueStr) as QueueItem[];
          setQueue(parsedQueue);
          queueRef.current = parsedQueue;
        } catch { /* ignore */ }
      }

      const failedStr = await AsyncStorage.getItem(FAILED_KEY);
      if (failedStr) {
        try { setFailedQueue(JSON.parse(failedStr)); } catch { /* ignore */ }
      }

      const refStr = await AsyncStorage.getItem(REF_CACHE_KEY);
      if (refStr) {
        try { setRefCacheState(JSON.parse(refStr)); } catch { /* ignore */ }
      }
    };
    init();
  }, []);

  // Monitor network connectivity
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setIsOnline(state.isConnected ?? false);
    });
    return unsubscribe;
  }, []);

  // Auto-sync when coming back online
  useEffect(() => {
    if (isOnline && queue.length > 0 && !isSyncingRef.current) {
      syncNow();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]);

  const setDraft = useCallback((d: Draft | null) => {
    setDraftState(d);
    draftRef.current = d;
    if (d) {
      AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(d)).catch(() => {});
    } else {
      AsyncStorage.removeItem(DRAFT_KEY).catch(() => {});
    }
  }, []);

  const updateDraft = useCallback((updates: Partial<Draft>) => {
    setDraftState((prev) => {
      if (!prev) return prev;
      const updated: Draft = { ...prev, ...updates, updatedAt: new Date().toISOString() };
      draftRef.current = updated;
      AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(updated)).catch(() => {});
      return updated;
    });
  }, []);

  const saveDraft = useCallback(async () => {
    if (!draft) return;
    await AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  }, [draft]);

  const clearDraft = useCallback(async () => {
    setDraftState(null);
    draftRef.current = null;
    await AsyncStorage.removeItem(DRAFT_KEY);
  }, []);

  const enqueueItem = useCallback(
    async (item: QueueItem) => {
      setQueue((prev) => {
        const next = [...prev, item];
        queueRef.current = next;
        AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(next)).catch(() => {});
        return next;
      });
    },
    [],
  );

  const clearFailedItem = useCallback(async (id: string) => {
    setFailedQueue((prev) => {
      const next = prev.filter((i) => i.id !== id);
      AsyncStorage.setItem(FAILED_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const retryPhotoUpload = useCallback((id: string) => {
    setQueue((prev) => {
      const next = prev.map((item) =>
        item.id === id
          ? { ...item, photoUploadFailed: false, attempts: 0, lastError: undefined }
          : item,
      );
      // Update the ref immediately so a syncNow() called on the same tick
      // processes the reset item with attempts=0, not the stale attempts count.
      queueRef.current = next;
      AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const saveRefCache = useCallback((updates: Partial<ReferenceCache>) => {
    setRefCacheState((prev) => {
      const next = { ...prev, ...updates };
      AsyncStorage.setItem(REF_CACHE_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const persistQueues = useCallback(
    async (pending: QueueItem[], failed: QueueItem[]) => {
      queueRef.current = pending;
      setQueue(pending);
      setFailedQueue(failed);
      await Promise.all([
        AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(pending)),
        AsyncStorage.setItem(FAILED_KEY, JSON.stringify(failed)),
      ]);
    },
    [],
  );

  const syncNow = useCallback(async () => {
    if (isSyncingRef.current || !isOnline) return;
    isSyncingRef.current = true;
    setIsSyncing(true);

    try {
      const token = await getToken();
      if (!token) return;

      const domain = process.env.EXPO_PUBLIC_DOMAIN;
      const remaining: QueueItem[] = [];
      const newFailed: QueueItem[] = [...failedQueue];

      // Read from queueRef.current rather than the closed-over queue state so
      // that a retryPhotoUpload() call on the same tick is always honoured —
      // the ref is updated synchronously inside setQueue's updater function.
      for (const item of queueRef.current) {
        let moved = false;

        // Upload pending Form 34A photo — must succeed before submission proceeds.
        // If upload fails the item stays in the retry queue; we never submit
        // a Form 34A without its photo evidence.
        let syncBody = item.payload.body;
        if (item.payload.pendingPhotoUri) {
          let photoOk = false;
          try {
            const urlRes = await fetch(`https://${domain}/api/election-results/photo-upload-url`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}` },
            });
            if (urlRes.ok) {
              const { uploadUrl, objectPath } = await urlRes.json() as { uploadUrl: string; objectPath: string };
              const photoRes = await fetch(item.payload.pendingPhotoUri);
              if (photoRes.ok) {
                const blob = await photoRes.blob();
                const putRes = await fetch(uploadUrl, {
                  method: 'PUT',
                  body: blob,
                  headers: { 'Content-Type': 'image/jpeg' },
                });
                if (putRes.ok) {
                  syncBody = { ...syncBody, formPhotoUrl: objectPath };
                  photoOk = true;
                }
              }
            }
          } catch { /* network / storage error */ }

          if (!photoOk) {
            // Do not submit without the required photo — keep in retry queue and
            // surface the failure to the agent via photoUploadFailed flag.
            if (item.attempts + 1 < MAX_RETRIES) {
              remaining.push({
                ...item,
                attempts: item.attempts + 1,
                lastError: 'Form photo upload failed — will retry on next sync',
                photoUploadFailed: true,
              });
            } else {
              // Retry budget exhausted for photo — move to permanent failed queue
              newFailed.push({
                ...item,
                attempts: item.attempts + 1,
                lastError: `Form 34A photo could not reach the server after ${MAX_RETRIES} attempts`,
                photoUploadFailed: false,
              });
            }
            continue;
          }

          // Photo uploaded successfully — syncBody already has formPhotoUrl set above.
          // Execution continues to the submission step below.
        }

        try {
          const res = await fetch(`https://${domain}${item.payload.endpoint}`, {
            method: item.payload.method,
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(syncBody),
          });

          if (res.ok) {
            // Success — if the active draft was waiting for this item, clear it
            if (draftRef.current?.queueItemId === item.id) {
              setDraftState(null);
              draftRef.current = null;
              AsyncStorage.removeItem(DRAFT_KEY).catch(() => {});
            }
            moved = true; // don't add to remaining
          } else if (res.status >= 400 && res.status < 500) {
            // 4xx: non-retryable — move to failed queue immediately
            const errBody = await res.json().catch(() => ({})) as Record<string, string>;
            const errorMsg = errBody?.error ?? errBody?.message ?? `Server rejected submission (HTTP ${res.status})`;
            // Photo succeeded (if applicable) so clear the flag
            newFailed.push({ ...item, lastError: errorMsg, attempts: item.attempts + 1, photoUploadFailed: false });
            moved = true;
          } else {
            // 5xx: retryable server error
          }
        } catch {
          // Network error: retryable
        }

        if (!moved) {
          if (item.attempts + 1 < MAX_RETRIES) {
            // Photo succeeded (we're past the photoOk check), so clear the flag
            remaining.push({ ...item, attempts: item.attempts + 1, photoUploadFailed: false });
          } else {
            // Retry budget exhausted — move to failed queue
            newFailed.push({
              ...item,
              lastError: `Failed after ${MAX_RETRIES} attempts — check connectivity`,
              attempts: item.attempts + 1,
              photoUploadFailed: false,
            });
          }
        }
      }

      await persistQueues(remaining, newFailed);
      setLastSyncAt(new Date());
    } finally {
      isSyncingRef.current = false;
      setIsSyncing(false);
    }
  // queue intentionally omitted — syncNow reads queueRef.current directly so
  // it always processes the freshest snapshot without stale-closure races.
  }, [failedQueue, isOnline, getToken, persistQueues]);

  return (
    <OfflineContext.Provider
      value={{
        draft,
        setDraft,
        updateDraft,
        saveDraft,
        clearDraft,
        queue,
        pendingCount: queue.length,
        failedQueue,
        failedCount: failedQueue.length,
        clearFailedItem,
        enqueueItem,
        isOnline,
        isSyncing,
        syncNow,
        deviceId,
        lastSyncAt,
        refCache,
        saveRefCache,
        failedPhotoUploads: queue.filter((i) => i.photoUploadFailed === true),
        retryPhotoUpload,
      }}
    >
      {children}
    </OfflineContext.Provider>
  );
}

export function useOffline() {
  const ctx = useContext(OfflineContext);
  if (!ctx) throw new Error('useOffline must be used inside OfflineProvider');
  return ctx;
}
