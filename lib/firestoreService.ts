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
  Unsubscribe,
} from "firebase/firestore";
import { db } from "./firebase";
import { FirestoreFakturDoc, PrintState, InvoiceProgression } from "./types";

export type { FirestoreFakturDoc, PrintState, InvoiceProgression };

const APP_DATA_COLLECTION = "app_data";
const METADATA_DOC = "metadata";
const PRINT_STATE_DOC = "print_state";
const CHUNKS_COLLECTION = "faktur_chunks";

export type SubscribeChangeReason = "chunks" | "print" | "meta";

/**
 * Realtime listener for Chunked Fakturs and Print State
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

  const unsubChunks = onSnapshot(
    collection(db, CHUNKS_COLLECTION),
    (snap) => {
      const newMap = new Map<string, FirestoreFakturDoc[]>();
      snap.forEach((d) => {
        const dData = d.data();
        if (Array.isArray(dData.items)) {
          newMap.set(d.id, dData.items as FirestoreFakturDoc[]);
        }
      });
      currentChunksMap = newMap;
      emitData("chunks");
    },
    (err) => {
      console.warn("Chunks realtime stream error:", err);
      onError?.(err);
    }
  );

  const unsubPrint = onSnapshot(
    doc(db, APP_DATA_COLLECTION, PRINT_STATE_DOC),
    (snap) => {
      if (snap.exists()) {
        currentPrintState = snap.data() as PrintState;
      }
      if (hasEmittedInitialChunks) {
        onData([], currentProgression, currentPrintState, "print");
      }
    },
    (err) => console.warn("PrintState sync warning:", err)
  );

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
        onData([], currentProgression, currentPrintState, "meta");
      }
    },
    (err) => console.warn("Metadata sync warning:", err)
  );

  return () => {
    unsubChunks();
    unsubMeta();
    unsubPrint();
  };
}

/**
 * Fetch all existing fakturs and metadata directly from server
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
      const cleanKey = key.replace(/-1P$/i, "");
      const isPrinted = printedSet.has(key) || printedSet.has(cleanKey) || printedSet.has(`${cleanKey}-1P`);
      d.status_cetak = isPrinted;
      d.printed_at = pMap[key] || pMap[cleanKey] || pMap[`${cleanKey}-1P`] || null;
    }
  }

  return { docs, progression, printState };
}

/**
 * Split items into safe chunks (< 600 KB per document, max 300 items)
 */
function createSafeChunks(items: FirestoreFakturDoc[]): FirestoreFakturDoc[][] {
  const chunks: FirestoreFakturDoc[][] = [];
  let currentChunk: FirestoreFakturDoc[] = [];
  let currentEstimatedBytes = 0;
  const MAX_CHUNK_BYTES = 600 * 1024; // 600 KB safe limit

  for (const item of items) {
    const itemBytes = JSON.stringify(item).length;
    if (
      currentChunk.length > 0 &&
      (currentEstimatedBytes + itemBytes > MAX_CHUNK_BYTES || currentChunk.length >= 300)
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
 */
export async function saveFaktursBatch(
  fakturs: FirestoreFakturDoc[],
  progression?: InvoiceProgression | null,
  existingPrintState?: PrintState | null,
  newUnprintedKeys?: string[]
): Promise<void> {
  const newUnprintedSet = new Set(newUnprintedKeys || []);

  let livePrintedKeys: string[] = [];
  let livePrintedAtMap: Record<string, string> = {};
  let previousChunkIds: string[] = [];

  try {
    const [printSnap, metaSnap] = await Promise.all([
      getDoc(doc(db, APP_DATA_COLLECTION, PRINT_STATE_DOC)),
      getDoc(doc(db, APP_DATA_COLLECTION, METADATA_DOC)),
    ]);
    if (printSnap.exists()) {
      const liveData = printSnap.data() as PrintState;
      livePrintedKeys = (liveData.printedKeys || []).filter((k) => !newUnprintedSet.has(k));
      livePrintedAtMap = { ...(liveData.printedAtMap || {}) };
      newUnprintedSet.forEach((k) => delete livePrintedAtMap[k]);
    }
    if (metaSnap.exists()) {
      previousChunkIds = (metaSnap.data().chunkIds as string[]) || [];
    }
  } catch (err) {
    console.warn("Could not read live print state or metadata:", err);
  }

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

  // Write chunks in concurrent batches of 16
  const BATCH_CONCURRENCY = 16;
  for (let i = 0; i < chunks.length; i += BATCH_CONCURRENCY) {
    const slice = chunks.slice(i, i + BATCH_CONCURRENCY);
    await Promise.all(
      slice.map(async (chunk, sIdx) => {
        const idx = i + sIdx;
        const chunkId = `chunk_${idx}`;
        const chunkRef = doc(db, CHUNKS_COLLECTION, chunkId);
        await setDoc(chunkRef, {
          chunkIndex: idx,
          count: chunk.length,
          items: chunk,
          updatedAt: nowIso,
        });
      })
    );
  }

  // Remove orphan chunks
  const newChunkIdSet = new Set(chunkIds);
  const orphanDocs = previousChunkIds.filter((id) => !newChunkIdSet.has(id));
  if (orphanDocs.length > 0) {
    await Promise.all(
      orphanDocs.map((id) => deleteDoc(doc(db, CHUNKS_COLLECTION, id)).catch(() => null))
    );
  }

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

  // Sync print state
  await updatePrintState(Array.from(unifiedPrintedSet), unifiedPrintedAtMap);
}

/**
 * Update Print State in a single fast document write (< 50ms)
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
 * Toggle Print Status for a single invoice key
 */
export async function updateFakturPrintStatus(
  invoiceKey: string,
  status: boolean,
  printedAt: string | null
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
    }
  } catch (err) {
    console.warn("Could not read live print state:", err);
  }

  if (status) {
    liveKeys.add(invoiceKey);
    if (printedAt) liveMap[invoiceKey] = printedAt;
  } else {
    liveKeys.delete(invoiceKey);
    delete liveMap[invoiceKey];
  }

  await updatePrintState(Array.from(liveKeys), liveMap);
}

/**
 * Batch update print status for multiple keys
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
 * Update Category (1P / 2P / 3P) for an invoice in Firestore chunks
 */
export async function updateFakturCategory(
  invoiceKey: string,
  newKategori: "1P" | "2P" | "3P"
): Promise<void> {
  const metaSnap = await getDoc(doc(db, APP_DATA_COLLECTION, METADATA_DOC));
  const chunkIds = (metaSnap.exists() ? (metaSnap.data().chunkIds as string[]) : []) || [];

  for (const chunkId of chunkIds) {
    const chunkRef = doc(db, CHUNKS_COLLECTION, chunkId);
    const cSnap = await getDoc(chunkRef);
    if (cSnap.exists()) {
      const data = cSnap.data();
      let updated = false;
      const items = (data.items as FirestoreFakturDoc[]) || [];
      for (const item of items) {
        const k = item.id || item.no_faktur;
        if (k === invoiceKey || k.replace(/-1P$/i, "") === invoiceKey.replace(/-1P$/i, "")) {
          item.kategori = newKategori;
          if (item.extra) item.extra.kategori = newKategori;
          updated = true;
        }
      }
      if (updated) {
        await setDoc(chunkRef, { ...data, items, updatedAt: new Date().toISOString() });
        return;
      }
    }
  }
}

/**
 * Delete all Faktur chunks and reset database completely
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
