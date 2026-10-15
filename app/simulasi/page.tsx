"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import MasterApotekModal from "@/components/MasterApotekModal";
import MasterProductModal from "@/components/MasterProductModal";
import LoginModal, { AppUser } from "@/components/LoginModal";
import ChangePasswordModal from "@/components/ChangePasswordModal";
import ExportExcelModal from "@/components/ExportExcelModal";
import { FakturGroup } from "@/lib/types";

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

  // Settings & Modals State
  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
  const [showSettingsPanel, setShowSettingsPanel] = useState<boolean>(false);
  const [showApotekModal, setShowApotekModal] = useState<boolean>(false);
  const [showProductModal, setShowProductModal] = useState<boolean>(false);
  const [showExportModal, setShowExportModal] = useState<boolean>(false);
  const [showChangelogModal, setShowChangelogModal] = useState<boolean>(false);
  const [showChangePasswordModal, setShowChangePasswordModal] = useState<boolean>(false);
  const [showLoginModal, setShowLoginModal] = useState<boolean>(false);
  const [showOnlinePopover, setShowOnlinePopover] = useState<boolean>(false);

  const [currentUser, setCurrentUser] = useState<AppUser | null>({
    name: "Admin Gudang",
    role: "admin",
  });

  const togglePrint = (id: string) => {
    setData((prev) =>
      prev.map((item) => {
        if (item.id === id) {
          const nextPrinted = !item.printed;
          return {
            ...item,
            printed: nextPrinted,
            printedAt: nextPrinted ? new Date().toLocaleTimeString("id-ID") : undefined,
            printedBy: nextPrinted ? currentUser?.name || "Admin" : undefined,
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
        printedBy: item.printed ? item.printedBy : currentUser?.name || "Admin",
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

  // Convert mock data to FakturGroup format for ExportExcelModal
  const exportGroups = useMemo<FakturGroup[]>(() => {
    return data.map((d) => ({
      key: d.id,
      invoiceNumber: d.invoiceNumber,
      invoiceKey: d.invoiceNumber,
      so: d.so,
      items: [],
      orderDate: d.orderDate,
      transactionDate: d.txDate,
      jenisTransaksi: d.jenis,
      customerName: d.customer,
      kategori: d.kat,
      kategoriProduk: d.katProduk,
      hasPrekursor: d.katProduk === "PREKURSOR",
      hasOOT: d.katProduk === "OOT",
      hasCCP: d.katProduk === "CCP",
      hasAlkes: d.katProduk === "ALKES",
      hasFarma: d.katProduk === "FARMA",
      isDoubleInv: Boolean(d.isDouble),
      isRetur: Boolean(d.isRetur),
      totalHarga: d.total / 1.11,
      totalItems: 1,
      allPrinted: d.printed,
      printedAt: d.printedAt || null,
      printedBy: d.printedBy || null,
    }));
  }, [data]);

  // Unique Dates
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
    belum: { title: "Belum Dicetak", subtitle: `${stats.belum} Faktur antre untuk diproses`, color: "text-amber-400" },
    sudah: { title: "Selesai Dicetak", subtitle: `${stats.sudah} Faktur sudah tuntas dicetak`, color: "text-emerald-400" },
    semua: { title: "Semua Faktur", subtitle: `Total ${stats.total} Faktur terdata`, color: "text-blue-400" },
    double: { title: "Double Invoice", subtitle: `${stats.double} Faktur terindikasi nomor ganda`, color: "text-rose-400" },
    retur: { title: "Faktur Retur", subtitle: `${stats.retur} Faktur retur/pengembalian barang`, color: "text-amber-400" },
  }[activeNav];

  return (
    <div className={`flex h-screen w-screen overflow-hidden font-sans transition-colors duration-150 ${
      isDarkMode ? "bg-[#080C15] text-slate-100" : "bg-[#F8FAFC] text-slate-800"
    }`}>
      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* ─── LEFT SIDEBAR WORKSPACE (Width: 260px) ───────────────────────── */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      <aside className={`w-64 shrink-0 h-full border-r flex flex-col justify-between select-none ${
        isDarkMode ? "bg-[#0A0F1D] border-slate-800/80" : "bg-white border-slate-200"
      }`}>
        {/* Top: Branding, Online Popover, Upload */}
        <div className="p-3.5 space-y-3">
          {/* Logo & Online Presence Button */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-blue-600 flex items-center justify-center font-mono font-black text-white text-xs shadow-xs">
                FT
              </div>
              <div>
                <div className="font-extrabold text-xs font-mono tracking-tight leading-tight">
                  FAKTUR TRACKER
                </div>
                <div className={`text-[10px] font-medium ${isDarkMode ? "text-slate-500" : "text-slate-400"}`}>
                  Gudang 1 • Cabang Pusat
                </div>
              </div>
            </div>

            {/* Online Status Pill - Clickable to open online users */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowOnlinePopover(!showOnlinePopover)}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[9px] text-emerald-400 font-semibold cursor-pointer hover:bg-emerald-500/20 transition-colors"
                title="Lihat pengguna online"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span>4 ON</span>
              </button>

              {/* Online Users Popover */}
              {showOnlinePopover && (
                <div className={`absolute left-0 top-full mt-2 w-56 rounded-xl border p-2.5 shadow-2xl z-50 text-xs ${
                  isDarkMode ? "bg-[#0E1524] border-slate-700 text-slate-100" : "bg-white border-slate-200 text-slate-800"
                }`}>
                  <div className="flex items-center justify-between pb-1.5 border-b border-slate-800 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    <span>Pengguna Online (4)</span>
                    <button onClick={() => setShowOnlinePopover(false)} className="text-slate-400 hover:text-white">✕</button>
                  </div>
                  <div className="space-y-1.5 pt-1.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-bold flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                        Admin Gudang (Anda)
                      </span>
                      <span className="text-[9px] text-emerald-400 font-mono">Aktif</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] opacity-80">
                      <span className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                        Ahmad Staff
                      </span>
                      <span className="text-[9px] text-slate-400 font-mono">Gudang</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] opacity-80">
                      <span className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                        Rian Ops
                      </span>
                      <span className="text-[9px] text-slate-400 font-mono">Checker</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Upload Button */}
          <button
            type="button"
            className="w-full py-1.5 px-3 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-600/20 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <span>+</span>
            <span>Upload Data XXCUST</span>
          </button>
        </div>

        {/* Middle: Navigation Lists */}
        <div className="flex-1 overflow-y-auto px-2 space-y-4 py-1 custom-scrollbar text-xs">
          {/* Section 1: Antrean Kerja */}
          <div>
            <div className={`px-2 pb-1 text-[9px] font-bold uppercase tracking-wider ${isDarkMode ? "text-slate-500" : "text-slate-400"}`}>
              Antrean Cetak
            </div>
            <div className="space-y-0.5">
              <button
                type="button"
                onClick={() => setActiveNav("belum")}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                  activeNav === "belum"
                    ? "bg-blue-600/15 text-blue-400 border border-blue-500/30 font-bold"
                    : isDarkMode ? "text-slate-400 hover:text-white hover:bg-slate-800/50" : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span>📥</span>
                  <span>Belum Dicetak</span>
                </div>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">
                  {stats.belum}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveNav("sudah")}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                  activeNav === "sudah"
                    ? "bg-blue-600/15 text-blue-400 border border-blue-500/30 font-bold"
                    : isDarkMode ? "text-slate-400 hover:text-white hover:bg-slate-800/50" : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
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
                    : isDarkMode ? "text-slate-400 hover:text-white hover:bg-slate-800/50" : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span>📑</span>
                  <span>Semua Faktur</span>
                </div>
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                  isDarkMode ? "text-slate-400 bg-slate-800" : "text-slate-600 bg-slate-100"
                }`}>
                  {stats.total}
                </span>
              </button>
            </div>
          </div>

          {/* Section 2: Perhatian Khusus */}
          <div>
            <div className={`px-2 pb-1 text-[9px] font-bold uppercase tracking-wider ${isDarkMode ? "text-slate-500" : "text-slate-400"}`}>
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

          {/* Section 3: Master Data & Pengaturan Menu Langsung di Sidebar */}
          <div>
            <div className={`px-2 pb-1 text-[9px] font-bold uppercase tracking-wider ${isDarkMode ? "text-slate-500" : "text-slate-400"}`}>
              Master & Pengaturan
            </div>
            <div className="space-y-0.5">
              <button
                type="button"
                onClick={() => setShowApotekModal(true)}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg font-semibold transition-colors cursor-pointer text-left ${
                  isDarkMode ? "text-slate-300 hover:bg-slate-800/60" : "text-slate-700 hover:bg-slate-100"
                }`}
              >
                <span>🏢</span>
                <span>Master Apotek (1P/2P/3P)</span>
              </button>

              <button
                type="button"
                onClick={() => setShowProductModal(true)}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg font-semibold transition-colors cursor-pointer text-left ${
                  isDarkMode ? "text-slate-300 hover:bg-slate-800/60" : "text-slate-700 hover:bg-slate-100"
                }`}
              >
                <span>💊</span>
                <span>Master Produk</span>
              </button>

              <button
                type="button"
                onClick={() => setShowSettingsPanel(true)}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg font-semibold transition-colors cursor-pointer text-left ${
                  isDarkMode ? "text-blue-400 hover:bg-blue-950/40" : "text-blue-600 hover:bg-blue-50"
                }`}
              >
                <span>⚙️</span>
                <span>Buka Panel Pengaturan</span>
              </button>
            </div>
          </div>

          {/* Section 4: Progresi Telemetri Nomor Faktur */}
          <div className="pt-2 border-t border-slate-800/80">
            <div className={`p-2.5 rounded-xl border space-y-2 text-[11px] ${
              isDarkMode ? "bg-[#0C1222] border-slate-800" : "bg-slate-50 border-slate-200"
            }`}>
              <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-400">
                <span>Progresi Nomor</span>
                <span className="text-blue-400 font-mono">SO: {stats.totalSO}</span>
              </div>

              {/* ORA Max */}
              <div className={`p-1.5 rounded-lg border ${
                isDarkMode ? "bg-[#090D18] border-slate-800" : "bg-white border-slate-200"
              }`}>
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
              <div className={`p-1.5 rounded-lg border space-y-1 ${
                isDarkMode ? "bg-[#090D18] border-slate-800" : "bg-white border-slate-200"
              }`}>
                <div className="text-[10px] text-slate-400 font-semibold">DOO Nomor Max:</div>
                <div className="grid grid-cols-3 gap-1 text-[10px] font-mono font-bold text-center">
                  <div className={`p-0.5 rounded ${isDarkMode ? "bg-slate-800" : "bg-slate-100"} text-emerald-400`}>
                    1P:{stats.max1PDoo}
                  </div>
                  <div className={`p-0.5 rounded ${isDarkMode ? "bg-slate-800" : "bg-slate-100"} text-sky-300`}>
                    2P:{stats.max2P}
                  </div>
                  <div className={`p-0.5 rounded ${isDarkMode ? "bg-slate-800" : "bg-slate-100"} text-purple-300`}>
                    3P:{stats.max3P}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom User Profile, Settings Trigger, & Link */}
        <div className={`p-3 border-t space-y-2 ${
          isDarkMode ? "bg-[#0B101D] border-slate-800/80" : "bg-slate-50 border-slate-200"
        }`}>
          <Link
            href="/"
            className={`w-full text-center block py-1 rounded text-[11px] font-semibold transition-colors ${
              isDarkMode ? "text-slate-400 hover:text-white hover:bg-slate-800/60" : "text-slate-600 hover:text-slate-900 hover:bg-slate-200"
            }`}
          >
            ← Kembali ke Tampilan Lama
          </Link>

          <div className={`flex items-center justify-between text-xs pt-2 border-t ${
            isDarkMode ? "border-slate-800/60" : "border-slate-200"
          }`}>
            <button
              type="button"
              onClick={() => setShowLoginModal(true)}
              className="flex items-center gap-2 text-left cursor-pointer hover:opacity-80 transition-opacity"
              title="Ganti Pengguna"
            >
              <div className="w-6 h-6 rounded-md bg-blue-600/30 border border-blue-500/40 flex items-center justify-center text-[10px] font-bold text-blue-300">
                👤
              </div>
              <div>
                <div className="font-bold text-[11px] leading-tight flex items-center gap-1">
                  <span>{currentUser?.name || "Pilih User"}</span>
                  <span className="text-[9px] text-blue-400 underline">Ganti</span>
                </div>
                <div className={`text-[9px] ${isDarkMode ? "text-slate-500" : "text-slate-400"}`}>
                  {currentUser?.role === "admin" ? "Pencetak Aktif" : "Hanya Lihat"}
                </div>
              </div>
            </button>

            {/* Quick Gear Icon */}
            <button
              type="button"
              onClick={() => setShowSettingsPanel(true)}
              className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
                isDarkMode ? "bg-slate-800/80 border-slate-700 text-slate-300 hover:bg-slate-700" : "bg-white border-slate-200 text-slate-700 hover:bg-slate-100"
              }`}
              title="Buka Pengaturan"
            >
              ⚙️
            </button>
          </div>
        </div>
      </aside>

      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* ─── RIGHT MAIN CANVAS ────────────────────────────────────────────── */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      <main className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Top Context & Action Bar (Height: 52px) */}
        <header className={`h-[52px] shrink-0 px-4 border-b flex items-center justify-between gap-3 ${
          isDarkMode ? "bg-[#0B101D] border-slate-800/80" : "bg-white border-slate-200"
        }`}>
          {/* Left Title */}
          <div>
            <h1 className="text-sm font-extrabold tracking-tight flex items-center gap-2">
              <span className={activeNavTitle.color}>{activeNavTitle.title}</span>
              <span className="text-xs text-slate-500 font-normal">({filtered.length} Faktur)</span>
            </h1>
            <p className="text-[10px] text-slate-500">{activeNavTitle.subtitle}</p>
          </div>

          {/* Right Filters & Tools */}
          <div className="flex items-center gap-2">
            {/* Quick Search */}
            <div className="relative w-44 sm:w-52">
              <span className="absolute left-2.5 top-1.5 text-xs text-slate-500">🔍</span>
              <input
                type="text"
                placeholder="Cari SO, Faktur, Apotek... (/)"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className={`w-full pl-7 pr-2.5 py-1 rounded-md text-xs outline-hidden transition-all ${
                  isDarkMode ? "bg-[#080C15] border border-slate-700/80 text-slate-100 focus:border-blue-500" : "bg-slate-50 border border-slate-300 text-slate-800 focus:bg-white"
                }`}
              />
            </div>

            {/* Filter Jenis */}
            <select
              value={jenisFilter}
              onChange={(e) => setJenisFilter(e.target.value)}
              className={`px-2 py-1 rounded-md text-xs outline-hidden ${
                isDarkMode ? "bg-[#080C15] border border-slate-700/80 text-slate-300" : "bg-slate-50 border border-slate-300 text-slate-700"
              }`}
            >
              <option value="all">Semua Jenis</option>
              <option value="ORA">Khusus ORA</option>
              <option value="DOO">Khusus DOO</option>
            </select>

            {/* Filter Kategori */}
            <select
              value={katFilter}
              onChange={(e) => setKatFilter(e.target.value)}
              className={`px-2 py-1 rounded-md text-xs outline-hidden ${
                isDarkMode ? "bg-[#080C15] border border-slate-700/80 text-slate-300" : "bg-slate-50 border border-slate-300 text-slate-700"
              }`}
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
              className={`px-2 py-1 rounded-md text-xs outline-hidden ${
                isDarkMode ? "bg-[#080C15] border border-slate-700/80 text-slate-300" : "bg-slate-50 border border-slate-300 text-slate-700"
              }`}
            >
              <option value="all">Semua Produk</option>
              <option value="prekursor">Prekursor</option>
              <option value="oot">OOT</option>
              <option value="ccp">CCP</option>
              <option value="alkes">Alkes</option>
              <option value="farma">Farma</option>
            </select>

            {/* Ekspor Excel Trigger */}
            <button
              type="button"
              onClick={() => setShowExportModal(true)}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold border transition-colors flex items-center gap-1 cursor-pointer ${
                isDarkMode ? "border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
              }`}
            >
              <span>📥</span>
              <span className="hidden sm:inline">Ekspor Excel</span>
            </button>

            {/* Settings Trigger in Header */}
            <button
              type="button"
              onClick={() => setShowSettingsPanel(true)}
              className={`px-2 py-1 rounded-md text-xs font-semibold border transition-colors flex items-center gap-1 cursor-pointer ${
                isDarkMode ? "border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
              }`}
              title="Buka Pengaturan"
            >
              <span>⚙️</span>
              <span className="hidden md:inline">Pengaturan</span>
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

        {/* ─── Table Canvas (Full Bleed) ──────────────────────────────────── */}
        <div className="flex-1 overflow-auto custom-scrollbar">
          <table className="w-full text-left text-xs border-collapse">
            <thead className={`sticky top-0 z-20 border-b text-[11px] font-bold uppercase tracking-wider select-none shadow-xs ${
              isDarkMode ? "bg-[#0E1524] border-slate-800 text-slate-400" : "bg-slate-100 border-slate-300 text-slate-600"
            }`}>
              <tr>
                <th className="py-2.5 px-3 w-10 text-center">Status</th>
                <th className="py-2.5 px-2.5 w-14 text-center">Jenis</th>
                <th className="py-2.5 px-3 w-24">No SO</th>
                <th className="py-2.5 px-3 w-28">No Faktur</th>
                <th className={`py-2.5 px-3 w-28 font-semibold ${isDarkMode ? "bg-blue-950/30 text-blue-300" : "bg-blue-50 text-blue-800"}`}>
                  Tgl Faktur
                </th>
                <th className={`py-2.5 px-3 w-28 font-semibold ${isDarkMode ? "bg-indigo-950/30 text-indigo-300" : "bg-indigo-50 text-indigo-800"}`}>
                  Tgl Order
                </th>
                <th className="py-2.5 px-3">Nama Pelanggan</th>
                <th className="py-2.5 px-2.5 w-14 text-center">Kat</th>
                <th className="py-2.5 px-2.5 w-24 text-center">Produk</th>
                <th className="py-2.5 px-4 w-32 text-right">Total (+PPN)</th>
                <th className="py-2.5 px-4 w-32 text-center">Aksi / Cetak</th>
              </tr>
            </thead>

            <tbody className={`divide-y font-medium ${isDarkMode ? "divide-slate-800/40" : "divide-slate-200"}`}>
              {filtered.map((row) => {
                const isSelected = selectedId === row.id;
                return (
                  <tr
                    key={row.id}
                    onClick={() => setSelectedId(row.id)}
                    className={`transition-colors cursor-pointer ${
                      row.isDouble
                        ? isDarkMode ? "bg-rose-950/20 hover:bg-rose-950/35" : "bg-rose-50 hover:bg-rose-100"
                        : row.isRetur
                        ? isDarkMode ? "bg-amber-950/20 hover:bg-amber-950/35" : "bg-amber-50 hover:bg-amber-100"
                        : isSelected
                        ? isDarkMode ? "bg-blue-950/25" : "bg-blue-50"
                        : isDarkMode ? "hover:bg-slate-800/30" : "hover:bg-slate-50"
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
                            : "border-slate-500 hover:border-slate-400"
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
                    <td className="py-2.5 px-3 font-mono text-[11px]">
                      {row.so}
                    </td>

                    {/* No Faktur with double / retur tags */}
                    <td className="py-2.5 px-3 font-mono font-bold flex items-center gap-1.5">
                      <span>{row.invoiceNumber}</span>
                      {row.isDouble && (
                        <span className="px-1 py-0.2 rounded text-[9px] font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30">
                          Double
                        </span>
                      )}
                      {row.isRetur && (
                        <span className="px-1 py-0.2 rounded text-[9px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">
                          Retur
                        </span>
                      )}
                    </td>

                    {/* Tgl Faktur */}
                    <td className={`py-2.5 px-3 font-mono text-[11px] font-semibold ${
                      isDarkMode ? "text-blue-400 bg-blue-950/10" : "text-blue-700 bg-blue-50/50"
                    }`}>
                      {row.txDate}
                    </td>

                    {/* Tgl Order */}
                    <td className={`py-2.5 px-3 font-mono text-[11px] font-semibold ${
                      isDarkMode ? "text-indigo-400 bg-indigo-950/10" : "text-indigo-700 bg-indigo-50/50"
                    }`}>
                      {row.orderDate}
                    </td>

                    {/* Pelanggan */}
                    <td className="py-2.5 px-3 font-semibold truncate max-w-sm">
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
                            : "bg-slate-700/30 text-slate-400 border border-slate-700"
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
                            ? "bg-cyan-500/15 text-cyan-400 border border-cyan-500/30"
                            : row.katProduk === "PREKURSOR"
                            ? "bg-purple-500/15 text-purple-400 border border-purple-500/30"
                            : row.katProduk === "OOT"
                            ? "bg-orange-500/15 text-orange-400 border border-orange-500/30"
                            : row.katProduk === "ALKES"
                            ? "bg-teal-500/15 text-teal-400 border border-teal-500/30"
                            : isDarkMode ? "bg-slate-800 text-slate-400" : "bg-slate-200 text-slate-600"
                        }`}
                      >
                        {row.katProduk}
                      </span>
                    </td>

                    {/* Total Nilai */}
                    <td className="py-2.5 px-4 text-right font-mono font-bold">
                      {row.isRetur ? (
                        <span className="text-amber-500">-Rp {formatRupiah(Math.abs(row.total))}</span>
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
                            ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/25"
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

        {/* Bottom Status Ribbon */}
        <footer className={`h-[30px] shrink-0 px-4 border-t flex items-center justify-between text-[11px] select-none ${
          isDarkMode ? "bg-[#0B101D] border-slate-800/80 text-slate-400" : "bg-slate-100 border-slate-200 text-slate-600"
        }`}>
          <div>
            Menampilkan <strong>{filtered.length}</strong> faktur aktif (Status: <span className="uppercase font-bold text-blue-500">{activeNav}</span>)
          </div>
          <div className="flex items-center gap-2">
            <span>Shortcut:</span>
            <kbd className="px-1 py-0.2 rounded bg-slate-800 border border-slate-700 text-slate-300 font-mono text-[9px]">↓/↑</kbd>
            <kbd className="px-1 py-0.2 rounded bg-slate-800 border border-slate-700 text-slate-300 font-mono text-[9px]">Space (Cetak)</kbd>
            <kbd className="px-1 py-0.2 rounded bg-slate-800 border border-slate-700 text-slate-300 font-mono text-[9px]">/ (Cari)</kbd>
          </div>
        </footer>
      </main>

      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* ─── FULL SETTINGS SIDEBAR DRAWER ─────────────────────────────────── */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      {showSettingsPanel && (
        <>
          <div
            className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-xs"
            onClick={() => setShowSettingsPanel(false)}
          />
          <div className={`fixed top-0 right-0 h-full w-80 z-50 shadow-2xl flex flex-col transition-all duration-200 border-l ${
            isDarkMode ? "bg-[#0D1528] border-slate-700 text-slate-100" : "bg-white border-slate-200 text-slate-900"
          }`}>
            {/* Header */}
            <div className={`px-5 py-4 border-b flex items-center justify-between ${
              isDarkMode ? "border-slate-800 bg-[#0B1120]" : "border-slate-100 bg-slate-50"
            }`}>
              <div className="flex items-center gap-2">
                <span className="text-base">⚙️</span>
                <span className="font-bold text-sm">Pengaturan Sistem</span>
              </div>
              <button
                type="button"
                onClick={() => setShowSettingsPanel(false)}
                className="w-7 h-7 rounded-md flex items-center justify-center text-xs font-bold text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Menu Items */}
            <div className="flex-1 overflow-y-auto py-3 px-4 space-y-1 text-xs">
              <p className="text-[10px] font-bold uppercase tracking-widest px-1 pb-1 pt-2 text-slate-400">
                Master Data
              </p>

              <button
                type="button"
                onClick={() => { setShowApotekModal(true); setShowSettingsPanel(false); }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg font-medium transition-colors text-left hover:bg-slate-800/60 cursor-pointer"
              >
                <span className="w-8 h-8 rounded-lg flex items-center justify-center text-base bg-slate-800 text-slate-300">🏢</span>
                <div>
                  <div className="font-semibold text-xs">Master Apotek</div>
                  <div className="text-[11px] text-slate-400">Kelola prioritas 1P / 2P / 3P</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => { setShowProductModal(true); setShowSettingsPanel(false); }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg font-medium transition-colors text-left hover:bg-slate-800/60 cursor-pointer"
              >
                <span className="w-8 h-8 rounded-lg flex items-center justify-center text-base bg-slate-800 text-slate-300">💊</span>
                <div>
                  <div className="font-semibold text-xs">Master Produk</div>
                  <div className="text-[11px] text-slate-400">Farma, CCP, Prekursor, OOT, Alkes</div>
                </div>
              </button>

              <div className="my-2 border-t border-slate-800" />

              <p className="text-[10px] font-bold uppercase tracking-widest px-1 pb-1 text-slate-400">
                Laporan & Ekspor
              </p>

              <button
                type="button"
                onClick={() => { setShowExportModal(true); setShowSettingsPanel(false); }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg font-medium transition-colors text-left hover:bg-slate-800/60 cursor-pointer"
              >
                <span className="w-8 h-8 rounded-lg flex items-center justify-center text-base bg-slate-800 text-slate-300">📥</span>
                <div>
                  <div className="font-semibold text-xs">Ekspor ke Excel</div>
                  <div className="text-[11px] text-slate-400">Filter tanggal SO vs Faktur (.xlsx)</div>
                </div>
              </button>

              <div className="my-2 border-t border-slate-800" />

              <p className="text-[10px] font-bold uppercase tracking-widest px-1 pb-1 text-slate-400">
                Tampilan & Akun
              </p>

              {/* Dark / Light Toggle */}
              <div className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-800/60">
                <span className="w-8 h-8 rounded-lg flex items-center justify-center text-base bg-slate-800 text-amber-400">
                  {isDarkMode ? "☀️" : "🌙"}
                </span>
                <div className="flex-1">
                  <div className="font-semibold text-xs">Mode Tampilan</div>
                  <div className="text-[11px] text-slate-400">{isDarkMode ? "Mode Gelap (Dark)" : "Mode Terang (Light)"}</div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsDarkMode(!isDarkMode)}
                  className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer ${isDarkMode ? "bg-blue-600" : "bg-slate-600"}`}
                >
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${isDarkMode ? "left-5" : "left-0.5"}`} />
                </button>
              </div>

              {/* Changelog */}
              <button
                type="button"
                onClick={() => { setShowChangelogModal(true); setShowSettingsPanel(false); }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg font-medium transition-colors text-left hover:bg-slate-800/60 cursor-pointer"
              >
                <span className="w-8 h-8 rounded-lg flex items-center justify-center text-base bg-blue-950/70 text-blue-400">📢</span>
                <div>
                  <div className="font-semibold text-xs">Info Pembaruan</div>
                  <div className="text-[11px] text-slate-400">Catatan perubahan v2.2</div>
                </div>
              </button>

              {/* Change Password */}
              <button
                type="button"
                onClick={() => { setShowChangePasswordModal(true); setShowSettingsPanel(false); }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg font-medium transition-colors text-left hover:bg-slate-800/60 cursor-pointer"
              >
                <span className="w-8 h-8 rounded-lg flex items-center justify-center text-base bg-slate-800 text-slate-300">🔑</span>
                <div>
                  <div className="font-semibold text-xs">Ganti Password</div>
                  <div className="text-[11px] text-slate-400">Ubah kredensial akun</div>
                </div>
              </button>
            </div>

            {/* Footer */}
            <div className={`px-5 py-3 border-t text-[11px] ${
              isDarkMode ? "border-slate-800 text-slate-500" : "border-slate-200 text-slate-400"
            }`}>
              Faktur Tracker v2.2 • Oracle ERP Live Tracker
            </div>
          </div>
        </>
      )}

      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* ─── FULL OPERATIONAL MODALS ───────────────────────────────────────── */}
      {/* ═════════════════════════════════════════════════════════════════════ */}

      {/* Master Apotek Modal */}
      {showApotekModal && (
        <MasterApotekModal
          isOpen={showApotekModal}
          onClose={() => setShowApotekModal(false)}
          categoryOverrides={{}}
          isDarkMode={isDarkMode}
        />
      )}

      {/* Master Product Modal */}
      {showProductModal && (
        <MasterProductModal
          isOpen={showProductModal}
          onClose={() => setShowProductModal(false)}
          productOverrides={{}}
          isDarkMode={isDarkMode}
        />
      )}

      {/* Export Excel Modal */}
      {showExportModal && (
        <ExportExcelModal
          isOpen={showExportModal}
          onClose={() => setShowExportModal(false)}
          groups={exportGroups}
          isDarkMode={isDarkMode}
        />
      )}

      {/* Login / Switch User Modal */}
      {showLoginModal && (
        <LoginModal
          isOpen={showLoginModal}
          onClose={() => setShowLoginModal(false)}
          onLogin={(u: AppUser) => {
            setCurrentUser(u);
            setShowLoginModal(false);
          }}
          currentUser={currentUser}
          isDarkMode={isDarkMode}
        />
      )}

      {/* Change Password Modal */}
      {showChangePasswordModal && (
        <ChangePasswordModal
          isOpen={showChangePasswordModal}
          onClose={() => setShowChangePasswordModal(false)}
          userName={currentUser?.name || "Admin Gudang"}
          isDarkMode={isDarkMode}
          onSuccess={() => {}}
        />
      )}

      {/* Changelog Modal */}
      {showChangelogModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs">
          <div className="max-w-md w-full rounded-2xl border border-slate-700 bg-[#0E1524] p-5 text-slate-100 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="font-bold text-sm flex items-center gap-2">
                <span>📢</span>
                <span>Info Pembaruan Sistem v2.2</span>
              </div>
              <button onClick={() => setShowChangelogModal(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>
            <div className="text-xs space-y-2 leading-relaxed text-slate-300">
              <p>• <strong>Arsitektur Baru:</strong> Sidebar Workspace navigasi instan untuk efisiensi operator gudang.</p>
              <p>• <strong>Dua Tanggal Berdampingan:</strong> Kolom Tanggal Faktur & Tanggal Order terpisah jelas.</p>
              <p>• <strong>Ekspor Excel Fleksibel:</strong> Mendukung penarikan berdasarkan Tanggal Masuk SO atau Tanggal Terfaktur.</p>
            </div>
            <button
              onClick={() => setShowChangelogModal(false)}
              className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold"
            >
              Tutup & Mengerti
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
