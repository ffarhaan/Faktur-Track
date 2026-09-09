"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { ColumnMapping, FakturRecord, ParsedExcelRow } from "@/lib/types";
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

export default function HomePage() {
  const [records, setRecords] = useState<FakturRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [stage, setStage] = useState<Stage>("idle");
  const [headers, setHeaders] = useState<string[]>([]);
  const [parsedRows, setParsedRows] = useState<ParsedExcelRow[]>([]);
  const [showUpload, setShowUpload] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  // filter dari ImportSummary "Lihat data baru"
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

    // Supabase Realtime: Otomatis sinkron data tanpa refresh manual saat ada perubahan
    const channel = supabase
      .channel("faktur-records-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "faktur_records" },
        () => {
          fetchRecords();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  function handleParsed(hdrs: string[], rows: ParsedExcelRow[]) {
    setHeaders(hdrs);
    setParsedRows(rows);
    setStage("mapping");
  }

  async function handleImport(mapping: ColumnMapping) {
    setStage("importing");
    setImportResult(null);

    const mappedColumns = new Set(Object.values(mapping));
    const importedAt = new Date().toISOString();

    // Simpan set no_faktur yang sudah ada SEBELUM import untuk deteksi data baru
    const existingNoFaktur = new Set(records.map((r) => r.no_faktur));
    // Simpan map no_faktur -> status_cetak untuk deteksi "baru belum diprint"
    const existingStatusMap = new Map(
      records.map((r) => [r.no_faktur, r.status_cetak])
    );

    // Helper mencari value dari kolom row dengan fuzzy key match
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

    type AggregatedInvoice = {
      no_faktur: string;
      no_delivery_order: string | null;
      no_sales_order: string | null;
      imported_at: string;
      extra: {
        items: Array<{
          item_code?: string | number | null;
          item_description?: string | number | null;
          qty?: string | number | null;
          uom?: string | number | null;
          lot_number?: string | number | null;
          harga_jual?: string | number | null;
          total_harga?: string | number | null;
          nama_pelanggan?: string | number | null;
          order_number?: string | number | null;
        }>;
        nama_pelanggan?: string | null;
        [key: string]: unknown;
      };
      _soSet: Set<string>;
    };

    const uniqueMap = new Map<string, AggregatedInvoice>();

    for (const row of parsedRows) {
      const rawNoFaktur = row[mapping.no_faktur];
      if (!rawNoFaktur) continue; // skip baris tanpa no faktur

      const noFaktur = String(rawNoFaktur).trim();
      const soVal = mapping.no_sales_order && row[mapping.no_sales_order]
        ? String(row[mapping.no_sales_order]).trim()
        : null;
      const doVal = mapping.no_delivery_order && row[mapping.no_delivery_order]
        ? String(row[mapping.no_delivery_order]).trim()
        : null;

      const custName = findRowVal(row, [/nama.*pelanggan/i, /customer/i, /pelanggan/i]);
      const orderTypeVal = findRowVal(row, [/order.*type/i, /transaction.*type/i, /order.*source/i, /line.*type/i]);
      const itemCode = findRowVal(row, [/item.*code/i, /kode.*barang/i, /item/i]);
      const itemDesc = findRowVal(row, [/item.*desc/i, /nama.*barang/i, /description/i, /product/i]);
      const qtyVal = findRowVal(row, [/^qty$/i, /quantity/i, /jumlah/i]);
      const uomVal = findRowVal(row, [/^uom$/i, /satuan/i, /unit/i]);
      const lotVal = findRowVal(row, [/lot/i, /batch/i]);
      const hargaJual = findRowVal(row, [/harga.*jual/i, /unit.*price/i, /hna/i]);
      const totalHarga = findRowVal(row, [/total.*harga/i, /amount/i, /total/i]);

      const itemObj = {
        item_code: itemCode,
        item_description: itemDesc,
        qty: qtyVal,
        uom: uomVal,
        lot_number: lotVal,
        harga_jual: hargaJual,
        total_harga: totalHarga,
        nama_pelanggan: custName,
        order_number: soVal,
      };

      const existing = uniqueMap.get(noFaktur);
      if (!existing) {
        const soSet = new Set<string>();
        if (soVal) soSet.add(soVal);

        uniqueMap.set(noFaktur, {
          no_faktur: noFaktur,
          no_delivery_order: doVal,
          no_sales_order: soVal,
          imported_at: importedAt,
          extra: {
            nama_pelanggan: custName ? String(custName) : null,
            order_type: orderTypeVal ? String(orderTypeVal) : null,
            items: (itemCode || itemDesc) ? [itemObj] : [],
          },
          _soSet: soSet,
        });
      } else {
        if (soVal) existing._soSet.add(soVal);
        if (!existing.extra.nama_pelanggan && custName) {
          existing.extra.nama_pelanggan = String(custName);
        }
        if (!existing.extra.order_type && orderTypeVal) {
          existing.extra.order_type = String(orderTypeVal);
        }
        if (itemCode || itemDesc) {
          existing.extra.items.push(itemObj);
        }
      }
    }

    const uniquePayload = Array.from(uniqueMap.values()).map((item) => {
      const { _soSet, ...rest } = item;
      return {
        ...rest,
        no_sales_order: _soSet.size > 0 ? Array.from(_soSet).join(", ") : null,
      };
    });

    if (uniquePayload.length === 0) {
      setStage("idle");
      return;
    }

    const batches = chunk(uniquePayload, 500);
    let importedCount = 0;

    for (const batch of batches) {
      const { error } = await supabase
        .from("faktur_records")
        .upsert(batch, { onConflict: "no_faktur" });

      if (error) {
        alert("Gagal import: " + error.message);
        setStage("idle");
        return;
      }
      importedCount += batch.length;
    }

    // Hitung statistik: data baru & yang belum diprint
    const newItems = uniquePayload.filter((p) => !existingNoFaktur.has(p.no_faktur));
    const newCount = newItems.length;
    // Data baru → belum diprint (status_cetak default false untuk yang baru)
    const newUnprintedCount = newItems.filter(
      (p) => !existingStatusMap.get(p.no_faktur)
    ).length;

    setImportResult({ totalImported: importedCount, newCount, newUnprintedCount, importedAt });
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
