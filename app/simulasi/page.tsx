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

// ─── Customizer Configuration Interface ──────────────────────────────────────
interface UIConfig {
  layout: "sidebar" | "topbar" | "hybrid";
  theme: "obsidian" | "navy" | "zinc" | "light";
  accent: "blue" | "emerald" | "cyan" | "indigo" | "amber" | "rose";
  density: "compact" | "normal" | "spacious";
  kpiStyle: "sidebar-docked" | "ribbon-top" | "cards-grid" | "hidden";
  showTxDate: boolean;
  showOrderDate: boolean;
  showProductBadge: boolean;
  showCustomerName: boolean;
  showTotal: boolean;
}

const DEFAULT_CONFIG: UIConfig = {
  layout: "sidebar",
  theme: "obsidian",
  accent: "blue",
  density: "compact",
  kpiStyle: "sidebar-docked",
  showTxDate: true,
  showOrderDate: true,
  showProductBadge: true,
  showCustomerName: true,
  showTotal: true,
};

export default function SimulasiPage() {
  const [data, setData] = useState<MockFaktur[]>(INITIAL_MOCK_DATA);
  const [activeNav, setActiveNav] = useState<"belum" | "sudah" | "semua" | "double" | "retur">("belum");
  const [katFilter, setKatFilter] = useState<string>("all");
  const [jenisFilter, setJenisFilter] = useState<string>("all");
  const [klasFilter, setKlasFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>("1");

  // ─── Studio Customizer State ───────────────────────────────────────────────
  const [cfg, setCfg] = useState<UIConfig>(DEFAULT_CONFIG);
  const [showStudioDrawer, setShowStudioDrawer] = useState<boolean>(false);
  const [copiedConfig, setCopiedConfig] = useState<boolean>(false);

  // Settings & Modals State
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

  // Convert mock data for ExportExcelModal
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

  // ─── Dynamic Theme Colors ──────────────────────────────────────────────────
  const themeClasses = {
    obsidian: {
      bg: "bg-[#080C15]",
      surface: "bg-[#0A0F1D]",
      surface2: "bg-[#0E1524]",
      border: "border-slate-800/80",
      text: "text-slate-100",
      textMuted: "text-slate-400",
      tableHeader: "bg-[#0E1524] text-slate-400",
      isDark: true,
    },
    navy: {
      bg: "bg-[#070D1E]",
      surface: "bg-[#0B1530]",
      surface2: "bg-[#0F1E42]",
      border: "border-blue-900/60",
      text: "text-blue-50",
      textMuted: "text-blue-300/70",
      tableHeader: "bg-[#0E1B3D] text-blue-300",
      isDark: true,
    },
    zinc: {
      bg: "bg-[#121214]",
      surface: "bg-[#18181B]",
      surface2: "bg-[#202024]",
      border: "border-zinc-800",
      text: "text-zinc-100",
      textMuted: "text-zinc-400",
      tableHeader: "bg-[#1E1E22] text-zinc-400",
      isDark: true,
    },
    light: {
      bg: "bg-[#F8FAFC]",
      surface: "bg-white",
      surface2: "bg-slate-50",
      border: "border-slate-200",
      text: "text-slate-900",
      textMuted: "text-slate-500",
      tableHeader: "bg-slate-100 text-slate-700",
      isDark: false,
    },
  }[cfg.theme];

  const accentBtn = {
    blue: "bg-blue-600 hover:bg-blue-500 text-white shadow-blue-600/20",
    emerald: "bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/20",
    cyan: "bg-cyan-600 hover:bg-cyan-500 text-white shadow-cyan-600/20",
    indigo: "bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/20",
    amber: "bg-amber-600 hover:bg-amber-500 text-white shadow-amber-600/20",
    rose: "bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/20",
  }[cfg.accent];

  const tablePadding = {
    compact: "py-1.5 px-2.5",
    normal: "py-2.5 px-3",
    spacious: "py-3.5 px-4",
  }[cfg.density];

  // Presets
  const applyPreset = (name: string) => {
    if (name === "operator-pro") {
      setCfg({
        layout: "sidebar",
        theme: "obsidian",
        accent: "blue",
        density: "compact",
        kpiStyle: "sidebar-docked",
        showTxDate: true,
        showOrderDate: true,
        showProductBadge: true,
        showCustomerName: true,
        showTotal: true,
      });
    } else if (name === "stripe-clean") {
      setCfg({
        layout: "topbar",
        theme: "light",
        accent: "indigo",
        density: "normal",
        kpiStyle: "ribbon-top",
        showTxDate: true,
        showOrderDate: true,
        showProductBadge: true,
        showCustomerName: true,
        showTotal: true,
      });
    } else if (name === "financial-terminal") {
      setCfg({
        layout: "topbar",
        theme: "navy",
        accent: "cyan",
        density: "compact",
        kpiStyle: "ribbon-top",
        showTxDate: true,
        showOrderDate: true,
        showProductBadge: true,
        showCustomerName: true,
        showTotal: true,
      });
    } else if (name === "zen-minimal") {
      setCfg({
        layout: "sidebar",
        theme: "zinc",
        accent: "emerald",
        density: "compact",
        kpiStyle: "hidden",
        showTxDate: true,
        showOrderDate: true,
        showProductBadge: true,
        showCustomerName: true,
        showTotal: true,
      });
    }
  };

  const copyConfigJson = () => {
    navigator.clipboard.writeText(JSON.stringify(cfg, null, 2));
    setCopiedConfig(true);
    setTimeout(() => setCopiedConfig(false), 2000);
  };

  return (
    <div className={`flex h-screen w-screen overflow-hidden font-sans ${themeClasses.bg} ${themeClasses.text} transition-colors duration-150`}>

      {/* ─── FLOATING UI STUDIO TRIGGER (Always visible in bottom-right corner) ─── */}
      <div className="fixed bottom-4 right-4 z-50">
        <button
          type="button"
          onClick={() => setShowStudioDrawer(true)}
          className="px-3.5 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-xl shadow-blue-600/30 flex items-center gap-2 cursor-pointer transition-all hover:scale-105 active:scale-95 border border-white/20"
        >
          <span className="text-sm">🎨</span>
          <span>Desain Sendiri (Studio UI)</span>
        </button>
      </div>

      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* ─── LAYOUT MODE 1: SIDEBAR WORKSPACE ─────────────────────────────── */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      {cfg.layout === "sidebar" && (
        <aside className={`w-64 shrink-0 h-full border-r ${themeClasses.border} ${themeClasses.surface} flex flex-col justify-between select-none`}>
          {/* Top Brand & Actions */}
          <div className="p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={`w-6 h-6 rounded-md flex items-center justify-center font-mono font-black text-white text-xs shadow-xs ${accentBtn.split(" ")[0]}`}>
                  FT
                </div>
                <div>
                  <div className="font-extrabold text-xs font-mono tracking-tight leading-tight">
                    FAKTUR TRACKER
                  </div>
                  <div className={`text-[10px] font-medium ${themeClasses.textMuted}`}>
                    Gudang 1 • Cabang Pusat
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowOnlinePopover(!showOnlinePopover)}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[9px] text-emerald-400 font-semibold cursor-pointer"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span>4 ON</span>
              </button>
            </div>

            <button
              type="button"
              className={`w-full py-1.5 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-md ${accentBtn}`}
            >
              <span>+</span>
              <span>Upload Data XXCUST</span>
            </button>
          </div>

          {/* Navigation Lists */}
          <div className="flex-1 overflow-y-auto px-2 space-y-4 py-1 custom-scrollbar text-xs">
            <div>
              <div className={`px-2 pb-1 text-[9px] font-bold uppercase tracking-wider ${themeClasses.textMuted}`}>
                Antrean Cetak
              </div>
              <div className="space-y-0.5">
                <button
                  type="button"
                  onClick={() => setActiveNav("belum")}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                    activeNav === "belum"
                      ? "bg-blue-600/15 text-blue-400 border border-blue-500/30 font-bold"
                      : `${themeClasses.textMuted} hover:text-white hover:bg-slate-800/40`
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
                      : `${themeClasses.textMuted} hover:text-white hover:bg-slate-800/40`
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
                      : `${themeClasses.textMuted} hover:text-white hover:bg-slate-800/40`
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span>📑</span>
                    <span>Semua Faktur</span>
                  </div>
                  <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${themeClasses.surface2} ${themeClasses.textMuted}`}>
                    {stats.total}
                  </span>
                </button>
              </div>
            </div>

            <div>
              <div className={`px-2 pb-1 text-[9px] font-bold uppercase tracking-wider ${themeClasses.textMuted}`}>
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

            {/* Master Menu */}
            <div>
              <div className={`px-2 pb-1 text-[9px] font-bold uppercase tracking-wider ${themeClasses.textMuted}`}>
                Master & Pengaturan
              </div>
              <div className="space-y-0.5">
                <button
                  type="button"
                  onClick={() => setShowApotekModal(true)}
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg font-semibold transition-colors cursor-pointer text-left ${themeClasses.textMuted} hover:text-white`}
                >
                  <span>🏢</span>
                  <span>Master Apotek (1P/2P/3P)</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowProductModal(true)}
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg font-semibold transition-colors cursor-pointer text-left ${themeClasses.textMuted} hover:text-white`}
                >
                  <span>💊</span>
                  <span>Master Produk</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowSettingsPanel(true)}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg font-semibold transition-colors cursor-pointer text-left text-blue-400 hover:bg-blue-950/40"
                >
                  <span>⚙️</span>
                  <span>Panel Pengaturan</span>
                </button>
              </div>
            </div>

            {/* KPI Telemetry Widget in Sidebar (if enabled) */}
            {cfg.kpiStyle === "sidebar-docked" && (
              <div className="pt-2 border-t border-slate-800/80">
                <div className={`p-2.5 rounded-xl border ${themeClasses.border} ${themeClasses.surface2} space-y-2 text-[11px]`}>
                  <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    <span>Progresi Nomor</span>
                    <span className="text-blue-400 font-mono">SO: {stats.totalSO}</span>
                  </div>

                  <div className={`p-1.5 rounded-lg border ${themeClasses.border} ${themeClasses.surface}`}>
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

                  <div className={`p-1.5 rounded-lg border ${themeClasses.border} ${themeClasses.surface} space-y-1`}>
                    <div className="text-[10px] text-slate-400 font-semibold">DOO Nomor Max:</div>
                    <div className="grid grid-cols-3 gap-1 text-[10px] font-mono font-bold text-center">
                      <div className="p-0.5 rounded bg-slate-800/60 text-emerald-400">1P:{stats.max1PDoo}</div>
                      <div className="p-0.5 rounded bg-slate-800/60 text-sky-300">2P:{stats.max2P}</div>
                      <div className="p-0.5 rounded bg-slate-800/60 text-purple-300">3P:{stats.max3P}</div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Sidebar Footer User */}
          <div className={`p-3 border-t ${themeClasses.border} ${themeClasses.surface} space-y-2`}>
            <Link
              href="/"
              className={`w-full text-center block py-1 rounded text-[11px] font-semibold transition-colors ${themeClasses.textMuted} hover:text-white`}
            >
              ← Kembali ke Sistem Utama
            </Link>
            <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-800/60">
              <button
                type="button"
                onClick={() => setShowLoginModal(true)}
                className="flex items-center gap-2 text-left cursor-pointer hover:opacity-80 transition-opacity"
              >
                <div className="w-6 h-6 rounded-md bg-blue-600/30 border border-blue-500/40 flex items-center justify-center text-[10px] font-bold text-blue-300">
                  👤
                </div>
                <div>
                  <div className="font-bold text-[11px] leading-tight flex items-center gap-1">
                    <span>{currentUser?.name || "Admin"}</span>
                    <span className="text-[9px] text-blue-400 underline">Ganti</span>
                  </div>
                  <div className={`text-[9px] ${themeClasses.textMuted}`}>
                    {currentUser?.role === "admin" ? "Pencetak Aktif" : "Hanya Lihat"}
                  </div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setShowSettingsPanel(true)}
                className="p-1.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 cursor-pointer"
              >
                ⚙️
              </button>
            </div>
          </div>
        </aside>
      )}

      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* ─── MAIN RIGHT CANVAS / FULL BODY ─────────────────────────────────── */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      <main className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Top Header Bar */}
        <header className={`h-[52px] shrink-0 px-4 border-b ${themeClasses.border} ${themeClasses.surface} flex items-center justify-between gap-3`}>
          {/* Left: View Title or Brand if Topbar mode */}
          <div className="flex items-center gap-3">
            {cfg.layout !== "sidebar" && (
              <div className="flex items-center gap-2 mr-2">
                <div className={`w-6 h-6 rounded-md flex items-center justify-center font-mono font-black text-white text-xs ${accentBtn.split(" ")[0]}`}>
                  FT
                </div>
                <span className="font-extrabold text-xs font-mono tracking-tight">FAKTUR TRACKER</span>
              </div>
            )}
            <div>
              <h1 className="text-sm font-extrabold tracking-tight flex items-center gap-2">
                <span className={activeNavTitle.color}>{activeNavTitle.title}</span>
                <span className={`text-xs ${themeClasses.textMuted} font-normal`}>({filtered.length} Faktur)</span>
              </h1>
              <p className={`text-[10px] ${themeClasses.textMuted}`}>{activeNavTitle.subtitle}</p>
            </div>
          </div>

          {/* Right Toolbar Controls */}
          <div className="flex items-center gap-2">
            <div className="relative w-40 sm:w-48">
              <span className="absolute left-2.5 top-1.5 text-xs text-slate-500">🔍</span>
              <input
                type="text"
                placeholder="Cari SO, Faktur... (/)"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className={`w-full pl-7 pr-2.5 py-1 rounded-md text-xs outline-hidden ${themeClasses.surface2} border ${themeClasses.border}`}
              />
            </div>

            <select
              value={jenisFilter}
              onChange={(e) => setJenisFilter(e.target.value)}
              className={`px-2 py-1 rounded-md text-xs outline-hidden ${themeClasses.surface2} border ${themeClasses.border}`}
            >
              <option value="all">Semua Jenis</option>
              <option value="ORA">Khusus ORA</option>
              <option value="DOO">Khusus DOO</option>
            </select>

            <select
              value={katFilter}
              onChange={(e) => setKatFilter(e.target.value)}
              className={`px-2 py-1 rounded-md text-xs outline-hidden ${themeClasses.surface2} border ${themeClasses.border}`}
            >
              <option value="all">Semua Kat</option>
              <option value="1P">1P</option>
              <option value="2P">2P</option>
              <option value="3P">3P</option>
            </select>

            <button
              type="button"
              onClick={() => setShowExportModal(true)}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold border ${themeClasses.border} ${themeClasses.surface2} hover:opacity-80 transition-colors flex items-center gap-1 cursor-pointer`}
            >
              <span>📥</span>
              <span className="hidden sm:inline">Ekspor Excel</span>
            </button>

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

        {/* ─── OPTIONAL TOP KPI RIBBON (If configured) ────────────────────── */}
        {cfg.kpiStyle === "ribbon-top" && (
          <div className={`px-4 py-2 border-b ${themeClasses.border} ${themeClasses.surface2} flex flex-wrap items-center justify-between gap-3 text-xs`}>
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5 font-bold">
                <span className="text-slate-400">Total SO:</span>
                <span className="font-mono text-white">{stats.totalSO}</span>
              </span>
              <span className="flex items-center gap-1.5 font-bold text-amber-400">
                <span>Belum Print:</span>
                <span className="font-mono">{stats.belum}</span>
              </span>
              <span className="flex items-center gap-1.5 font-bold text-emerald-400">
                <span>Selesai:</span>
                <span className="font-mono">{stats.sudah}</span>
              </span>
              {stats.double > 0 && (
                <span className="flex items-center gap-1.5 font-bold text-rose-400">
                  <span>Double INV:</span>
                  <span className="font-mono">{stats.double}</span>
                </span>
              )}
              {stats.retur > 0 && (
                <span className="flex items-center gap-1.5 font-bold text-amber-400">
                  <span>Retur:</span>
                  <span className="font-mono">{stats.retur}</span>
                </span>
              )}
            </div>

            <div className="flex items-center gap-3 text-[11px] font-mono text-slate-400">
              <span className="text-sky-300">ORA Max: {stats.maxOra}</span>
              <span>•</span>
              <span className="text-emerald-300">1P DOO: {stats.max1PDoo}</span>
              <span className="text-sky-200">2P: {stats.max2P}</span>
              <span className="text-purple-200">3P: {stats.max3P}</span>
            </div>
          </div>
        )}

        {/* ─── OPTIONAL CLASSIC TOP CARDS GRID (If configured) ────────────── */}
        {cfg.kpiStyle === "cards-grid" && (
          <div className={`p-3 border-b ${themeClasses.border} ${themeClasses.surface2} grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-1.5`}>
            <div className={`p-2 rounded-lg border ${themeClasses.border} ${themeClasses.surface}`}>
              <div className="text-[10px] uppercase font-bold text-slate-400">Total SO</div>
              <div className="text-base font-black font-mono mt-0.5">{stats.totalSO}</div>
            </div>
            <div className={`p-2 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-300`}>
              <div className="text-[10px] uppercase font-bold text-amber-400">Belum Print</div>
              <div className="text-base font-black font-mono mt-0.5">{stats.belum}</div>
            </div>
            <div className={`p-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-300`}>
              <div className="text-[10px] uppercase font-bold text-emerald-400">Selesai</div>
              <div className="text-base font-black font-mono mt-0.5">{stats.sudah}</div>
            </div>
            <div className={`p-2 rounded-lg border ${themeClasses.border} ${themeClasses.surface}`}>
              <div className="text-[10px] uppercase font-bold text-slate-400">Total Faktur</div>
              <div className="text-base font-black font-mono mt-0.5">{stats.total}</div>
            </div>
            <div className={`p-2 rounded-lg border ${stats.double > 0 ? "border-rose-500/40 bg-rose-500/10 text-rose-300" : `${themeClasses.border} ${themeClasses.surface}`}`}>
              <div className="text-[10px] uppercase font-bold">Double INV</div>
              <div className="text-base font-black font-mono mt-0.5">{stats.double}</div>
            </div>
            <div className={`p-2 rounded-lg border ${stats.retur > 0 ? "border-amber-500/40 bg-amber-500/10 text-amber-300" : `${themeClasses.border} ${themeClasses.surface}`}`}>
              <div className="text-[10px] uppercase font-bold">Retur</div>
              <div className="text-base font-black font-mono mt-0.5">{stats.retur}</div>
            </div>
            <div className={`p-2 rounded-lg border border-sky-500/30 bg-sky-950/20 text-sky-200`}>
              <div className="text-[10px] uppercase font-bold text-sky-400">1P ORA Max</div>
              <div className="text-xs font-bold font-mono mt-0.5">{stats.maxOra}</div>
            </div>
            <div className={`p-2 rounded-lg border border-indigo-500/30 bg-indigo-950/20 text-indigo-200`}>
              <div className="text-[10px] uppercase font-bold text-indigo-400">DOO Max</div>
              <div className="text-[10px] font-mono font-bold mt-0.5">1P:{stats.max1PDoo}</div>
            </div>
          </div>
        )}

        {/* ─── DATA TABLE CANVAS (100% Full Height) ───────────────────────── */}
        <div className="flex-1 overflow-auto custom-scrollbar">
          <table className="w-full text-left text-xs border-collapse">
            <thead className={`sticky top-0 z-20 border-b ${themeClasses.border} ${themeClasses.tableHeader} text-[11px] font-bold uppercase tracking-wider select-none shadow-xs`}>
              <tr>
                <th className={`${tablePadding} w-10 text-center`}>Status</th>
                <th className={`${tablePadding} w-14 text-center`}>Jenis</th>
                <th className={`${tablePadding} w-24`}>No SO</th>
                <th className={`${tablePadding} w-28`}>No Faktur</th>
                {cfg.showTxDate && (
                  <th className={`${tablePadding} w-28 bg-blue-950/20 text-blue-300 font-semibold`}>
                    Tgl Faktur
                  </th>
                )}
                {cfg.showOrderDate && (
                  <th className={`${tablePadding} w-28 bg-indigo-950/20 text-indigo-300 font-semibold`}>
                    Tgl Order
                  </th>
                )}
                {cfg.showCustomerName && (
                  <th className={`${tablePadding}`}>Nama Pelanggan</th>
                )}
                <th className={`${tablePadding} w-14 text-center`}>Kat</th>
                {cfg.showProductBadge && (
                  <th className={`${tablePadding} w-24 text-center`}>Produk</th>
                )}
                {cfg.showTotal && (
                  <th className={`${tablePadding} w-32 text-right`}>Total (+PPN)</th>
                )}
                <th className={`${tablePadding} w-32 text-center`}>Aksi / Cetak</th>
              </tr>
            </thead>

            <tbody className={`divide-y ${themeClasses.border} font-medium`}>
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
                        ? "bg-amber-950/20 hover:bg-amber-950/30"
                        : isSelected
                        ? "bg-blue-950/25"
                        : "hover:bg-slate-800/30"
                    }`}
                  >
                    <td className={`${tablePadding} text-center`}>
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

                    <td className={`${tablePadding} text-center`}>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold font-mono ${
                        row.jenis === "ORA" ? "bg-sky-500/15 text-sky-400 border border-sky-500/30" : "bg-indigo-500/15 text-indigo-400 border border-indigo-500/30"
                      }`}>
                        {row.jenis}
                      </span>
                    </td>

                    <td className={`${tablePadding} font-mono text-[11px]`}>
                      {row.so}
                    </td>

                    <td className={`${tablePadding} font-mono font-bold flex items-center gap-1.5`}>
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

                    {cfg.showTxDate && (
                      <td className={`${tablePadding} font-mono text-[11px] font-semibold text-blue-400 bg-blue-950/10`}>
                        {row.txDate}
                      </td>
                    )}

                    {cfg.showOrderDate && (
                      <td className={`${tablePadding} font-mono text-[11px] font-semibold text-indigo-400 bg-indigo-950/10`}>
                        {row.orderDate}
                      </td>
                    )}

                    {cfg.showCustomerName && (
                      <td className={`${tablePadding} font-semibold truncate max-w-sm`}>
                        {row.customer}
                      </td>
                    )}

                    <td className={`${tablePadding} text-center`}>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        row.kat === "1P" ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30" : row.kat === "2P" ? "bg-sky-500/15 text-sky-400 border border-sky-500/30" : "bg-slate-700/30 text-slate-400 border border-slate-700"
                      }`}>
                        {row.kat}
                      </span>
                    </td>

                    {cfg.showProductBadge && (
                      <td className={`${tablePadding} text-center`}>
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider ${
                          row.katProduk === "CCP" ? "bg-cyan-500/15 text-cyan-400 border border-cyan-500/30" : row.katProduk === "PREKURSOR" ? "bg-purple-500/15 text-purple-400 border border-purple-500/30" : row.katProduk === "OOT" ? "bg-orange-500/15 text-orange-400 border border-orange-500/30" : "bg-slate-800 text-slate-400"
                        }`}>
                          {row.katProduk}
                        </span>
                      </td>
                    )}

                    {cfg.showTotal && (
                      <td className={`${tablePadding} text-right font-mono font-bold`}>
                        {row.isRetur ? (
                          <span className="text-amber-500">-Rp {formatRupiah(Math.abs(row.total))}</span>
                        ) : (
                          `Rp ${formatRupiah(row.total)}`
                        )}
                      </td>
                    )}

                    <td className={`${tablePadding} text-center`}>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          togglePrint(row.id);
                        }}
                        className={`px-2.5 py-1 rounded-md text-[10px] font-bold border transition-all cursor-pointer ${
                          row.printed
                            ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/25"
                            : `${accentBtn.split(" ")[0]} border-transparent text-white hover:opacity-90`
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
        <footer className={`h-[30px] shrink-0 px-4 border-t ${themeClasses.border} ${themeClasses.surface} flex items-center justify-between text-[11px] ${themeClasses.textMuted} select-none`}>
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
      {/* ─── LIVE UI STUDIO DRAWER (Panel Desain Sendiri) ─────────────────── */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      {showStudioDrawer && (
        <>
          <div
            className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs"
            onClick={() => setShowStudioDrawer(false)}
          />
          <div className="fixed top-0 right-0 h-full w-96 z-50 shadow-2xl flex flex-col bg-[#0D1528] border-l border-slate-700 text-slate-100 animate-in slide-in-from-right duration-200">
            {/* Header */}
            <div className="px-5 py-4 border-b border-slate-800 bg-[#0B1120] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="text-xl">🎨</span>
                <div>
                  <h2 className="font-extrabold text-sm text-white">Studio Desain UI</h2>
                  <p className="text-[11px] text-slate-400">Sesuaikan tampilan langsung sesuai selera Anda</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowStudioDrawer(false)}
                className="w-7 h-7 rounded-md flex items-center justify-center text-xs font-bold text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Body Controls */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs custom-scrollbar">
              {/* 1. Quick Presets */}
              <div className="p-3 rounded-xl border border-slate-800 bg-[#0E1524] space-y-2">
                <span className="font-bold text-[10px] uppercase tracking-wider text-slate-400">
                  ⚡ Preset Cepat:
                </span>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => applyPreset("operator-pro")}
                    className="p-2 rounded-lg border border-slate-700 hover:border-blue-500 bg-slate-800/60 text-left cursor-pointer"
                  >
                    <div className="font-bold text-slate-200">Operator Pro</div>
                    <div className="text-[10px] text-slate-400">Sidebar + Dark Obsidian</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => applyPreset("stripe-clean")}
                    className="p-2 rounded-lg border border-slate-700 hover:border-indigo-500 bg-slate-800/60 text-left cursor-pointer"
                  >
                    <div className="font-bold text-slate-200">Stripe Clean</div>
                    <div className="text-[10px] text-slate-400">Top Bar + Off-White</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => applyPreset("financial-terminal")}
                    className="p-2 rounded-lg border border-slate-700 hover:border-cyan-500 bg-slate-800/60 text-left cursor-pointer"
                  >
                    <div className="font-bold text-slate-200">Financial Cockpit</div>
                    <div className="text-[10px] text-slate-400">Navy + Ribbon + Cyan</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => applyPreset("zen-minimal")}
                    className="p-2 rounded-lg border border-slate-700 hover:border-emerald-500 bg-slate-800/60 text-left cursor-pointer"
                  >
                    <div className="font-bold text-slate-200">Zen Minimal</div>
                    <div className="text-[10px] text-slate-400">No Cards + Max Table</div>
                  </button>
                </div>
              </div>

              {/* 2. Layout Structure */}
              <div className="space-y-1.5">
                <label className="font-bold text-[10px] uppercase tracking-wider text-slate-400">
                  1. Tata Letak Navigasi (Layout):
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setCfg((prev) => ({ ...prev, layout: "sidebar" }))}
                    className={`py-2 px-1 text-center rounded-lg border font-bold cursor-pointer transition-all ${
                      cfg.layout === "sidebar"
                        ? "bg-blue-600 border-blue-500 text-white shadow-xs"
                        : "border-slate-700 bg-slate-800/60 text-slate-300 hover:bg-slate-800"
                    }`}
                  >
                    Sidebar Kiri
                  </button>

                  <button
                    type="button"
                    onClick={() => setCfg((prev) => ({ ...prev, layout: "topbar" }))}
                    className={`py-2 px-1 text-center rounded-lg border font-bold cursor-pointer transition-all ${
                      cfg.layout === "topbar"
                        ? "bg-blue-600 border-blue-500 text-white shadow-xs"
                        : "border-slate-700 bg-slate-800/60 text-slate-300 hover:bg-slate-800"
                    }`}
                  >
                    Top Bar
                  </button>

                  <button
                    type="button"
                    onClick={() => setCfg((prev) => ({ ...prev, layout: "hybrid" }))}
                    className={`py-2 px-1 text-center rounded-lg border font-bold cursor-pointer transition-all ${
                      cfg.layout === "hybrid"
                        ? "bg-blue-600 border-blue-500 text-white shadow-xs"
                        : "border-slate-700 bg-slate-800/60 text-slate-300 hover:bg-slate-800"
                    }`}
                  >
                    Command Full
                  </button>
                </div>
              </div>

              {/* 3. Theme Colors */}
              <div className="space-y-1.5">
                <label className="font-bold text-[10px] uppercase tracking-wider text-slate-400">
                  2. Warna Latar Belakang (Background Theme):
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setCfg((prev) => ({ ...prev, theme: "obsidian" }))}
                    className={`p-2 rounded-lg border flex items-center gap-2 cursor-pointer ${
                      cfg.theme === "obsidian" ? "border-blue-500 ring-2 ring-blue-500/30 bg-[#080C15]" : "border-slate-700 bg-[#080C15]"
                    }`}
                  >
                    <span className="w-3.5 h-3.5 rounded-full bg-[#080C15] border border-white/40" />
                    <span className="font-bold text-slate-200">Obsidian Dark</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setCfg((prev) => ({ ...prev, theme: "navy" }))}
                    className={`p-2 rounded-lg border flex items-center gap-2 cursor-pointer ${
                      cfg.theme === "navy" ? "border-blue-500 ring-2 ring-blue-500/30 bg-[#070D1E]" : "border-slate-700 bg-[#070D1E]"
                    }`}
                  >
                    <span className="w-3.5 h-3.5 rounded-full bg-[#0B1530] border border-blue-400" />
                    <span className="font-bold text-blue-200">Midnight Navy</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setCfg((prev) => ({ ...prev, theme: "zinc" }))}
                    className={`p-2 rounded-lg border flex items-center gap-2 cursor-pointer ${
                      cfg.theme === "zinc" ? "border-blue-500 ring-2 ring-blue-500/30 bg-[#121214]" : "border-slate-700 bg-[#121214]"
                    }`}
                  >
                    <span className="w-3.5 h-3.5 rounded-full bg-[#18181B] border border-zinc-500" />
                    <span className="font-bold text-zinc-200">Graphite Zinc</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setCfg((prev) => ({ ...prev, theme: "light" }))}
                    className={`p-2 rounded-lg border flex items-center gap-2 cursor-pointer ${
                      cfg.theme === "light" ? "border-blue-500 ring-2 ring-blue-500/30 bg-white" : "border-slate-700 bg-white"
                    }`}
                  >
                    <span className="w-3.5 h-3.5 rounded-full bg-slate-100 border border-slate-300" />
                    <span className="font-bold text-slate-900">Studio Light</span>
                  </button>
                </div>
              </div>

              {/* 4. Accent Color */}
              <div className="space-y-1.5">
                <label className="font-bold text-[10px] uppercase tracking-wider text-slate-400">
                  3. Warna Aksen Tombol (Accent Color):
                </label>
                <div className="flex items-center gap-2">
                  {(["blue", "emerald", "cyan", "indigo", "amber", "rose"] as const).map((col) => (
                    <button
                      key={col}
                      type="button"
                      onClick={() => setCfg((prev) => ({ ...prev, accent: col }))}
                      className={`w-8 h-8 rounded-full border-2 transition-transform cursor-pointer ${
                        cfg.accent === col ? "scale-110 border-white ring-2 ring-white/30" : "border-transparent opacity-75 hover:opacity-100"
                      } ${
                        col === "blue" ? "bg-blue-600" : col === "emerald" ? "bg-emerald-600" : col === "cyan" ? "bg-cyan-600" : col === "indigo" ? "bg-indigo-600" : col === "amber" ? "bg-amber-600" : "bg-rose-600"
                      }`}
                    />
                  ))}
                </div>
              </div>

              {/* 5. Density */}
              <div className="space-y-1.5">
                <label className="font-bold text-[10px] uppercase tracking-wider text-slate-400">
                  4. Kerapatan Baris Tabel (Data Density):
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setCfg((prev) => ({ ...prev, density: "compact" }))}
                    className={`py-2 px-1 text-center rounded-lg border font-bold cursor-pointer ${
                      cfg.density === "compact" ? "bg-blue-600 border-blue-500 text-white" : "border-slate-700 bg-slate-800/60 text-slate-300"
                    }`}
                  >
                    Padat (28px)
                  </button>

                  <button
                    type="button"
                    onClick={() => setCfg((prev) => ({ ...prev, density: "normal" }))}
                    className={`py-2 px-1 text-center rounded-lg border font-bold cursor-pointer ${
                      cfg.density === "normal" ? "bg-blue-600 border-blue-500 text-white" : "border-slate-700 bg-slate-800/60 text-slate-300"
                    }`}
                  >
                    Standar (36px)
                  </button>

                  <button
                    type="button"
                    onClick={() => setCfg((prev) => ({ ...prev, density: "spacious" }))}
                    className={`py-2 px-1 text-center rounded-lg border font-bold cursor-pointer ${
                      cfg.density === "spacious" ? "bg-blue-600 border-blue-500 text-white" : "border-slate-700 bg-slate-800/60 text-slate-300"
                    }`}
                  >
                    Lega (44px)
                  </button>
                </div>
              </div>

              {/* 6. KPI Style */}
              <div className="space-y-1.5">
                <label className="font-bold text-[10px] uppercase tracking-wider text-slate-400">
                  5. Penempatan Kartu Metrik / Telemetri:
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setCfg((prev) => ({ ...prev, kpiStyle: "sidebar-docked" }))}
                    className={`p-2 rounded-lg border font-bold text-left cursor-pointer ${
                      cfg.kpiStyle === "sidebar-docked" ? "bg-blue-600 border-blue-500 text-white" : "border-slate-700 bg-slate-800/60 text-slate-300"
                    }`}
                  >
                    Di Sidebar Kiri
                  </button>

                  <button
                    type="button"
                    onClick={() => setCfg((prev) => ({ ...prev, kpiStyle: "ribbon-top" }))}
                    className={`p-2 rounded-lg border font-bold text-left cursor-pointer ${
                      cfg.kpiStyle === "ribbon-top" ? "bg-blue-600 border-blue-500 text-white" : "border-slate-700 bg-slate-800/60 text-slate-300"
                    }`}
                  >
                    Pita Tipis Atas
                  </button>

                  <button
                    type="button"
                    onClick={() => setCfg((prev) => ({ ...prev, kpiStyle: "cards-grid" }))}
                    className={`p-2 rounded-lg border font-bold text-left cursor-pointer ${
                      cfg.kpiStyle === "cards-grid" ? "bg-blue-600 border-blue-500 text-white" : "border-slate-700 bg-slate-800/60 text-slate-300"
                    }`}
                  >
                    Kotak Grid Atas
                  </button>

                  <button
                    type="button"
                    onClick={() => setCfg((prev) => ({ ...prev, kpiStyle: "hidden" }))}
                    className={`p-2 rounded-lg border font-bold text-left cursor-pointer ${
                      cfg.kpiStyle === "hidden" ? "bg-blue-600 border-blue-500 text-white" : "border-slate-700 bg-slate-800/60 text-slate-300"
                    }`}
                  >
                    Sembunyikan (0 Kartu)
                  </button>
                </div>
              </div>

              {/* 7. Column Toggles */}
              <div className="space-y-1.5">
                <label className="font-bold text-[10px] uppercase tracking-wider text-slate-400">
                  6. Kolom Tabel yang Ditampilkan:
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={cfg.showTxDate}
                      onChange={(e) => setCfg((prev) => ({ ...prev, showTxDate: e.target.checked }))}
                    />
                    <span>Tgl Faktur</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={cfg.showOrderDate}
                      onChange={(e) => setCfg((prev) => ({ ...prev, showOrderDate: e.target.checked }))}
                    />
                    <span>Tgl Order (SO)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={cfg.showProductBadge}
                      onChange={(e) => setCfg((prev) => ({ ...prev, showProductBadge: e.target.checked }))}
                    />
                    <span>Kategori Produk</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={cfg.showTotal}
                      onChange={(e) => setCfg((prev) => ({ ...prev, showTotal: e.target.checked }))}
                    />
                    <span>Total Rupiah</span>
                  </label>
                </div>
              </div>
            </div>

            {/* Footer: Copy / Apply */}
            <div className="p-4 border-t border-slate-800 bg-[#0B1120] space-y-2">
              <button
                type="button"
                onClick={copyConfigJson}
                className="w-full py-2 px-3 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <span>📋</span>
                <span>{copiedConfig ? "✓ Konfigurasi Tersalin!" : "Salin Kode Konfigurasi"}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowStudioDrawer(false);
                  alert("Desain Anda sedang aktif di simulasi ini! Anda bisa mengklik tombol 'Salin Kode Konfigurasi' lalu kirimkan ke saya jika ingin diterapkan permanen ke sistem utama.");
                }}
                className={`w-full py-2 px-3 rounded-xl text-xs font-bold cursor-pointer ${accentBtn}`}
              >
                Terapkan di Layar Ini
              </button>
            </div>
          </div>
        </>
      )}

      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* ─── FULL OPERATIONAL MODALS ───────────────────────────────────────── */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      {showApotekModal && (
        <MasterApotekModal
          isOpen={showApotekModal}
          onClose={() => setShowApotekModal(false)}
          categoryOverrides={{}}
          isDarkMode={themeClasses.isDark}
        />
      )}

      {showProductModal && (
        <MasterProductModal
          isOpen={showProductModal}
          onClose={() => setShowProductModal(false)}
          productOverrides={{}}
          isDarkMode={themeClasses.isDark}
        />
      )}

      {showExportModal && (
        <ExportExcelModal
          isOpen={showExportModal}
          onClose={() => setShowExportModal(false)}
          groups={exportGroups}
          isDarkMode={themeClasses.isDark}
        />
      )}

      {showLoginModal && (
        <LoginModal
          isOpen={showLoginModal}
          onClose={() => setShowLoginModal(false)}
          onLogin={(u: AppUser) => {
            setCurrentUser(u);
            setShowLoginModal(false);
          }}
          currentUser={currentUser}
          isDarkMode={themeClasses.isDark}
        />
      )}

      {showChangePasswordModal && (
        <ChangePasswordModal
          isOpen={showChangePasswordModal}
          onClose={() => setShowChangePasswordModal(false)}
          userName={currentUser?.name || "Admin Gudang"}
          isDarkMode={themeClasses.isDark}
          onSuccess={() => {}}
        />
      )}
    </div>
  );
}
