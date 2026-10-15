"use client";

import { useState, useMemo } from "react";
import Link from "next/link";

interface MockFaktur {
  id: string;
  jenis: "ORA" | "DOO";
  so: string;
  invoiceNumber: string;
  txDate: string;
  orderDate: string;
  customer: string;
  kat: "1P" | "2P" | "3P";
  katProduk: "FARMA" | "PREKURSOR" | "OOT" | "CCP" | "ALKES";
  total: number;
  printed: boolean;
  printedAt?: string;
  printedBy?: string;
}

const INITIAL_MOCK_DATA: MockFaktur[] = [
  {
    id: "1",
    jenis: "ORA",
    so: "884102",
    invoiceNumber: "20145-1P",
    txDate: "15/10/2026",
    orderDate: "13/10/2026",
    customer: "PT Helios Alchemist Kesehatan",
    kat: "1P",
    katProduk: "CCP",
    total: 14850000,
    printed: false,
  },
  {
    id: "2",
    jenis: "DOO",
    so: "991201",
    invoiceNumber: "20138",
    txDate: "15/10/2026",
    orderDate: "13/10/2026",
    customer: "Apotek Kimia Farma Juanda",
    kat: "2P",
    katProduk: "PREKURSOR",
    total: 8420000,
    printed: true,
    printedAt: "15/10/2026 08:42:15",
    printedBy: "Ahmad Staff",
  },
  {
    id: "3",
    jenis: "DOO",
    so: "991205",
    invoiceNumber: "20133",
    txDate: "15/10/2026",
    orderDate: "12/10/2026",
    customer: "RS Siloam Kebon Jeruk",
    kat: "1P",
    katProduk: "FARMA",
    total: 26500000,
    printed: true,
    printedAt: "15/10/2026 09:15:30",
    printedBy: "Rian Ops",
  },
  {
    id: "4",
    jenis: "DOO",
    so: "991210",
    invoiceNumber: "20112",
    txDate: "15/10/2026",
    orderDate: "13/10/2026",
    customer: "Apotek Medika Prima Farma",
    kat: "1P",
    katProduk: "FARMA",
    total: 5120000,
    printed: false,
  },
  {
    id: "5",
    jenis: "ORA",
    so: "884109",
    invoiceNumber: "20152-1P",
    txDate: "15/10/2026",
    orderDate: "14/10/2026",
    customer: "PT Helios Alchemist Kesehatan",
    kat: "1P",
    katProduk: "OOT",
    total: 9780000,
    printed: false,
  },
  {
    id: "6",
    jenis: "DOO",
    so: "991218",
    invoiceNumber: "20098",
    txDate: "15/10/2026",
    orderDate: "13/10/2026",
    customer: "Apotek K-24 Margonda",
    kat: "2P",
    katProduk: "FARMA",
    total: 3450000,
    printed: true,
    printedAt: "15/10/2026 09:33:04",
    printedBy: "Ahmad Staff",
  },
  {
    id: "7",
    jenis: "DOO",
    so: "991222",
    invoiceNumber: "20077",
    txDate: "14/10/2026",
    orderDate: "12/10/2026",
    customer: "Apotek Berkah Sehat Mandiri",
    kat: "3P",
    katProduk: "ALKES",
    total: 1890000,
    printed: true,
    printedAt: "14/10/2026 16:10:00",
    printedBy: "Admin",
  },
  {
    id: "8",
    jenis: "DOO",
    so: "991225",
    invoiceNumber: "20049",
    txDate: "14/10/2026",
    orderDate: "12/10/2026",
    customer: "Apotek Century Grand Indonesia",
    kat: "2P",
    katProduk: "FARMA",
    total: 11200000,
    printed: false,
  },
];

function formatRupiah(n: number): string {
  return new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

export default function SimulasiPage() {
  const [data, setData] = useState<MockFaktur[]>(INITIAL_MOCK_DATA);
  const [tab, setTab] = useState<"belum" | "sudah" | "semua">("belum");
  const [search, setSearch] = useState("");
  const [themeMode, setThemeMode] = useState<"linear" | "stripe">("linear");
  const [selectedId, setSelectedId] = useState<string | null>("1");

  // Toggle print simulation
  const togglePrint = (id: string) => {
    setData((prev) =>
      prev.map((item) => {
        if (item.id === id) {
          const nextPrinted = !item.printed;
          return {
            ...item,
            printed: nextPrinted,
            printedAt: nextPrinted ? new Date().toLocaleTimeString("id-ID") : undefined,
            printedBy: nextPrinted ? "Admin" : undefined,
          };
        }
        return item;
      })
    );
  };

  const filtered = useMemo(() => {
    return data.filter((item) => {
      if (tab === "belum" && item.printed) return false;
      if (tab === "sudah" && !item.printed) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const match =
          item.so.includes(q) ||
          item.invoiceNumber.toLowerCase().includes(q) ||
          item.customer.toLowerCase().includes(q) ||
          item.txDate.includes(q) ||
          item.orderDate.includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [data, tab, search]);

  const stats = useMemo(() => {
    const belum = data.filter((d) => !d.printed).length;
    const sudah = data.filter((d) => d.printed).length;
    const total = data.length;
    return { belum, sudah, total };
  }, [data]);

  const isDark = themeMode === "linear";

  return (
    <div
      className={`min-h-screen transition-colors duration-200 ${
        isDark ? "bg-[#0B0F17] text-slate-100" : "bg-[#F8FAFC] text-slate-800"
      } font-sans`}
    >
      {/* Top Banner / Switcher */}
      <div
        className={`px-4 py-2 border-b text-xs flex flex-wrap items-center justify-between gap-3 ${
          isDark
            ? "bg-[#111726]/80 border-slate-800/80 text-slate-400"
            : "bg-white border-slate-200 text-slate-600"
        }`}
      >
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="font-semibold text-slate-200">
            SIMULASI DESAIN BARU (PROTOTYPE)
          </span>
          <span className="opacity-60 hidden sm:inline">
            — Tidak mempengaruhi database live
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg p-0.5 border border-slate-700/60 bg-black/20">
            <button
              onClick={() => setThemeMode("linear")}
              className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${
                themeMode === "linear"
                  ? "bg-blue-600 text-white shadow-xs"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Obsidian Dark (Linear)
            </button>
            <button
              onClick={() => setThemeMode("stripe")}
              className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${
                themeMode === "stripe"
                  ? "bg-white text-slate-900 shadow-xs font-bold"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Minimalist Clean (Stripe)
            </button>
          </div>

          <Link
            href="/"
            className="px-3 py-1 rounded-lg text-[11px] font-semibold border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors"
          >
            ← Kembali ke Sistem Utama
          </Link>
        </div>
      </div>

      {/* Main Container */}
      <div className="max-w-[1400px] mx-auto px-4 py-5 space-y-5">
        {/* Header Bar */}
        <header className="flex flex-wrap items-center justify-between gap-4 pb-2">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center font-mono font-black text-blue-400 text-base shadow-inner">
              FT
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-extrabold tracking-tight font-mono">
                  FAKTUR TRACKER
                </h1>
                <span className="text-xs text-slate-500 font-medium">/</span>
                <span className="text-xs font-semibold text-slate-400">Gudang 1</span>
              </div>
              <p className="text-[11px] text-slate-500">
                Sistem Monitoring & Antrean Cetak Faktur Logistik
              </p>
            </div>
          </div>

          {/* Right Action Buttons */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all flex items-center gap-1.5 ${
                isDark
                  ? "bg-[#161F30] border-slate-700/80 text-slate-200 hover:bg-[#1E293B]"
                  : "bg-white border-slate-300 text-slate-700 hover:bg-slate-50"
              }`}
            >
              <span>📥</span>
              <span>Ekspor Excel</span>
            </button>

            <button
              type="button"
              className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-600/20 transition-all flex items-center gap-1.5"
            >
              <span>+</span>
              <span>Unggah Data (XXCUST)</span>
            </button>

            <div
              className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold border ${
                isDark
                  ? "bg-[#161F30] border-slate-700 text-slate-300"
                  : "bg-white border-slate-200 text-slate-700"
              }`}
            >
              AG
            </div>
          </div>
        </header>

        {/* KPI Cards Row (Linear Style) */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Card 1: Belum Dicetak */}
          <div
            className={`p-4 rounded-xl border transition-all ${
              isDark
                ? "bg-[#0F1623] border-slate-800/90 hover:border-slate-700"
                : "bg-white border-slate-200 shadow-xs"
            }`}
          >
            <div className="flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wider">
              <span>Sisa Beban Cetak</span>
              <span className="w-2 h-2 rounded-full bg-amber-500/80" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl font-extrabold font-mono tracking-tight text-amber-500">
                {stats.belum}
              </span>
              <span className="text-xs text-slate-500 font-medium">Faktur antre</span>
            </div>
            <div className="mt-2 text-[11px] text-slate-500 flex items-center gap-1">
              <span>⚡</span> Perlu diproses hari ini
            </div>
          </div>

          {/* Card 2: Selesai Dicetak */}
          <div
            className={`p-4 rounded-xl border transition-all ${
              isDark
                ? "bg-[#0F1623] border-slate-800/90 hover:border-slate-700"
                : "bg-white border-slate-200 shadow-xs"
            }`}
          >
            <div className="flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wider">
              <span>Selesai Dicetak</span>
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl font-extrabold font-mono tracking-tight text-emerald-500">
                {stats.sudah}
              </span>
              <span className="text-xs text-slate-500 font-medium">Faktur tuntas</span>
            </div>
            <div className="mt-2 text-[11px] text-slate-500 flex items-center gap-1">
              <span>✓</span> Tersinkron ke gudang
            </div>
          </div>

          {/* Card 3: Rentang ORA */}
          <div
            className={`p-4 rounded-xl border transition-all ${
              isDark
                ? "bg-[#0F1623] border-slate-800/90 hover:border-slate-700"
                : "bg-white border-slate-200 shadow-xs"
            }`}
          >
            <div className="flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wider">
              <span>Rentang ORA (Helios)</span>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20">
                ORA
              </span>
            </div>
            <div className="mt-2 text-sm font-bold font-mono text-slate-200">
              20145-1P <span className="text-slate-500 text-xs">➔</span> 20152-1P
            </div>
            <div className="mt-2 text-[11px] text-slate-500">
              Total 2 Faktur Prioritas Helios
            </div>
          </div>

          {/* Card 4: Rentang DOO */}
          <div
            className={`p-4 rounded-xl border transition-all ${
              isDark
                ? "bg-[#0F1623] border-slate-800/90 hover:border-slate-700"
                : "bg-white border-slate-200 shadow-xs"
            }`}
          >
            <div className="flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wider">
              <span>Rentang DOO Reguler</span>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                DOO
              </span>
            </div>
            <div className="mt-2 text-sm font-bold font-mono text-slate-200">
              20049 <span className="text-slate-500 text-xs">➔</span> 20138
            </div>
            <div className="mt-2 text-[11px] text-slate-500">
              Total 6 Faktur DOO Terverifikasi
            </div>
          </div>
        </div>

        {/* Toolbar: Filter Tabs & Search */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          {/* Underline Tabs (Linear Craft Style) */}
          <div className="flex items-center gap-1 border-b border-slate-800 w-full sm:w-auto">
            <button
              onClick={() => setTab("belum")}
              className={`pb-2.5 px-3 text-xs font-bold transition-all border-b-2 cursor-pointer ${
                tab === "belum"
                  ? "border-blue-500 text-blue-400"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              Belum Dicetak{" "}
              <span
                className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] ${
                  tab === "belum"
                    ? "bg-blue-500/20 text-blue-300"
                    : "bg-slate-800 text-slate-400"
                }`}
              >
                {stats.belum}
              </span>
            </button>

            <button
              onClick={() => setTab("sudah")}
              className={`pb-2.5 px-3 text-xs font-bold transition-all border-b-2 cursor-pointer ${
                tab === "sudah"
                  ? "border-blue-500 text-blue-400"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              Selesai Dicetak{" "}
              <span
                className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] ${
                  tab === "sudah"
                    ? "bg-blue-500/20 text-blue-300"
                    : "bg-slate-800 text-slate-400"
                }`}
              >
                {stats.sudah}
              </span>
            </button>

            <button
              onClick={() => setTab("semua")}
              className={`pb-2.5 px-3 text-xs font-bold transition-all border-b-2 cursor-pointer ${
                tab === "semua"
                  ? "border-blue-500 text-blue-400"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              Semua Faktur{" "}
              <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] bg-slate-800 text-slate-400">
                {stats.total}
              </span>
            </button>
          </div>

          {/* Search Box */}
          <div className="relative w-full sm:w-72">
            <span className="absolute left-2.5 top-2 text-slate-500 text-xs">
              🔍
            </span>
            <input
              type="text"
              placeholder="Cari no faktur, SO, apotek... (/) "
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={`w-full pl-8 pr-3 py-1.5 rounded-lg text-xs font-medium border outline-hidden transition-all ${
                isDark
                  ? "bg-[#0E1524] border-slate-800 text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
                  : "bg-white border-slate-300 text-slate-800 placeholder-slate-400 focus:border-blue-600"
              }`}
            />
          </div>
        </div>

        {/* High-Precision Table */}
        <div
          className={`rounded-xl border overflow-hidden transition-all ${
            isDark ? "bg-[#0F1623] border-slate-800" : "bg-white border-slate-200 shadow-sm"
          }`}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr
                  className={`border-b text-[11px] font-bold uppercase tracking-wider select-none ${
                    isDark
                      ? "bg-[#111827]/90 border-slate-800 text-slate-400"
                      : "bg-slate-50 border-slate-200 text-slate-600"
                  }`}
                >
                  <th className="py-2.5 px-3 w-10 text-center">Status</th>
                  <th className="py-2.5 px-3 w-16">Jenis</th>
                  <th className="py-2.5 px-3 w-24">No SO</th>
                  <th className="py-2.5 px-3 w-28">No Faktur</th>
                  <th className="py-2.5 px-3 w-28 bg-blue-950/20 text-blue-300">
                    Tgl Faktur
                  </th>
                  <th className="py-2.5 px-3 w-28 bg-indigo-950/20 text-indigo-300">
                    Tgl Order
                  </th>
                  <th className="py-2.5 px-4">Nama Pelanggan</th>
                  <th className="py-2.5 px-2.5 w-16 text-center">Kat</th>
                  <th className="py-2.5 px-3 w-24">Produk</th>
                  <th className="py-2.5 px-4 w-32 text-right">Total (+PPN)</th>
                  <th className="py-2.5 px-4 w-36 text-center">Aksi / Cetak</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-800/60 font-medium">
                {filtered.map((row) => {
                  const isSelected = selectedId === row.id;
                  return (
                    <tr
                      key={row.id}
                      onClick={() => setSelectedId(row.id)}
                      className={`transition-colors cursor-pointer ${
                        isSelected
                          ? isDark
                            ? "bg-blue-950/30"
                            : "bg-blue-50/60"
                          : isDark
                          ? "hover:bg-slate-800/30"
                          : "hover:bg-slate-50"
                      }`}
                    >
                      {/* Checkbox / Indicator */}
                      <td className="py-2.5 px-3 text-center">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            togglePrint(row.id);
                          }}
                          className={`w-4 h-4 rounded border flex items-center justify-center transition-all cursor-pointer ${
                            row.printed
                              ? "bg-emerald-500 border-emerald-500 text-white"
                              : "border-slate-600 hover:border-slate-400"
                          }`}
                          title={row.printed ? "Tandai Belum Dicetak" : "Tandai Sudah Dicetak"}
                        >
                          {row.printed && (
                            <svg className="w-3 h-3 stroke-current stroke-[3] fill-none" viewBox="0 0 24 24">
                              <path d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </button>
                      </td>

                      {/* Jenis Badge */}
                      <td className="py-2.5 px-3">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold font-mono ${
                            row.jenis === "ORA"
                              ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                              : "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20"
                          }`}
                        >
                          {row.jenis}
                        </span>
                      </td>

                      {/* No SO */}
                      <td className="py-2.5 px-3 font-mono text-slate-300 text-[11px]">
                        {row.so}
                      </td>

                      {/* No Faktur */}
                      <td className="py-2.5 px-3 font-mono font-bold text-slate-100">
                        {row.invoiceNumber}
                      </td>

                      {/* Tgl Faktur */}
                      <td className="py-2.5 px-3 font-mono text-[11px] text-blue-400 font-semibold bg-blue-950/10">
                        {row.txDate}
                      </td>

                      {/* Tgl Order */}
                      <td className="py-2.5 px-3 font-mono text-[11px] text-indigo-400 font-semibold bg-indigo-950/10">
                        {row.orderDate}
                      </td>

                      {/* Pelanggan */}
                      <td className="py-2.5 px-4 font-semibold text-slate-200 truncate max-w-xs">
                        {row.customer}
                      </td>

                      {/* Kategori Badge */}
                      <td className="py-2.5 px-2.5 text-center">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            row.kat === "1P"
                              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                              : row.kat === "2P"
                              ? "bg-sky-500/10 text-sky-400 border border-sky-500/20"
                              : "bg-slate-700/40 text-slate-400 border border-slate-700"
                          }`}
                        >
                          {row.kat}
                        </span>
                      </td>

                      {/* Kategori Produk */}
                      <td className="py-2.5 px-3">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider ${
                            row.katProduk === "CCP"
                              ? "bg-cyan-500/10 text-cyan-300 border border-cyan-500/20"
                              : row.katProduk === "PREKURSOR"
                              ? "bg-purple-500/10 text-purple-300 border border-purple-500/20"
                              : row.katProduk === "OOT"
                              ? "bg-orange-500/10 text-orange-300 border border-orange-500/20"
                              : "bg-slate-800 text-slate-400"
                          }`}
                        >
                          {row.katProduk}
                        </span>
                      </td>

                      {/* Total Nilai */}
                      <td className="py-2.5 px-4 text-right font-mono font-bold text-slate-200">
                        Rp {formatRupiah(row.total)}
                      </td>

                      {/* Aksi Print */}
                      <td className="py-2.5 px-4 text-center">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            togglePrint(row.id);
                          }}
                          className={`px-2.5 py-1 rounded-md text-[11px] font-bold border transition-all cursor-pointer ${
                            row.printed
                              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20"
                              : "bg-blue-600 border-blue-600 text-white hover:bg-blue-500 shadow-xs active:scale-95"
                          }`}
                        >
                          {row.printed ? "✓ Terprint" : "Cetak"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Table Footer */}
          <div
            className={`px-4 py-3 border-t flex flex-wrap items-center justify-between gap-3 text-xs ${
              isDark
                ? "bg-[#111827]/90 border-slate-800 text-slate-400"
                : "bg-slate-50 border-slate-200 text-slate-600"
            }`}
          >
            <div>
              Menampilkan <strong>{filtered.length}</strong> dari <strong>{data.length}</strong> faktur
            </div>
            <div className="flex items-center gap-1.5 text-[11px]">
              <span className="text-slate-500">Shortcut:</span>
              <kbd className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300 font-mono text-[10px]">
                ↓/↑
              </kbd>
              <span>Pilih baris</span>
              <kbd className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300 font-mono text-[10px] ml-1">
                Space
              </kbd>
              <span>Toggle Cetak</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
