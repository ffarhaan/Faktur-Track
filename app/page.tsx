"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { FileType, FakturRecord, ParsedExcelRow } from "@/lib/types";
import UploadExcel from "@/components/UploadExcel";
import ColumnMapper from "@/components/ColumnMapper";
import DataTable from "@/components/DataTable";
import ImportSummary from "@/components/ImportSummary";

type Stage = "idle" | "mapping" | "importing";

type ImportResult = {
  totalImported: number;
  newCount: number;
  newUnprintedCount: number;
  importedAt: string;
};

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Normalisasi string header: lowercase, alphanumeric only
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Cari nilai dari row berdasarkan pola regex
function findRowVal(row: ParsedExcelRow, patterns: RegExp[]): string | number | null {
  for (const pattern of patterns) {
    for (const [key, val] of Object.entries(row)) {
      if (pattern.test(key) && val !== null && val !== undefined && val !== "") {
        return val;
      }
    }
  }
  return null;
}

/**
 * Deteksi tipe file berdasarkan header kolom.
 * XXCUST  → ada "No Invoice AR"
 * DOO/ORA → ada "Reference" + "Transaction Source" + "Bill-to Customer"
 */
function detectFileType(hdrs: string[]): FileType {
  const normalized = hdrs.map(norm);
  if (normalized.some((h) => h.includes("noinvoicear") || h.includes("invoicear"))) return "XXCUST";
  if (
    normalized.some((h) => h === "reference") &&
    normalized.some((h) => h.includes("transactionsource")) &&
    normalized.some((h) => h.includes("billtocustomer") || h.includes("billto"))
  ) {
    return "DOO"; // DOO dan ORA punya format yang sama
  }
  return "UNKNOWN";
}

export default function HomePage() {
  const [records, setRecords] = useState<FakturRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [stage, setStage] = useState<Stage>("idle");
  const [headers, setHeaders] = useState<string[]>([]);
  const [parsedRows, setParsedRows] = useState<ParsedExcelRow[]>([]);
  const [showUpload, setShowUpload] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [highlightImportedAt, setHighlightImportedAt] = useState<string | null>(null);

  async function fetchRecords() {
    setLoading(true);
    const { data, error } = await supabase
      .from("faktur_records")
      .select("*")
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) {
      console.error(error);
      return;
    }
    setRecords((data as FakturRecord[]) ?? []);
  }

  useEffect(() => {
    fetchRecords();

    const channel = supabase
      .channel("faktur-records-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "faktur_records" },
        () => { fetchRecords(); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  function handleParsed(hdrs: string[], rows: ParsedExcelRow[]) {
    const fileType = detectFileType(hdrs);
    if (fileType === "XXCUST") {
      executeImportXXCUST(rows);
    } else if (fileType === "DOO") {
      executeImportDOO(rows);
    } else {
      // Tidak terdeteksi → tampilkan ColumnMapper manual
      setHeaders(hdrs);
      setParsedRows(rows);
      setStage("mapping");
    }
  }

  // ─────────────────────────────────────────────
  // IMPORT XXCUST
  // Kolom: No Invoice AR, Order Number, Nama Pelanggan,
  //        Item Code, Item Description, Qty, UOM, LOT Number,
  //        HNA, Diskon, Harga Jual, Total Harga, COGS/Unit, Profit
  // ─────────────────────────────────────────────
  async function executeImportXXCUST(rowsToImport: ParsedExcelRow[]) {
    setStage("importing");
    setImportResult(null);
    const importedAt = new Date().toISOString();

    const existingNoFaktur = new Set(records.map((r) => r.no_faktur).filter(Boolean));
    const existingStatusMap = new Map(records.map((r) => [r.no_faktur, r.status_cetak]));

    type AggInvoice = {
      no_faktur: string;
      no_sales_order: string | null;
      no_delivery_order: string | null;
      imported_at: string;
      source_file: string;
      extra: {
        nama_pelanggan?: string | null;
        jenis_transaksi?: string | null;
        items: Array<Record<string, unknown>>;
      };
      _soSet: Set<string>;
    };

    const uniqueMap = new Map<string, AggInvoice>();

    for (const row of rowsToImport) {
      // Cari No Invoice AR
      const rawFaktur =
        findRowVal(row, [/no\s*invoice\s*ar/i, /invoice\s*ar/i]) ??
        findRowVal(row, [/no\s*faktur/i, /nofaktur/i]);
      if (!rawFaktur) continue;

      const noFaktur = String(rawFaktur).trim();
      if (!noFaktur || noFaktur === "0") continue;

      // Cari Order Number (No SO)
      const soRaw = findRowVal(row, [/^order\s*number$/i, /^no\s*so$/i, /^sales\s*order/i]);
      const soVal = soRaw ? String(soRaw).trim() : null;

      // Data barang
      const itemCode   = findRowVal(row, [/^item\s*code$/i, /^kode\s*barang$/i]);
      const itemDesc   = findRowVal(row, [/^item\s*description$/i, /^nama\s*barang$/i, /^description$/i]);
      const qty        = findRowVal(row, [/^qty$/i, /^quantity$/i, /^jumlah$/i]);
      const uom        = findRowVal(row, [/^uom$/i, /^satuan$/i]);
      const lot        = findRowVal(row, [/^lot\s*number$/i, /^lot$/i, /^batch$/i]);
      const hna        = findRowVal(row, [/^hna$/i, /^unit\s*price$/i]);
      const diskon     = findRowVal(row, [/^diskon$/i, /^discount$/i]);
      const hargaJual  = findRowVal(row, [/^harga\s*jual$/i, /^selling\s*price$/i]);
      const totalHarga = findRowVal(row, [/^total\s*harga$/i, /^amount$/i, /^total$/i]);
      const cogs       = findRowVal(row, [/^cogs\/unit$/i, /^cogs$/i]);
      const profit     = findRowVal(row, [/^profit$/i]);
      const kategori   = findRowVal(row, [/^nama\s*kategori/i, /^kategori/i]);
      const principal  = findRowVal(row, [/^principal$/i]);
      const brand      = findRowVal(row, [/^brand$/i]);
      const custName   = findRowVal(row, [/^nama\s*pelanggan$/i, /^customer$/i, /^pelanggan$/i]);
      const jenisTrans = findRowVal(row, [/^jenis\s*transaksi$/i, /^transaction\s*type$/i]);

      const itemObj = {
        item_code: itemCode,
        item_description: itemDesc,
        qty,
        uom,
        lot_number: lot,
        hna,
        diskon,
        harga_jual: hargaJual,
        total_harga: totalHarga,
        cogs,
        profit,
        kategori,
        principal,
        brand,
        order_number: soVal,
      };

      const existing = uniqueMap.get(noFaktur);
      if (!existing) {
        const soSet = new Set<string>();
        if (soVal) soSet.add(soVal);
        uniqueMap.set(noFaktur, {
          no_faktur: noFaktur,
          no_sales_order: soVal,
          no_delivery_order: null,
          imported_at: importedAt,
          source_file: "XXCUST",
          extra: {
            nama_pelanggan: custName ? String(custName) : null,
            jenis_transaksi: jenisTrans ? String(jenisTrans) : null,
            items: (itemCode || itemDesc) ? [itemObj] : [],
          },
          _soSet: soSet,
        });
      } else {
        if (soVal) existing._soSet.add(soVal);
        if (!existing.extra.nama_pelanggan && custName) existing.extra.nama_pelanggan = String(custName);
        if (!existing.extra.jenis_transaksi && jenisTrans) existing.extra.jenis_transaksi = String(jenisTrans);
        if (itemCode || itemDesc) existing.extra.items.push(itemObj);
      }
    }

    const payload = Array.from(uniqueMap.values()).map(({ _soSet, ...rest }) => ({
      ...rest,
      no_sales_order: _soSet.size > 0 ? Array.from(_soSet).join(", ") : rest.no_sales_order,
    }));

    if (payload.length === 0) { setStage("idle"); return; }

    // Upsert by no_faktur
    for (const batch of chunk(payload, 500)) {
      const { error } = await supabase
        .from("faktur_records")
        .upsert(batch, { onConflict: "no_faktur" });
      if (error) { alert("Gagal import XXCUST: " + error.message); setStage("idle"); return; }
    }

    // Untuk setiap no_so dari XXCUST, update record DOO (yang no_faktur-nya null) agar dapat no_faktur
    const soToFakturMap = new Map<string, string>();
    for (const item of payload) {
      if (item.no_sales_order) {
        for (const so of item.no_sales_order.split(", ")) {
          soToFakturMap.set(so.trim(), item.no_faktur);
        }
      }
    }
    // Update DOO records yang cocok
    for (const [so, faktur] of soToFakturMap.entries()) {
      await supabase
        .from("faktur_records")
        .update({ no_faktur: faktur, source_file: "XXCUST", imported_at: importedAt })
        .eq("no_sales_order", so)
        .is("no_faktur", null);
    }

    const newItems = payload.filter((p) => !existingNoFaktur.has(p.no_faktur));
    const newCount = newItems.length;
    const newUnprintedCount = newItems.filter((p) => !existingStatusMap.get(p.no_faktur)).length;

    setImportResult({ totalImported: payload.length, newCount, newUnprintedCount, importedAt });
    setStage("idle");
    setShowUpload(false);
    setParsedRows([]);
    setHeaders([]);
    await fetchRecords();
  }

  // ─────────────────────────────────────────────
  // IMPORT DOO / ORA
  // Kolom: Reference (No SO), Bill-to Customer, Transaction Source, Accounting Date
  // ─────────────────────────────────────────────
  async function executeImportDOO(rowsToImport: ParsedExcelRow[]) {
    setStage("importing");
    setImportResult(null);
    const importedAt = new Date().toISOString();

    const existingSO = new Set(records.map((r) => r.no_sales_order).filter(Boolean));

    type DOORecord = {
      no_faktur: null;
      no_delivery_order: null;
      no_sales_order: string;
      imported_at: string;
      source_file: string;
      extra: {
        nama_pelanggan?: string | null;
        jenis_transaksi?: string | null;
        items: [];
      };
    };

    const uniqueMap = new Map<string, DOORecord>();

    for (const row of rowsToImport) {
      // Reference = No SO
      const refRaw = findRowVal(row, [/^reference$/i]);
      if (!refRaw) continue;
      const soVal = String(refRaw).trim();
      if (!soVal) continue;

      const custName   = findRowVal(row, [/^bill.to\s*customer$/i, /^ship.to\s*customer$/i, /^customer$/i]);
      const txSource   = findRowVal(row, [/^transaction\s*source$/i]);

      if (!uniqueMap.has(soVal)) {
        uniqueMap.set(soVal, {
          no_faktur: null,
          no_delivery_order: null,
          no_sales_order: soVal,
          imported_at: importedAt,
          source_file: txSource ? String(txSource).includes("DOO") ? "DOO" : "ORA" : "DOO",
          extra: {
            nama_pelanggan: custName ? String(custName) : null,
            jenis_transaksi: txSource ? String(txSource) : null,
            items: [],
          },
        });
      }
    }

    const payload = Array.from(uniqueMap.values());
    if (payload.length === 0) { setStage("idle"); return; }

    // Upsert by no_sales_order (hanya untuk record yang no_faktur-nya NULL)
    let importedCount = 0;
    for (const batch of chunk(payload, 500)) {
      // Insert baru jika no_sales_order belum ada, skip jika sudah ada (termasuk yang sudah punya faktur)
      const newRecords = batch.filter((r) => !existingSO.has(r.no_sales_order));
      if (newRecords.length > 0) {
        const { error } = await supabase
          .from("faktur_records")
          .insert(newRecords);
        if (error) { alert("Gagal import DOO: " + error.message); setStage("idle"); return; }
        importedCount += newRecords.length;
      }
    }

    const newCount = importedCount;
    setImportResult({ totalImported: payload.length, newCount, newUnprintedCount: 0, importedAt });
    setStage("idle");
    setShowUpload(false);
    setParsedRows([]);
    setHeaders([]);
    await fetchRecords();
  }

  async function handleImport(mapping: Record<string, string>) {
    // Fallback manual mapping (ColumnMapper)
    setStage("importing");
    const importedAt = new Date().toISOString();
    const payload = parsedRows
      .map((row) => ({
        no_faktur: mapping.no_faktur ? String(row[mapping.no_faktur] ?? "").trim() : null,
        no_sales_order: mapping.no_sales_order ? String(row[mapping.no_sales_order] ?? "").trim() || null : null,
        no_delivery_order: null,
        imported_at: importedAt,
        source_file: "MANUAL",
        extra: { items: [] },
      }))
      .filter((r) => r.no_faktur);

    for (const batch of chunk(payload, 500)) {
      const { error } = await supabase
        .from("faktur_records")
        .upsert(batch, { onConflict: "no_faktur" });
      if (error) { alert("Gagal import: " + error.message); setStage("idle"); return; }
    }
    setImportResult({ totalImported: payload.length, newCount: payload.length, newUnprintedCount: payload.length, importedAt });
    setStage("idle");
    setShowUpload(false);
    setParsedRows([]);
    setHeaders([]);
    await fetchRecords();
  }

  function handleRecordUpdated(updated: FakturRecord) {
    setRecords((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
  }

  function handleRecordDeleted(id: string) {
    setRecords((prev) => prev.filter((r) => r.id !== id));
  }

  return (
    <main className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Faktur Tracker</h1>
          <p className="text-sm text-gray-500">
            Tracking No Faktur, No Delivery Order, No Sales Order &amp; status print
          </p>
        </div>
        <button
          onClick={() => setShowUpload((s) => !s)}
          className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800"
        >
          {showUpload ? "Tutup" : "Import Excel"}
        </button>
      </div>

      {/* Banner summary setelah import */}
      {importResult && (
        <ImportSummary
          totalImported={importResult.totalImported}
          newCount={importResult.newCount}
          newUnprintedCount={importResult.newUnprintedCount}
          importedAt={importResult.importedAt}
          onDismiss={() => {
            setImportResult(null);
            setHighlightImportedAt(null);
          }}
          onViewNew={() => {
            setHighlightImportedAt(importResult.importedAt);
            setImportResult(null);
          }}
        />
      )}

      {showUpload && (
        <div className="mb-8 space-y-4">
          {stage === "idle" && <UploadExcel onParsed={handleParsed} />}
          {stage === "mapping" && (
            <ColumnMapper
              headers={headers}
              onConfirm={handleImport}
              onCancel={() => {
                setStage("idle");
                setHeaders([]);
                setParsedRows([]);
              }}
            />
          )}
          {stage === "importing" && (
            <p className="text-sm text-gray-500">Mengimport data, mohon tunggu...</p>
          )}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">Memuat data...</p>
      ) : (
        <DataTable
          records={records}
          onRecordUpdated={handleRecordUpdated}
          onRecordDeleted={handleRecordDeleted}
          highlightImportedAt={highlightImportedAt}
          onClearHighlight={() => setHighlightImportedAt(null)}
        />
      )}
    </main>
  );
}
