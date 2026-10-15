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
  isDouble?: boolean;
  isRetur?: boolean;
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
  {
    id: "9",
    jenis: "DOO",
    so: "991228",
    invoiceNumber: "20035",
    txDate: "14/10/2026",
    orderDate: "11/10/2026",
    customer: "Apotek Kimia Farma Matraman",
    kat: "1P",
    katProduk: "FARMA",
    total: 7600000,
    printed: false,
    isDouble: true,
  },
  {
    id: "10",
    jenis: "DOO",
    so: "991228",
    invoiceNumber: "20036",
    txDate: "14/10/2026",
    orderDate: "11/10/2026",
    customer: "Apotek Kimia Farma Matraman",
    kat: "1P",
    katProduk: "FARMA",
    total: 2100000,
    printed: false,
    isDouble: true,
  },
  {
    id: "11",
    jenis: "DOO",
    so: "990812",
    invoiceNumber: "RET-20012",
    txDate: "14/10/2026",
    orderDate: "10/10/2026",
    customer: "Apotek Roxy Thamrin",
    kat: "2P",
    katProduk: "FARMA",
    total: -1450000,
    printed: false,
    isRetur: true,
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
  const [tab, setTab] = useState<"belum" | "sudah" | "semua" | "double" | "retur">("belum");
  const [katFilter, setKatFilter] = useState<string>("all");
  const [jenisFilter, setJenisFilter] = useState<string>("all");
  const [klasFilter, setKlasFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>("1");

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

  const handleMarkAllPrinted = () => {
    setData((prev) =>
      prev.map((item) => ({
        ...item,
        printed: true,
        printedAt: item.printed ? item.printedAt : new Date().toLocaleTimeString("id-ID"),
        printedBy: item.printed ? item.printedBy : "Admin",
      }))
    );
  };

  // Comprehensive Metrics
  const stats = useMemo(() => {
    let belumCount = 0;
    let sudahCount = 0;
    let doubleCount = 0;
    let returCount = 0;
    const soSet = new Set<string>();

    let maxOra = "-";
    let maxOraNum = -1;
    let max1PDoo = "-";
    let max1PDooNum = -1;
    let max2P = "-";
    let max2PNum = -1;
    let max3P = "-";
    let max3PNum = -1;

    for (const d of data) {
      if (d.printed) sudahCount++;
      else belumCount++;
      if (d.isDouble) doubleCount++;
      if (d.isRetur) returCount++;
      if (d.so && d.so !== "-") soSet.add(d.so);

      const n = parseInt(d.invoiceNumber.replace(/\D/g, ""), 10) || 0;
      if (d.jenis === "ORA") {
        if (n > maxOraNum) {
          maxOraNum = n;
          maxOra = d.invoiceNumber;
        }
      } else {
        if (d.kat === "1P" && n > max1PDooNum) {
          max1PDooNum = n;
          max1PDoo = d.invoiceNumber;
        } else if (d.kat === "2P" && n > max2PNum) {
          max2PNum = n;
          max2P = d.invoiceNumber;
        } else if (d.kat === "3P" && n > max3PNum) {
          max3PNum = n;
          max3P = d.invoiceNumber;
        }
      }
    }

    return {
      belumCount,
      sudahCount,
      totalCount: data.length,
      doubleCount,
      returCount,
      totalSO: soSet.size,
      maxOra,
      max1PDoo,
      max2P,
      max3P,
      rangeOra: "20145-1P ➔ 20152-1P",
      range1PDoo: "20035 ➔ 20133",
      range2P: "20049 ➔ 20138",
      range3P: "20077",
    };
  }, [data]);

  // Unique Dates for dropdown
  const availableDates = useMemo(() => {
    const s = new Set<string>();
    data.forEach((d) => {
      if (d.txDate) s.add(d.txDate);
      if (d.orderDate) s.add(d.orderDate);
    });
    return Array.from(s).sort().reverse();
  }, [data]);

  // Filtered dataset
  const filtered = useMemo(() => {
    return data.filter((item) => {
      if (tab === "belum" && item.printed) return false;
      if (tab === "sudah" && !item.printed) return false;
      if (tab === "double" && !item.isDouble) return false;
      if (tab === "retur" && !item.isRetur) return false;

      if (katFilter !== "all" && item.kat !== katFilter) return false;
      if (jenisFilter !== "all" && item.jenis !== jenisFilter) return false;
      if (klasFilter !== "all" && item.katProduk.toLowerCase() !== klasFilter.toLowerCase()) return false;
      if (dateFilter !== "all" && item.txDate !== dateFilter && item.orderDate !== dateFilter) return false;

      if (search.trim()) {
        const q = search.toLowerCase();
        const match =
          item.so.includes(q) ||
          item.invoiceNumber.toLowerCase().includes(q) ||
          item.customer.toLowerCase().includes(q) ||
          item.txDate.includes(q) ||
          item.orderDate.includes(q) ||
          item.katProduk.toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [data, tab, katFilter, jenisFilter, klasFilter, dateFilter, search]);

  const unprintedInFiltered = useMemo(() => {
    return filtered.filter((f) => !f.printed).length;
  }, [filtered]);

  return (
    <div className="min-h-screen bg-[#090D16] text-slate-100 font-sans selection:bg-blue-600 selection:text-white">
      {/* ─── Top Brand & Navigation Header (Height: 46px - Ultra Compact) ─── */}
      <header className="h-[46px] px-4 border-b border-slate-800/80 bg-[#0B101D] flex items-center justify-between gap-3 sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-blue-600 flex items-center justify-center font-mono font-black text-white text-xs shadow-xs">
              FT
            </div>
            <span className="font-extrabold tracking-tight font-mono text-xs sm:text-sm text-slate-100">
              FAKTUR TRACKER
            </span>
          </div>
          <span className="text-slate-600 text-xs">/</span>
          <span className="text-xs font-semibold text-slate-300">Gudang 1</span>
          <div className="hidden sm:flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[10px] text-emerald-400 font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>4 Online</span>
          </div>
        </div>

        {/* Right Tools */}
        <div className="flex items-center gap-2">
          <Link
            href="/"
            className="text-[11px] font-semibold text-slate-400 hover:text-white px-2 py-1 rounded transition-colors mr-1"
          >
            ← Kembali ke Sistem Live
          </Link>
          <button
            type="button"
            className="px-2.5 py-1 rounded-md text-xs font-semibold border border-slate-700 bg-slate-800/80 text-slate-200 hover:bg-slate-700 transition-colors flex items-center gap-1 cursor-pointer"
          >
            <span>📥</span>
            <span className="hidden sm:inline">Ekspor Excel</span>
          </button>
          <label className="px-2.5 py-1 rounded-md text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white shadow-xs cursor-pointer flex items-center gap-1">
            <span>+</span>
            <span className="hidden sm:inline">Upload XXCUST</span>
          </label>
          <div className="w-6 h-6 rounded-md bg-slate-800 border border-slate-700 flex items-center justify-center text-[10px] font-bold text-slate-300">
            AG
          </div>
        </div>
      </header>

      {/* ─── Streamlined Body ─── */}
      <main className="max-w-[1560px] mx-auto px-3 sm:px-4 py-2.5 space-y-2">

        {/* ─── Complete 8-Card Telemetry Ribbon (Ultra Compact: ~58px Height) ─── */}
        {/* Desain grid horizontal rapat yang menyajikan SEMUA metrik tanpa memakan tempat vertikal */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-1.5">
          {/* Tile 1: Total SO */}
          <div className="px-2.5 py-1.5 rounded-lg border border-slate-800 bg-[#0E1524] flex flex-col justify-between">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center justify-between">
              <span>Total SO</span>
              <span className="opacity-40">📦</span>
            </div>
            <div className="text-lg font-black font-mono text-white leading-tight">
              {stats.totalSO}
            </div>
            <div className="text-[9px] text-slate-500 truncate">SO Terdata</div>
          </div>

          {/* Tile 2: Belum Terprint (Primary Alert) */}
          <div className="px-2.5 py-1.5 rounded-lg border border-amber-500/40 bg-gradient-to-b from-amber-500/10 to-[#0E1524] flex flex-col justify-between shadow-xs">
            <div className="text-[10px] font-bold uppercase tracking-wider text-amber-400 flex items-center justify-between">
              <span>Belum Print</span>
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            </div>
            <div className="text-lg font-black font-mono text-amber-300 leading-tight">
              {stats.belumCount}
            </div>
            <div className="text-[9px] text-amber-400/80 font-medium truncate">Wajib Dicetak</div>
          </div>

          {/* Tile 3: Selesai Cetak */}
          <div className="px-2.5 py-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/5 flex flex-col justify-between">
            <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 flex items-center justify-between">
              <span>Selesai</span>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            </div>
            <div className="text-lg font-black font-mono text-emerald-300 leading-tight">
              {stats.sudahCount}
            </div>
            <div className="text-[9px] text-emerald-400/80 truncate">Tuntas Tercatat</div>
          </div>

          {/* Tile 4: Total Faktur */}
          <div className="px-2.5 py-1.5 rounded-lg border border-slate-800 bg-[#0E1524] flex flex-col justify-between">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center justify-between">
              <span>Total Faktur</span>
              <span className="opacity-40">📑</span>
            </div>
            <div className="text-lg font-black font-mono text-white leading-tight">
              {stats.totalCount}
            </div>
            <div className="text-[9px] text-slate-500 truncate">Seluruh Faktur</div>
          </div>

          {/* Tile 5: Double INV (Critical Alert) */}
          <div className={`px-2.5 py-1.5 rounded-lg border flex flex-col justify-between ${
            stats.doubleCount > 0
              ? "border-rose-500/50 bg-rose-500/10 text-rose-200 animate-pulse"
              : "border-slate-800 bg-[#0E1524] text-slate-400"
          }`}>
            <div className="text-[10px] font-bold uppercase tracking-wider flex items-center justify-between">
              <span className={stats.doubleCount > 0 ? "text-rose-400" : "text-slate-400"}>Double INV</span>
              {stats.doubleCount > 0 && <span>⚠️</span>}
            </div>
            <div className={`text-lg font-black font-mono leading-tight ${stats.doubleCount > 0 ? "text-rose-300" : "text-slate-400"}`}>
              {stats.doubleCount}
            </div>
            <div className="text-[9px] truncate opacity-80">
              {stats.doubleCount > 0 ? "Perlu Diperiksa" : "Aman (0)"}
            </div>
          </div>

          {/* Tile 6: Retur */}
          <div className={`px-2.5 py-1.5 rounded-lg border flex flex-col justify-between ${
            stats.returCount > 0
              ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
              : "border-slate-800 bg-[#0E1524] text-slate-400"
          }`}>
            <div className="text-[10px] font-bold uppercase tracking-wider flex items-center justify-between">
              <span className={stats.returCount > 0 ? "text-amber-400" : "text-slate-400"}>Retur</span>
              <span>🔄</span>
            </div>
            <div className={`text-lg font-black font-mono leading-tight ${stats.returCount > 0 ? "text-amber-300" : "text-slate-400"}`}>
              {stats.returCount}
            </div>
            <div className="text-[9px] truncate opacity-80">Faktur Retur</div>
          </div>

          {/* Tile 7: ORA (Helios Max & Range) */}
          <div className="px-2.5 py-1.5 rounded-lg border border-sky-500/30 bg-sky-950/20 flex flex-col justify-between">
            <div className="text-[10px] font-bold uppercase tracking-wider text-sky-400 flex items-center justify-between">
              <span>1P ORA (Max)</span>
              <span className="text-[8px] px-1 py-0.2 rounded font-mono font-bold bg-sky-500/20 text-sky-300">ORA</span>
            </div>
            <div className="text-sm font-black font-mono text-sky-200 truncate leading-tight my-0.5">
              {stats.maxOra}
            </div>
            <div className="text-[9px] font-mono text-slate-400 truncate" title={stats.rangeOra}>
              R: {stats.rangeOra}
            </div>
          </div>

          {/* Tile 8: 1P DOO / 2P / 3P Progression (Multi-badge Compact) */}
          <div className="px-2.5 py-1.5 rounded-lg border border-indigo-500/30 bg-indigo-950/20 flex flex-col justify-between">
            <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-300 flex items-center justify-between">
              <span>DOO Max</span>
              <span className="text-[8px] px-1 py-0.2 rounded font-mono font-bold bg-indigo-500/20 text-indigo-300">1P/2P/3P</span>
            </div>
            <div className="flex items-center justify-between text-[11px] font-mono font-bold my-0.5">
              <span className="text-emerald-400" title="1P DOO Max">1P:{stats.max1PDoo}</span>
              <span className="text-sky-300" title="2P Max">2P:{stats.max2P}</span>
              <span className="text-purple-300" title="3P Max">3P:{stats.max3P}</span>
            </div>
            <div className="text-[9px] text-slate-400 truncate">
              DOO Progresi Aktif
            </div>
          </div>
        </div>

        {/* ─── Consolidated Filter Strip (Tabs + Batch Button + Dropdowns in ~38px) ─── */}
        <div className="p-2 rounded-xl border border-slate-800 bg-[#0E1524] space-y-2">
          {/* Top Line: Filter Tabs + Batch Mark Button */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setTab("belum")}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                  tab === "belum"
                    ? "bg-blue-600 text-white shadow-xs"
                    : "text-slate-400 hover:text-white hover:bg-slate-800/60"
                }`}
              >
                <span>Belum Dicetak</span>
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                  tab === "belum" ? "bg-white/20 text-white" : "bg-slate-800 text-amber-400 font-bold"
                }`}>
                  {stats.belumCount}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setTab("sudah")}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                  tab === "sudah"
                    ? "bg-blue-600 text-white shadow-xs"
                    : "text-slate-400 hover:text-white hover:bg-slate-800/60"
                }`}
              >
                <span>Sudah Dicetak</span>
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                  tab === "sudah" ? "bg-white/20 text-white" : "bg-slate-800 text-emerald-400"
                }`}>
                  {stats.sudahCount}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setTab("semua")}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                  tab === "semua"
                    ? "bg-blue-600 text-white shadow-xs"
                    : "text-slate-400 hover:text-white hover:bg-slate-800/60"
                }`}
              >
                <span>Semua</span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-slate-800 text-slate-300">
                  {stats.totalCount}
                </span>
              </button>

              {/* Double INV Tab */}
              <button
                type="button"
                onClick={() => setTab("double")}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                  tab === "double"
                    ? "bg-rose-600 text-white shadow-xs"
                    : "text-rose-400 hover:bg-rose-950/40"
                }`}
              >
                <span>Double INV</span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-rose-950 border border-rose-800 text-rose-300">
                  {stats.doubleCount}
                </span>
              </button>

              {/* Retur Tab */}
              <button
                type="button"
                onClick={() => setTab("retur")}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                  tab === "retur"
                    ? "bg-amber-600 text-white shadow-xs"
                    : "text-amber-400 hover:bg-amber-950/40"
                }`}
              >
                <span>Retur</span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-amber-950 border border-amber-800 text-amber-300">
                  {stats.returCount}
                </span>
              </button>
            </div>

            {/* Quick Batch Action */}
            {unprintedInFiltered > 0 && (
              <button
                type="button"
                onClick={handleMarkAllPrinted}
                className="px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition-all flex items-center gap-1 shadow-xs cursor-pointer active:scale-95"
              >
                <span>✓</span>
                <span>Tandai Semua Selesai ({unprintedInFiltered})</span>
              </button>
            )}
          </div>

          {/* Secondary Filter Inputs Row: Compact single-line 30px */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 gap-1.5 pt-1.5 border-t border-slate-800/80">
            {/* Search Box */}
            <div className="relative md:col-span-2">
              <span className="absolute left-2.5 top-1.5 text-xs text-slate-500">🔍</span>
              <input
                type="text"
                placeholder="Cari SO, Faktur, Apotek, Produk... (/)"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-7 pr-3 py-1 bg-[#090D16] border border-slate-700/80 rounded-md text-xs text-slate-100 placeholder-slate-500 outline-hidden focus:border-blue-500"
              />
            </div>

            {/* Kategori Prioritas */}
            <select
              value={katFilter}
              onChange={(e) => setKatFilter(e.target.value)}
              className="px-2 py-1 bg-[#090D16] border border-slate-700/80 rounded-md text-xs text-slate-200 outline-hidden focus:border-blue-500"
            >
              <option value="all">Semua Kategori (1P/2P/3P)</option>
              <option value="1P">Khusus 1P</option>
              <option value="2P">Khusus 2P</option>
              <option value="3P">Khusus 3P</option>
            </select>

            {/* Jenis Transaksi */}
            <select
              value={jenisFilter}
              onChange={(e) => setJenisFilter(e.target.value)}
              className="px-2 py-1 bg-[#090D16] border border-slate-700/80 rounded-md text-xs text-slate-200 outline-hidden focus:border-blue-500"
            >
              <option value="all">Semua Jenis (ORA/DOO)</option>
              <option value="ORA">Khusus ORA (Helios)</option>
              <option value="DOO">Khusus DOO (Reguler)</option>
            </select>

            {/* Klasifikasi Produk */}
            <select
              value={klasFilter}
              onChange={(e) => setKlasFilter(e.target.value)}
              className="px-2 py-1 bg-[#090D16] border border-slate-700/80 rounded-md text-xs text-slate-200 outline-hidden focus:border-blue-500"
            >
              <option value="all">Semua Produk</option>
              <option value="prekursor">Prekursor</option>
              <option value="oot">OOT</option>
              <option value="ccp">CCP (Cold Chain)</option>
              <option value="alkes">Alkes</option>
              <option value="farma">Farma</option>
            </select>

            {/* Tanggal Dropdown */}
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="px-2 py-1 bg-[#090D16] border border-slate-700/80 rounded-md text-xs text-slate-200 outline-hidden focus:border-blue-500"
            >
              <option value="all">Semua Tanggal</option>
              {availableDates.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* ─── High-Density Data Table ─── */}
        <div className="rounded-xl border border-slate-800 bg-[#0E1524] overflow-hidden shadow-xl">
          <div className="overflow-x-auto max-h-[calc(100vh-270px)] custom-scrollbar">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="sticky top-0 z-20 bg-[#121B2D] border-b border-slate-800 text-[11px] font-bold uppercase tracking-wider text-slate-400 select-none shadow-xs">
                <tr>
                  <th className="py-2 px-2.5 w-10 text-center">Status</th>
                  <th className="py-2 px-2 w-14 text-center">Jenis</th>
                  <th className="py-2 px-3 w-20">No SO</th>
                  <th className="py-2 px-3 w-28">No Faktur</th>
                  <th className="py-2 px-2.5 w-24 bg-blue-950/40 text-blue-300">
                    Tgl Faktur
                  </th>
                  <th className="py-2 px-2.5 w-24 bg-indigo-950/40 text-indigo-300">
                    Tgl Order
                  </th>
                  <th className="py-2 px-3">Nama Pelanggan</th>
                  <th className="py-2 px-2 w-12 text-center">Kat</th>
                  <th className="py-2 px-2.5 w-24 text-center">Produk</th>
                  <th className="py-2 px-3 w-32 text-right">Total (+PPN)</th>
                  <th className="py-2 px-3 w-32 text-center">Done Print</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-800/50 font-medium">
                {filtered.map((row) => {
                  const isSelected = selectedId === row.id;
                  return (
                    <tr
                      key={row.id}
                      onClick={() => setSelectedId(row.id)}
                      className={`transition-colors cursor-pointer ${
                        row.isDouble
                          ? "bg-rose-950/20 hover:bg-rose-950/30"
                          : row.isRetur
                          ? "bg-amber-950/15 hover:bg-amber-950/25"
                          : isSelected
                          ? "bg-blue-950/30"
                          : "hover:bg-slate-800/40"
                      }`}
                    >
                      {/* Checkbox */}
                      <td className="py-2 px-2.5 text-center">
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
                        >
                          {row.printed && (
                            <svg className="w-3 h-3 stroke-current stroke-[3] fill-none" viewBox="0 0 24 24">
                              <path d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </button>
                      </td>

                      {/* Jenis Badge */}
                      <td className="py-2 px-2 text-center">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold font-mono ${
                            row.jenis === "ORA"
                              ? "bg-sky-500/15 text-sky-400 border border-sky-500/30"
                              : "bg-indigo-500/15 text-indigo-400 border border-indigo-500/30"
                          }`}
                        >
                          {row.jenis}
                        </span>
                      </td>

                      {/* No SO */}
                      <td className="py-2 px-3 font-mono text-[11px] text-slate-300">
                        {row.so}
                      </td>

                      {/* No Faktur with double/retur badge */}
                      <td className="py-2 px-3 font-mono font-bold text-slate-100 flex items-center gap-1.5">
                        <span>{row.invoiceNumber}</span>
                        {row.isDouble && (
                          <span className="px-1 py-0.2 rounded text-[9px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                            Double
                          </span>
                        )}
                        {row.isRetur && (
                          <span className="px-1 py-0.2 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                            Retur
                          </span>
                        )}
                      </td>

                      {/* Tgl Faktur */}
                      <td className="py-2 px-2.5 font-mono text-[11px] text-blue-400 font-semibold bg-blue-950/15">
                        {row.txDate}
                      </td>

                      {/* Tgl Order */}
                      <td className="py-2 px-2.5 font-mono text-[11px] text-indigo-400 font-semibold bg-indigo-950/15">
                        {row.orderDate}
                      </td>

                      {/* Pelanggan */}
                      <td className="py-2 px-3 font-semibold text-slate-200 truncate max-w-xs">
                        {row.customer}
                      </td>

                      {/* Kat Priority */}
                      <td className="py-2 px-2 text-center">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            row.kat === "1P"
                              ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                              : row.kat === "2P"
                              ? "bg-sky-500/15 text-sky-400 border border-sky-500/30"
                              : "bg-slate-800 text-slate-400 border border-slate-700"
                          }`}
                        >
                          {row.kat}
                        </span>
                      </td>

                      {/* Produk */}
                      <td className="py-2 px-2.5 text-center">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider ${
                            row.katProduk === "CCP"
                              ? "bg-cyan-500/15 text-cyan-300 border border-cyan-500/30"
                              : row.katProduk === "PREKURSOR"
                              ? "bg-purple-500/15 text-purple-300 border border-purple-500/30"
                              : row.katProduk === "OOT"
                              ? "bg-orange-500/15 text-orange-300 border border-orange-500/30"
                              : row.katProduk === "ALKES"
                              ? "bg-teal-500/15 text-teal-300 border border-teal-500/30"
                              : "bg-slate-800 text-slate-400"
                          }`}
                        >
                          {row.katProduk}
                        </span>
                      </td>

                      {/* Total Nilai */}
                      <td className="py-2 px-3 text-right font-mono font-bold text-slate-200">
                        {row.isRetur ? (
                          <span className="text-amber-400">-Rp {formatRupiah(Math.abs(row.total))}</span>
                        ) : (
                          `Rp ${formatRupiah(row.total)}`
                        )}
                      </td>

                      {/* Done Print Status */}
                      <td className="py-2 px-3 text-center">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            togglePrint(row.id);
                          }}
                          className={`px-2 py-0.5 rounded text-[10px] font-bold border transition-all cursor-pointer ${
                            row.printed
                              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20"
                              : "bg-blue-600 border-blue-600 text-white hover:bg-blue-500 shadow-xs"
                          }`}
                        >
                          {row.printed ? `✓ ${row.printedAt || "Print"}` : "Cetak"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Compact Status Bar Footer */}
          <div className="px-3 py-1.5 border-t border-slate-800 bg-[#121B2D] flex flex-wrap items-center justify-between text-[11px] text-slate-400">
            <div>
              Menampilkan <strong>{filtered.length}</strong> dari <strong>{data.length}</strong> faktur (Tab: <span className="uppercase font-bold text-blue-400">{tab}</span>)
            </div>
            <div className="flex items-center gap-2">
              <span>Shortcut:</span>
              <kbd className="px-1 py-0.2 rounded bg-slate-800 border border-slate-700 text-slate-300 font-mono text-[9px]">↓/↑</kbd>
              <kbd className="px-1 py-0.2 rounded bg-slate-800 border border-slate-700 text-slate-300 font-mono text-[9px]">Space (Cetak)</kbd>
              <kbd className="px-1 py-0.2 rounded bg-slate-800 border border-slate-700 text-slate-300 font-mono text-[9px]">/ (Cari)</kbd>
            </div>
          </div>
        </div>

      </main>
    </div>
  );
}
