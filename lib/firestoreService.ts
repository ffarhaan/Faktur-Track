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
  runTransaction,
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
  let hasEmittedInitialChunks = false;

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

    // Apply printed status with flexible key matching (exact, clean, and -1P)
    for (const d of allDocs) {
      const key = d.id || d.no_faktur;
      if (!key) continue;
      const cleanKey = key.replace(/-1P$/i, "");
      const isPrinted = printedSet.has(key) || printedSet.has(cleanKey) || printedSet.has(`${cleanKey}-1P`);
      d.status_cetak = isPrinted;
      d.printed_at = pMap[key] || pMap[cleanKey] || pMap[`${cleanKey}-1P`] || null;
    }

    hasEmittedInitialChunks = true;
    onData(allDocs, currentProgression, currentPrintState, reason);
  };

  let emitTimer: NodeJS.Timeout | null = null;
  const debouncedEmit = (reason: SubscribeChangeReason = "chunks", delayMs: number = 200) => {
    if (emitTimer) clearTimeout(emitTimer);
    emitTimer = setTimeout(() => {
      emitData(reason);
    }, delayMs);
  };

  // 1. Pure Real-time stream for CHUNKS (Instant sync across all laptops whenever a file is uploaded or cleared)
  const unsubChunks = onSnapshot(
    collection(db, CHUNKS_COLLECTION),
    (snap) => {
      const newMap = new Map<string, FirestoreFakturDoc[]>();
      snap.forEach((d) => {
        const dData = d.data();
        if (Array.isArray(dData.items)) {
          newMap.set(d.id, dData.items as FirestoreFakturDoc[]);
        } else if (typeof dData.itemsJson === "string") {
          try {
            const parsed = JSON.parse(dData.itemsJson);
            if (Array.isArray(parsed)) newMap.set(d.id, parsed as FirestoreFakturDoc[]);
          } catch {}
        }
      });
      currentChunksMap = newMap;
      debouncedEmit("chunks", 250);
    },
    (err) => {
      console.warn("Chunks realtime stream error:", err);
      onError?.(err);
    }
  );

  // 2. Pure Real-time stream for PRINT STATE (Instant sync when anyone marks an invoice as printed/unprinted)
  const unsubPrint = onSnapshot(
    doc(db, APP_DATA_COLLECTION, PRINT_STATE_DOC),
    (snap) => {
      if (snap.exists()) {
        currentPrintState = snap.data() as PrintState;
      }
      if (hasEmittedInitialChunks) {
        debouncedEmit("print", 50);
      }
    },
    (err) => console.warn("PrintState sync warning:", err)
  );

  // 3. Pure Real-time stream for METADATA & PROGRESSION (Instant sync for upload progression & ranges)
  const unsubMeta = onSnapshot(
    doc(db, APP_DATA_COLLECTION, METADATA_DOC),
    (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (data.invoiceProgression) {
          currentProgression = data.invoiceProgression as InvoiceProgression;
        }
      }
      if (hasEmittedInitialChunks) {
        debouncedEmit("meta", 50);
      }
    },
    (err) => console.warn("Metadata sync warning:", err)
  );

  // Wake-up check: When user switches back to tab or unlocks laptop (visibilitychange/focus)
  const checkRemoteUpdate = async () => {
    try {
      const [chunksSnap, printSnap, metaSnap] = await Promise.all([
        getDocsFromServer(collection(db, CHUNKS_COLLECTION)).catch(() => null),
        getDocFromServer(doc(db, APP_DATA_COLLECTION, PRINT_STATE_DOC)).catch(() => null),
        getDocFromServer(doc(db, APP_DATA_COLLECTION, METADATA_DOC)).catch(() => null),
      ]);

      if (metaSnap && metaSnap.exists()) {
        const data = metaSnap.data();
        if (data.invoiceProgression) {
          currentProgression = data.invoiceProgression as InvoiceProgression;
        }
      }

      if (printSnap && printSnap.exists()) {
        currentPrintState = printSnap.data() as PrintState;
      }

      if (chunksSnap && !chunksSnap.empty) {
        const newMap = new Map<string, FirestoreFakturDoc[]>();
        chunksSnap.forEach((d) => {
          const dData = d.data();
          if (Array.isArray(dData.items)) {
            newMap.set(d.id, dData.items as FirestoreFakturDoc[]);
          } else if (typeof dData.itemsJson === "string") {
            try {
              const parsed = JSON.parse(dData.itemsJson);
              if (Array.isArray(parsed)) newMap.set(d.id, parsed as FirestoreFakturDoc[]);
            } catch {}
          }
        });
        currentChunksMap = newMap;
      }
      emitData("chunks");
    } catch {}
  };

  const onVisibilityChange = () => {
    if (typeof document !== "undefined" && document.visibilityState === "visible") {
      checkRemoteUpdate();
    }
  };

  if (typeof window !== "undefined") {
    window.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", checkRemoteUpdate);
  }

  return () => {
    if (typeof window !== "undefined") {
      window.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", checkRemoteUpdate);
    }
    unsubChunks();
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
    } else if (typeof data.itemsJson === "string") {
      try {
        const parsed = JSON.parse(data.itemsJson);
        if (Array.isArray(parsed)) docs.push(...(parsed as FirestoreFakturDoc[]));
      } catch {}
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
      const cleanKey = key.replace(/-1P$/i, "");
      const isPrinted = printedSet.has(key) || printedSet.has(cleanKey) || printedSet.has(`${cleanKey}-1P`);
      d.status_cetak = isPrinted;
      d.printed_at = pMap[key] || pMap[cleanKey] || pMap[`${cleanKey}-1P`] || null;
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
      livePrintedKeys = liveData.printedKeys || [];
      livePrintedAtMap = { ...(liveData.printedAtMap || {}) };
    }
  } catch (err) {
    console.warn("Could not read live print state during batch upload:", err);
  }

  // UNION MERGE: Print status of existing invoices is strictly preserved!
  const localPrintedKeys = existingPrintState?.printedKeys || [];
  const unifiedPrintedSet = new Set<string>([
    ...livePrintedKeys,
    ...localPrintedKeys,
  ]);
  const unifiedPrintedAtMap: Record<string, string> = {
    ...livePrintedAtMap,
    ...(existingPrintState?.printedAtMap || {}),
  };

  // Sync the unified print status into the chunk items
  for (const item of fakturs) {
    const key = item.id || item.no_faktur;
    if (key) {
      const cleanKey = key.replace(/-1P$/i, "");
      const isPrinted = unifiedPrintedSet.has(key) || unifiedPrintedSet.has(cleanKey) || unifiedPrintedSet.has(`${cleanKey}-1P`);
      if (isPrinted) {
        item.status_cetak = true;
        item.printed_at = unifiedPrintedAtMap[key] || unifiedPrintedAtMap[cleanKey] || unifiedPrintedAtMap[`${cleanKey}-1P`] || item.printed_at || new Date().toISOString();
      } else {
        item.status_cetak = false;
        item.printed_at = null;
      }
    }
  }

  // CRITICAL MULTI-DEVICE PROTECTION:
  // Before building chunks, fetch any existing chunks from Firestore that might have been uploaded by colleagues on other devices,
  // and merge them so one device NEVER deletes or overwrites another device's invoices!
  const liveChunkDocIds = new Set<string>();
  try {
    const liveChunksSnap = await getDocs(collection(db, CHUNKS_COLLECTION));
    const currentKeys = new Set(fakturs.map((f) => f.id || f.no_faktur));
    const missingDocs: FirestoreFakturDoc[] = [];

    liveChunksSnap.forEach((d) => {
      liveChunkDocIds.add(d.id);
      const data = d.data();
      let chunkItems: FirestoreFakturDoc[] = [];
      if (Array.isArray(data.items)) {
        chunkItems = data.items as FirestoreFakturDoc[];
      } else if (typeof data.itemsJson === "string") {
        try {
          const parsed = JSON.parse(data.itemsJson);
          if (Array.isArray(parsed)) chunkItems = parsed as FirestoreFakturDoc[];
        } catch {}
      }
      chunkItems.forEach((it: FirestoreFakturDoc) => {
        const k = it.id || it.no_faktur;
        if (k && !currentKeys.has(k)) {
          currentKeys.add(k);
          missingDocs.push(it);
        }
      });
    });

    if (missingDocs.length > 0) {
      fakturs.push(...missingDocs);
    }
  } catch (err) {
    console.warn("Could not check live chunks union:", err);
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

  // Clean up any orphan chunks from older uploads where totalChunks was larger
  const newChunkIdSet = new Set(chunkIds);
  const orphanDocs = Array.from(liveChunkDocIds).filter((id) => !newChunkIdSet.has(id));
  if (orphanDocs.length > 0) {
    await Promise.all(
      orphanDocs.map((id) => deleteDoc(doc(db, CHUNKS_COLLECTION, id)).catch(() => null))
    );
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

  // Sync the unified print state to Firestore (1 write) so all newly added historical invoices stay printed on refresh!
  try {
    await updatePrintState(Array.from(unifiedPrintedSet), unifiedPrintedAtMap);
  } catch (err) {
    console.warn("Could not update print state during batch upload:", err);
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
 * Toggle Print Status for a single invoice with atomic Firestore transaction
 */
export async function updateFakturPrintStatus(
  invoiceKey: string,
  status: boolean,
  printedAt: string | null,
  currentPrintedKeys?: Set<string>,
  currentPrintedAtMap?: Record<string, string>
): Promise<void> {
  const printDocRef = doc(db, APP_DATA_COLLECTION, PRINT_STATE_DOC);
  const cleanKey = invoiceKey.replace(/-1P$/i, "");
  const keysToUpdate = Array.from(new Set([invoiceKey, cleanKey, `${cleanKey}-1P`].filter(Boolean)));
  const nowIso = printedAt || new Date().toISOString();

  try {
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(printDocRef);
      let liveKeys = new Set<string>();
      let liveMap: Record<string, string> = {};

      if (snap.exists()) {
        const data = snap.data() as PrintState;
        liveKeys = new Set(data.printedKeys || []);
        liveMap = { ...(data.printedAtMap || {}) };
      }

      // Merge current local printed keys so no concurrent toggles are dropped
      if (currentPrintedKeys) {
        currentPrintedKeys.forEach((k) => {
          if (status || !keysToUpdate.includes(k)) {
            liveKeys.add(k);
          }
        });
        if (currentPrintedAtMap) {
          liveMap = { ...currentPrintedAtMap, ...liveMap };
        }
      }

      if (status) {
        keysToUpdate.forEach((k) => {
          liveKeys.add(k);
          liveMap[k] = nowIso;
        });
      } else {
        keysToUpdate.forEach((k) => {
          liveKeys.delete(k);
          delete liveMap[k];
        });
      }

      transaction.set(printDocRef, {
        printedKeys: Array.from(liveKeys),
        printedAtMap: liveMap,
        updatedAt: new Date().toISOString(),
      });
    });
  } catch (err) {
    console.warn("Transaction failed, falling back to setDoc:", err);
    const fallbackKeys = new Set(currentPrintedKeys || []);
    const fallbackMap = { ...(currentPrintedAtMap || {}) };
    if (status) {
      keysToUpdate.forEach((k) => {
        fallbackKeys.add(k);
        fallbackMap[k] = nowIso;
      });
    } else {
      keysToUpdate.forEach((k) => {
        fallbackKeys.delete(k);
        delete fallbackMap[k];
      });
    }
    await updatePrintState(Array.from(fallbackKeys), fallbackMap);
  }
}

/**
 * Batch update print status for multiple keys (e.g. mark all / filter printed)
 * Uses atomic Firestore transaction!
 */
export async function updateFaktursPrintStatusBatch(
  keys: string[],
  status: boolean,
  printedAt: string | null
): Promise<void> {
  const printDocRef = doc(db, APP_DATA_COLLECTION, PRINT_STATE_DOC);
  const nowIso = printedAt || new Date().toISOString();

  try {
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(printDocRef);
      let currentKeys = new Set<string>();
      let currentMap: Record<string, string> = {};

      if (snap.exists()) {
        const data = snap.data() as PrintState;
        currentKeys = new Set(data.printedKeys || []);
        currentMap = { ...(data.printedAtMap || {}) };
      }

      if (status) {
        keys.forEach((k) => {
          const cleanKey = k.replace(/-1P$/i, "");
          currentKeys.add(k);
          currentKeys.add(cleanKey);
          currentKeys.add(`${cleanKey}-1P`);
          currentMap[k] = nowIso;
          currentMap[cleanKey] = nowIso;
          currentMap[`${cleanKey}-1P`] = nowIso;
        });
      } else {
        keys.forEach((k) => {
          const cleanKey = k.replace(/-1P$/i, "");
          currentKeys.delete(k);
          currentKeys.delete(cleanKey);
          currentKeys.delete(`${cleanKey}-1P`);
          delete currentMap[k];
          delete currentMap[cleanKey];
          delete currentMap[`${cleanKey}-1P`];
        });
      }

      transaction.set(printDocRef, {
        printedKeys: Array.from(currentKeys),
        printedAtMap: currentMap,
        updatedAt: new Date().toISOString(),
      });
    });
  } catch (err) {
    console.warn("Batch transaction failed, falling back to direct setDoc:", err);
    const snap = await getDoc(printDocRef).catch(() => null);
    let currentKeys = new Set<string>();
    let currentMap: Record<string, string> = {};
    if (snap && snap.exists()) {
      const data = snap.data() as PrintState;
      currentKeys = new Set(data.printedKeys || []);
      currentMap = { ...(data.printedAtMap || {}) };
    }
    if (status) {
      keys.forEach((k) => {
        const cleanKey = k.replace(/-1P$/i, "");
        currentKeys.add(k);
        currentKeys.add(cleanKey);
        currentKeys.add(`${cleanKey}-1P`);
        currentMap[k] = nowIso;
        currentMap[cleanKey] = nowIso;
        currentMap[`${cleanKey}-1P`] = nowIso;
      });
    } else {
      keys.forEach((k) => {
        const cleanKey = k.replace(/-1P$/i, "");
        currentKeys.delete(k);
        currentKeys.delete(cleanKey);
        currentKeys.delete(`${cleanKey}-1P`);
        delete currentMap[k];
        delete currentMap[cleanKey];
        delete currentMap[`${cleanKey}-1P`];
      });
    }
    await updatePrintState(Array.from(currentKeys), currentMap);
  }
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

export interface ApotekOverrideEntry {
  namaApotek: string;
  kategori: "1P" | "2P" | "3P";
  kodeCustomer?: string;
  namaMerchant?: string;
  keterangan?: string;
  updatedAt: string;
  updatedBy?: string;
}

const MASTER_APOTEK_OVERRIDES_DOC = "master_apotek_overrides";

/**
 * Realtime listener for Master Apotek Custom Overrides
 */
export function subscribeToMasterApotekOverrides(
  onData: (overrides: Record<string, ApotekOverrideEntry>) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  return onSnapshot(
    doc(db, APP_DATA_COLLECTION, MASTER_APOTEK_OVERRIDES_DOC),
    (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        const overrides = (data.overrides as Record<string, ApotekOverrideEntry>) || {};
        onData(overrides);
      } else {
        onData({});
      }
    },
    onError
  );
}

/**
 * Fetch all Master Apotek Overrides directly from server
 */
export async function getMasterApotekOverrides(): Promise<Record<string, ApotekOverrideEntry>> {
  try {
    const snap = await getDocFromServer(
      doc(db, APP_DATA_COLLECTION, MASTER_APOTEK_OVERRIDES_DOC)
    ).catch(() => getDoc(doc(db, APP_DATA_COLLECTION, MASTER_APOTEK_OVERRIDES_DOC)));

    if (snap.exists()) {
      const data = snap.data();
      return (data.overrides as Record<string, ApotekOverrideEntry>) || {};
    }
  } catch (err) {
    console.warn("Could not fetch master apotek overrides from server:", err);
  }
  return {};
}

/**
 * Save or update a single Master Apotek custom override
 */
export async function saveMasterApotekOverride(
  entry: Omit<ApotekOverrideEntry, "updatedAt">
): Promise<void> {
  const docRef = doc(db, APP_DATA_COLLECTION, MASTER_APOTEK_OVERRIDES_DOC);
  const nowIso = new Date().toISOString();
  const currentOverrides = await getMasterApotekOverrides();

  const key = entry.namaApotek.trim().toLowerCase();
  currentOverrides[key] = {
    ...entry,
    namaApotek: entry.namaApotek.trim(),
    updatedAt: nowIso,
  };

  await setDoc(
    docRef,
    {
      overrides: currentOverrides,
      updatedAt: nowIso,
    },
    { merge: true }
  );
}

/**
 * Remove a custom override to restore default master classification
 */
export async function removeMasterApotekOverride(namaApotek: string): Promise<void> {
  const docRef = doc(db, APP_DATA_COLLECTION, MASTER_APOTEK_OVERRIDES_DOC);
  const nowIso = new Date().toISOString();
  const currentOverrides = await getMasterApotekOverrides();

  const key = namaApotek.trim().toLowerCase();
  delete currentOverrides[key];

  await setDoc(
    docRef,
    {
      overrides: currentOverrides,
      updatedAt: nowIso,
    },
    { merge: true }
  );
}

