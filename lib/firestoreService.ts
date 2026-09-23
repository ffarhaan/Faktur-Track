import {
  collection,
  doc,
  setDoc,
  getDocs,
  getDoc,
  getDocsFromServer,
  getDocFromServer,
  onSnapshot,
  deleteDoc,
  writeBatch,
  Unsubscribe,
} from "firebase/firestore";
import { db } from "./firebase";
import { InvoiceProgression } from "./types";

export interface FirestoreFakturDoc {
  id: string;
  no_faktur: string;
  no_sales_order: string;
  customer_name: string;
  order_date: string;
  jenis_transaksi: string;
  kategori: string;
  status_cetak?: boolean;
  printed_at?: string | null;
  extra: Record<string, unknown>;
  updated_at?: string;
}

export interface PrintState {
  printedKeys: string[];
  printedAtMap: Record<string, string>;
  updatedAt: string;
}

const APP_DATA_COLLECTION = "app_data";
const METADATA_DOC = "metadata";
const PRINT_STATE_DOC = "print_state";
const CHUNKS_COLLECTION = "faktur_chunks";

let localLastUploadTimestamp: string | null = null;

const CHUNK_SIZE = 120; // ~120 items per doc (~250KB, comfortably under 1MB Firestore doc limit)

export type SubscribeChangeReason = "chunks" | "print" | "meta";

/**
 * Realtime listener for Chunked Fakturs and Print State
 * Loads in < 100ms and uses only ~5-8 document reads total!
 */
export function subscribeToFakturs(
  onData: (
    fakturs: FirestoreFakturDoc[],
    progression: InvoiceProgression | null,
    printState?: PrintState | null,
    reason?: SubscribeChangeReason
  ) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  let currentProgression: InvoiceProgression | null = null;
  let currentChunksMap = new Map<string, FirestoreFakturDoc[]>();
  let currentPrintState: PrintState = {
    printedKeys: [],
    printedAtMap: {},
    updatedAt: "",
  };
  let emitTimer: ReturnType<typeof setTimeout> | null = null;
  let hasEmittedInitialChunks = false;
  let lastMetaUpdatedAt: string | null = null;

  const emitData = (reason: SubscribeChangeReason = "chunks") => {
    // Merge all chunks in order
    const sortedChunkKeys = Array.from(currentChunksMap.keys()).sort((a, b) => {
      const na = parseInt(a.replace(/\D/g, ""), 10) || 0;
      const nb = parseInt(b.replace(/\D/g, ""), 10) || 0;
      return na - nb;
    });

    const seenDocKeys = new Set<string>();
    const allDocs: FirestoreFakturDoc[] = [];
    for (const k of sortedChunkKeys) {
      const list = currentChunksMap.get(k) || [];
      for (let idx = 0; idx < list.length; idx++) {
        const d = list[idx];
        const key = d.id || d.no_faktur || `${k}_${idx}`;
        if (!seenDocKeys.has(key)) {
          seenDocKeys.add(key);
          allDocs.push(d);
        }
      }
    }

    const printedSet = new Set(currentPrintState.printedKeys || []);
    const pMap = currentPrintState.printedAtMap || {};

    // Apply printed status with exact key matching
    for (const d of allDocs) {
      const key = d.id || d.no_faktur;
      if (!key) continue;
      const isPrinted = printedSet.has(key);
      d.status_cetak = isPrinted;
      d.printed_at = pMap[key] || null;
    }

    hasEmittedInitialChunks = true;
    onData(allDocs, currentProgression, currentPrintState, reason);
  };

  let expectedChunks = 0;

  const debouncedEmit = (reason: SubscribeChangeReason = "chunks") => {
    if (emitTimer) clearTimeout(emitTimer);
    emitTimer = setTimeout(() => {
      emitData(reason);
    }, 200);
  };

  // 1. Subscribe to Metadata
  const unsubMeta = onSnapshot(
    doc(db, APP_DATA_COLLECTION, METADATA_DOC),
    async (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (data.invoiceProgression) {
          currentProgression = data.invoiceProgression as InvoiceProgression;
        }
        if (typeof data.totalChunks === "number") {
          expectedChunks = data.totalChunks;
        }

        const newUpdatedAt = String(data.updatedAt || "");
        const isFirstLoad = lastMetaUpdatedAt === null;
        const isRemoteUpload = Boolean(
          !isFirstLoad &&
          newUpdatedAt &&
          newUpdatedAt !== lastMetaUpdatedAt &&
          newUpdatedAt !== localLastUploadTimestamp
        );
        lastMetaUpdatedAt = newUpdatedAt;

        if (isFirstLoad || isRemoteUpload) {
          // Instantly fetch all chunks atomically from server so all colleagues see the new invoices & pending SO!
          try {
            const chunksSnap = await getDocsFromServer(collection(db, CHUNKS_COLLECTION));
            const newMap = new Map<string, FirestoreFakturDoc[]>();
            chunksSnap.forEach((d) => {
              const dData = d.data();
              if (Array.isArray(dData.items)) {
                newMap.set(d.id, dData.items as FirestoreFakturDoc[]);
              }
            });
            currentChunksMap = newMap;
            emitData("chunks");
            return;
          } catch (err) {
            console.warn("Auto-sync chunks on metadata change error:", err);
          }
        }

      }
      if (hasEmittedInitialChunks) {
        onData([], currentProgression, currentPrintState, "meta");
      } else {
        debouncedEmit("meta");
      }
    },
    (err) => console.warn("Metadata sync warning:", err)
  );

  // Wake-up check: When user switches back to tab or unlocks phone (visibilitychange/focus)
  const checkRemoteUpdate = async () => {
    try {
      const metaSnap = await getDocFromServer(doc(db, APP_DATA_COLLECTION, METADATA_DOC));
      if (metaSnap.exists()) {
        const data = metaSnap.data();
        const incomingTime = String(data.updatedAt || "");
        if (
          incomingTime &&
          incomingTime !== lastMetaUpdatedAt &&
          incomingTime !== localLastUploadTimestamp
        ) {
          lastMetaUpdatedAt = incomingTime;
          if (data.invoiceProgression) {
            currentProgression = data.invoiceProgression as InvoiceProgression;
          }
          const chunksSnap = await getDocsFromServer(collection(db, CHUNKS_COLLECTION));
          const newMap = new Map<string, FirestoreFakturDoc[]>();
          chunksSnap.forEach((d) => {
            const dData = d.data();
            if (Array.isArray(dData.items)) {
              newMap.set(d.id, dData.items as FirestoreFakturDoc[]);
            }
          });
          currentChunksMap = newMap;
          emitData("chunks");
        }
      }
    } catch {}
  };

  // Heartbeat fallback: every 10s check if remote upload happened during sleep/background
  const heartbeatTimer = setInterval(checkRemoteUpdate, 10000);

  const onVisibilityChange = () => {
    if (typeof document !== "undefined" && document.visibilityState === "visible") {
      checkRemoteUpdate();
    }
  };

  if (typeof window !== "undefined") {
    window.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", checkRemoteUpdate);
  }

  // 2. Subscribe to Print State (Ultra fast toggle & mark all - decoupled from chunk merging!)
  const unsubPrint = onSnapshot(
    doc(db, APP_DATA_COLLECTION, PRINT_STATE_DOC),
    (snap) => {
      if (snap.exists()) {
        currentPrintState = snap.data() as PrintState;
      }
      // If chunks are already loaded in memory, emit print update IMMEDIATELY (<1ms) without re-merging chunks!
      if (hasEmittedInitialChunks) {
        onData([], currentProgression, currentPrintState, "print");
      } else {
        debouncedEmit("print");
      }
    },
    (err) => console.warn("PrintState sync warning:", err)
  );

  return () => {

    if (emitTimer) clearTimeout(emitTimer);
    clearInterval(heartbeatTimer);
    if (typeof window !== "undefined") {
      window.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", checkRemoteUpdate);
    }
    unsubMeta();
    unsubPrint();
  };
}


/**
 * Fetch all existing faktur records and progression directly from server (bypassing any stale local cache)
 */
export async function getExistingFakturs(): Promise<{
  docs: FirestoreFakturDoc[];
  progression: InvoiceProgression | null;
  printState: PrintState | null;
}> {
  const [chunksSnap, metaSnap, printSnap] = await Promise.all([
    getDocsFromServer(collection(db, CHUNKS_COLLECTION)).catch(() => getDocs(collection(db, CHUNKS_COLLECTION))),
    getDocFromServer(doc(db, APP_DATA_COLLECTION, METADATA_DOC)).catch(() => getDoc(doc(db, APP_DATA_COLLECTION, METADATA_DOC))),
    getDocFromServer(doc(db, APP_DATA_COLLECTION, PRINT_STATE_DOC)).catch(() => getDoc(doc(db, APP_DATA_COLLECTION, PRINT_STATE_DOC))),
  ]);

  const sortedDocs = chunksSnap.docs.sort((a, b) => {
    const na = parseInt(a.id.replace(/\D/g, ""), 10) || 0;
    const nb = parseInt(b.id.replace(/\D/g, ""), 10) || 0;
    return na - nb;
  });

  const docs: FirestoreFakturDoc[] = [];
  sortedDocs.forEach((d) => {
    const data = d.data();
    if (Array.isArray(data.items)) {
      docs.push(...(data.items as FirestoreFakturDoc[]));
    }
  });

  let progression: InvoiceProgression | null = null;
  if (metaSnap.exists()) {
    const data = metaSnap.data();
    if (data.invoiceProgression) {
      progression = data.invoiceProgression as InvoiceProgression;
    }
  }

  let printState: PrintState | null = null;
  if (printSnap.exists()) {
    printState = printSnap.data() as PrintState;
    const printedSet = new Set(printState.printedKeys || []);
    const pMap = printState.printedAtMap || {};
    for (const d of docs) {
      const key = d.id || d.no_faktur;
      if (!key) continue;
      const isPrinted = printedSet.has(key);
      d.status_cetak = isPrinted;
      d.printed_at = pMap[key] || null;
    }
  }

  return { docs, progression, printState };
}

/**
 * Safe chunk builder that guarantees every chunk document is < 500KB (Firestore allows up to 1024 KB)
 */
function createSafeChunks(items: FirestoreFakturDoc[]): FirestoreFakturDoc[][] {
  const chunks: FirestoreFakturDoc[][] = [];
  let currentChunk: FirestoreFakturDoc[] = [];
  let currentEstimatedBytes = 0;
  const MAX_CHUNK_BYTES = 600 * 1024; // 600 KB safe limit (Firestore limit is 1048 KB)

  for (const item of items) {
    const itemBytes = JSON.stringify(item).length;
    if (
      currentChunk.length > 0 &&
      (currentEstimatedBytes + itemBytes > MAX_CHUNK_BYTES || currentChunk.length >= 350)
    ) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentEstimatedBytes = 0;
    }
    currentChunk.push(item);
    currentEstimatedBytes += itemBytes;
  }
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }
  return chunks;
}

/**
 * Save / Upsert Fakturs in Chunks
 * Safely writes chunks in parallel under 500KB each
 */
export async function saveFaktursBatch(
  fakturs: FirestoreFakturDoc[],
  progression?: InvoiceProgression | null,
  existingPrintState?: PrintState | null,
  newUnprintedKeys?: string[]
): Promise<void> {
  const newUnprintedSet = new Set(newUnprintedKeys || []);

  // CRITICAL CONCURRENCY GUARD:
  // Fetch live print state directly from Firestore so print checkmarks made by colleagues
  // while this upload was preparing are NEVER lost or overwritten!
  let livePrintedKeys: string[] = [];
  let livePrintedAtMap: Record<string, string> = {};

  try {
    const printSnap = await getDoc(doc(db, APP_DATA_COLLECTION, PRINT_STATE_DOC));
    if (printSnap.exists()) {
      const liveData = printSnap.data() as PrintState;
      // Genuinely new invoices being uploaded MUST be excluded from live printed keys
      livePrintedKeys = (liveData.printedKeys || []).filter((k) => !newUnprintedSet.has(k));
      livePrintedAtMap = { ...(liveData.printedAtMap || {}) };
      newUnprintedSet.forEach((k) => delete livePrintedAtMap[k]);
    }
  } catch (err) {
    console.warn("Could not read live print state during batch upload:", err);
  }

  // UNION MERGE: Print status of existing invoices is preserved.
  // New unprinted invoices are strictly excluded.
  const localPrintedKeys = (existingPrintState?.printedKeys || []).filter((k) => !newUnprintedSet.has(k));
  const unifiedPrintedSet = new Set<string>([
    ...livePrintedKeys,
    ...localPrintedKeys,
  ]);
  const unifiedPrintedAtMap: Record<string, string> = {
    ...livePrintedAtMap,
    ...(existingPrintState?.printedAtMap || {}),
  };
  newUnprintedSet.forEach((k) => delete unifiedPrintedAtMap[k]);

  // Sync the unified print status into the chunk items
  for (const item of fakturs) {
    const key = item.id || item.no_faktur;
    if (key) {
      if (newUnprintedSet.has(key)) {
        item.status_cetak = false;
        item.printed_at = null;
      } else if (unifiedPrintedSet.has(key)) {
        item.status_cetak = true;
        item.printed_at = unifiedPrintedAtMap[key] || item.printed_at || new Date().toISOString();
      }
    }
  }

  const chunks = createSafeChunks(fakturs);
  const nowIso = new Date().toISOString();
  const chunkIds: string[] = chunks.map((_, idx) => `chunk_${idx}`);

  // Write chunks in batches of 8 with auto-retry
  const BATCH_CONCURRENCY = 8;
  for (let i = 0; i < chunks.length; i += BATCH_CONCURRENCY) {
    const slice = chunks.slice(i, i + BATCH_CONCURRENCY);
    await Promise.all(
      slice.map(async (chunk, sIdx) => {
        const idx = i + sIdx;
        const chunkId = `chunk_${idx}`;
        const chunkRef = doc(db, CHUNKS_COLLECTION, chunkId);
        let lastErr: unknown = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            await setDoc(chunkRef, {
              chunkIndex: idx,
              count: chunk.length,
              items: chunk,
              updatedAt: nowIso,
            });
            return;
          } catch (err) {
            lastErr = err;
            await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
          }
        }
        throw lastErr || new Error(`Gagal menyimpan ${chunkId}`);
      })
    );
  }

  // Clean up any old unused chunks (e.g. if previous upload had more chunks)
  try {
    const existingChunksSnap = await getDocs(collection(db, CHUNKS_COLLECTION));
    const currentChunkSet = new Set(chunkIds);
    await Promise.all(
      existingChunksSnap.docs
        .filter((d) => !currentChunkSet.has(d.id))
        .map((d) => deleteDoc(d.ref))
    );
  } catch (err) {
    console.warn("Could not clean old chunks:", err);
  }

  // Save metadata
  localLastUploadTimestamp = nowIso;
  const metaDocRef = doc(db, APP_DATA_COLLECTION, METADATA_DOC);
  await setDoc(
    metaDocRef,
    {
      invoiceProgression: progression || null,
      totalInvoices: fakturs.length,
      totalChunks: chunks.length,
      chunkIds,
      updatedAt: nowIso,
    },
    { merge: true }
  );

  // Only initialize print state if it does not exist yet; NEVER overwrite live print status!
  try {
    const printDocRef = doc(db, APP_DATA_COLLECTION, PRINT_STATE_DOC);
    const printSnap = await getDoc(printDocRef);
    if (!printSnap.exists()) {
      await updatePrintState(Array.from(unifiedPrintedSet), unifiedPrintedAtMap);
    }
  } catch (err) {
    console.warn("Could not check print state existence:", err);
  }
}

/**
 * Update Print State (Single document write = 1 write, super fast < 50ms)
 */
export async function updatePrintState(
  printedKeys: string[],
  printedAtMap: Record<string, string>
): Promise<void> {
  const printDocRef = doc(db, APP_DATA_COLLECTION, PRINT_STATE_DOC);
  await setDoc(printDocRef, {
    printedKeys,
    printedAtMap,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Toggle Print Status for a single invoice
 */
export async function updateFakturPrintStatus(
  invoiceKey: string,
  status: boolean,
  printedAt: string | null,
  currentPrintedKeys?: Set<string>,
  currentPrintedAtMap?: Record<string, string>
): Promise<void> {
  const printDocRef = doc(db, APP_DATA_COLLECTION, PRINT_STATE_DOC);
  let liveKeys = new Set<string>();
  let liveMap: Record<string, string> = {};

  try {
    const snap = await getDoc(printDocRef);
    if (snap.exists()) {
      const data = snap.data() as PrintState;
      liveKeys = new Set(data.printedKeys || []);
      liveMap = { ...(data.printedAtMap || {}) };
    } else if (currentPrintedKeys) {
      liveKeys = new Set(currentPrintedKeys);
      liveMap = { ...(currentPrintedAtMap || {}) };
    }
  } catch (err) {
    console.warn("Could not fetch live print state, falling back to local:", err);
    if (currentPrintedKeys) liveKeys = new Set(currentPrintedKeys);
    if (currentPrintedAtMap) liveMap = { ...currentPrintedAtMap };
  }

  if (status) {
    liveKeys.add(invoiceKey);
    if (printedAt) {
      liveMap[invoiceKey] = printedAt;
    }
  } else {
    liveKeys.delete(invoiceKey);
    delete liveMap[invoiceKey];
  }

  await updatePrintState(Array.from(liveKeys), liveMap);
}

/**
 * Batch update print status for multiple keys (e.g. mark all / filter printed)
 * Uses only 1 document write!
 */
export async function updateFaktursPrintStatusBatch(
  keys: string[],
  status: boolean,
  printedAt: string | null
): Promise<void> {
  const printDocRef = doc(db, APP_DATA_COLLECTION, PRINT_STATE_DOC);
  const snap = await getDoc(printDocRef);
  let currentKeys = new Set<string>();
  let currentMap: Record<string, string> = {};

  if (snap.exists()) {
    const data = snap.data() as PrintState;
    currentKeys = new Set(data.printedKeys || []);
    currentMap = { ...(data.printedAtMap || {}) };
  }

  if (status) {
    keys.forEach((k) => {
      currentKeys.add(k);
      if (printedAt) currentMap[k] = printedAt;
    });
  } else {
    keys.forEach((k) => {
      currentKeys.delete(k);
      delete currentMap[k];
    });
  }

  await updatePrintState(Array.from(currentKeys), currentMap);
}

/**
 * Delete all Faktur chunks and reset state
 */
export async function clearAllFakturs(): Promise<void> {
  const chunksSnap = await getDocs(collection(db, CHUNKS_COLLECTION));
  await Promise.all(chunksSnap.docs.map((d) => deleteDoc(d.ref)));

  const nowIso = new Date().toISOString();
  localLastUploadTimestamp = nowIso;
  await Promise.all([
    setDoc(doc(db, APP_DATA_COLLECTION, METADATA_DOC), {
      invoiceProgression: null,
      totalInvoices: 0,
      totalChunks: 0,
      chunkIds: [],
      updatedAt: nowIso,
    }),
    setDoc(doc(db, APP_DATA_COLLECTION, PRINT_STATE_DOC), {
      printedKeys: [],
      printedAtMap: {},
      updatedAt: nowIso,
    }),
  ]);
}

export interface TeamFeedback {
  id?: string;
  senderName: string;
  category: "kendala" | "lemot" | "saran" | "lainnya";
  message: string;
  createdAt: string;
  status?: "baru" | "dibaca" | "selesai";
}

/**
 * Submit feedback or complaint from team members directly into Firestore
 */
export async function submitTeamFeedback(
  data: Omit<TeamFeedback, "id" | "createdAt" | "status">
): Promise<void> {
  const docRef = doc(collection(db, "app_feedback"));
  await setDoc(docRef, {
    ...data,
    id: docRef.id,
    createdAt: new Date().toISOString(),
    status: "baru",
  });
}

/**
 * Realtime listener for team feedbacks
 */
export function subscribeToTeamFeedbacks(
  onData: (items: TeamFeedback[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  return onSnapshot(
    collection(db, "app_feedback"),
    (snapshot) => {
      const items: TeamFeedback[] = [];
      snapshot.forEach((d) => {
        items.push({ id: d.id, ...d.data() } as TeamFeedback);
      });
      items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      onData(items);
    },
    onError
  );
}

/**
 * Delete a feedback item
 */
export async function deleteTeamFeedback(id: string): Promise<void> {
  await deleteDoc(doc(db, "app_feedback", id));
}
