"use client";

import { useState, useMemo, useEffect, useCallback, Fragment } from "react";
import { parseExcelFile } from "@/lib/parser";
import { FakturRecord } from "@/lib/types";

type Filter = "all" | "belum" | "double";
type KatFilter = "all" | "1P" | "2P" | "3P";

const ROWS_PER_PAGE = 50;

function formatRupiah(n: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(n);
}

type SOGroup = {
  so: string;
  items: FakturRecord[];
  orderDate: string;
  invoiceNumbers: string[];
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

export default function Home() {
  const [records, setRecords] = useState<FakturRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [katFilter, setKatFilter] = useState<KatFilter>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [printedInvoices, setPrintedInvoices] = useState<Set<string>>(new Set());
  const [dragOver, setDragOver] = useState(false);
  const [expandedSOs, setExpandedSOs] = useState<Set<string>>(new Set());

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const storedRecords = localStorage.getItem("records");
      if (storedRecords) setRecords(JSON.parse(storedRecords));
      const storedPrinted = localStorage.getItem("printedInvoices");
      if (storedPrinted) setPrintedInvoices(new Set(JSON.parse(storedPrinted)));
      const storedFiles = localStorage.getItem("uploadedFiles");
      if (storedFiles) setUploadedFiles(JSON.parse(storedFiles));
    } catch {}
  }, []);

  // Save records to localStorage
  useEffect(() => {
    try {
      localStorage.setItem("records", JSON.stringify(records));
    } catch {}
  }, [records]);

  // Save uploaded files to localStorage
  useEffect(() => {
    try {
      localStorage.setItem("uploadedFiles", JSON.stringify(uploadedFiles));
    } catch {}
  }, [uploadedFiles]);

  // Auto-refresh: check version every 30s, reload if changed
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

  const savePrinted = useCallback((set: Set<string>) => {
    setPrintedInvoices(set);
    try {
      localStorage.setItem("printedInvoices", JSON.stringify([...set]));
    } catch {}
  }, []);

  const toggleExpand = useCallback((so: string) => {
    setExpandedSOs((prev) => {
      const next = new Set(prev);
      if (next.has(so)) next.delete(so);
      else next.add(so);
      return next;
    });
  }, []);

  // Print: one-way lock. Once printed, cannot unmark.
  const markPrinted = useCallback(
    (group: SOGroup) => {
      if (group.allPrinted) return;
      const next = new Set(printedInvoices);
      for (const inv of group.invoiceNumbers) next.add(inv);
      savePrinted(next);
    },
    [printedInvoices, savePrinted]
  );

  const markAllAsPrinted = useCallback(() => {
    const next = new Set(printedInvoices);
    for (const r of records) next.add(r.invoiceNumber);
    savePrinted(next);
  }, [records, printedInvoices, savePrinted]);

  // Upload: upsert. New SOs added, existing SOs updated with new data.
  // Print status (localStorage) is never touched — only records change.
  const handleUpload = useCallback(async (file: File) => {
    setLoading(true);
    setError(null);
    try {
      const parsed = await parseExcelFile(file);
      if (parsed.length === 0) {
        setError("File berhasil dibaca tapi tidak ada data.");
      } else {
        const newSOs = new Set(parsed.map((r) => r.orderNumber));
        setRecords((prev) => {
          const kept = prev.filter((r) => !newSOs.has(r.orderNumber));
          return [...kept, ...parsed];
        });
        setUploadedFiles((prev) => [
          ...prev,
          { name: file.name, count: parsed.length, time: new Date().toLocaleString("id-ID") },
        ]);
        setPage(0);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal membaca file.");
    } finally {
      setLoading(false);
    }
  }, []);

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

  const clearAll = () => {
    if (!confirm("Hapus SEMUA data dan riwayat? Print status juga reset.")) return;
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
  };

  // Group by SO
  const grouped = useMemo<SOGroup[]>(() => {
    const map: Record<string, FakturRecord[]> = {};
    for (const r of records) {
      if (!map[r.orderNumber]) map[r.orderNumber] = [];
      map[r.orderNumber].push(r);
    }
    return Object.entries(map).map(([so, items]) => {
      const invoiceNumbers = [...new Set(items.map((i) => i.invoiceNumber))];
      return {
        so,
        items,
        orderDate: items[0].orderDate,
        invoiceNumbers,
        jenisTransaksi: items[0].jenisTransaksi,
        customerName: items[0].customerName,
        kategori: items[0].kategori,
        isDoubleInv: items.some((i) => i.isDoubleInv),
        totalHarga: items.reduce((sum, i) => sum + i.totalHarga, 0),
        totalItems: items.length,
        allPrinted: invoiceNumbers.every((inv) => printedInvoices.has(inv)),
        anyPrinted: invoiceNumbers.some((inv) => printedInvoices.has(inv)),
      };
    });
  }, [records, printedInvoices]);

  const filtered = useMemo(() => {
    let result = grouped;
    if (filter === "belum") result = result.filter((g) => !g.allPrinted);
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
  }, [filter, katFilter, search]);

  const summary = useMemo(() => {
    const uniqueInvoices = new Set(records.map((r) => r.invoiceNumber));
    const uniqueSO = new Set(records.map((r) => r.orderNumber));
    const belumTerprint = [...uniqueInvoices].filter(
      (inv) => !printedInvoices.has(inv)
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

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Upload area - always visible */}
        <div className="mb-6">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={`border-2 border-dashed rounded-xl p-6 text-center transition-colors ${
              dragOver ? "border-blue-500 bg-blue-50" : "border-gray-300 bg-white"
            }`}
          >
            <p className="text-gray-600 mb-2 font-medium">Upload File Excel dari Oracle</p>
            <p className="text-sm text-gray-400 mb-4">Drag &amp; drop di sini atau klik tombol di bawah. Format: .xlsx atau .xls</p>
            <label className="inline-block bg-blue-600 text-white px-6 py-2.5 rounded-lg cursor-pointer hover:bg-blue-700 text-sm font-medium">
              Pilih File Excel
              <input type="file" accept=".xlsx,.xls" onChange={onFileInput} className="hidden" />
            </label>
          </div>
          {error && (
            <div className="mt-3 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}
        </div>

        {/* Loading */}
        {loading && (
          <div className="text-center py-6">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-3"></div>
            <p className="text-gray-500 text-sm">Membaca file...</p>
          </div>
        )}

        {/* Upload history */}
        {uploadedFiles.length > 0 && (
          <div className="mb-4 bg-white rounded-lg border border-gray-200 p-3">
            <p className="text-xs font-medium text-gray-500 mb-2">Riwayat Upload:</p>
            <div className="flex flex-wrap gap-2">
              {uploadedFiles.map((f, i) => (
                <span key={i} className="inline-flex items-center gap-1 bg-gray-100 text-gray-700 px-2 py-1 rounded text-xs">
                  {f.name} ({f.count.toLocaleString("id-ID")} baris) — {f.time}
                </span>
              ))}
            </div>
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
                <FBtn active={filter === "all"} onClick={() => setFilter("all")}>Semua</FBtn>
                <FBtn active={filter === "belum"} onClick={() => setFilter("belum")} color="orange">Belum Terprint</FBtn>
                <FBtn active={filter === "double"} onClick={() => setFilter("double")} color="red">Double INV</FBtn>
              </div>
              <div className="h-6 w-px bg-gray-200 mx-1" />
              <div className="flex gap-1">
                <FBtn active={katFilter === "all"} onClick={() => setKatFilter("all")}>All Kat</FBtn>
                <FBtn active={katFilter === "1P"} onClick={() => setKatFilter("1P")} color="blue">1P</FBtn>
                <FBtn active={katFilter === "2P"} onClick={() => setKatFilter("2P")} color="green">2P</FBtn>
                <FBtn active={katFilter === "3P"} onClick={() => setKatFilter("3P")} color="purple">3P</FBtn>
              </div>
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
                className="text-xs text-gray-600 hover:text-gray-900 px-3 py-1.5 rounded-lg hover:bg-gray-100 whitespace-nowrap"
              >
                Tandai Semua Printed
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
                              <button
                                onClick={() => markPrinted(g)}
                                disabled={g.allPrinted}
                                className={`w-6 h-6 rounded flex items-center justify-center text-xs font-bold transition-colors ${
                                  g.allPrinted
                                    ? "bg-green-500 text-white cursor-not-allowed"
                                    : g.anyPrinted
                                    ? "bg-yellow-400 text-white hover:bg-yellow-500"
                                    : "bg-gray-200 text-gray-400 hover:bg-gray-300"
                                }`}
                                title={g.allPrinted ? "Sudah terprint (terkunci)" : g.anyPrinted ? "Sebagian terprint" : "Belum terprint - klik untuk tandai"}
                              >
                                {g.allPrinted ? "✓" : g.anyPrinted ? "◑" : "○"}
                              </button>
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
                              {g.invoiceNumbers.length > 1
                                ? `${g.invoiceNumbers[0]} +${g.invoiceNumbers.length - 1}`
                                : g.invoiceNumbers[0]}
                            </td>
                            <td className="px-2 py-2 text-xs text-gray-600 whitespace-nowrap">{g.jenisTransaksi}</td>
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
