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

    const payload = parsedRows
      .map((row) => {
        const noFaktur = row[mapping.no_faktur];
        if (!noFaktur) return null; // skip baris tanpa no faktur

        const extra: Record<string, string | number | null> = {};
        Object.entries(row).forEach(([key, value]) => {
          if (!mappedColumns.has(key)) {
            extra[key] = value;
          }
        });

        return {
          no_faktur: String(noFaktur).trim(),
          no_delivery_order: row[mapping.no_delivery_order]
            ? String(row[mapping.no_delivery_order]).trim()
            : null,
          no_sales_order: row[mapping.no_sales_order]
            ? String(row[mapping.no_sales_order]).trim()
            : null,
          imported_at: importedAt,
          extra,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    if (payload.length === 0) {
      setStage("idle");
      return;
    }

    const batches = chunk(payload, 500);
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
    const newItems = payload.filter((p) => !existingNoFaktur.has(p.no_faktur));
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
