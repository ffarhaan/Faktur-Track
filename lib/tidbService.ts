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

export function syncFaktursToTiDBBackground(fakturs: FirestoreFakturDoc[]) {
  if (!fakturs || fakturs.length === 0) return;

  // Run in next tick / microtask to ensure zero interference with current call stack
  setTimeout(async () => {
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

      // Send to internal API route
      await fetch("/api/tidb", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "upsert_batch",
          fakturs: payload,
        }),
      }).catch((err) => {
        // Safe silent catch: never bubble up to operational UI
        console.warn("[TiDB Sync] Background upsert failed safely (non-blocking):", err);
      });
    } catch (err) {
      console.warn("[TiDB Sync] Error preparing background payload:", err);
    }
  }, 100);
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

