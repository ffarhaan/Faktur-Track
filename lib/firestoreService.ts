import {
  collection,
  doc,
  setDoc,
  getDocs,
  getDoc,
  onSnapshot,
  writeBatch,
  query,
  orderBy,
  Unsubscribe,
} from "firebase/firestore";
import { db } from "./firebase";
import { FakturRecord, InvoiceProgression } from "./types";

export interface FirestoreFakturDoc {
  id: string;
  no_faktur: string;
  no_sales_order: string;
  customer_name: string;
  order_date: string;
  jenis_transaksi: string;
  kategori: string;
  status_cetak: boolean;
  printed_at: string | null;
  extra: Record<string, unknown>;
  updated_at: string;
}

const FAKTURS_COLLECTION = "fakturs";
const METADATA_COLLECTION = "metadata";
const SUMMARY_DOC = "summary";

/**
 * Realtime listener for all fakturs and metadata progression
 */
export function subscribeToFakturs(
  onData: (fakturs: FirestoreFakturDoc[], progression: InvoiceProgression | null) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  let currentProgression: InvoiceProgression | null = null;
  let currentDocs: FirestoreFakturDoc[] = [];

  // 1. Subscribe to metadata summary (Progression)
  const metaDocRef = doc(db, METADATA_COLLECTION, SUMMARY_DOC);
  const unsubMeta = onSnapshot(
    metaDocRef,
    (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (data.invoiceProgression) {
          currentProgression = data.invoiceProgression as InvoiceProgression;
        }
      }
      onData(currentDocs, currentProgression);
    },
    (err) => {
      console.warn("Firestore metadata subscribe error:", err);
    }
  );

  // 2. Subscribe to Fakturs collection
  const q = query(collection(db, FAKTURS_COLLECTION));
  const unsubFakturs = onSnapshot(
    q,
    (snapshot) => {
      const items: FirestoreFakturDoc[] = [];
      snapshot.forEach((d) => {
        if (d.id !== "__SYSTEM_METADATA__") {
          items.push(d.data() as FirestoreFakturDoc);
        }
      });
      currentDocs = items;
      onData(currentDocs, currentProgression);
    },
    (err) => {
      console.error("Firestore fakturs subscribe error:", err);
      if (onError) onError(err);
    }
  );

  return () => {
    unsubMeta();
    unsubFakturs();
  };
}

/**
 * Fetch all existing faktur records and progression directly from Firestore
 */
export async function getExistingFakturs(): Promise<{
  docs: FirestoreFakturDoc[];
  progression: InvoiceProgression | null;
}> {
  const snapshot = await getDocs(collection(db, FAKTURS_COLLECTION));
  const docs: FirestoreFakturDoc[] = [];
  snapshot.forEach((d) => {
    if (d.id !== "__SYSTEM_METADATA__") {
      docs.push(d.data() as FirestoreFakturDoc);
    }
  });

  let progression: InvoiceProgression | null = null;
  try {
    const metaDocRef = doc(db, METADATA_COLLECTION, SUMMARY_DOC);
    const metaSnap = await getDoc(metaDocRef);
    if (metaSnap.exists()) {
      const data = metaSnap.data();
      if (data.invoiceProgression) {
        progression = data.invoiceProgression as InvoiceProgression;
      }
    }
  } catch (err) {
    console.warn("Error fetching metadata progression:", err);
  }

  return { docs, progression };
}

/**
 * Save / Upsert Fakturs in batches of 500 (Firestore maximum batch size)
 */
export async function saveFaktursBatch(
  fakturs: FirestoreFakturDoc[],
  progression?: InvoiceProgression | null
): Promise<void> {
  const chunkSize = 450;
  const chunks: FirestoreFakturDoc[][] = [];
  for (let i = 0; i < fakturs.length; i += chunkSize) {
    chunks.push(fakturs.slice(i, i + chunkSize));
  }

  // Run batch writes concurrently (4 batches in parallel) for ultra-fast upload
  const concurrency = 4;
  for (let i = 0; i < chunks.length; i += concurrency) {
    const batchGroup = chunks.slice(i, i + concurrency);
    await Promise.all(
      batchGroup.map(async (chunk) => {
        const batch = writeBatch(db);
        for (const item of chunk) {
          const docRef = doc(db, FAKTURS_COLLECTION, item.id || item.no_faktur);
          batch.set(docRef, item, { merge: true });
        }
        await batch.commit();
      })
    );
  }

  // Save metadata progression
  if (progression) {
    const metaDocRef = doc(db, METADATA_COLLECTION, SUMMARY_DOC);
    await setDoc(
      metaDocRef,
      {
        invoiceProgression: progression,
        totalInvoices: fakturs.length,
        updated_at: new Date().toISOString(),
      },
      { merge: true }
    );
  }
}

/**
 * Toggle / Update Print Status for a single invoice in realtime
 */
export async function updateFakturPrintStatus(
  invoiceKey: string,
  status: boolean,
  printedAt: string | null
): Promise<void> {
  const docRef = doc(db, FAKTURS_COLLECTION, invoiceKey);
  await setDoc(
    docRef,
    {
      status_cetak: status,
      printed_at: printedAt,
      updated_at: new Date().toISOString(),
    },
    { merge: true }
  );
}

/**
 * Delete all Faktur documents and reset metadata
 */
export async function clearAllFakturs(): Promise<void> {
  const snapshot = await getDocs(collection(db, FAKTURS_COLLECTION));
  const docs = snapshot.docs;
  const chunkSize = 450;

  for (let i = 0; i < docs.length; i += chunkSize) {
    const chunk = docs.slice(i, i + chunkSize);
    const batch = writeBatch(db);
    for (const d of chunk) {
      batch.delete(d.ref);
    }
    await batch.commit();
  }

  // Reset metadata
  const metaDocRef = doc(db, METADATA_COLLECTION, SUMMARY_DOC);
  await setDoc(metaDocRef, {
    invoiceProgression: null,
    totalInvoices: 0,
    updated_at: new Date().toISOString(),
  });
}
