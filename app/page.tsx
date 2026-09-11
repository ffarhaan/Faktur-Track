"use client";

import { useState, useMemo, useEffect, useCallback, Fragment } from "react";
import { parseExcelFile } from "@/lib/parser";
import { FakturRecord } from "@/lib/types";
import { supabase } from "@/lib/supabaseClient";

type Filter = "all" | "belum" | "sudah" | "double";
type KatFilter = "all" | "1P" | "2P" | "3P";

const ROWS_PER_PAGE = 50;

function parseInvNum(invs: string[]): number {
  if (!invs || invs.length === 0) return 0;
  const n = parseInt(invs[0].replace(/\D/g, ""), 10);
  return isNaN(n) ? 0 : n;
}

function parseDateMs(dStr: string): number {
  if (!dStr) return 0;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(dStr)) {
    const [d, m, y] = dStr.split("/").map(Number);
    return new Date(y, m - 1, d).getTime();
  }
  const t = Date.parse(dStr);
  return isNaN(t) ? 0 : t;
}

function formatRupiah(n: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(n);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

type SOGroup = {
  so: string;
  items: FakturRecord[];
  orderDate: string;
  invoiceNumbers: string[];
  invoiceKeys: string[];
  jenisTransaksi: string;
  customerName: string;
  kategori: "1P" | "2P" | "3P";
  isDoubleInv: boolean;
  totalHarga: number;
  totalItems: number;
  allPrinted: boolean;
  anyPrinted: boolean;
};

type UploadedFile = {
  name: string;
  count: number;
  time: string;
};

function dbRowsToFakturRecords(rows: Array<Record<string, unknown>>): {
  records: FakturRecord[];
  printedSet: Set<string>;
} {
  const records: FakturRecord[] = [];
  const printedSet = new Set<string>();

  for (const r of rows) {
    const rawInv = String(r.no_faktur || "");
    const cleanInv = rawInv.replace(/-1P$/i, "");
    const extra = (r.extra as Record<string, unknown>) || {};
    const items = (extra.items as Array<Record<string, unknown>>) || [];
    const cust = String(extra.nama_pelanggan || "");
    const jenis = String(extra.jenis_transaksi || r.source_file || "");
    const date = String(extra.accounting_date || extra.order_date || r.imported_at || "");
    const is1P = rawInv.endsWith("-1P") || String(r.source_file || "").toUpperCase() === "ORA" || jenis.includes("PRIORITY") || cust.toLowerCase().includes("helios");
    const invKey = is1P ? `${cleanInv}-1P` : cleanInv;
    const cleanJenis = is1P ? "ORA" : "DOO";

    if (r.status_cetak) {
      if (invKey) printedSet.add(invKey);
    }

    if (items.length > 0) {
      for (let idx = 0; idx < items.length; idx++) {
        const it = items[idx];
        records.push({
          orderDate: date,
          orderNumber: String(it.order_number || r.no_sales_order || cleanInv),
          invoiceNumber: cleanInv,
          invoiceKey: invKey,
          jenisTransaksi: cleanJenis,
          customerName: cust,
          itemCode: String(it.item_code || ""),
          itemDescription: String(it.item_description || ""),
          qty: (it.qty as number | string) || 0,
          uom: String(it.uom || ""),
          lotNumber: String(it.lot_number || ""),
          totalHarga: typeof it.total_harga === "number" ? it.total_harga : parseFloat(String(it.total_harga || 0)) || 0,
          kategori: is1P ? "1P" : "3P",
          isDoubleInv: false,
          rowIndex: idx,
        });
      }
    } else {
      records.push({
        orderDate: date,
        orderNumber: String(r.no_sales_order || cleanInv),
        invoiceNumber: cleanInv,
        invoiceKey: invKey,
        jenisTransaksi: cleanJenis,
        customerName: cust,
        itemCode: "-",
        itemDescription: "Data DOO",
        qty: 1,
        uom: "-",
        lotNumber: "-",
        totalHarga: 0,
        kategori: is1P ? "1P" : "3P",
        isDoubleInv: false,
        rowIndex: 0,
      });
    }
  }

  // Detect double invoices
  const soInvMap: Record<string, Set<string>> = {};
  for (const rec of records) {
    if (!soInvMap[rec.orderNumber]) soInvMap[rec.orderNumber] = new Set();
    if (rec.invoiceNumber) soInvMap[rec.orderNumber].add(rec.invoiceNumber);
  }
  for (const rec of records) {
    if (soInvMap[rec.orderNumber]?.size > 1) rec.isDoubleInv = true;
  }

  return { records, printedSet };
}

export default function Home() {
  const [records, setRecords] = useState<FakturRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [filter, setFilter] = useState<Filter>("belum");
  const [katFilter, setKatFilter] = useState<KatFilter>("all");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [printedInvoices, setPrintedInvoices] = useState<Set<string>>(new Set());
  const [dragOver, setDragOver] = useState(false);
  const [expandedSOs, setExpandedSOs] = useState<Set<string>>(new Set());

  // Fetch all records from Supabase
  const fetchFromSupabase = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      let allRows: Array<Record<string, unknown>> = [];
      let from = 0;
      const step = 1000;
      while (true) {
        const { data, error: sbErr } = await supabase
          .from("faktur_records")
          .select("*")
          .order("created_at", { ascending: false })
          .range(from, from + step - 1);

        if (sbErr || !data || data.length === 0) break;
        allRows = allRows.concat(data as Array<Record<string, unknown>>);
        if (data.length < step) break;
        from += step;
      }

      if (allRows.length > 0) {
        const { records: recs, printedSet } = dbRowsToFakturRecords(allRows);
        setRecords(recs);
        setPrintedInvoices(printedSet);
        try {
          localStorage.setItem("records", JSON.stringify(recs));
          localStorage.setItem("printedInvoices", JSON.stringify([...printedSet]));
        } catch {}
      }
    } catch (err) {
      console.error("Supabase sync error:", err);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  // Load on mount: fast cache first, then sync with Supabase
  useEffect(() => {
    try {
      const storedRecords = localStorage.getItem("records");
      if (storedRecords) setRecords(JSON.parse(storedRecords));
      const storedPrinted = localStorage.getItem("printedInvoices");
      if (storedPrinted) setPrintedInvoices(new Set(JSON.parse(storedPrinted)));
      const storedFiles = localStorage.getItem("uploadedFiles");
      if (storedFiles) setUploadedFiles(JSON.parse(storedFiles));
    } catch {}

    fetchFromSupabase(true);

    // Sync from Supabase every 15s so all devices stay updated
    const syncInterval = setInterval(() => {
      fetchFromSupabase(false);
    }, 15000);

    return () => clearInterval(syncInterval);
  }, [fetchFromSupabase]);

  // Auto-refresh on new deploy version
  useEffect(() => {
    let currentVersion: string | null = null;
    const checkVersion = async () => {
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        const data = await res.json();
        if (currentVersion === null) {
          currentVersion = data.version;
        } else if (currentVersion !== data.version) {
          window.location.reload();
        }
      } catch {}
    };
    checkVersion();
    const interval = setInterval(checkVersion, 30000);
    return () => clearInterval(interval);
  }, []);

  const toggleExpand = useCallback((so: string) => {
    setExpandedSOs((prev) => {
      const next = new Set(prev);
      if (next.has(so)) next.delete(so);
      else next.add(so);
      return next;
    });
  }, []);

  // Print: toggle local state AND sync to Supabase so all devices see it
  const togglePrint = useCallback(
    async (group: SOGroup) => {
      const willBePrinted = !group.allPrinted;
      const next = new Set(printedInvoices);
      for (const key of group.invoiceKeys) {
        if (willBePrinted) next.add(key);
        else next.delete(key);
      }
      setPrintedInvoices(next);
      try {
        localStorage.setItem("printedInvoices", JSON.stringify([...next]));
      } catch {}

      await supabase
        .from("faktur_records")
        .update({
          status_cetak: willBePrinted,
          printed_at: willBePrinted ? new Date().toISOString() : null,
        })
        .in("no_faktur", group.invoiceKeys);
    },
    [printedInvoices]
  );

  const markAllAsPrinted = useCallback(async () => {
    const next = new Set(printedInvoices);
    const allKeys: string[] = [];
    for (const r of records) {
      next.add(r.invoiceKey);
      allKeys.push(r.invoiceKey);
    }
    setPrintedInvoices(next);
    try {
      localStorage.setItem("printedInvoices", JSON.stringify([...next]));
    } catch {}

    for (const batch of chunk(allKeys, 500)) {
      await supabase
        .from("faktur_records")
        .update({ status_cetak: true, printed_at: new Date().toISOString() })
        .in("no_faktur", batch);
    }
  }, [records, printedInvoices]);

  const markAllAsUnprinted = useCallback(async () => {
    if (!confirm("Reset SEMUA faktur menjadi 'Belum Terprint'?")) return;
    setPrintedInvoices(new Set());
    try {
      localStorage.setItem("printedInvoices", JSON.stringify([]));
    } catch {}

    const allKeys: string[] = [];
    for (const r of records) {
      allKeys.push(r.invoiceKey);
    }
    for (const batch of chunk(allKeys, 500)) {
      await supabase
        .from("faktur_records")
        .update({ status_cetak: false, printed_at: null })
        .in("no_faktur", batch);
    }
  }, [records]);

  // Upload: Parse & Save directly to Supabase cloud DB so all devices see it
  const handleUpload = useCallback(
    async (file: File) => {
      setLoading(true);
      setError(null);
      try {
        const parsed = await parseExcelFile(file);
        if (parsed.length === 0) {
          setError("File berhasil dibaca tapi tidak ada data.");
          setLoading(false);
          return;
        }

        const importedAt = new Date().toISOString();

        // Fetch ALL existing print status from DB (paginated) so we NEVER reset already printed invoices
        let existingDB: Array<Record<string, unknown>> = [];
        let fromIdx = 0;
        while (true) {
          const { data: pageData, error: pageErr } = await supabase
            .from("faktur_records")
            .select("no_faktur, status_cetak, printed_at, extra")
            .range(fromIdx, fromIdx + 999);
          if (pageErr || !pageData || pageData.length === 0) break;
          existingDB = existingDB.concat(pageData as Array<Record<string, unknown>>);
          if (pageData.length < 1000) break;
          fromIdx += 1000;
        }

        const existingStatusMap = new Map<string, { status_cetak: boolean; printed_at: string | null; extra: Record<string, unknown> | null }>();
        existingDB.forEach((row: Record<string, unknown>) => {
          existingStatusMap.set(String(row.no_faktur).trim(), {
            status_cetak: Boolean(row.status_cetak),
            printed_at: (row.printed_at as string) || null,
            extra: (row.extra as Record<string, unknown>) || null,
          });
        });

        // Group parsed records by invoice to upsert to Supabase
        const invMap = new Map<string, Record<string, unknown>>();
        for (const r of parsed) {
          const is1P = r.kategori === "1P" || r.jenisTransaksi.includes("PRIORITY") || r.customerName.toLowerCase().includes("helios");
          const noFaktur = is1P ? `${r.invoiceNumber}-1P` : r.invoiceNumber;
          if (!noFaktur || noFaktur === "0" || noFaktur === "-1P") continue;

          const prevInfo = existingStatusMap.get(noFaktur);
          const isPrinted = prevInfo ? prevInfo.status_cetak : false;
          const printedAt = prevInfo ? prevInfo.printed_at : null;

          if (!invMap.has(noFaktur)) {
            invMap.set(noFaktur, {
              no_faktur: noFaktur,
              no_sales_order: r.orderNumber,
              no_delivery_order: null,
              status_cetak: isPrinted,
              printed_at: printedAt,
              imported_at: importedAt,
              source_file: is1P ? "ORA" : "XXCUST",
              extra: {
                nama_pelanggan: r.customerName || (prevInfo?.extra?.nama_pelanggan as string) || null,
                jenis_transaksi: r.jenisTransaksi || (prevInfo?.extra?.jenis_transaksi as string) || null,
                accounting_date: r.orderDate || (prevInfo?.extra?.accounting_date as string) || null,
                order_date: r.orderDate || (prevInfo?.extra?.order_date as string) || null,
                items: [],
              },
              _soSet: new Set([r.orderNumber]),
            });
          }

          const existing = invMap.get(noFaktur)!;
          (existing._soSet as Set<string>).add(r.orderNumber);
          const itList = (existing.extra as Record<string, unknown>).items as Array<Record<string, unknown>>;
          itList.push({
            item_code: r.itemCode,
            item_description: r.itemDescription,
            qty: r.qty,
            uom: r.uom,
            lot_number: r.lotNumber,
            total_harga: r.totalHarga,
            order_number: r.orderNumber,
          });
        }

        const payload = Array.from(invMap.values()).map(({ _soSet, ...rest }) => ({
          ...rest,
          no_sales_order: (_soSet as Set<string>).size > 0 ? Array.from(_soSet as Set<string>).join(", ") : rest.no_sales_order,
        }));

        for (const batch of chunk(payload, 500)) {
          const { error: sbErr } = await supabase
            .from("faktur_records")
            .upsert(batch, { onConflict: "no_faktur" });
          if (sbErr) console.error("Upload upsert error:", sbErr.message);
        }

        setUploadedFiles((prev) => [
          ...prev,
          { name: file.name, count: parsed.length, time: new Date().toLocaleString("id-ID") },
        ]);
        setPage(0);

        await fetchFromSupabase(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Gagal membaca file.");
      } finally {
        setLoading(false);
      }
    },
    [fetchFromSupabase]
  );

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
    e.target.value = "";
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleUpload(file);
  };

  const clearAll = async () => {
    if (!confirm("Hapus SEMUA data di cloud database dan riwayat?")) return;
    setLoading(true);
    setRecords([]);
    setUploadedFiles([]);
    setPrintedInvoices(new Set());
    setExpandedSOs(new Set());
    setFilter("all");
    setKatFilter("all");
    setSearch("");
    setPage(0);
    try {
      localStorage.removeItem("records");
      localStorage.removeItem("uploadedFiles");
      localStorage.removeItem("printedInvoices");
    } catch {}

    await supabase.from("faktur_records").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    setLoading(false);
  };

  // Group by SO and sort Ascending by Invoice Number and Order Date
  const grouped = useMemo<SOGroup[]>(() => {
    const map: Record<string, FakturRecord[]> = {};
    for (const r of records) {
      if (!map[r.orderNumber]) map[r.orderNumber] = [];
      map[r.orderNumber].push(r);
    }
    return Object.entries(map)
      .map(([so, items]) => {
        const invoiceNumbers = [...new Set(items.map((i) => i.invoiceNumber))];
        const invoiceKeys = [...new Set(items.map((i) => i.invoiceKey))];
        return {
          so,
          items,
          orderDate: items[0].orderDate,
          invoiceNumbers,
          invoiceKeys,
          jenisTransaksi: items[0].jenisTransaksi,
          customerName: items[0].customerName,
          kategori: items[0].kategori,
          isDoubleInv: items.some((i) => i.isDoubleInv),
          totalHarga: items.reduce((sum, i) => sum + i.totalHarga, 0),
          totalItems: items.length,
          allPrinted: invoiceKeys.every((key) => printedInvoices.has(key)),
          anyPrinted: invoiceKeys.some((key) => printedInvoices.has(key)),
        };
      })
      .sort((a, b) => {
        const invA = parseInvNum(a.invoiceNumbers);
        const invB = parseInvNum(b.invoiceNumbers);
        const diff = invA !== invB ? invA - invB : parseDateMs(a.orderDate) - parseDateMs(b.orderDate);
        return sortOrder === "desc" ? -diff : diff;
      });
  }, [records, printedInvoices, sortOrder]);

  const filtered = useMemo(() => {
    let result = grouped;
    if (filter === "belum") result = result.filter((g) => !g.allPrinted);
    else if (filter === "sudah") result = result.filter((g) => g.allPrinted);
    else if (filter === "double") result = result.filter((g) => g.isDoubleInv);
    if (katFilter !== "all") result = result.filter((g) => g.kategori === katFilter);
    if (search) {
      const s = search.toLowerCase();
      result = result.filter(
        (g) =>
          g.so.toLowerCase().includes(s) ||
          g.invoiceNumbers.some((inv) => inv.toLowerCase().includes(s)) ||
          g.customerName.toLowerCase().includes(s) ||
          g.items.some(
            (i) =>
              i.itemDescription.toLowerCase().includes(s) ||
              i.itemCode.toLowerCase().includes(s)
          )
      );
    }
    return result;
  }, [grouped, filter, katFilter, search]);

  const totalPages = Math.ceil(filtered.length / ROWS_PER_PAGE);
  const pageData = filtered.slice(page * ROWS_PER_PAGE, (page + 1) * ROWS_PER_PAGE);

  useEffect(() => {
    setPage(0);
  }, [filter, katFilter, search, sortOrder]);

  const summary = useMemo(() => {
    const uniqueInvoices = new Set(records.map((r) => r.invoiceKey));
    const uniqueSO = new Set(records.map((r) => r.orderNumber));
    const belumTerprint = [...uniqueInvoices].filter(
      (key) => !printedInvoices.has(key)
    ).length;
    const doubleInv = grouped.filter((g) => g.isDoubleInv).length;
    const totalHarga = records.reduce((sum, r) => sum + r.totalHarga, 0);
    return {
      totalSO: uniqueSO.size,
      totalInvoices: uniqueInvoices.size,
      totalItems: records.length,
      belumTerprint,
      doubleInv,
      totalHarga,
    };
  }, [records, printedInvoices, grouped]);

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-sm">
              FT
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900">Faktur Tracker</h1>
              <p className="text-xs text-gray-500">Tracking faktur dari Oracle export</p>
            </div>
          </div>
          {records.length > 0 && (
            <button
              onClick={clearAll}
              className="text-sm text-red-600 hover:text-red-700 px-3 py-1.5 rounded-lg hover:bg-red-50"
            >
              Hapus Semua Data
            </button>
          )}
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-4">
        {/* Upload bar - compact, always visible */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`flex items-center gap-3 rounded-lg border p-2 mb-3 transition-colors ${
            dragOver ? "border-blue-500 bg-blue-50" : "border-gray-300 bg-white"
          }`}
        >
          <label className="bg-blue-600 text-white px-4 py-1.5 rounded-lg cursor-pointer hover:bg-blue-700 text-sm font-medium whitespace-nowrap">
            Upload Excel
            <input type="file" accept=".xlsx,.xls" onChange={onFileInput} className="hidden" />
          </label>
          {loading && <span className="text-sm text-gray-500">Membaca file...</span>}
          {uploadedFiles.length > 0 && (
            <span className="text-xs text-gray-400 truncate">
              {uploadedFiles.length} file diupload · terakhir: {uploadedFiles[uploadedFiles.length - 1].name}
            </span>
          )}
        </div>
        {error && (
          <div className="mb-3 bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm">
            {error}
          </div>
        )}

        {/* Data loaded */}
        {records.length > 0 && (
          <>
            {/* Summary */}
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
              <Card label="Total SO" value={summary.totalSO.toLocaleString("id-ID")} />
              <Card label="Total Invoice" value={summary.totalInvoices.toLocaleString("id-ID")} />
              <Card label="Total Item" value={summary.totalItems.toLocaleString("id-ID")} />
              <Card label="Belum Terprint" value={summary.belumTerprint.toLocaleString("id-ID")} color="orange" />
              <Card label="Double INV" value={summary.doubleInv.toLocaleString("id-ID")} color="red" />
              <Card label="Total Harga" value={formatRupiah(summary.totalHarga)} small />
            </div>

            {/* Filters */}
            <div className="bg-white rounded-lg border border-gray-200 p-3 mb-4 flex flex-wrap items-center gap-2">
              <div className="flex gap-1">
                <FBtn active={filter === "belum"} onClick={() => setFilter("belum")} color="orange">Belum Terprint</FBtn>
                <FBtn active={filter === "sudah"} onClick={() => setFilter("sudah")} color="green">Sudah Terprint</FBtn>
                <FBtn active={filter === "all"} onClick={() => setFilter("all")}>Semua</FBtn>
                <FBtn active={filter === "double"} onClick={() => setFilter("double")} color="red">Double INV</FBtn>
              </div>
              <div className="h-6 w-px bg-gray-200 mx-1" />
              <div className="flex gap-1">
                <FBtn active={katFilter === "all"} onClick={() => setKatFilter("all")}>All Kat</FBtn>
                <FBtn active={katFilter === "1P"} onClick={() => setKatFilter("1P")} color="blue">1P</FBtn>
                <FBtn active={katFilter === "2P"} onClick={() => setKatFilter("2P")} color="green">2P</FBtn>
                <FBtn active={katFilter === "3P"} onClick={() => setKatFilter("3P")} color="purple">3P</FBtn>
              </div>
              <div className="h-6 w-px bg-gray-200 mx-1" />
              <button
                onClick={() => setSortOrder((prev) => (prev === "desc" ? "asc" : "desc"))}
                className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 flex items-center gap-1 whitespace-nowrap"
                title="Ganti urutan faktur"
              >
                {sortOrder === "desc" ? "⬇ Terbaru di Atas" : "⬆ Terlama di Atas"}
              </button>
              <div className="flex-1" />
              <input
                type="text"
                placeholder="Cari SO, Invoice, Apotek, Item..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-full sm:w-64"
              />
              <button
                onClick={markAllAsPrinted}
                className="text-xs text-green-700 bg-green-50 hover:bg-green-100 px-3 py-1.5 rounded-lg border border-green-200 whitespace-nowrap"
              >
                Tandai Semua Printed
              </button>
              <button
                onClick={markAllAsUnprinted}
                className="text-xs text-orange-700 bg-orange-50 hover:bg-orange-100 px-3 py-1.5 rounded-lg border border-orange-200 whitespace-nowrap"
              >
                Reset ke Belum Terprint
              </button>
            </div>

            {/* Table */}
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-2 py-2 w-8"></th>
                      <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">Print</th>
                      <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">Kat</th>
                      <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">Order Date</th>
                      <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">No SO</th>
                      <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">No Invoice</th>
                      <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">Jenis Transaksi</th>
                      <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">Pelanggan</th>
                      <th className="px-2 py-2 text-center text-xs font-medium text-gray-500 whitespace-nowrap">Items</th>
                      <th className="px-2 py-2 text-right text-xs font-medium text-gray-500 whitespace-nowrap">Total Harga</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {pageData.map((g) => {
                      const expanded = expandedSOs.has(g.so);
                      return (
                        <Fragment key={g.so}>
                          <tr
                            onClick={() => toggleExpand(g.so)}
                            className={`cursor-pointer hover:bg-gray-50 ${
                              g.isDoubleInv ? "bg-red-50" : g.allPrinted ? "bg-green-50" : ""
                            }`}
                          >
                            <td className="px-2 py-2 text-center text-gray-400 text-xs">
                              {expanded ? "▼" : "▶"}
                            </td>
                            <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                              {(() => {
                                const hasInvoice = g.invoiceNumbers.length > 0 && g.invoiceNumbers.some((inv) => inv && inv !== "0" && inv !== "-");
                                return (
                                  <button
                                    onClick={() => togglePrint(g)}
                                    disabled={!hasInvoice}
                                    className={`w-6 h-6 rounded flex items-center justify-center text-xs font-bold transition-colors ${
                                      !hasInvoice
                                        ? "bg-gray-100 text-gray-300 cursor-not-allowed"
                                        : g.allPrinted
                                        ? "bg-green-500 text-white hover:bg-green-600"
                                        : g.anyPrinted
                                        ? "bg-yellow-400 text-white hover:bg-yellow-500"
                                        : "bg-gray-200 text-gray-500 hover:bg-gray-300"
                                    }`}
                                    title={
                                      !hasInvoice
                                        ? "Menunggu No Faktur (Belum bisa diprint)"
                                        : g.allPrinted
                                        ? "Sudah terprint - klik untuk batal tandai"
                                        : g.anyPrinted
                                        ? "Sebagian terprint"
                                        : "Belum terprint - klik untuk tandai"
                                    }
                                  >
                                    {!hasInvoice ? "–" : g.allPrinted ? "✓" : g.anyPrinted ? "◑" : "○"}
                                  </button>
                                );
                              })()}
                            </td>
                            <td className="px-2 py-2">
                              <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                                g.kategori === "1P" ? "bg-blue-100 text-blue-700"
                                : g.kategori === "2P" ? "bg-green-100 text-green-700"
                                : "bg-purple-100 text-purple-700"
                              }`}>
                                {g.kategori}
                              </span>
                            </td>
                            <td className="px-2 py-2 text-gray-600 whitespace-nowrap text-xs">{g.orderDate}</td>
                            <td className="px-2 py-2 font-mono text-xs text-gray-900 whitespace-nowrap">
                              {g.so}
                              {g.isDoubleInv && <span className="ml-1 text-red-600 font-bold">⚠</span>}
                            </td>
                            <td className="px-2 py-2 font-mono text-xs text-gray-900 whitespace-nowrap">
                              {g.invoiceNumbers.length > 0 && g.invoiceNumbers.some((inv) => inv && inv !== "0" && inv !== "-")
                                ? g.invoiceNumbers.length > 1
                                  ? `${g.invoiceNumbers[0]} +${g.invoiceNumbers.length - 1}`
                                  : g.invoiceNumbers[0]
                                : <span className="text-gray-400 italic text-xs">Menunggu Faktur</span>}
                            </td>
                            <td className="px-2 py-2 whitespace-nowrap">
                              <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${
                                g.jenisTransaksi === "ORA"
                                  ? "bg-blue-100 text-blue-800"
                                  : "bg-emerald-100 text-emerald-800"
                              }`}>
                                {g.jenisTransaksi}
                              </span>
                            </td>
                            <td className="px-2 py-2 text-gray-700 whitespace-nowrap max-w-xs truncate">{g.customerName}</td>
                            <td className="px-2 py-2 text-center text-gray-600 text-xs">{g.totalItems}</td>
                            <td className="px-2 py-2 text-right text-gray-900 whitespace-nowrap font-medium text-xs">
                              {formatRupiah(g.totalHarga)}
                            </td>
                          </tr>
                          {expanded && (
                            <tr className="bg-gray-50">
                              <td colSpan={10} className="px-4 py-3">
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="border-b border-gray-200">
                                      <th className="px-2 py-1 text-left font-medium text-gray-500">No Invoice</th>
                                      <th className="px-2 py-1 text-left font-medium text-gray-500">Item Code</th>
                                      <th className="px-2 py-1 text-left font-medium text-gray-500">Item Description</th>
                                      <th className="px-2 py-1 text-right font-medium text-gray-500">Qty</th>
                                      <th className="px-2 py-1 text-left font-medium text-gray-500">UOM</th>
                                      <th className="px-2 py-1 text-left font-medium text-gray-500">LOT Number</th>
                                      <th className="px-2 py-1 text-right font-medium text-gray-500">Total Harga</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-100">
                                    {g.items.map((item, i) => (
                                      <tr key={i} className="hover:bg-gray-100">
                                        <td className="px-2 py-1 font-mono text-gray-900 whitespace-nowrap">{item.invoiceNumber}</td>
                                        <td className="px-2 py-1 font-mono text-gray-600 whitespace-nowrap">{item.itemCode}</td>
                                        <td className="px-2 py-1 text-gray-700">{item.itemDescription}</td>
                                        <td className="px-2 py-1 text-right text-gray-900">{item.qty}</td>
                                        <td className="px-2 py-1 text-gray-600">{item.uom}</td>
                                        <td className="px-2 py-1 font-mono text-gray-600 whitespace-nowrap">{item.lotNumber}</td>
                                        <td className="px-2 py-1 text-right text-gray-900 whitespace-nowrap">{formatRupiah(item.totalHarga)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between">
                <p className="text-xs text-gray-500">
                  {filtered.length.toLocaleString("id-ID")} SO · {summary.totalInvoices.toLocaleString("id-ID")} invoice · {summary.totalItems.toLocaleString("id-ID")} item
                </p>
                <div className="flex items-center gap-2">
                  <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}
                    className="px-3 py-1 text-sm rounded border border-gray-300 disabled:opacity-30 hover:bg-gray-50">←</button>
                  <span className="text-sm text-gray-600">{page + 1} / {totalPages || 1}</span>
                  <button onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1}
                    className="px-3 py-1 text-sm rounded border border-gray-300 disabled:opacity-30 hover:bg-gray-50">→</button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function Card({ label, value, color, small }: { label: string; value: string; color?: "orange" | "red"; small?: boolean }) {
  const colorClass = color === "orange" ? "text-orange-600" : color === "red" ? "text-red-600" : "text-gray-900";
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`${small ? "text-sm" : "text-xl"} font-bold ${colorClass}`}>{value}</p>
    </div>
  );
}

function FBtn({ active, onClick, children, color = "gray" }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
  color?: "gray" | "orange" | "red" | "blue" | "green" | "purple";
}) {
  const colors: Record<string, string> = {
    gray: active ? "bg-gray-800 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200",
    orange: active ? "bg-orange-500 text-white" : "bg-orange-100 text-orange-700 hover:bg-orange-200",
    red: active ? "bg-red-500 text-white" : "bg-red-100 text-red-700 hover:bg-red-200",
    blue: active ? "bg-blue-600 text-white" : "bg-blue-100 text-blue-700 hover:bg-blue-200",
    green: active ? "bg-green-600 text-white" : "bg-green-100 text-green-700 hover:bg-green-200",
    purple: active ? "bg-purple-600 text-white" : "bg-purple-100 text-purple-700 hover:bg-purple-200",
  };
  return (
    <button onClick={onClick} className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${colors[color]}`}>
      {children}
    </button>
  );
}
