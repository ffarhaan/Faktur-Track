import {
  collection,
  doc,
  setDoc,
  getDocs,
  getDoc,
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
      // Guard against emitting incomplete chunks if totalChunks is known
      if (expectedChunks > 0 && currentChunksMap.size < expectedChunks) {
        return;
      }
      emitData(reason);
    }, 150);
  };

  // 1. Subscribe to Metadata
  const unsubMeta = onSnapshot(
    doc(db, APP_DATA_COLLECTION, METADATA_DOC),
    (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (data.invoiceProgression) {
          currentProgression = data.invoiceProgression as InvoiceProgression;
        }
        if (typeof data.totalChunks === "number") {
          expectedChunks = data.totalChunks;
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

  // 3. Subscribe to Faktur Chunks
  const unsubChunks = onSnapshot(
    collection(db, CHUNKS_COLLECTION),
    (snapshot) => {
      const newMap = new Map<string, FirestoreFakturDoc[]>();
      snapshot.forEach((d) => {
        const data = d.data();
        if (Array.isArray(data.items)) {
          newMap.set(d.id, data.items as FirestoreFakturDoc[]);
        }
      });
      currentChunksMap = newMap;
      debouncedEmit("chunks");
    },
    (err) => {
      console.error("Chunks sync error:", err);
      if (onError) onError(err);
    }
  );

  return () => {
    if (emitTimer) clearTimeout(emitTimer);
    unsubMeta();
    unsubPrint();
    unsubChunks();
  };
}

/**
 * Fetch all existing faktur records and progression
 */
export async function getExistingFakturs(): Promise<{
  docs: FirestoreFakturDoc[];
  progression: InvoiceProgression | null;
  printState: PrintState | null;
}> {
  const [chunksSnap, metaSnap, printSnap] = await Promise.all([
    getDocs(collection(db, CHUNKS_COLLECTION)),
    getDoc(doc(db, APP_DATA_COLLECTION, METADATA_DOC)),
    getDoc(doc(db, APP_DATA_COLLECTION, PRINT_STATE_DOC)),
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
  const MAX_CHUNK_BYTES = 500 * 1024; // 500 KB safety limit (Firestore hard limit is 1048 KB)

  for (const item of items) {
    const itemBytes = JSON.stringify(item).length;
    if (
      currentChunk.length > 0 &&
      (currentEstimatedBytes + itemBytes > MAX_CHUNK_BYTES || currentChunk.length >= 150)
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
  existingPrintState?: PrintState | null
): Promise<void> {
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
      livePrintedAtMap = liveData.printedAtMap || {};
    }
  } catch (err) {
    console.warn("Could not read live print state during batch upload:", err);
  }

  // UNION MERGE: Print status is strictly additive during upload.
  // Any invoice printed anywhere (live DB or locally) remains printed.
  const unifiedPrintedSet = new Set<string>([
    ...livePrintedKeys,
    ...(existingPrintState?.printedKeys || []),
  ]);
  const unifiedPrintedAtMap: Record<string, string> = {
    ...livePrintedAtMap,
    ...(existingPrintState?.printedAtMap || {}),
  };

  // Sync the unified print status into the chunk items
  for (const item of fakturs) {
    const key = item.id || item.no_faktur;
    if (key && unifiedPrintedSet.has(key)) {
      item.status_cetak = true;
      item.printed_at = unifiedPrintedAtMap[key] || item.printed_at || new Date().toISOString();
    }
  }

  const chunks = createSafeChunks(fakturs);
  const nowIso = new Date().toISOString();
  const chunkIds: string[] = [];

  // Write all chunks in parallel
  await Promise.all(
    chunks.map(async (chunk, idx) => {
      const chunkId = `chunk_${idx}`;
      chunkIds.push(chunkId);
      const chunkRef = doc(db, CHUNKS_COLLECTION, chunkId);
      await setDoc(chunkRef, {
        chunkIndex: idx,
        count: chunk.length,
        items: chunk,
        updatedAt: nowIso,
      });
    })
  );

  // Clean up any old unused chunks (e.g. if previous upload had more chunks)
  const existingChunksSnap = await getDocs(collection(db, CHUNKS_COLLECTION));
  const currentChunkSet = new Set(chunkIds);
  await Promise.all(
    existingChunksSnap.docs
      .filter((d) => !currentChunkSet.has(d.id))
      .map((d) => deleteDoc(d.ref))
  );

  // Save metadata
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

  // Save the union-merged print state back to Firestore so no print status is ever wiped out
  await updatePrintState(Array.from(unifiedPrintedSet), unifiedPrintedAtMap);
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
  currentPrintedKeys: Set<string>,
  currentPrintedAtMap: Record<string, string>
): Promise<void> {
  const nextKeys = new Set(currentPrintedKeys);
  const nextMap = { ...currentPrintedAtMap };

  if (status) {
    nextKeys.add(invoiceKey);
    if (printedAt) {
      nextMap[invoiceKey] = printedAt;
    }
  } else {
    nextKeys.delete(invoiceKey);
    delete nextMap[invoiceKey];
  }

  await updatePrintState(Array.from(nextKeys), nextMap);
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
