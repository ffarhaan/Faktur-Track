"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
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

export default function Home() {
  const [records, setRecords] = useState<FakturRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [katFilter, setKatFilter] = useState<KatFilter>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [printedInvoices, setPrintedInvoices] = useState<Set<string>>(new Set());
  const [dragOver, setDragOver] = useState(false);

  // Load printed invoices from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem("printedInvoices");
      if (stored) {
        setPrintedInvoices(new Set(JSON.parse(stored)));
      }
    } catch {
      // ignore
    }
  }, []);

  const savePrinted = useCallback((set: Set<string>) => {
    setPrintedInvoices(set);
    try {
      localStorage.setItem("printedInvoices", JSON.stringify([...set]));
    } catch {
      // ignore
    }
  }, []);

  const togglePrinted = useCallback(
    (invoiceNumber: string) => {
      const newSet = new Set(printedInvoices);
      if (newSet.has(invoiceNumber)) {
        newSet.delete(invoiceNumber);
      } else {
        newSet.add(invoiceNumber);
      }
      savePrinted(newSet);
    },
    [printedInvoices, savePrinted]
  );

  const markAllAsPrinted = useCallback(() => {
    const newSet = new Set(printedInvoices);
    for (const r of records) {
      newSet.add(r.invoiceNumber);
    }
    savePrinted(newSet);
  }, [records, printedInvoices, savePrinted]);

  const handleUpload = useCallback(async (file: File) => {
    setLoading(true);
    setError(null);
    setFileName(file.name);
    try {
      const parsed = await parseExcelFile(file);
      if (parsed.length === 0) {
        setError("File berhasil dibaca tapi tidak ada data ditemukan.");
      } else {
        setRecords(parsed);
        setPage(0);
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Gagal membaca file. Coba lagi."
      );
      setRecords([]);
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

  // Filtered records
  const filtered = useMemo(() => {
    let result = records;

    if (filter === "belum") {
      result = result.filter((r) => !printedInvoices.has(r.invoiceNumber));
    } else if (filter === "double") {
      result = result.filter((r) => r.isDoubleInv);
    }

    if (katFilter !== "all") {
      result = result.filter((r) => r.kategori === katFilter);
    }

    if (search) {
      const s = search.toLowerCase();
      result = result.filter(
        (r) =>
          r.orderNumber.toLowerCase().includes(s) ||
          r.invoiceNumber.toLowerCase().includes(s) ||
          r.customerName.toLowerCase().includes(s) ||
          r.itemDescription.toLowerCase().includes(s) ||
          r.itemCode.toLowerCase().includes(s)
      );
    }

    return result;
  }, [records, filter, katFilter, search, printedInvoices]);

  // Pagination
  const totalPages = Math.ceil(filtered.length / ROWS_PER_PAGE);
  const pageData = filtered.slice(
    page * ROWS_PER_PAGE,
    (page + 1) * ROWS_PER_PAGE
  );

  // Reset page when filter changes
  useEffect(() => {
    setPage(0);
  }, [filter, katFilter, search]);

  // Summary
  const summary = useMemo(() => {
    const uniqueInvoices = new Set(records.map((r) => r.invoiceNumber));
    const uniqueSO = new Set(records.map((r) => r.orderNumber));
    const belumTerprint = [...uniqueInvoices].filter(
      (inv) => !printedInvoices.has(inv)
    ).length;
    const doubleInv = new Set(
      records.filter((r) => r.isDoubleInv).map((r) => r.orderNumber)
    ).size;
    const totalHarga = records.reduce((sum, r) => sum + r.totalHarga, 0);
    return {
      totalRows: records.length,
      totalInvoices: uniqueInvoices.size,
      totalSO: uniqueSO.size,
      belumTerprint,
      doubleInv,
      totalHarga,
    };
  }, [records, printedInvoices]);

  const isPrinted = (inv: string) => printedInvoices.has(inv);

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-sm">
              FT
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900">Faktur Tracker</h1>
              <p className="text-xs text-gray-500">
                Tracking faktur dari Oracle export
              </p>
            </div>
          </div>
          {records.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 hidden sm:inline">
                {fileName}
              </span>
              <button
                onClick={() => {
                  setRecords([]);
                  setFileName("");
                  setFilter("all");
                  setKatFilter("all");
                  setSearch("");
                }}
                className="text-sm text-gray-600 hover:text-gray-900 px-3 py-1.5 rounded-lg hover:bg-gray-100"
              >
                Reset
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Upload area */}
        {records.length === 0 && !loading && (
          <div className="mb-6">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors ${
                dragOver
                  ? "border-blue-500 bg-blue-50"
                  : "border-gray-300 bg-white"
              }`}
            >
              <div className="text-4xl mb-3">📁</div>
              <p className="text-gray-600 mb-2">
                Drag &amp; drop file Excel di sini
              </p>
              <p className="text-sm text-gray-400 mb-4">
                Format: .xlsx (XXCUST) atau .xls (export)
              </p>
              <label className="inline-block bg-blue-600 text-white px-6 py-2.5 rounded-lg cursor-pointer hover:bg-blue-700 text-sm font-medium">
                Pilih File
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={onFileInput}
                  className="hidden"
                />
              </label>
            </div>
            {error && (
              <div className="mt-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-3"></div>
            <p className="text-gray-500 text-sm">Membaca file...</p>
          </div>
        )}

        {/* Data loaded */}
        {records.length > 0 && (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <p className="text-xs text-gray-500 mb-1">Total Baris</p>
                <p className="text-xl font-bold text-gray-900">
                  {summary.totalRows.toLocaleString("id-ID")}
                </p>
              </div>
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <p className="text-xs text-gray-500 mb-1">Unique Invoice</p>
                <p className="text-xl font-bold text-gray-900">
                  {summary.totalInvoices.toLocaleString("id-ID")}
                </p>
              </div>
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <p className="text-xs text-gray-500 mb-1">Belum Terprint</p>
                <p className="text-xl font-bold text-orange-600">
                  {summary.belumTerprint.toLocaleString("id-ID")}
                </p>
              </div>
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <p className="text-xs text-gray-500 mb-1">Double INV</p>
                <p className="text-xl font-bold text-red-600">
                  {summary.doubleInv.toLocaleString("id-ID")}
                </p>
              </div>
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <p className="text-xs text-gray-500 mb-1">Total Harga</p>
                <p className="text-sm font-bold text-gray-900">
                  {formatRupiah(summary.totalHarga)}
                </p>
              </div>
            </div>

            {/* Filter bar */}
            <div className="bg-white rounded-lg border border-gray-200 p-3 mb-4 flex flex-wrap items-center gap-2">
              <div className="flex gap-1">
                <FilterButton
                  active={filter === "all"}
                  onClick={() => setFilter("all")}
                >
                  Semua
                </FilterButton>
                <FilterButton
                  active={filter === "belum"}
                  onClick={() => setFilter("belum")}
                  color="orange"
                >
                  Belum Terprint
                </FilterButton>
                <FilterButton
                  active={filter === "double"}
                  onClick={() => setFilter("double")}
                  color="red"
                >
                  Double INV
                </FilterButton>
              </div>

              <div className="h-6 w-px bg-gray-200 mx-1" />

              <div className="flex gap-1">
                <FilterButton
                  active={katFilter === "all"}
                  onClick={() => setKatFilter("all")}
                >
                  All Kat
                </FilterButton>
                <FilterButton
                  active={katFilter === "1P"}
                  onClick={() => setKatFilter("1P")}
                  color="blue"
                >
                  1P
                </FilterButton>
                <FilterButton
                  active={katFilter === "2P"}
                  onClick={() => setKatFilter("2P")}
                  color="green"
                >
                  2P
                </FilterButton>
                <FilterButton
                  active={katFilter === "3P"}
                  onClick={() => setKatFilter("3P")}
                  color="purple"
                >
                  3P
                </FilterButton>
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
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">
                        Print
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">
                        Kat
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">
                        Order Date
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">
                        No SO
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">
                        No Invoice
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">
                        Jenis Transaksi
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">
                        Pelanggan
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">
                        Item Code
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">
                        Item Description
                      </th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 whitespace-nowrap">
                        Qty
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">
                        UOM
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">
                        LOT Number
                      </th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 whitespace-nowrap">
                        Total Harga
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {pageData.map((r, i) => {
                      const printed = isPrinted(r.invoiceNumber);
                      return (
                        <tr
                          key={`${r.rowIndex}-${i}`}
                          className={
                            r.isDoubleInv
                              ? "bg-red-50 hover:bg-red-100"
                              : printed
                              ? "bg-green-50 hover:bg-green-100"
                              : "hover:bg-gray-50"
                          }
                        >
                          <td className="px-3 py-2">
                            <button
                              onClick={() => togglePrinted(r.invoiceNumber)}
                              className={`w-6 h-6 rounded flex items-center justify-center text-xs font-bold ${
                                printed
                                  ? "bg-green-500 text-white"
                                  : "bg-gray-200 text-gray-400 hover:bg-gray-300"
                              }`}
                              title={
                                printed ? "Sudah terprint" : "Belum terprint"
                              }
                            >
                              {printed ? "✓" : "○"}
                            </button>
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                                r.kategori === "1P"
                                  ? "bg-blue-100 text-blue-700"
                                  : r.kategori === "2P"
                                  ? "bg-green-100 text-green-700"
                                  : "bg-purple-100 text-purple-700"
                              }`}
                            >
                              {r.kategori}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-gray-600 whitespace-nowrap">
                            {r.orderDate}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs text-gray-900 whitespace-nowrap">
                            {r.orderNumber}
                            {r.isDoubleInv && (
                              <span className="ml-1 text-red-600 font-bold">
                                ⚠
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs text-gray-900 whitespace-nowrap">
                            {r.invoiceNumber}
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-600 whitespace-nowrap">
                            {r.jenisTransaksi}
                          </td>
                          <td className="px-3 py-2 text-gray-700 whitespace-nowrap max-w-xs truncate">
                            {r.customerName}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs text-gray-600 whitespace-nowrap">
                            {r.itemCode}
                          </td>
                          <td className="px-3 py-2 text-gray-700 max-w-xs truncate">
                            {r.itemDescription}
                          </td>
                          <td className="px-3 py-2 text-right text-gray-900 whitespace-nowrap">
                            {r.qty}
                          </td>
                          <td className="px-3 py-2 text-gray-600 whitespace-nowrap">
                            {r.uom}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs text-gray-600 whitespace-nowrap">
                            {r.lotNumber}
                          </td>
                          <td className="px-3 py-2 text-right text-gray-900 whitespace-nowrap font-medium">
                            {formatRupiah(r.totalHarga)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between">
                <p className="text-xs text-gray-500">
                  {filtered.length.toLocaleString("id-ID")} baris ·{" "}
                  {summary.totalInvoices.toLocaleString("id-ID")} invoice ·{" "}
                  {summary.totalSO.toLocaleString("id-ID")} SO
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage(Math.max(0, page - 1))}
                    disabled={page === 0}
                    className="px-3 py-1 text-sm rounded border border-gray-300 disabled:opacity-30 hover:bg-gray-50"
                  >
                    ←
                  </button>
                  <span className="text-sm text-gray-600">
                    {page + 1} / {totalPages || 1}
                  </span>
                  <button
                    onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                    disabled={page >= totalPages - 1}
                    className="px-3 py-1 text-sm rounded border border-gray-300 disabled:opacity-30 hover:bg-gray-50"
                  >
                    →
                  </button>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Error */}
        {error && records.length === 0 && !loading && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
            {error}
          </div>
        )}
      </div>
    </main>
  );
}

function FilterButton({
  active,
  onClick,
  children,
  color = "gray",
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  color?: "gray" | "orange" | "red" | "blue" | "green" | "purple";
}) {
  const colors: Record<string, string> = {
    gray: active
      ? "bg-gray-800 text-white"
      : "bg-gray-100 text-gray-600 hover:bg-gray-200",
    orange: active
      ? "bg-orange-500 text-white"
      : "bg-orange-100 text-orange-700 hover:bg-orange-200",
    red: active
      ? "bg-red-500 text-white"
      : "bg-red-100 text-red-700 hover:bg-red-200",
    blue: active
      ? "bg-blue-600 text-white"
      : "bg-blue-100 text-blue-700 hover:bg-blue-200",
    green: active
      ? "bg-green-600 text-white"
      : "bg-green-100 text-green-700 hover:bg-green-200",
    purple: active
      ? "bg-purple-600 text-white"
      : "bg-purple-100 text-purple-700 hover:bg-purple-200",
  };
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${colors[color]}`}
    >
      {children}
    </button>
  );
}
