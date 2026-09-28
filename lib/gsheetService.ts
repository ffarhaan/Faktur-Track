/**
 * Google Sheets Backup Service
 * Otomatis mengirim data faktur baru ke Google Sheets setiap kali upload
 */

import { FirestoreFakturDoc, PrintState } from "./firestoreService";

const GSHEET_WEBHOOK_URL =
  "https://script.google.com/macros/s/AKfycbzX4iJF_wHgTPINLHYZoNsPMKEG3kExdAtOrcLsjDcNaVFA0oPYeH6DqFekjHDtmqA/exec";

const BATCH_SIZE = 1000;

export interface GSheetRow {
  no: number;
  orderDate: string;
  invoiceNumber: string;
  so: string;
  customerName: string;
  jenisTransaksi: string;
  kategori: string;
  kategoriProduk: string;
  itemCount: number;
  totalHarga: number;
  statusCetak: string;
  printedAt: string;
}

function toGSheetRow(
  item: FirestoreFakturDoc,
  printedSet: Set<string>,
  printMap: Record<string, string>,
  index: number
): GSheetRow {
  const key = item.id || item.no_faktur;
  const isPrinted = printedSet.has(key);
  const extra = (item.extra || {}) as Record<string, unknown>;
  const itemsList = Array.isArray(extra.items) ? extra.items : [];
  const totalHarga =
    typeof extra.total_harga === "number"
      ? extra.total_harga
      : typeof extra.entered_amount === "number"
      ? extra.entered_amount
      : parseFloat(
          String(
            extra.total_harga ||
              extra.entered_amount ||
              extra.amount ||
              "0"
          )
        ) || 0;

  const cust = String(extra.nama_pelanggan || item.customer_name || "");
  const cleanJenis = item.jenis_transaksi || (cust.toUpperCase().includes("APOTEK") || cust.toUpperCase().includes("CLINIC") ? "ORA" : "DOO");
  const docSO = String(item.no_sales_order || extra.no_sales_order || "").trim();
  const cleanDocSO = docSO.split(",").map((s) => s.trim()).filter((s) => s && s !== "-").join(", ");

  let itemSO = "";
  if (itemsList.length > 0) {
    for (const it of itemsList) {
      const itRec = it as Record<string, unknown>;
      const ordNum = String(itRec.order_number || itRec.no_sales_order || "").trim();
      if (ordNum && ordNum !== "-") {
        itemSO = ordNum;
        break;
      }
    }
  }

  const validItemSO = itemSO && itemSO !== "-" ? itemSO : "";
  let validSO = "-";
  if (cleanJenis === "ORA") {
    const candidate = [validItemSO, cleanDocSO].filter((s) => s && s !== "-").join(", ");
    const parts = candidate.split(",").map((s) => s.trim()).filter((s) => s && s !== "-");
    const realParts = parts.filter((s) => s.length >= 5 || s.includes("-"));
    validSO = realParts.length > 0 ? realParts[0] : parts[0] || "-";
  } else {
    if (cleanDocSO && cleanDocSO !== "-") {
      validSO = cleanDocSO.split(",")[0].trim();
    } else {
      validSO = validItemSO || "-";
    }
  }

  return {
    no: index + 1,
    orderDate: item.order_date || String(extra.order_date || extra.accounting_date || ""),
    invoiceNumber: item.no_faktur || "",
    so: validSO,
    customerName: item.customer_name || String(extra.nama_pelanggan || ""),
    jenisTransaksi: cleanJenis,
    kategori: item.kategori || "",
    kategoriProduk:
      String(extra.kategoriProduk || extra.klasifikasi_produk || ""),
    itemCount: itemsList.length > 0 ? itemsList.length : 1,
    totalHarga,
    statusCetak: isPrinted ? "Sudah Dicetak" : "Belum Dicetak",
    printedAt: printMap[key] || String(item.printed_at || "") || "-",
  };
}

async function sendBatch(rows: GSheetRow[]): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(GSHEET_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify(rows),
        redirect: "follow",
      });
      const text = await res.text();
      try {
        const json = JSON.parse(text);
        if (json.status === "success") return;
      } catch {
        // jika respon bukan JSON, anggap sukses jika status 200
        if (res.ok) return;
      }
      throw new Error(`GSheet webhook error: ${text.slice(0, 200)}`);
    } catch (err) {
      if (attempt === 2) throw err;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
}

/**
 * Kirim SEMUA faktur ke Google Sheets (clear dulu lalu isi ulang)
 * Dipakai saat upload baru — mengganti seluruh isi sheet dengan data terkini
 */
export async function syncAllToGSheet(
  allFakturs: FirestoreFakturDoc[],
  printState: PrintState | null
): Promise<{ success: boolean; count: number; error?: string }> {
  try {
    const printedSet = new Set<string>(printState?.printedKeys || []);
    const printMap = printState?.printedAtMap || {};

    // 1. Bersihkan sheet & buat header
    await fetch(GSHEET_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "clear" }),
      redirect: "follow",
    });

    // 2. Format semua baris
    const rows = allFakturs.map((item, idx) =>
      toGSheetRow(item, printedSet, printMap, idx)
    );

    // 3. Kirim per batch
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      await sendBatch(rows.slice(i, i + BATCH_SIZE));
    }

    return { success: true, count: rows.length };
  } catch (err) {
    console.error("GSheet sync error:", err);
    return {
      success: false,
      count: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Append HANYA faktur baru ke Google Sheets (tidak clear sheet)
 * Logika sama dengan di aplikasi: lihat faktur terakhir, tambahkan yang baru saja
 */
export async function appendNewToGSheet(
  newFakturs: FirestoreFakturDoc[],
  printState: PrintState | null
): Promise<{ success: boolean; count: number; error?: string }> {
  if (newFakturs.length === 0) return { success: true, count: 0 };

  try {
    const printedSet = new Set<string>(printState?.printedKeys || []);
    const printMap = printState?.printedAtMap || {};

    // Format hanya faktur baru
    const rows = newFakturs.map((item, idx) =>
      toGSheetRow(item, printedSet, printMap, idx)
    );

    // Kirim per batch (append langsung ke bawah, tidak hapus data lama)
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      await sendBatch(rows.slice(i, i + BATCH_SIZE));
    }

    return { success: true, count: rows.length };
  } catch (err) {
    console.error("GSheet append error:", err);
    return {
      success: false,
      count: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Sync status cetak (Sudah / Belum) untuk 1 faktur ke Google Sheets secara realtime
 */
export async function updateGSheetPrintStatus(
  invoiceKey: string,
  isPrinted: boolean,
  printedAt: string | null
): Promise<void> {
  const payload = {
    action: "updatePrintStatusOnly",
    invoiceKey,
    statusCetak: isPrinted ? "Sudah Dicetak" : "Belum Dicetak",
    printedAt: printedAt || "-",
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(GSHEET_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify(payload),
        redirect: "follow",
      });
      if (res.ok) {
        console.log(`✅ GSheet print status updated for ${invoiceKey}`);
        return;
      }
    } catch (err) {
      if (attempt === 2) {
        console.warn("GSheet print status sync failed after retries:", err);
      } else {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }
}

/**
 * Sync status cetak massal (batch) ke Google Sheets secara realtime
 */
export async function updateGSheetPrintStatusBatch(
  invoiceKeys: string[],
  isPrinted: boolean,
  printedAt: string | null
): Promise<void> {
  if (invoiceKeys.length === 0) return;

  const payload = {
    action: "updatePrintStatusBatch",
    invoiceKeys,
    statusCetak: isPrinted ? "Sudah Dicetak" : "Belum Dicetak",
    printedAt: printedAt || "-",
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(GSHEET_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify(payload),
        redirect: "follow",
      });
      if (res.ok) {
        console.log(`✅ GSheet batch print status updated for ${invoiceKeys.length} items`);
        return;
      }
    } catch (err) {
      if (attempt === 2) {
        console.warn("GSheet batch print status sync failed after retries:", err);
      } else {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }
}
