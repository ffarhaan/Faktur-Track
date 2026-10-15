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
  const [activeNav, setActiveNav] = useState<"belum" | "sudah" | "semua" | "double" | "retur">("belum");
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

  // Metrics
  const stats = useMemo(() => {
    let belum = 0;
    let sudah = 0;
    let double = 0;
    let retur = 0;
    const soSet = new Set<string>();

    for (const d of data) {
      if (d.printed) sudah++;
      else belum++;
      if (d.isDouble) double++;
      if (d.isRetur) retur++;
      if (d.so && d.so !== "-") soSet.add(d.so);
    }

    return {
      belum,
      sudah,
      total: data.length,
      double,
      retur,
      totalSO: soSet.size,
      maxOra: "20152-1P",
      rangeOra: "20145-1P ➔ 20152-1P",
      max1PDoo: "20133",
      max2P: "20138",
      max3P: "20077",
    };
  }, [data]);

  // Filtered dataset
  const filtered = useMemo(() => {
    return data.filter((item) => {
      if (activeNav === "belum" && item.printed) return false;
      if (activeNav === "sudah" && !item.printed) return false;
      if (activeNav === "double" && !item.isDouble) return false;
      if (activeNav === "retur" && !item.isRetur) return false;

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
          item.orderDate.includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [data, activeNav, katFilter, jenisFilter, klasFilter, dateFilter, search]);

  const activeNavTitle = {
    belum: { title: "Belum Dicetak", subtitle: `${stats.belum} Faktur menunggu cetak`, color: "text-amber-400" },
    sudah: { title: "Selesai Dicetak", subtitle: `${stats.sudah} Faktur sudah dicetak`, color: "text-emerald-400" },
    semua: { title: "Semua Faktur", subtitle: `Total ${stats.total} Faktur terdata`, color: "text-blue-400" },
    double: { title: "Faktur Ganda (Double INV)", subtitle: `${stats.double} Faktur terindikasi double order`, color: "text-rose-400" },
    retur: { title: "Faktur Retur", subtitle: `${stats.retur} Faktur retur/pengembalian barang`, color: "text-amber-400" },
  }[activeNav];

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#080C15] text-slate-100 font-sans selection:bg-blue-600 selection:text-white">
      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* ─── LEFT SIDEBAR WORKSPACE (Width: 260px, Fixed, Full Height) ─── */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      <aside className="w-64 shrink-0 h-full border-r border-slate-800/80 bg-[#0A0F1D] flex flex-col justify-between select-none">
        {/* Top: Branding & Upload */}
        <div className="p-3.5 space-y-3">
          {/* Logo & Status */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-blue-600 flex items-center justify-center font-mono font-black text-white text-xs shadow-xs">
                FT
              </div>
              <div>
                <div className="font-extrabold text-xs font-mono tracking-tight text-white leading-tight">
                  FAKTUR TRACKER
                </div>
                <div className="text-[10px] text-slate-500 font-medium">
                  Gudang 1 • Cabang Pusat
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[9px] text-emerald-400 font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>4 ON</span>
            </div>
          </div>

          {/* Upload Button Full-Width */}
          <button
            type="button"
            className="w-full py-1.5 px-3 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-600/20 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <span>+</span>
            <span>Upload Data XXCUST</span>
          </button>
        </div>

        {/* Middle: Navigation Lists (Inbox Style) */}
        <div className="flex-1 overflow-y-auto px-2 space-y-4 py-1 custom-scrollbar text-xs">
          {/* Section 1: Antrean Kerja */}
          <div>
            <div className="px-2 pb-1 text-[9px] font-bold uppercase tracking-wider text-slate-400">
              Status Faktur
            </div>
            <div className="space-y-0.5">
              <button
                type="button"
                onClick={() => setActiveNav("belum")}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                  activeNav === "belum"
                    ? "bg-blue-600/15 text-blue-400 border border-blue-500/30 font-bold"
                    : "text-slate-400 hover:text-white hover:bg-slate-800/50"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span>📥</span>
                  <span>Belum Dicetak</span>
                </div>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  {stats.belum}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveNav("sudah")}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                  activeNav === "sudah"
                    ? "bg-blue-600/15 text-blue-400 border border-blue-500/30 font-bold"
                    : "text-slate-400 hover:text-white hover:bg-slate-800/50"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span>✅</span>
                  <span>Selesai Dicetak</span>
                </div>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono text-emerald-400 bg-emerald-500/10">
                  {stats.sudah}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveNav("semua")}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                  activeNav === "semua"
                    ? "bg-blue-600/15 text-blue-400 border border-blue-500/30 font-bold"
                    : "text-slate-400 hover:text-white hover:bg-slate-800/50"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span>📑</span>
                  <span>Semua Faktur</span>
                </div>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono text-slate-400 bg-slate-800">
                  {stats.total}
                </span>
              </button>
            </div>
          </div>

          {/* Section 2: Perlu Perhatian (Anomali) */}
          <div>
            <div className="px-2 pb-1 text-[9px] font-bold uppercase tracking-wider text-slate-400">
              Perlu Perhatian
            </div>
            <div className="space-y-0.5">
              <button
                type="button"
                onClick={() => setActiveNav("double")}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                  activeNav === "double"
                    ? "bg-rose-950/40 text-rose-300 border border-rose-700/50 font-bold"
                    : "text-rose-400 hover:bg-rose-950/30"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span>⚠️</span>
                  <span>Double INV</span>
                </div>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse">
                  {stats.double}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveNav("retur")}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                  activeNav === "retur"
                    ? "bg-amber-950/40 text-amber-300 border border-amber-700/50 font-bold"
                    : "text-amber-400 hover:bg-amber-950/30"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span>🔄</span>
                  <span>Faktur Retur</span>
                </div>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  {stats.retur}
                </span>
              </button>
            </div>
          </div>

          {/* Section 3: Telemetri Progresi Nomor (Di dalam sidebar, rapi & permanen) */}
          <div className="pt-2 border-t border-slate-800/80">
            <div className="p-2.5 rounded-xl border border-slate-800/90 bg-[#0C1222] space-y-2 text-[11px]">
              <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                <span>Progresi Nomor</span>
                <span className="text-blue-400 font-mono">SO: {stats.totalSO}</span>
              </div>

              {/* ORA Max */}
              <div className="p-1.5 rounded-lg bg-[#090D18] border border-slate-800/80">
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-slate-400 font-semibold">1P ORA (Max)</span>
                  <span className="text-[8px] font-mono px-1 rounded bg-sky-500/20 text-sky-400 font-bold">ORA</span>
                </div>
                <div className="font-mono font-bold text-sky-300 text-xs mt-0.5">
                  {stats.maxOra}
                </div>
                <div className="text-[9px] font-mono text-slate-500 truncate">
                  R: {stats.rangeOra}
                </div>
              </div>

              {/* DOO Max Progressions */}
              <div className="p-1.5 rounded-lg bg-[#090D18] border border-slate-800/80 space-y-1">
                <div className="text-[10px] text-slate-400 font-semibold">DOO Nomor Max:</div>
                <div className="grid grid-cols-3 gap-1 text-[10px] font-mono font-bold text-center">
                  <div className="p-0.5 rounded bg-slate-800/60 text-emerald-400" title="1P DOO Max">
                    1P:{stats.max1PDoo}
                  </div>
                  <div className="p-0.5 rounded bg-slate-800/60 text-sky-300" title="2P DOO Max">
                    2P:{stats.max2P}
                  </div>
                  <div className="p-0.5 rounded bg-slate-800/60 text-purple-300" title="3P DOO Max">
                    3P:{stats.max3P}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom User Profile & Return Link */}
        <div className="p-3 border-t border-slate-800/80 bg-[#0B101D] space-y-2">
          <Link
            href="/"
            className="w-full text-center block py-1 rounded text-[11px] font-semibold text-slate-400 hover:text-white hover:bg-slate-800/60 transition-colors"
          >
            ← Kembali ke Tampilan Lama
          </Link>
          <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-800/60">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-slate-800 border border-slate-700 flex items-center justify-center text-[10px] font-bold text-slate-300">
                AG
              </div>
              <div>
                <div className="font-bold text-[11px] leading-tight">Admin Gudang</div>
                <div className="text-[9px] text-slate-500">Pencetak Aktif</div>
              </div>
            </div>
            <button className="text-slate-400 hover:text-white text-xs">⚙</button>
          </div>
        </div>
      </aside>

      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* ─── RIGHT MAIN CANVAS (Pure Data Focus, Zero Card Waste) ─────────── */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      <main className="flex-1 flex flex-col h-full overflow-hidden bg-[#080C15]">
        {/* Top Context & Action Bar (Height: 52px) */}
        <header className="h-[52px] shrink-0 px-4 border-b border-slate-800/80 bg-[#0B101D] flex items-center justify-between gap-3">
          {/* Left Title */}
          <div>
            <h1 className="text-sm font-extrabold tracking-tight flex items-center gap-2">
              <span className={activeNavTitle.color}>{activeNavTitle.title}</span>
              <span className="text-xs text-slate-500 font-normal">({filtered.length} Faktur)</span>
            </h1>
            <p className="text-[10px] text-slate-500">{activeNavTitle.subtitle}</p>
          </div>

          {/* Right Filters & Buttons */}
          <div className="flex items-center gap-2">
            {/* Quick Search */}
            <div className="relative w-48 sm:w-56">
              <span className="absolute left-2.5 top-1.5 text-xs text-slate-500">🔍</span>
              <input
                type="text"
                placeholder="Cari SO, Faktur, Apotek... (/)"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-7 pr-2.5 py-1 bg-[#080C15] border border-slate-700/80 rounded-md text-xs text-slate-100 placeholder-slate-500 outline-hidden focus:border-blue-500"
              />
            </div>

            {/* Filter Jenis */}
            <select
              value={jenisFilter}
              onChange={(e) => setJenisFilter(e.target.value)}
              className="px-2 py-1 bg-[#080C15] border border-slate-700/80 rounded-md text-xs text-slate-300 outline-hidden focus:border-blue-500"
            >
              <option value="all">Semua Jenis</option>
              <option value="ORA">Khusus ORA</option>
              <option value="DOO">Khusus DOO</option>
            </select>

            {/* Filter Kategori */}
            <select
              value={katFilter}
              onChange={(e) => setKatFilter(e.target.value)}
              className="px-2 py-1 bg-[#080C15] border border-slate-700/80 rounded-md text-xs text-slate-300 outline-hidden focus:border-blue-500"
            >
              <option value="all">Semua Kat</option>
              <option value="1P">1P</option>
              <option value="2P">2P</option>
              <option value="3P">3P</option>
            </select>

            {/* Filter Produk */}
            <select
              value={klasFilter}
              onChange={(e) => setKlasFilter(e.target.value)}
              className="px-2 py-1 bg-[#080C15] border border-slate-700/80 rounded-md text-xs text-slate-300 outline-hidden focus:border-blue-500"
            >
              <option value="all">Semua Produk</option>
              <option value="prekursor">Prekursor</option>
              <option value="oot">OOT</option>
              <option value="ccp">CCP</option>
              <option value="alkes">Alkes</option>
              <option value="farma">Farma</option>
            </select>

            {/* Ekspor Excel */}
            <button
              type="button"
              className="px-2.5 py-1 rounded-md text-xs font-semibold border border-slate-700 bg-slate-800/80 text-slate-200 hover:bg-slate-700 transition-colors flex items-center gap-1 cursor-pointer"
            >
              <span>📥</span>
              <span className="hidden sm:inline">Ekspor</span>
            </button>

            {/* Batch Done Print Button */}
            {activeNav === "belum" && stats.belum > 0 && (
              <button
                type="button"
                onClick={handleMarkAllPrinted}
                className="px-2.5 py-1 rounded-md text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition-all flex items-center gap-1 shadow-xs cursor-pointer active:scale-95"
              >
                <span>✓</span>
                <span>Selesaikan Semua ({stats.belum})</span>
              </button>
            )}
          </div>
        </header>

        {/* ─── Table Canvas (Fills 100% of the Remaining Screen) ──────────── */}
        <div className="flex-1 overflow-auto custom-scrollbar">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="sticky top-0 z-20 bg-[#0E1524] border-b border-slate-800 text-[11px] font-bold uppercase tracking-wider text-slate-400 select-none shadow-xs">
              <tr>
                <th className="py-2.5 px-3 w-10 text-center">Status</th>
                <th className="py-2.5 px-2.5 w-14 text-center">Jenis</th>
                <th className="py-2.5 px-3 w-24">No SO</th>
                <th className="py-2.5 px-3 w-28">No Faktur</th>
                <th className="py-2.5 px-3 w-28 bg-blue-950/30 text-blue-300 font-semibold">
                  Tgl Faktur
                </th>
                <th className="py-2.5 px-3 w-28 bg-indigo-950/30 text-indigo-300 font-semibold">
                  Tgl Order
                </th>
                <th className="py-2.5 px-3">Nama Pelanggan</th>
                <th className="py-2.5 px-2.5 w-14 text-center">Kat</th>
                <th className="py-2.5 px-2.5 w-24 text-center">Produk</th>
                <th className="py-2.5 px-4 w-32 text-right">Total (+PPN)</th>
                <th className="py-2.5 px-4 w-32 text-center">Aksi / Cetak</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-800/40 font-medium">
              {filtered.map((row) => {
                const isSelected = selectedId === row.id;
                return (
                  <tr
                    key={row.id}
                    onClick={() => setSelectedId(row.id)}
                    className={`transition-colors cursor-pointer ${
                      row.isDouble
                        ? "bg-rose-950/20 hover:bg-rose-950/35"
                        : row.isRetur
                        ? "bg-amber-950/20 hover:bg-amber-950/35"
                        : isSelected
                        ? "bg-blue-950/25"
                        : "hover:bg-slate-800/30"
                    }`}
                  >
                    {/* Checkbox */}
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
                      >
                        {row.printed && (
                          <svg className="w-3 h-3 stroke-current stroke-[3] fill-none" viewBox="0 0 24 24">
                            <path d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </button>
                    </td>

                    {/* Jenis Badge */}
                    <td className="py-2.5 px-2.5 text-center">
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
                    <td className="py-2.5 px-3 font-mono text-[11px] text-slate-300">
                      {row.so}
                    </td>

                    {/* No Faktur with double / retur tags */}
                    <td className="py-2.5 px-3 font-mono font-bold text-slate-100 flex items-center gap-1.5">
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
                    <td className="py-2.5 px-3 font-mono text-[11px] text-blue-400 font-semibold bg-blue-950/10">
                      {row.txDate}
                    </td>

                    {/* Tgl Order */}
                    <td className="py-2.5 px-3 font-mono text-[11px] text-indigo-400 font-semibold bg-indigo-950/10">
                      {row.orderDate}
                    </td>

                    {/* Pelanggan */}
                    <td className="py-2.5 px-3 font-semibold text-slate-200 truncate max-w-sm">
                      {row.customer}
                    </td>

                    {/* Kategori Prioritas */}
                    <td className="py-2.5 px-2.5 text-center">
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
                    <td className="py-2.5 px-2.5 text-center">
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
                    <td className="py-2.5 px-4 text-right font-mono font-bold text-slate-200">
                      {row.isRetur ? (
                        <span className="text-amber-400">-Rp {formatRupiah(Math.abs(row.total))}</span>
                      ) : (
                        `Rp ${formatRupiah(row.total)}`
                      )}
                    </td>

                    {/* Done Print Aksi */}
                    <td className="py-2.5 px-4 text-center">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          togglePrint(row.id);
                        }}
                        className={`px-2.5 py-1 rounded-md text-[10px] font-bold border transition-all cursor-pointer ${
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

        {/* Bottom Status Ribbon (Height: 30px) */}
        <footer className="h-[30px] shrink-0 px-4 border-t border-slate-800/80 bg-[#0B101D] flex items-center justify-between text-[11px] text-slate-400 select-none">
          <div>
            Menampilkan <strong>{filtered.length}</strong> faktur aktif di layar
          </div>
          <div className="flex items-center gap-2">
            <span>Shortcut:</span>
            <kbd className="px-1 py-0.2 rounded bg-slate-800 border border-slate-700 text-slate-300 font-mono text-[9px]">↓/↑ Pilih</kbd>
            <kbd className="px-1 py-0.2 rounded bg-slate-800 border border-slate-700 text-slate-300 font-mono text-[9px]">Space Cetak</kbd>
            <kbd className="px-1 py-0.2 rounded bg-slate-800 border border-slate-700 text-slate-300 font-mono text-[9px]">/ Cari</kbd>
          </div>
        </footer>
      </main>
    </div>
  );
}
