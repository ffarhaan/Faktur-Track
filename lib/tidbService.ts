/**
 * TiDB Serverless Background Sync Service
 * 
 * Strict Compliance with LOCKED_RULES.md:
 * 1. 100% Non-blocking: Runs in asynchronous fire-and-forget mode.
 * 2. Zero Operational Impact: Does NOT block Firestore, UI responsiveness, or staff workflows.
 * 3. Fail-safe: Any network or API failure is caught silently and will never throw to the user.
 * 4. Dual Source Safety: Respects DOO vs ORA key isolation (-1P) and preserves print status.
 */

import { FirestoreFakturDoc } from "./types";

export async function syncFaktursToTiDB(fakturs: FirestoreFakturDoc[]): Promise<void> {
  if (!fakturs || fakturs.length === 0) return;
  try {
    const payload = fakturs.map((f) => ({
      invoice_key: f.id || f.no_faktur,
      no_faktur: f.no_faktur,
      no_sales_order: f.no_sales_order || "-",
      customer_name: f.customer_name || f.extra?.nama_pelanggan || "-",
      order_date: f.order_date || f.extra?.order_date || "-",
      transaction_date: f.transaction_date || f.extra?.transaction_date || f.order_date || "-",
      jenis_transaksi: f.jenis_transaksi || f.extra?.jenis_transaksi || "DOO",
      kategori: f.kategori || f.extra?.kategori || "3P",
      kategori_produk: (f.extra?.items && f.extra.items[0]?.kategori_produk) || "FARMA",
      status_cetak: Boolean(f.status_cetak),
      printed_at: f.printed_at || null,
      printed_by: f.printed_by || null,
      total_harga: Number(f.extra?.total_harga || 0),
      items: f.extra?.items || [],
    }));

    const CHUNK_SIZE = 50;
    for (let i = 0; i < payload.length; i += CHUNK_SIZE) {
      const slice = payload.slice(i, i + CHUNK_SIZE);
      await fetch("/api/tidb", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "upsert_batch",
          fakturs: slice,
        }),
      }).catch((err) => {
        console.warn("[TiDB Sync] Upsert slice failed:", err);
      });
    }
  } catch (err) {
    console.warn("[TiDB Sync] Error syncing to TiDB:", err);
  }
}

export function syncFaktursToTiDBBackground(fakturs: FirestoreFakturDoc[]) {
  if (!fakturs || fakturs.length === 0) return;

  // Run in next tick / microtask to ensure zero interference with current call stack
  setTimeout(async () => {
    await syncFaktursToTiDB(fakturs);
  }, 50);
}

export function syncPrintStatusToTiDBBackground(
  keys: string[],
  isPrinted: boolean,
  printedAt: string | null = null,
  printedBy: string | null = null
) {
  if (!keys || keys.length === 0) return;

  setTimeout(async () => {
    try {
      await fetch("/api/tidb", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_print",
          keys,
          isPrinted,
          printedAt,
          printedBy,
        }),
      }).catch((err) => {
        console.warn("[TiDB Sync] Background print update failed safely (non-blocking):", err);
      });
    } catch (err) {
      console.warn("[TiDB Sync] Error preparing print status payload:", err);
    }
  }, 100);
}

export async function fetchFaktursFromTiDB(): Promise<FirestoreFakturDoc[] | null> {
  try {
    const res = await fetch("/api/tidb", {
      method: "GET",
      headers: { "Cache-Control": "no-cache" },
    });
    if (!res.ok) {
      console.warn("[TiDB Read] HTTP error:", res.status);
      return null;
    }
    const data = await res.json();
    if (data.success && Array.isArray(data.fakturs)) {
      return data.fakturs as FirestoreFakturDoc[];
    }
    return null;
  } catch (err) {
    console.warn("[TiDB Read] Fetch failed safely:", err);
    return null;
  }
}

// -------------------------------------------------------------
// High-Speed Local IndexedDB Cache for Instant 0ms App Launch
// Emulates Firebase offline persistence with zero external deps
// -------------------------------------------------------------
const DB_NAME = "faktur_tidb_cache_db";
const STORE_NAME = "fakturs_store";
const KEY = "cached_fakturs";

function openCacheDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      return reject(new Error("IndexedDB not available in current environment"));
    }
    const req = window.indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getLocalCachedFakturs(): Promise<FirestoreFakturDoc[] | null> {
  try {
    const db = await openCacheDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(KEY);
      req.onsuccess = () => {
        if (Array.isArray(req.result) && req.result.length > 0) {
          resolve(req.result as FirestoreFakturDoc[]);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function setLocalCachedFakturs(fakturs: FirestoreFakturDoc[]): Promise<void> {
  if (!fakturs || fakturs.length === 0) return;
  try {
    const db = await openCacheDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put(fakturs, KEY);
  } catch {
    // Non-blocking fail-safe
  }
}

