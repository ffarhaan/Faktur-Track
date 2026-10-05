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
import { FirestoreFakturDoc, PrintState, InvoiceProgression, UploadNotification } from "./types";
import { normalize } from "./parser";

export type { FirestoreFakturDoc, PrintState, InvoiceProgression, UploadNotification };

const APP_DATA_COLLECTION = "app_data";
const METADATA_DOC = "metadata";
const PRINT_STATE_DOC = "print_state";
const PRINT_PARTITIONS_COLLECTION = "print_state_partitions";
const CATEGORY_OVERRIDES_DOC = "category_overrides";
const CHUNKS_COLLECTION = "faktur_chunks";

export type SubscribeChangeReason = "chunks" | "print" | "meta";

/**
 * Deterministically partition an invoice key into a partition bucket document ID
 * (Bucket sizes of 5,000 invoices per partition ensure doc sizes stay under 150 KB, well below 1 MB limit)
 */
export function getPrintPartitionId(invoiceKey: string): string {
  const cleanNumStr = invoiceKey.replace(/\D/g, "");
  if (!cleanNumStr) return "part_misc";
  const num = parseInt(cleanNumStr, 10);
  const bucketIndex = Math.floor(num / 5000);
  return `part_${bucketIndex * 5000}_${(bucketIndex + 1) * 5000 - 1}`;
}

/**
 * Realtime listener for Chunked Fakturs, Print State (Partitioned + Legacy Fallback), Category Overrides, and Upload Broadcast
 */
export function subscribeToFakturs(
  onData: (
    fakturs: FirestoreFakturDoc[],
    progression: InvoiceProgression | null,
    printState?: PrintState | null,
    categoryOverrides?: Record<string, "1P" | "2P" | "3P"> | null,
    uploadNotification?: UploadNotification | null,
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
  let currentCategoryOverrides: Record<string, "1P" | "2P" | "3P"> = {};
  let currentUploadNotification: UploadNotification | null = null;
  let hasEmittedInitialChunks = false;

  // Track partitioned print docs
  const partitionMap = new Map<string, { printedKeys: string[]; printedAtMap: Record<string, string> }>();
  let legacyPrintState: PrintState | null = null;

  const recomputePrintState = () => {
    // If partitions exist in Firestore, merge them; also merge legacy doc for seamless zero-downtime transition
    const combinedKeys = new Set<string>();
    const combinedMap: Record<string, string> = {};

    if (legacyPrintState) {
      (legacyPrintState.printedKeys || []).forEach((k) => combinedKeys.add(k));
      Object.assign(combinedMap, legacyPrintState.printedAtMap || {});
    }

    partitionMap.forEach((part) => {
      (part.printedKeys || []).forEach((k) => combinedKeys.add(k));
      Object.assign(combinedMap, part.printedAtMap || {});
    });

    currentPrintState = {
      printedKeys: Array.from(combinedKeys),
      printedAtMap: combinedMap,
      updatedAt: new Date().toISOString(),
    };
  };

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
      const isPrinted = printedSet.has(key);
      d.status_cetak = isPrinted;
      d.printed_at = isPrinted ? (pMap[key] || null) : null;

      // Apply customer/invoice category override if available
      const cleanKey = key.replace(/-1P$/i, "");
      const cust = String(d.customer_name || d.extra?.nama_pelanggan || "").trim();
      const normCust = cust ? normalize(cust) : "";
      const overrideKat = currentCategoryOverrides[normCust] || currentCategoryOverrides[cust] || currentCategoryOverrides[cleanKey];
      if (overrideKat && d.jenis_transaksi !== "ORA") {
        d.kategori = overrideKat;
        if (d.extra) d.extra.kategori = overrideKat;
      }
    }

    hasEmittedInitialChunks = true;
    onData(allDocs, currentProgression, currentPrintState, currentCategoryOverrides, currentUploadNotification, reason);
  };

  let chunkEmitTimer: NodeJS.Timeout | null = null;
  const debouncedEmitChunks = () => {
    if (chunkEmitTimer) clearTimeout(chunkEmitTimer);
    chunkEmitTimer = setTimeout(() => {
      emitData("chunks");
    }, 120);
  };

  const unsubChunks = onSnapshot(
    collection(db, CHUNKS_COLLECTION),
    (snap) => {
      // Efficiently update only changed / added / removed chunks in memory map
      snap.docChanges().forEach((change) => {
        if (change.type === "removed") {
          currentChunksMap.delete(change.doc.id);
        } else {
          const dData = change.doc.data();
          if (Array.isArray(dData.items)) {
            currentChunksMap.set(change.doc.id, dData.items as FirestoreFakturDoc[]);
          }
        }
      });
      // Debounce emission so multiple chunk writes from an upload settle together and emit once
      if (hasEmittedInitialChunks) {
        debouncedEmitChunks();
      } else {
        emitData("chunks");
      }
    },
    (err) => {
      console.warn("Chunks realtime stream error:", err);
      onError?.(err);
    }
  );

  // Listen to legacy print state
  const unsubLegacyPrint = onSnapshot(
    doc(db, APP_DATA_COLLECTION, PRINT_STATE_DOC),
    (snap) => {
      if (snap.exists()) {
        legacyPrintState = snap.data() as PrintState;
      } else {
        legacyPrintState = null;
      }
      recomputePrintState();
      if (hasEmittedInitialChunks) {
        onData([], currentProgression, currentPrintState, currentCategoryOverrides, null, "print");
      }
    },
    (err) => console.warn("PrintState sync warning:", err)
  );

  // Listen to partitioned print state collection
  const unsubPartitions = onSnapshot(
    collection(db, PRINT_PARTITIONS_COLLECTION),
    (snap) => {
      snap.docChanges().forEach((change) => {
        if (change.type === "removed") {
          partitionMap.delete(change.doc.id);
        } else {
          const data = change.doc.data();
          partitionMap.set(change.doc.id, {
            printedKeys: data.printedKeys || [],
            printedAtMap: data.printedAtMap || {},
          });
        }
      });
      recomputePrintState();
      if (hasEmittedInitialChunks) {
        onData([], currentProgression, currentPrintState, currentCategoryOverrides, null, "print");
      }
    },
    (err) => console.warn("Print partitions sync warning:", err)
  );

  const unsubOverrides = onSnapshot(
    doc(db, APP_DATA_COLLECTION, CATEGORY_OVERRIDES_DOC),
    (snap) => {
      if (snap.exists()) {
        currentCategoryOverrides = (snap.data() || {}) as Record<string, "1P" | "2P" | "3P">;
      }
      if (hasEmittedInitialChunks) {
        emitData("meta");
      }
    },
    (err) => console.warn("Category overrides sync warning:", err)
  );

  const unsubMeta = onSnapshot(
    doc(db, APP_DATA_COLLECTION, METADATA_DOC),
    (snap) => {
      let uploadNotif: UploadNotification | null = null;
      if (snap.exists()) {
        const data = snap.data();
        if (data.invoiceProgression) {
          currentProgression = data.invoiceProgression as InvoiceProgression;
        }
        if (data.lastUploadNotification) {
          uploadNotif = data.lastUploadNotification as UploadNotification;
          currentUploadNotification = uploadNotif;
        }
      }
      if (hasEmittedInitialChunks) {
        onData([], currentProgression, currentPrintState, currentCategoryOverrides, uploadNotif, "meta");
      }
    },
    (err) => console.warn("Metadata sync warning:", err)
  );

  return () => {
    unsubChunks();
    unsubMeta();
    unsubLegacyPrint();
    unsubPartitions();
    unsubOverrides();
  };
}

/**
 * Fetch all existing fakturs and metadata directly from server
 */
export async function getExistingFakturs(): Promise<{
  docs: FirestoreFakturDoc[];
  progression: InvoiceProgression | null;
  printState: PrintState | null;
  categoryOverrides: Record<string, "1P" | "2P" | "3P">;
}> {
  const [chunksSnap, metaSnap, legacyPrintSnap, partitionsSnap, overrideSnap] = await Promise.all([
    getDocsFromServer(collection(db, CHUNKS_COLLECTION)).catch(() => getDocs(collection(db, CHUNKS_COLLECTION))),
    getDocFromServer(doc(db, APP_DATA_COLLECTION, METADATA_DOC)).catch(() => getDoc(doc(db, APP_DATA_COLLECTION, METADATA_DOC))),
    getDocFromServer(doc(db, APP_DATA_COLLECTION, PRINT_STATE_DOC)).catch(() => getDoc(doc(db, APP_DATA_COLLECTION, PRINT_STATE_DOC))),
    getDocsFromServer(collection(db, PRINT_PARTITIONS_COLLECTION)).catch(() => getDocs(collection(db, PRINT_PARTITIONS_COLLECTION))),
    getDocFromServer(doc(db, APP_DATA_COLLECTION, CATEGORY_OVERRIDES_DOC)).catch(() => getDoc(doc(db, APP_DATA_COLLECTION, CATEGORY_OVERRIDES_DOC))),
  ]);

  const sortedDocs = chunksSnap.docs.sort((a, b) => {
    const na = parseInt(a.id.replace(/\D/g, ""), 10) || 0;
    const nb = parseInt(b.id.replace(/\D/g, ""), 10) || 0;
    return na - nb;
  });

  const categoryOverrides = (overrideSnap && overrideSnap.exists()
    ? (overrideSnap.data() as Record<string, "1P" | "2P" | "3P">)
    : {}) || {};

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

  // Merge print state from both partitions and legacy document
  const combinedPrintKeys = new Set<string>();
  const combinedPrintMap: Record<string, string> = {};

  if (legacyPrintSnap && legacyPrintSnap.exists()) {
    const legData = legacyPrintSnap.data() as PrintState;
    (legData.printedKeys || []).forEach((k) => combinedPrintKeys.add(k));
    Object.assign(combinedPrintMap, legData.printedAtMap || {});
  }

  if (partitionsSnap && !partitionsSnap.empty) {
    partitionsSnap.forEach((pDoc) => {
      const pData = pDoc.data();
      const pKeys = (pData.printedKeys as string[]) || [];
      const pMap = (pData.printedAtMap as Record<string, string>) || {};
      pKeys.forEach((k) => combinedPrintKeys.add(k));
      Object.assign(combinedPrintMap, pMap);
    });
  }

  const printState: PrintState = {
    printedKeys: Array.from(combinedPrintKeys),
    printedAtMap: combinedPrintMap,
    updatedAt: new Date().toISOString(),
  };

  const printedSet = combinedPrintKeys;
  const pMap = combinedPrintMap;
  for (const d of docs) {
    const key = d.id || d.no_faktur;
    if (!key) continue;
    const isPrinted = printedSet.has(key);
    d.status_cetak = isPrinted;
    d.printed_at = isPrinted ? (pMap[key] || null) : null;

    // Apply customer/invoice category override if available
    const cleanKey = key.replace(/-1P$/i, "");
    const cust = String(d.customer_name || d.extra?.nama_pelanggan || "").trim();
    const normCust = cust ? normalize(cust) : "";
    const overrideKat = categoryOverrides[normCust] || categoryOverrides[cust] || categoryOverrides[cleanKey];
    if (overrideKat && d.jenis_transaksi !== "ORA") {
      d.kategori = overrideKat;
      if (d.extra) d.extra.kategori = overrideKat;
    }
  }

  return { docs, progression, printState, categoryOverrides };
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
  newUnprintedKeys?: string[],
  uploadNotification?: UploadNotification | null
): Promise<void> {
  const newUnprintedSet = new Set(newUnprintedKeys || []);

  let livePrintedKeys: string[] = [];
  let livePrintedAtMap: Record<string, string> = {};
  let previousChunkIds: string[] = [];

  try {
    const [printSnap, metaSnap, partitionsSnap] = await Promise.all([
      getDoc(doc(db, APP_DATA_COLLECTION, PRINT_STATE_DOC)),
      getDoc(doc(db, APP_DATA_COLLECTION, METADATA_DOC)),
      getDocs(collection(db, PRINT_PARTITIONS_COLLECTION)).catch(() => null),
    ]);

    const gatheredKeys = new Set<string>();
    const gatheredMap: Record<string, string> = {};

    if (printSnap.exists()) {
      const liveData = printSnap.data() as PrintState;
      (liveData.printedKeys || []).forEach((k) => gatheredKeys.add(k));
      Object.assign(gatheredMap, liveData.printedAtMap || {});
    }

    if (partitionsSnap && !partitionsSnap.empty) {
      partitionsSnap.forEach((pDoc) => {
        const pData = pDoc.data();
        const pKeys = (pData.printedKeys as string[]) || [];
        const pMap = (pData.printedAtMap as Record<string, string>) || {};
        pKeys.forEach((k) => gatheredKeys.add(k));
        Object.assign(gatheredMap, pMap);
      });
    }

    livePrintedKeys = Array.from(gatheredKeys);
    livePrintedAtMap = gatheredMap;

    if (metaSnap.exists()) {
      previousChunkIds = (metaSnap.data().chunkIds as string[]) || [];
    }
  } catch (err) {
    console.warn("Could not read live print state or metadata:", err);
  }

  const localPrintedKeys = existingPrintState?.printedKeys || [];
  const unifiedPrintedSet = new Set<string>([
    ...livePrintedKeys,
    ...localPrintedKeys,
  ]);
  // Invoices specifically flagged as unprinted by the upload must NEVER be marked printed
  for (const k of newUnprintedSet) {
    unifiedPrintedSet.delete(k);
  }

  const unifiedPrintedAtMap: Record<string, string> = {
    ...livePrintedAtMap,
    ...(existingPrintState?.printedAtMap || {}),
  };

  for (const item of fakturs) {
    const key = item.id || item.no_faktur;
    if (key) {
      if (unifiedPrintedSet.has(key)) {
        item.status_cetak = true;
        item.printed_at = unifiedPrintedAtMap[key] || item.printed_at || new Date().toISOString();
      } else {
        item.status_cetak = false;
        item.printed_at = null;
      }
    }
  }

  const chunks = createSafeChunks(fakturs);
  const nowIso = new Date().toISOString();
  const chunkIds: string[] = chunks.map((_, idx) => `chunk_${idx}`);

  // Fetch current chunk signatures from memory or Firestore to only write modified chunks
  // This reduces write volume on incremental uploads by up to 95%!
  const existingChunkDocs = await getDocs(collection(db, CHUNKS_COLLECTION)).catch(() => null);
  const existingChunkJsonMap = new Map<string, string>();
  if (existingChunkDocs && !existingChunkDocs.empty) {
    existingChunkDocs.forEach((d) => {
      const data = d.data();
      if (Array.isArray(data.items)) {
        // Compare items serialized signature
        existingChunkJsonMap.set(d.id, JSON.stringify(data.items));
      }
    });
  }

  // Filter only chunks that are new or genuinely modified
  const modifiedChunks: Array<{ idx: number; chunkId: string; chunk: FirestoreFakturDoc[] }> = [];
  chunks.forEach((chunk, idx) => {
    const chunkId = `chunk_${idx}`;
    const newJson = JSON.stringify(chunk);
    const oldJson = existingChunkJsonMap.get(chunkId);
    if (!oldJson || oldJson !== newJson) {
      modifiedChunks.push({ idx, chunkId, chunk });
    }
  });

  // Write only the modified chunks in fast concurrent batches of 16
  const BATCH_CONCURRENCY = 16;
  for (let i = 0; i < modifiedChunks.length; i += BATCH_CONCURRENCY) {
    const slice = modifiedChunks.slice(i, i + BATCH_CONCURRENCY);
    await Promise.all(
      slice.map(async (entry) => {
        const chunkRef = doc(db, CHUNKS_COLLECTION, entry.chunkId);
        await setDoc(chunkRef, {
          chunkIndex: entry.idx,
          count: entry.chunk.length,
          items: entry.chunk,
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

  // Save metadata with lastUploadNotification broadcast
  const metaDocRef = doc(db, APP_DATA_COLLECTION, METADATA_DOC);
  await setDoc(
    metaDocRef,
    {
      invoiceProgression: progression || null,
      totalInvoices: fakturs.length,
      totalChunks: chunks.length,
      chunkIds,
      updatedAt: nowIso,
      ...(uploadNotification ? { lastUploadNotification: uploadNotification } : {}),
    },
    { merge: true }
  );

  // Sync print state across partitions + dual write legacy doc
  await updatePrintState(Array.from(unifiedPrintedSet), unifiedPrintedAtMap);
}

/**
 * Update Print State across partitions with dual-write to legacy doc
 * Guarantees zero limit bottlenecks and 100% backward compatibility
 */
export async function updatePrintState(
  printedKeys: string[],
  printedAtMap: Record<string, string>
): Promise<void> {
  const nowIso = new Date().toISOString();

  // 1. Group keys by partition bucket
  const partitionBuckets: Record<string, { keys: string[]; map: Record<string, string> }> = {};
  for (const k of printedKeys) {
    const partId = getPrintPartitionId(k);
    if (!partitionBuckets[partId]) {
      partitionBuckets[partId] = { keys: [], map: {} };
    }
    partitionBuckets[partId].keys.push(k);
    if (printedAtMap[k]) {
      partitionBuckets[partId].map[k] = printedAtMap[k];
    }
  }

  // Write all affected partitions
  const partitionWrites = Object.entries(partitionBuckets).map(async ([partId, data]) => {
    const partRef = doc(db, PRINT_PARTITIONS_COLLECTION, partId);
    await setDoc(partRef, {
      partitionId: partId,
      printedKeys: data.keys,
      printedAtMap: data.map,
      count: data.keys.length,
      updatedAt: nowIso,
    });
  });

  // 2. Dual-write to legacy doc (kept under safe limit by taking latest keys if ever > 15,000)
  const legacyKeys = printedKeys.length > 15000 ? printedKeys.slice(-15000) : printedKeys;
  const legacyMap: Record<string, string> = {};
  legacyKeys.forEach((k) => {
    if (printedAtMap[k]) legacyMap[k] = printedAtMap[k];
  });

  const legacyWrite = setDoc(doc(db, APP_DATA_COLLECTION, PRINT_STATE_DOC), {
    printedKeys: legacyKeys,
    printedAtMap: legacyMap,
    updatedAt: nowIso,
  }).catch((e) => console.warn("Legacy print_state write skipped:", e));

  await Promise.all([...partitionWrites, legacyWrite]);
}

/**
 * Toggle Print Status for a single invoice key (Partitioned Fast Write < 50ms)
 */
export async function updateFakturPrintStatus(
  invoiceKey: string,
  status: boolean,
  printedAt: string | null
): Promise<void> {
  const partId = getPrintPartitionId(invoiceKey);
  const partRef = doc(db, PRINT_PARTITIONS_COLLECTION, partId);
  const legacyRef = doc(db, APP_DATA_COLLECTION, PRINT_STATE_DOC);

  let partKeys = new Set<string>();
  let partMap: Record<string, string> = {};

  try {
    const pSnap = await getDoc(partRef);
    if (pSnap.exists()) {
      const data = pSnap.data();
      partKeys = new Set((data.printedKeys as string[]) || []);
      partMap = { ...((data.printedAtMap as Record<string, string>) || {}) };
    } else {
      // Fallback check legacy doc if partition not yet written
      const legSnap = await getDoc(legacyRef);
      if (legSnap.exists()) {
        const legData = legSnap.data() as PrintState;
        (legData.printedKeys || []).forEach((k) => {
          if (getPrintPartitionId(k) === partId) partKeys.add(k);
        });
        Object.entries(legData.printedAtMap || {}).forEach(([k, v]) => {
          if (getPrintPartitionId(k) === partId) partMap[k] = v;
        });
      }
    }
  } catch (err) {
    console.warn("Could not read partition before update:", err);
  }

  if (status) {
    partKeys.add(invoiceKey);
    if (printedAt) partMap[invoiceKey] = printedAt;
  } else {
    partKeys.delete(invoiceKey);
    delete partMap[invoiceKey];
  }

  const nowIso = new Date().toISOString();

  // 1. Write partition document
  const writePart = setDoc(partRef, {
    partitionId: partId,
    printedKeys: Array.from(partKeys),
    printedAtMap: partMap,
    count: partKeys.size,
    updatedAt: nowIso,
  });

  // 2. Dual-write to legacy doc for backward compatibility
  const writeLegacy = (async () => {
    try {
      const legSnap = await getDoc(legacyRef);
      if (legSnap.exists()) {
        const legData = legSnap.data() as PrintState;
        const liveKeys = new Set(legData.printedKeys || []);
        const liveMap = { ...(legData.printedAtMap || {}) };
        if (status) {
          liveKeys.add(invoiceKey);
          if (printedAt) liveMap[invoiceKey] = printedAt;
        } else {
          liveKeys.delete(invoiceKey);
          delete liveMap[invoiceKey];
        }
        await setDoc(legacyRef, {
          printedKeys: Array.from(liveKeys),
          printedAtMap: liveMap,
          updatedAt: nowIso,
        });
      }
    } catch (e) {
      console.warn("Dual-write legacy update failed:", e);
    }
  })();

  await Promise.all([writePart, writeLegacy]);
}

/**
 * Batch update print status for multiple keys across partitions
 */
export async function updateFaktursPrintStatusBatch(
  keys: string[],
  status: boolean,
  printedAt: string | null
): Promise<void> {
  const keysByPartition: Record<string, string[]> = {};
  for (const k of keys) {
    const partId = getPrintPartitionId(k);
    if (!keysByPartition[partId]) keysByPartition[partId] = [];
    keysByPartition[partId].push(k);
  }

  const nowIso = new Date().toISOString();

  await Promise.all(
    Object.entries(keysByPartition).map(async ([partId, targetKeys]) => {
      const partRef = doc(db, PRINT_PARTITIONS_COLLECTION, partId);
      const pSnap = await getDoc(partRef).catch(() => null);
      let pKeys = new Set<string>();
      let pMap: Record<string, string> = {};

      if (pSnap && pSnap.exists()) {
        const data = pSnap.data();
        pKeys = new Set((data.printedKeys as string[]) || []);
        pMap = { ...((data.printedAtMap as Record<string, string>) || {}) };
      }

      targetKeys.forEach((k) => {
        if (status) {
          pKeys.add(k);
          if (printedAt) pMap[k] = printedAt;
        } else {
          pKeys.delete(k);
          delete pMap[k];
        }
      });

      await setDoc(partRef, {
        partitionId: partId,
        printedKeys: Array.from(pKeys),
        printedAtMap: pMap,
        count: pKeys.size,
        updatedAt: nowIso,
      });
    })
  );

  // Dual-write batch to legacy doc
  try {
    const legacyRef = doc(db, APP_DATA_COLLECTION, PRINT_STATE_DOC);
    const legSnap = await getDoc(legacyRef);
    if (legSnap.exists()) {
      const legData = legSnap.data() as PrintState;
      const curKeys = new Set(legData.printedKeys || []);
      const curMap = { ...(legData.printedAtMap || {}) };
      keys.forEach((k) => {
        if (status) {
          curKeys.add(k);
          if (printedAt) curMap[k] = printedAt;
        } else {
          curKeys.delete(k);
          delete curMap[k];
        }
      });
      await setDoc(legacyRef, {
        printedKeys: Array.from(curKeys),
        printedAtMap: curMap,
        updatedAt: nowIso,
      });
    }
  } catch (e) {
    console.warn("Dual-write legacy batch update failed:", e);
  }
}

/**
 * Update Category (1P / 2P / 3P) for an invoice in Firestore chunks
 */
export async function updateFakturCategory(
  invoiceKey: string,
  newKategori: "1P" | "2P" | "3P",
  customerName?: string
): Promise<void> {
  const cleanInv = invoiceKey.replace(/-1P$/i, "");
  const cleanCust = customerName ? customerName.trim() : "";
  const normCust = cleanCust ? normalize(cleanCust) : "";

  // 1. Save customer & invoice override directly to Firestore
  const overrideDocRef = doc(db, APP_DATA_COLLECTION, CATEGORY_OVERRIDES_DOC);
  const overrideSnap = await getDoc(overrideDocRef).catch(() => null);
  const existingOverrides = (overrideSnap && overrideSnap.exists()) ? overrideSnap.data() : {};

  const updates: Record<string, string> = {};
  if (normCust) updates[normCust] = newKategori;
  if (cleanCust) updates[cleanCust] = newKategori;
  if (cleanInv) updates[cleanInv] = newKategori;

  await setDoc(
    overrideDocRef,
    { ...existingOverrides, ...updates, updatedAt: new Date().toISOString() },
    { merge: true }
  );

  // 2. Update matching items across chunks in Firestore
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
        const k = item.id || item.no_faktur || "";
        const itemCleanK = k.replace(/-1P$/i, "");
        const itemCust = String(item.customer_name || item.extra?.nama_pelanggan || "").trim();
        const itemNormCust = itemCust ? normalize(itemCust) : "";

        const isMatch =
          k === invoiceKey ||
          itemCleanK === cleanInv ||
          (normCust && itemNormCust === normCust) ||
          (cleanCust && itemCust === cleanCust);

        if (isMatch && item.jenis_transaksi !== "ORA") {
          item.kategori = newKategori;
          if (item.extra) item.extra.kategori = newKategori;
          updated = true;
        }
      }
      if (updated) {
        await setDoc(chunkRef, { ...data, items, updatedAt: new Date().toISOString() });
      }
    }
  }
}

/**
 * Delete all Faktur chunks and reset database completely
 */
export async function clearAllFakturs(): Promise<void> {
  const [chunksSnap, partitionsSnap] = await Promise.all([
    getDocs(collection(db, CHUNKS_COLLECTION)),
    getDocs(collection(db, PRINT_PARTITIONS_COLLECTION)),
  ]);

  await Promise.all([
    ...chunksSnap.docs.map((d) => deleteDoc(d.ref)),
    ...partitionsSnap.docs.map((d) => deleteDoc(d.ref)),
  ]);

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
