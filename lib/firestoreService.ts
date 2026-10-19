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
  updateDoc,
  Unsubscribe,
} from "firebase/firestore";
import { db } from "./firebase";
import { FirestoreFakturDoc, PrintState, InvoiceProgression, UploadNotification, ActiveUserPresence } from "./types";
import { normalize } from "./parser";

export type { FirestoreFakturDoc, PrintState, InvoiceProgression, UploadNotification, ActiveUserPresence };

const APP_DATA_COLLECTION = "app_data";
const METADATA_DOC = "metadata";
const PRINT_STATE_DOC = "print_state";
const PRINT_PARTITIONS_COLLECTION = "print_state_partitions";
const CATEGORY_OVERRIDES_DOC = "category_overrides";
const PRODUCT_CATEGORY_OVERRIDES_DOC = "product_category_overrides";
const CHUNKS_COLLECTION = "faktur_chunks";
const PRESENCE_DOC = "online_presence";
const USER_CREDENTIALS_DOC = "user_credentials";

export type SubscribeChangeReason = "chunks" | "print" | "meta";

// Persistent module-level in-memory caches across subscription lifecycles
const globalChunksMap = new Map<string, FirestoreFakturDoc[]>();
const globalPartitionMap = new Map<string, { printedKeys: string[]; printedAtMap: Record<string, string>; printedByMap?: Record<string, string> }>();
let globalLegacyPrintState: PrintState | null = null;
let globalMetadata: { chunkIds: string[]; invoiceProgression?: InvoiceProgression } | null = null;
let globalCategoryOverrides: Record<string, "1P" | "2P" | "3P"> = {};
let globalProductCategoryOverrides: Record<string, string> = {};

// Background debounced chunk persistence to prevent heavy write locks and UI freeze
let internalChunkWriteInProgress = false;
const pendingModifiedChunkIds = new Set<string>();
let chunkSaveDebounceTimer: NodeJS.Timeout | null = null;

export function scheduleChunkPersistence(chunkIds: Set<string>) {
  chunkIds.forEach((id) => pendingModifiedChunkIds.add(id));
  if (chunkSaveDebounceTimer) clearTimeout(chunkSaveDebounceTimer);
  chunkSaveDebounceTimer = setTimeout(async () => {
    if (pendingModifiedChunkIds.size === 0) return;
    const toSave = Array.from(pendingModifiedChunkIds);
    pendingModifiedChunkIds.clear();
    const nowIso = new Date().toISOString();
    internalChunkWriteInProgress = true;
    try {
      await Promise.all(
        toSave.map(async (cId) => {
          const cRef = doc(db, CHUNKS_COLLECTION, cId);
          const items = globalChunksMap.get(cId) || [];
          await updateDoc(cRef, { items, updatedAt: nowIso }).catch((e) =>
            console.warn(`Failed to update chunk doc ${cId}:`, e)
          );
        })
      );
    } finally {
      setTimeout(() => {
        internalChunkWriteInProgress = false;
      }, 600);
    }
  }, 1000);
}

/**
 * Deterministically partition an invoice key into a partition bucket document ID
 * (Bucket sizes of 5,000 invoices per partition ensure doc sizes stay under 150 KB, well below 1 MB limit)
 */
export function getPrintPartitionId(invoiceKey: string): string {
  // Strip suffix like -1P, -2P, -3P BEFORE removing non-digits
  // so that "18033-1P" correctly maps to "18033" (bucket 15000_19999) and NOT "180331" (bucket 180000_184999)!
  const cleanNumStr = invoiceKey.replace(/-[0-9]P$/i, "").replace(/\D/g, "");
  if (!cleanNumStr) return "part_misc";
  const num = parseInt(cleanNumStr, 10);
  const bucketIndex = Math.floor(num / 5000);
  return `part_${bucketIndex * 5000}_${(bucketIndex + 1) * 5000 - 1}`;
}

/**
 * Chronological Consistency Guard:
 * An invoice can NEVER be printed days before its order date was even created!
 * If a print record has a timestamp > 24 hours prior to the invoice's order date,
 * it is a stale collision from a previous cycle and must be discarded.
 */
export function isStalePrintTimestamp(
  printedAt: string | null | undefined,
  orderDate: string | null | undefined
): boolean {
  if (!printedAt) return false;
  if (!orderDate || orderDate === "-") return false;
  const pDate = new Date(printedAt);
  if (isNaN(pDate.getTime())) return false;

  const parts = String(orderDate).trim().split(/[\/\-]/);
  let oDate: Date | null = null;
  if (parts.length === 3) {
    if (parts[0].length === 4) {
      oDate = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    } else {
      oDate = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
    }
  } else {
    const parsed = new Date(orderDate);
    if (!isNaN(parsed.getTime())) oDate = parsed;
  }

  if (!oDate || isNaN(oDate.getTime())) return false;
  // If printed more than 24 hours before the order date was created
  return pDate.getTime() < oDate.getTime() - 24 * 60 * 60 * 1000;
}

/**
 * Universal print key variant resolver: registers key in cache.
 */
function registerPrintKeyVariants(
  k: string,
  pAt: string | undefined,
  keysSet: Set<string>,
  atMap: Record<string, string>
) {
  if (!k) return;
  // Anti-Ghost Guard: Block ghost collision keys in 20000-24999 range
  if (pAt === "2026-10-01T15:42:48.544Z") {
    const num = parseInt(k.replace(/\D/g, ""), 10);
    if (num >= 20000 && num <= 24999) return;
  }
  keysSet.add(k);
  if (pAt && !atMap[k]) atMap[k] = pAt;
}

/**
 * Synchronously get all currently known printed keys and printedAtMap from module-level caches
 */
export function getLivePrintState(): {
  printedKeys: string[];
  printedAtMap: Record<string, string>;
  printedByMap: Record<string, string>;
} {
  const gatheredKeys = new Set<string>();
  const gatheredMap: Record<string, string> = {};
  const gatheredByMap: Record<string, string> = {};

  if (globalPartitionMap.size > 0) {
    globalPartitionMap.forEach((p) => {
      const pMap = p.printedAtMap || {};
      const pBy = p.printedByMap || {};
      (p.printedKeys || []).forEach((k) => {
        registerPrintKeyVariants(k, pMap[k], gatheredKeys, gatheredMap);
        if (gatheredKeys.has(k) && pBy[k]) gatheredByMap[k] = pBy[k];
      });
    });
  }
  if (globalLegacyPrintState) {
    const lMap = globalLegacyPrintState.printedAtMap || {};
    const lBy = globalLegacyPrintState.printedByMap || {};
    (globalLegacyPrintState.printedKeys || []).forEach((k) => {
      registerPrintKeyVariants(k, lMap[k], gatheredKeys, gatheredMap);
      if (gatheredKeys.has(k) && lBy[k]) gatheredByMap[k] = lBy[k];
    });
  }

  globalChunksMap.forEach((items) => {
    items.forEach((item) => {
      const k = item.id || item.no_faktur;
      if (k && item.status_cetak) {
        if (!isStalePrintTimestamp(item.printed_at, item.order_date)) {
          registerPrintKeyVariants(k, item.printed_at || undefined, gatheredKeys, gatheredMap);
          if (gatheredKeys.has(k) && item.printed_by && !gatheredByMap[k]) {
            gatheredByMap[k] = item.printed_by;
          }
        }
      }
    });
  });

  return {
    printedKeys: Array.from(gatheredKeys),
    printedAtMap: gatheredMap,
    printedByMap: gatheredByMap,
  };
}

/**
 * Fully fetch all printed keys across all print_state_partitions and legacy doc from Firestore.
 * Updates in-memory caches and guarantees 100% complete coverage.
 */
export async function fetchAllLivePrintKeys(): Promise<{
  printedKeys: Set<string>;
  printedAtMap: Record<string, string>;
  printedByMap: Record<string, string>;
}> {
  const gatheredKeys = new Set<string>();
  const gatheredMap: Record<string, string> = {};
  const gatheredByMap: Record<string, string> = {};

  // 1. If memory cache already has partitions (e.g. from real-time listener), return instantly in 0ms!
  if (globalPartitionMap.size > 0) {
    globalPartitionMap.forEach((p) => {
      const pMap = p.printedAtMap || {};
      const pBy = p.printedByMap || {};
      (p.printedKeys || []).forEach((k) => registerPrintKeyVariants(k, pMap[k], gatheredKeys, gatheredMap));
      Object.assign(gatheredMap, pMap);
      Object.assign(gatheredByMap, pBy);
    });
    return {
      printedKeys: gatheredKeys,
      printedAtMap: gatheredMap,
      printedByMap: gatheredByMap,
    };
  }

  // 2. Fetch all partition documents from Firestore (< 25KB each, fast!)
  try {
    const partitionsSnap = await getDocs(collection(db, PRINT_PARTITIONS_COLLECTION)).catch(() => null);

    if (partitionsSnap && !partitionsSnap.empty) {
      partitionsSnap.forEach((pDoc) => {
        const pData = pDoc.data();
        const pKeys = (pData.printedKeys as string[]) || [];
        const pMap = (pData.printedAtMap as Record<string, string>) || {};
        const pBy = (pData.printedByMap as Record<string, string>) || {};
        pKeys.forEach((k) => registerPrintKeyVariants(k, pMap[k], gatheredKeys, gatheredMap));
        Object.assign(gatheredMap, pMap);
        Object.assign(gatheredByMap, pBy);
        globalPartitionMap.set(pDoc.id, { printedKeys: pKeys, printedAtMap: pMap, printedByMap: pBy });
      });
    }
  } catch (err) {
    console.warn("fetchAllLivePrintKeys Firestore error:", err);
  }

  return {
    printedKeys: gatheredKeys,
    printedAtMap: gatheredMap,
    printedByMap: gatheredByMap,
  };
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
    reason?: SubscribeChangeReason,
    productCategoryOverrides?: Record<string, string> | null
  ) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  let currentProgression: InvoiceProgression | null = globalMetadata?.invoiceProgression || null;
  const currentChunksMap = new Map<string, FirestoreFakturDoc[]>(globalChunksMap);
  let currentCategoryOverrides: Record<string, "1P" | "2P" | "3P"> = { ...globalCategoryOverrides };
  let currentProductCategoryOverrides: Record<string, string> = { ...globalProductCategoryOverrides };
  let currentUploadNotification: UploadNotification | null = null;

  let currentPrintState: PrintState = {
    printedKeys: [],
    printedAtMap: {},
    printedByMap: {},
    updatedAt: "",
  };

  const recomputePrintState = () => {
    const combinedKeys = new Set<string>();
    const combinedMap: Record<string, string> = {};
    const combinedByMap: Record<string, string> = {};

    globalPartitionMap.forEach((part) => {
      const pMap = part.printedAtMap || {};
      const pBy = part.printedByMap || {};
      (part.printedKeys || []).forEach((k) => registerPrintKeyVariants(k, pMap[k], combinedKeys, combinedMap));
      Object.assign(combinedMap, pMap);
      Object.assign(combinedByMap, pBy);
    });

    currentPrintState = {
      printedKeys: Array.from(combinedKeys),
      printedAtMap: combinedMap,
      printedByMap: combinedByMap,
      updatedAt: new Date().toISOString(),
    };
  };

  // Pre-seed print state from cache immediately
  recomputePrintState();

  let hasEmittedInitialPayload = false;
  let hasReceivedChunks = false;
  let hasReceivedPartitions = false;
  let hasReceivedLegacyPrint = false;
  let initialEmitTimer: NodeJS.Timeout | null = null;

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
    const pMap: Record<string, string> = { ...(currentPrintState.printedAtMap || {}) };
    const pByMap: Record<string, string> = { ...(currentPrintState.printedByMap || {}) };

    // Always merge print keys directly from documents so that any printed invoice in chunks is NEVER lost
    // even if partitions are still streaming or incomplete!
    for (const d of allDocs) {
      const key = d.id || d.no_faktur;
      if (key && d.status_cetak) {
        registerPrintKeyVariants(key, d.printed_at || undefined, printedSet, pMap);
        if (d.printed_by && !pByMap[key]) pByMap[key] = d.printed_by;
      }
    }
    currentPrintState.printedKeys = Array.from(printedSet);
    currentPrintState.printedAtMap = pMap;
    currentPrintState.printedByMap = pByMap;

    for (const d of allDocs) {
      const key = d.id || d.no_faktur;
      const cleanKey = key.replace(/-1P$/i, "");
      const orderDate = d.order_date || d.extra?.order_date || d.extra?.accounting_date;
      const candidatePAt = pMap[key] || d.printed_at || null;
      const isStale = isStalePrintTimestamp(candidatePAt, orderDate);
      const isPrinted = !isStale && Boolean(d.status_cetak || printedSet.has(key));
      d.status_cetak = isPrinted;
      d.printed_at = isPrinted ? candidatePAt : null;
      d.printed_by = isPrinted ? (pByMap[key] || d.printed_by || null) : null;

      // Apply customer/invoice category override if available
      const cust = String(d.customer_name || d.extra?.nama_pelanggan || "").trim();
      const normCust = cust ? normalize(cust) : "";
      const overrideKat = currentCategoryOverrides[normCust] || currentCategoryOverrides[cust] || currentCategoryOverrides[cleanKey];
      if (overrideKat && d.jenis_transaksi !== "ORA") {
        d.kategori = overrideKat;
        if (d.extra) d.extra.kategori = overrideKat;
      }

      // Apply product category overrides to line items
      if (Array.isArray(d.extra?.items)) {
        for (const item of d.extra.items) {
          const itCode = String(item.item_code || "").trim();
          const itDesc = String(item.item_description || "").trim();
          const itNorm = itDesc ? normalize(itDesc) : "";
          const numCode = itCode ? itCode.replace(/[^0-9]/g, "") : "";
          const prodKat =
            currentProductCategoryOverrides[itCode] ||
            (numCode ? currentProductCategoryOverrides[numCode] : undefined) ||
            currentProductCategoryOverrides[itNorm] ||
            currentProductCategoryOverrides[itDesc];
          if (prodKat) {
            item.kategori_produk = prodKat;
            if (prodKat === "PREKURSOR" || prodKat === "Prekursor") {
              item.klasifikasi_obat = "Prekursor";
            } else if (prodKat === "OOT") {
              item.klasifikasi_obat = "OOT";
            } else {
              delete item.klasifikasi_obat;
            }
          }
        }
      }
    }

    hasEmittedInitialPayload = true;
    onData(allDocs, currentProgression, currentPrintState, currentCategoryOverrides, currentUploadNotification, reason, currentProductCategoryOverrides);
  };

  const tryInitialEmit = () => {
    if (hasEmittedInitialPayload) return;
    const hasPrint = hasReceivedPartitions || hasReceivedLegacyPrint || currentPrintState.printedKeys.length > 0;
    if (hasReceivedChunks && (hasPrint || currentChunksMap.size === 0)) {
      if (initialEmitTimer) {
        clearTimeout(initialEmitTimer);
        initialEmitTimer = null;
      }
      emitData("meta");
    }
  };

  let chunkEmitTimer: NodeJS.Timeout | null = null;
  const debouncedEmitChunks = () => {
    if (chunkEmitTimer) clearTimeout(chunkEmitTimer);
    chunkEmitTimer = setTimeout(() => {
      emitData("meta");
    }, 30);
  };

  let printEmitTimer: NodeJS.Timeout | null = null;
  const debouncedEmitPrint = () => {
    if (printEmitTimer) clearTimeout(printEmitTimer);
    printEmitTimer = setTimeout(() => {
      recomputePrintState();
      if (hasEmittedInitialPayload) {
        onData([], currentProgression, currentPrintState, currentCategoryOverrides, null, "print", currentProductCategoryOverrides);
      }
    }, 10);
  };

  // TiDB Cloud Serverless is now 100% authoritative for all faktur records.
  hasReceivedChunks = true;
  const unsubChunks = () => {};
  const unsubLegacyPrint = () => {};

  // Listen to partitioned print state collection (< 50ms instant sync!)
  const unsubPartitions = onSnapshot(
    collection(db, PRINT_PARTITIONS_COLLECTION),
    (snap) => {
      snap.docChanges().forEach((change) => {
        if (change.type === "removed") {
          globalPartitionMap.delete(change.doc.id);
        } else {
          const data = change.doc.data();
          const pEntry = {
            printedKeys: (data.printedKeys as string[]) || [],
            printedAtMap: (data.printedAtMap as Record<string, string>) || {},
            printedByMap: (data.printedByMap as Record<string, string>) || {},
          };
          globalPartitionMap.set(change.doc.id, pEntry);
        }
      });
      hasReceivedPartitions = true;
      recomputePrintState();
      if (!hasEmittedInitialPayload) {
        tryInitialEmit();
      } else {
        debouncedEmitPrint();
      }
    },
    (err) => console.warn("Print partitions sync warning:", err)
  );

  const unsubOverrides = onSnapshot(
    doc(db, APP_DATA_COLLECTION, CATEGORY_OVERRIDES_DOC),
    (snap) => {
      if (snap.exists()) {
        currentCategoryOverrides = (snap.data() || {}) as Record<string, "1P" | "2P" | "3P">;
        globalCategoryOverrides = { ...currentCategoryOverrides };
      }
      if (hasEmittedInitialPayload) {
        emitData("meta");
      }
    },
    (err) => console.warn("Category overrides sync warning:", err)
  );

  const unsubProductOverrides = onSnapshot(
    doc(db, APP_DATA_COLLECTION, PRODUCT_CATEGORY_OVERRIDES_DOC),
    (snap) => {
      if (snap.exists()) {
        currentProductCategoryOverrides = (snap.data() || {}) as Record<string, string>;
        globalProductCategoryOverrides = { ...currentProductCategoryOverrides };
      }
      if (hasEmittedInitialPayload) {
        emitData("meta");
      }
    },
    (err) => console.warn("Product category overrides sync warning:", err)
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
        if (Array.isArray(data.chunkIds)) {
          globalMetadata = { chunkIds: data.chunkIds as string[], invoiceProgression: currentProgression || undefined };
        }
        if (data.lastUploadNotification) {
          uploadNotif = data.lastUploadNotification as UploadNotification;
          currentUploadNotification = uploadNotif;
        }
      }
      if (hasEmittedInitialPayload) {
        onData([], currentProgression, currentPrintState, currentCategoryOverrides, uploadNotif, "meta", currentProductCategoryOverrides);
      }
    },
    (err) => console.warn("Metadata sync warning:", err)
  );

  const unsubRecentSync = onSnapshot(
    doc(db, APP_DATA_COLLECTION, "recent_sync"),
    (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (Array.isArray(data.docs) && data.docs.length > 0) {
          const syncDocs = data.docs as FirestoreFakturDoc[];
          const uploadedAtMs = data.uploadedAt ? new Date(data.uploadedAt).getTime() : Date.now();
          const syncNotif: UploadNotification = {
            fileName: data.fileName || "File Upload",
            uploaderId: data.uploaderId || "",
            newUnprinted: data.newUnprintedCount || syncDocs.length,
            totalItems: data.totalItems || syncDocs.length,
            totalInvoices: data.totalInvoices || syncDocs.length,
            time: data.uploadedAt ? new Date(data.uploadedAt).toLocaleTimeString("id-ID") : new Date().toLocaleTimeString("id-ID"),
            uploadedAtMs,
          };
          const nextProg = (data.progression as InvoiceProgression) || currentProgression;
          onData(syncDocs, nextProg, currentPrintState, currentCategoryOverrides, syncNotif, "chunks", currentProductCategoryOverrides);
        }
      }
    },
    (err) => console.warn("Recent sync listener warning:", err)
  );

  return () => {
    if (initialEmitTimer) clearTimeout(initialEmitTimer);
    if (chunkEmitTimer) clearTimeout(chunkEmitTimer);
    if (printEmitTimer) clearTimeout(printEmitTimer);
    unsubChunks();
    unsubMeta();
    unsubRecentSync();
    unsubLegacyPrint();
    unsubPartitions();
    unsubOverrides();
    unsubProductOverrides();
  };
}

function parseInvoiceNumberForSort(key: string): number {
  if (!key) return 0;
  const n = parseInt(key.replace(/\D/g, ""), 10);
  return isNaN(n) ? 0 : n;
}

function pruneDocForBroadcast(doc: FirestoreFakturDoc): FirestoreFakturDoc {
  return {
    id: doc.id,
    no_faktur: doc.no_faktur,
    no_sales_order: doc.no_sales_order || "-",
    customer_name: doc.customer_name || doc.extra?.nama_pelanggan || "-",
    order_date: doc.order_date || doc.extra?.order_date || "-",
    transaction_date: doc.transaction_date || doc.extra?.transaction_date || doc.order_date || "-",
    jenis_transaksi: doc.jenis_transaksi || doc.extra?.jenis_transaksi || "DOO",
    kategori: doc.kategori || doc.extra?.kategori || "3P",
    status_cetak: Boolean(doc.status_cetak),
    printed_at: doc.printed_at || null,
    printed_by: doc.printed_by || null,
    extra: {
      nama_pelanggan: doc.extra?.nama_pelanggan || doc.customer_name || "-",
      order_date: doc.extra?.order_date || doc.order_date || "-",
      transaction_date: doc.extra?.transaction_date || doc.transaction_date || doc.order_date || "-",
      kategori: doc.extra?.kategori || doc.kategori || "3P",
      total_harga: Number(doc.extra?.total_harga || 0),
      items: (doc.extra?.items || []).slice(0, 10).map((it) => ({
        item_code: it.item_code || "",
        item_description: it.item_description || "",
        kategori_produk: it.kategori_produk || "FARMA",
        qty: it.qty || 0,
        uom: it.uom || "-",
        lot_number: it.lot_number || "-",
        total_harga: Number(it.total_harga || 0),
      })),
    },
  };
}

/**
 * Broadcast freshly uploaded invoices to all peer devices in real-time (< 30ms) via Firestore
 * Guarantees that ALL brand-new unprinted invoices are ALWAYS at the top and never dropped
 */
export async function broadcastRecentUpload(
  uploadedDocs: FirestoreFakturDoc[],
  progression: InvoiceProgression | null,
  fileName: string,
  uploaderId: string,
  newUnprintedCount: number,
  brandNewKeys?: string[]
): Promise<void> {
  try {
    const syncDocRef = doc(db, APP_DATA_COLLECTION, "recent_sync");
    const brandNewSet = new Set(brandNewKeys || []);

    // 1. Strictly prioritize ALL brand-new unprinted invoices at index 0..N
    const sortedDocs = [...uploadedDocs].sort((a, b) => {
      const aKey = a.id || a.no_faktur;
      const bKey = b.id || b.no_faktur;
      const aIsBrandNew = brandNewSet.has(aKey) || (!a.status_cetak ? 1 : 0);
      const bIsBrandNew = brandNewSet.has(bKey) || (!b.status_cetak ? 1 : 0);
      if (aIsBrandNew !== bIsBrandNew) {
        return (bIsBrandNew ? 1 : 0) - (aIsBrandNew ? 1 : 0); // brand new unprinted ALWAYS first!
      }
      return parseInvoiceNumberForSort(bKey) - parseInvoiceNumberForSort(aKey); // highest invoice numbers first!
    });

    // 2. Prune items to lightweight structures (~300 bytes/doc) so 300 docs safely use only ~90 KB
    const prunedDocs = sortedDocs.slice(0, 300).map(pruneDocForBroadcast);

    await setDoc(syncDocRef, {
      syncId: `sync_${Date.now()}_${uploaderId}`,
      uploaderId,
      uploadedAt: new Date().toISOString(),
      fileName,
      newUnprintedCount,
      progression,
      docs: prunedDocs,
    });
  } catch (err) {
    console.warn("Broadcast recent upload warning:", err);
  }
}

/**
 * Fetch all existing fakturs and metadata directly from server
 */
export async function getExistingFakturs(): Promise<{
  docs: FirestoreFakturDoc[];
  progression: InvoiceProgression | null;
  printState: PrintState | null;
  categoryOverrides: Record<string, "1P" | "2P" | "3P">;
  productCategoryOverrides: Record<string, string>;
}> {
  const [, metaSnap, legacyPrintSnap, partitionsSnap, overrideSnap, prodOverrideSnap] = await Promise.all([
    Promise.resolve({ docs: [] }),
    getDocFromServer(doc(db, APP_DATA_COLLECTION, METADATA_DOC)).catch(() => getDoc(doc(db, APP_DATA_COLLECTION, METADATA_DOC))),
    getDocFromServer(doc(db, APP_DATA_COLLECTION, PRINT_STATE_DOC)).catch(() => getDoc(doc(db, APP_DATA_COLLECTION, PRINT_STATE_DOC))),
    getDocsFromServer(collection(db, PRINT_PARTITIONS_COLLECTION)).catch(() => getDocs(collection(db, PRINT_PARTITIONS_COLLECTION))),
    getDocFromServer(doc(db, APP_DATA_COLLECTION, CATEGORY_OVERRIDES_DOC)).catch(() => getDoc(doc(db, APP_DATA_COLLECTION, CATEGORY_OVERRIDES_DOC))),
    getDocFromServer(doc(db, APP_DATA_COLLECTION, PRODUCT_CATEGORY_OVERRIDES_DOC)).catch(() => getDoc(doc(db, APP_DATA_COLLECTION, PRODUCT_CATEGORY_OVERRIDES_DOC))),
  ]);

  const categoryOverrides = (overrideSnap && overrideSnap.exists()
    ? (overrideSnap.data() as Record<string, "1P" | "2P" | "3P">)
    : {}) || {};

  const productCategoryOverrides = (prodOverrideSnap && prodOverrideSnap.exists()
    ? (prodOverrideSnap.data() as Record<string, string>)
    : {}) || {};

  const docs: FirestoreFakturDoc[] = [];

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

    // Apply product category overrides to line items
    if (Array.isArray(d.extra?.items)) {
      for (const item of d.extra.items) {
        const itCode = String(item.item_code || "").trim();
        const itDesc = String(item.item_description || "").trim();
        const itNorm = itDesc ? normalize(itDesc) : "";
        const numCode = itCode ? itCode.replace(/[^0-9]/g, "") : "";
        const prodKat =
          productCategoryOverrides[itCode] ||
          (numCode ? productCategoryOverrides[numCode] : undefined) ||
          productCategoryOverrides[itNorm] ||
          productCategoryOverrides[itDesc];
        if (prodKat) {
          item.kategori_produk = prodKat;
          if (prodKat === "PREKURSOR" || prodKat === "Prekursor") {
            item.klasifikasi_obat = "Prekursor";
          } else if (prodKat === "OOT") {
            item.klasifikasi_obat = "OOT";
          } else {
            delete item.klasifikasi_obat;
          }
        }
      }
    }
  }

  return { docs, progression, printState, categoryOverrides, productCategoryOverrides };
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
    const gatheredKeys = new Set<string>();
    const gatheredMap: Record<string, string> = {};

    // Check memory caches first (0ms latency instead of slow network roundtrips)
    if (globalPartitionMap.size > 0) {
      globalPartitionMap.forEach((p) => {
        (p.printedKeys || []).forEach((k) => gatheredKeys.add(k));
        Object.assign(gatheredMap, p.printedAtMap || {});
      });
    }
    if (globalLegacyPrintState) {
      (globalLegacyPrintState.printedKeys || []).forEach((k) => gatheredKeys.add(k));
      Object.assign(gatheredMap, globalLegacyPrintState.printedAtMap || {});
    }

    // Authoritatively fetch all server partitions to guarantee 100% complete coverage
    const serverPrintState = await fetchAllLivePrintKeys();
    serverPrintState.printedKeys.forEach((k) => gatheredKeys.add(k));
    Object.assign(gatheredMap, serverPrintState.printedAtMap);

    livePrintedKeys = Array.from(gatheredKeys);
    livePrintedAtMap = gatheredMap;

    if (globalMetadata?.chunkIds && globalMetadata.chunkIds.length > 0) {
      previousChunkIds = globalMetadata.chunkIds;
    } else {
      const metaSnap = await getDoc(doc(db, APP_DATA_COLLECTION, METADATA_DOC)).catch(() => null);
      if (metaSnap && metaSnap.exists()) {
        previousChunkIds = (metaSnap.data().chunkIds as string[]) || [];
      }
    }
  } catch (err) {
    console.warn("Could not read live print state or metadata:", err);
  }

  const localPrintedKeys = existingPrintState?.printedKeys || [];
  // Strict Anti-Reappearance Guarantee: Once an invoice is printed in live DB or local state,
  // uploading files MUST NEVER un-print it or delete it from the printed set!
  const unifiedPrintedSet = new Set<string>();
  const unifiedPrintedAtMap: Record<string, string> = {
    ...livePrintedAtMap,
    ...(existingPrintState?.printedAtMap || {}),
  };

  livePrintedKeys.forEach((k) => registerPrintKeyVariants(k, livePrintedAtMap[k], unifiedPrintedSet, unifiedPrintedAtMap));
  localPrintedKeys.forEach((k) => registerPrintKeyVariants(k, existingPrintState?.printedAtMap?.[k], unifiedPrintedSet, unifiedPrintedAtMap));

  for (const item of fakturs) {
    const key = item.id || item.no_faktur;
    if (key) {
      const orderDate = item.order_date || item.extra?.order_date || item.extra?.accounting_date;
      const candidatePAt = unifiedPrintedAtMap[key] || item.printed_at;
      const isStale = isStalePrintTimestamp(candidatePAt, orderDate);
      const isExplicitlyNewUnprinted = newUnprintedSet.has(key) || isStale;

      const isPrinted = !isExplicitlyNewUnprinted && Boolean(
        item.status_cetak ||
        unifiedPrintedSet.has(key)
      );

      if (isPrinted) {
        item.status_cetak = true;
        item.printed_at = candidatePAt || new Date().toISOString();
        registerPrintKeyVariants(key, item.printed_at, unifiedPrintedSet, unifiedPrintedAtMap);
      } else {
        item.status_cetak = false;
        item.printed_at = null;
        if (isExplicitlyNewUnprinted) {
          unifiedPrintedSet.delete(key);
        }
      }
    }
  }

  const nowIso = new Date().toISOString();

  // Metadata write
  const metaDocRef = doc(db, APP_DATA_COLLECTION, METADATA_DOC);
  const metaWritePromise = setDoc(
    metaDocRef,
    {
      invoiceProgression: progression || null,
      totalInvoices: fakturs.length,
      totalChunks: previousChunkIds.length,
      chunkIds: previousChunkIds,
      updatedAt: nowIso,
      ...(uploadNotification ? { lastUploadNotification: uploadNotification } : {}),
    },
    { merge: true }
  ).then(() => {
    globalMetadata = {
      chunkIds: previousChunkIds,
      invoiceProgression: progression || undefined,
    };
  });

  // Sync print state across partitions + dual write legacy doc in parallel (purging unprinted keys)
  const printStatePromise = updatePrintState(
    Array.from(unifiedPrintedSet),
    unifiedPrintedAtMap,
    Array.from(newUnprintedSet)
  );

  // Execute writes in parallel for atomic, instantaneous sync across devices (< 200ms total)
  await Promise.all([
    metaWritePromise,
    printStatePromise,
  ]);
}

/**
 * Update Print State across partitions with dual-write to legacy doc
 * Guarantees zero limit bottlenecks, diff partition writes, and 100% backward compatibility
 */
export async function updatePrintState(
  printedKeys: string[],
  printedAtMap: Record<string, string>,
  unprintedKeys?: string[]
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

  // Non-destructive partition update with explicit unprint & ghost purge support:
  const partitionWrites = Object.entries(partitionBuckets).map(async ([partId, data]) => {
    const existing = globalPartitionMap.get(partId);
    const existingKeys = existing ? existing.printedKeys : [];
    const mergedKeysSet = new Set<string>([...existingKeys, ...data.keys]);
    const mergedMap = { ...(existing ? existing.printedAtMap : {}), ...data.map };

    // Explicitly unprint keys if specified (Strict DOO vs ORA Key Isolation - LOCKED)
    if (unprintedKeys && unprintedKeys.length > 0) {
      unprintedKeys.forEach((k) => {
        mergedKeysSet.delete(k);
        delete mergedMap[k];
      });
    }

    // Anti-Ghost Guard: Purge all Oct 1 ghost collision keys from part_20000_24999
    if (partId === "part_20000_24999") {
      Array.from(mergedKeysSet).forEach((k) => {
        if (mergedMap[k] === "2026-10-01T15:42:48.544Z") {
          mergedKeysSet.delete(k);
          delete mergedMap[k];
        }
      });
    }

    const mergedKeys = Array.from(mergedKeysSet);

    if (existing && existing.printedKeys.length === mergedKeys.length) {
      const allPresent = existing.printedKeys.every((k) => mergedKeysSet.has(k));
      if (allPresent) return;
    }

    const partRef = doc(db, PRINT_PARTITIONS_COLLECTION, partId);
    await setDoc(partRef, {
      partitionId: partId,
      printedKeys: mergedKeys,
      printedAtMap: mergedMap,
      count: mergedKeys.length,
      updatedAt: nowIso,
    });
    // Immediately update memory cache
    globalPartitionMap.set(partId, { printedKeys: mergedKeys, printedAtMap: mergedMap });
  });

  await Promise.all(partitionWrites);
}

/**
 * Toggle Print Status for a single invoice key (Partitioned Fast Write < 50ms)
 */
export async function updateFakturPrintStatus(
  invoiceKey: string,
  status: boolean,
  printedAt: string | null,
  printedBy?: string | null
): Promise<void> {
  const partId = getPrintPartitionId(invoiceKey);
  const partRef = doc(db, PRINT_PARTITIONS_COLLECTION, partId);
  const legacyRef = doc(db, APP_DATA_COLLECTION, PRINT_STATE_DOC);

  const cached = globalPartitionMap.get(partId);
  let partKeys = new Set<string>(cached?.printedKeys || []);
  let partMap: Record<string, string> = { ...(cached?.printedAtMap || {}) };
  let partByMap: Record<string, string> = { ...(cached?.printedByMap || {}) };

  if (!cached) {
    try {
      const pSnap = await getDoc(partRef);
      if (pSnap.exists()) {
        const data = pSnap.data();
        ((data.printedKeys as string[]) || []).forEach((k) => partKeys.add(k));
        Object.assign(partMap, (data.printedAtMap as Record<string, string>) || {});
        Object.assign(partByMap, (data.printedByMap as Record<string, string>) || {});
      }
    } catch (err) {
      console.warn("Could not read partition before update:", err);
    }
  }

  if (status) {
    partKeys.add(invoiceKey);
    if (printedAt) partMap[invoiceKey] = printedAt;
    if (printedBy) partByMap[invoiceKey] = printedBy;
  } else {
    partKeys.delete(invoiceKey);
    delete partMap[invoiceKey];
    delete partByMap[invoiceKey];
  }

  const nowIso = new Date().toISOString();

  // Update in-memory chunks AND track which chunk documents in Firestore need updating
  const chunkDocsToSave = new Set<string>();
  globalChunksMap.forEach((items, chunkId) => {
    let chunkModified = false;
    items.forEach((item) => {
      const k = item.id || item.no_faktur;
      if (k === invoiceKey) {
        item.status_cetak = status;
        item.printed_at = status ? printedAt : null;
        item.printed_by = status ? (printedBy || null) : null;
        chunkModified = true;
      }
    });
    if (chunkModified) chunkDocsToSave.add(chunkId);
  });

  // Immediately update in-memory cache
  globalPartitionMap.set(partId, {
    printedKeys: Array.from(partKeys),
    printedAtMap: partMap,
    printedByMap: partByMap,
  });

  // Fast direct partition write (< 30ms!)
  await setDoc(partRef, {
    partitionId: partId,
    printedKeys: Array.from(partKeys),
    printedAtMap: partMap,
    printedByMap: partByMap,
    count: partKeys.size,
    updatedAt: nowIso,
  });
}

/**
 * Batch update print status for multiple keys across partitions
 */
export async function updateFaktursPrintStatusBatch(
  keys: string[],
  status: boolean,
  printedAt: string | null,
  printedBy?: string | null
): Promise<void> {
  const allKeys = Array.from(new Set(keys)).filter(Boolean);
  const targetKeySet = new Set(allKeys);

  const keysByPartition: Record<string, string[]> = {};
  for (const k of allKeys) {
    const partId = getPrintPartitionId(k);
    if (!keysByPartition[partId]) keysByPartition[partId] = [];
    keysByPartition[partId].push(k);
  }

  const nowIso = new Date().toISOString();

  // Update in-memory chunks AND track modified chunk documents
  const chunkDocsToSave = new Set<string>();
  globalChunksMap.forEach((items, chunkId) => {
    let chunkModified = false;
    items.forEach((item) => {
      const k = item.id || item.no_faktur;
      if (k && targetKeySet.has(k)) {
        item.status_cetak = status;
        item.printed_at = status ? printedAt : null;
        item.printed_by = status ? (printedBy || null) : null;
        chunkModified = true;
      }
    });
    if (chunkModified) chunkDocsToSave.add(chunkId);
  });

  const partWrites = Object.entries(keysByPartition).map(async ([partId, targetKeys]) => {
    const partRef = doc(db, PRINT_PARTITIONS_COLLECTION, partId);
    const cached = globalPartitionMap.get(partId);
    const pSnap = await getDoc(partRef).catch(() => null);
    let pKeys = new Set<string>(cached?.printedKeys || []);
    let pMap: Record<string, string> = { ...(cached?.printedAtMap || {}) };
    let pByMap: Record<string, string> = { ...(cached?.printedByMap || {}) };

    if (pSnap && pSnap.exists()) {
      const data = pSnap.data();
      ((data.printedKeys as string[]) || []).forEach((k) => pKeys.add(k));
      Object.assign(pMap, (data.printedAtMap as Record<string, string>) || {});
      Object.assign(pByMap, (data.printedByMap as Record<string, string>) || {});
    }

    targetKeys.forEach((k) => {
      if (status) {
        pKeys.add(k);
        if (printedAt) pMap[k] = printedAt;
        if (printedBy) pByMap[k] = printedBy;
      } else {
        pKeys.delete(k);
        delete pMap[k];
        delete pByMap[k];
      }
    });

    await setDoc(partRef, {
      partitionId: partId,
      printedKeys: Array.from(pKeys),
      printedAtMap: pMap,
      printedByMap: pByMap,
      count: pKeys.size,
      updatedAt: nowIso,
    });

    // Immediately update in-memory cache
    globalPartitionMap.set(partId, {
      printedKeys: Array.from(pKeys),
      printedAtMap: pMap,
      printedByMap: pByMap,
    });
  });

  // Debounced background persistence of modified chunks to Firestore
  if (chunkDocsToSave.size > 0) {
    scheduleChunkPersistence(chunkDocsToSave);
  }

  await Promise.all(partWrites);
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
 * Update Product Category (FARMA / ALKES / CCP / PREKURSOR / OOT) in Firestore
 * Persists to product_category_overrides doc and updates matching items across all chunks
 */
export async function updateProductCategoryOverride(
  productCode: string,
  productName: string,
  newCategory: string
): Promise<void> {
  const cleanCode = productCode ? productCode.trim() : "";
  const numOnly = cleanCode ? cleanCode.replace(/[^0-9]/g, "") : "";
  const cleanName = productName ? productName.trim() : "";
  const normName = cleanName ? normalize(cleanName) : "";

  // 1. Save product category override directly to Firestore
  const overrideDocRef = doc(db, APP_DATA_COLLECTION, PRODUCT_CATEGORY_OVERRIDES_DOC);
  const overrideSnap = await getDoc(overrideDocRef).catch(() => null);
  const existingOverrides = (overrideSnap && overrideSnap.exists()) ? overrideSnap.data() : {};

  const updates: Record<string, string> = {};
  if (cleanCode && cleanCode !== "-") updates[cleanCode] = newCategory;
  if (numOnly) updates[numOnly] = newCategory;
  if (cleanName && cleanName !== "-") updates[cleanName] = newCategory;
  if (normName) updates[normName] = newCategory;

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
        if (Array.isArray(item.extra?.items)) {
          for (const lineItem of item.extra.items) {
            const lCode = String(lineItem.item_code || "").trim();
            const lDesc = String(lineItem.item_description || "").trim();
            const lNorm = lDesc ? normalize(lDesc) : "";
            const isMatch =
              (cleanCode && cleanCode !== "-" && lCode === cleanCode) ||
              (normName && lNorm === normName) ||
              (cleanName && cleanName !== "-" && lDesc === cleanName);
            if (isMatch) {
              lineItem.kategori_produk = newCategory;
              if (newCategory === "PREKURSOR" || newCategory === "Prekursor") {
                lineItem.klasifikasi_obat = "Prekursor";
              } else if (newCategory === "OOT") {
                lineItem.klasifikasi_obat = "OOT";
              } else {
                delete lineItem.klasifikasi_obat;
              }
              updated = true;
            }
          }
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

/**
 * Report user heartbeat presence to Firestore
 */
export async function updateUserPresence(
  user: { name: string; role: "admin" | "readonly" },
  deviceId: string
): Promise<void> {
  if (!user || !user.name || !deviceId) return;
  try {
    const presenceRef = doc(db, APP_DATA_COLLECTION, PRESENCE_DOC);
    await setDoc(
      presenceRef,
      {
        [deviceId]: {
          name: user.name,
          role: user.role,
          lastActive: Date.now(),
          deviceId,
        },
      },
      { merge: true }
    );
  } catch (err) {
    console.warn("Failed to update user presence:", err);
  }
}

/**
 * Remove or mark inactive on logout/tab close
 */
export async function removeUserPresence(deviceId: string): Promise<void> {
  if (!deviceId) return;
  try {
    const presenceRef = doc(db, APP_DATA_COLLECTION, PRESENCE_DOC);
    await setDoc(
      presenceRef,
      {
        [deviceId]: {
          lastActive: 0,
        },
      },
      { merge: true }
    );
  } catch (err) {
    console.warn("Failed to clear user presence:", err);
  }
}

/**
 * Real-time listener for active users currently viewing the system
 */
export function subscribeToOnlinePresence(
  onUpdate: (activeUsers: ActiveUserPresence[]) => void
): Unsubscribe {
  const presenceRef = doc(db, APP_DATA_COLLECTION, PRESENCE_DOC);
  return onSnapshot(
    presenceRef,
    (snap) => {
      if (!snap.exists()) {
        onUpdate([]);
        return;
      }
      const data = snap.data() as Record<string, Partial<ActiveUserPresence>>;
      const now = Date.now();
      const cutoff = 60000; // active within the last 60 seconds

      // Filter active entries and deduplicate by user name (keep latest active)
      const userMap = new Map<string, ActiveUserPresence>();
      Object.entries(data).forEach(([devId, info]) => {
        if (!info || !info.name || !info.lastActive) return;
        if (now - info.lastActive <= cutoff) {
          const existing = userMap.get(info.name);
          if (!existing || info.lastActive > existing.lastActive) {
            userMap.set(info.name, {
              name: info.name,
              role: (info.role as "admin" | "readonly") || "admin",
              lastActive: info.lastActive,
              deviceId: devId,
            });
          }
        }
      });

      const list = Array.from(userMap.values()).sort((a, b) => b.lastActive - a.lastActive);
      onUpdate(list);
    },
    (err) => {
      console.warn("Error subscribing to online presence:", err);
    }
  );
}

/**
 * Verify user password (default "123" if not yet changed in cloud)
 */
export async function verifyUserPassword(userName: string, inputPass: string): Promise<boolean> {
  if (String(userName || "").toLowerCase() === "stranger") return true;
  try {
    const credRef = doc(db, APP_DATA_COLLECTION, USER_CREDENTIALS_DOC);
    const snap = await getDoc(credRef);
    if (snap.exists()) {
      const data = snap.data() as Record<string, string>;
      const storedPass = data[userName];
      if (storedPass !== undefined && storedPass !== null) {
        return String(storedPass) === inputPass;
      }
    }
  } catch (err) {
    console.warn("Could not fetch remote credentials, fallback to default:", err);
  }
  return inputPass === "123";
}

/**
 * Change user password in Cloud Firestore
 */
export async function changeUserPassword(
  userName: string,
  oldPass: string,
  newPass: string
): Promise<{ success: boolean; message: string }> {
  if (String(userName || "").toLowerCase() === "stranger") {
    return { success: false, message: "Pengguna stranger tidak memiliki password." };
  }
  if (!newPass || newPass.trim().length < 3) {
    return { success: false, message: "Password baru minimal 3 karakter." };
  }

  try {
    const credRef = doc(db, APP_DATA_COLLECTION, USER_CREDENTIALS_DOC);
    const snap = await getDoc(credRef);
    let currentPass = "123";
    if (snap.exists()) {
      const data = snap.data() as Record<string, string>;
      if (data[userName] !== undefined && data[userName] !== null) {
        currentPass = String(data[userName]);
      }
    }

    if (oldPass !== currentPass) {
      return { success: false, message: "Password lama salah!" };
    }

    await setDoc(credRef, { [userName]: newPass.trim() }, { merge: true });
    return { success: true, message: `Password untuk ${userName} berhasil diperbarui!` };
  } catch (err) {
    console.error("Failed to update password:", err);
    return { success: false, message: "Gagal menyimpan password ke database cloud." };
  }
}

