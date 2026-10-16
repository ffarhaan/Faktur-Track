"use client";

import { useState, useMemo } from "react";
import * as XLSX from "xlsx";
import { FakturGroup } from "@/lib/types";

interface ExportExcelModalProps {
  isOpen: boolean;
  onClose: () => void;
  groups: FakturGroup[];
  isDarkMode?: boolean;
}

function parseInvNum(inv: string): number {
  if (!inv) return 0;
  const s = String(inv).trim().replace(/-1P$/i, "");
  const n = parseInt(s.replace(/\D/g, ""), 10);
  return isNaN(n) ? 0 : n;
}

function orderDateToIso(dStr: string): string | null {
  if (!dStr || dStr === "-" || dStr === "0") return null;
  const s = String(dStr).trim();
  const mSlash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mSlash) {
    const pad = (n: number | string) => String(n).padStart(2, "0");
    return `${mSlash[3]}-${pad(mSlash[2])}-${pad(mSlash[1])}`;
  }
  const mIso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (mIso) {
    const pad = (n: number | string) => String(n).padStart(2, "0");
    return `${mIso[1]}-${pad(mIso[2])}-${pad(mIso[3])}`;
  }
  return null;
}

function isoToDisplayDate(iso: string): string {
  if (!iso) return "-";
  const parts = iso.split("-");
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return iso;
}

function formatPrintTime(dStr?: string | null): string {
  if (!dStr) return "-";
  try {
    const d = new Date(dStr);
    if (isNaN(d.getTime())) return dStr;
    const pad = (n: number) => String(n).padStart(2, "0");
    const day = pad(d.getDate());
    const month = pad(d.getMonth() + 1);
    const year = d.getFullYear();
    const hours = pad(d.getHours());
    const minutes = pad(d.getMinutes());
    const seconds = pad(d.getSeconds());
    return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
  } catch {
    return dStr;
  }
}

function formatRupiah(n: number): string {
  if (typeof n !== "number" || isNaN(n)) return "0";
  return new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

export default function ExportExcelModal({
  isOpen,
  onClose,
  groups,
  isDarkMode,
}: ExportExcelModalProps) {
  // dateBasis: "order" = Berdasarkan Tanggal Masuk SO; "transaction" = Berdasarkan Tanggal Faktur Terbit (Tx)
  const [dateBasis, setDateBasis] = useState<"order" | "transaction">("order");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<"all" | "printed" | "unprinted">("all");
  const [jenisFilter, setJenisFilter] = useState<"all" | "ORA" | "DOO">("all");
  const [katFilter, setKatFilter] = useState<"all" | "1P" | "2P" | "3P">("all");

  // Find date range from groups to provide smart defaults based on selected dateBasis
  const availableDates = useMemo(() => {
    const isoDates: string[] = [];
    groups.forEach((g) => {
      const dStr = dateBasis === "transaction" ? (g.transactionDate || g.orderDate) : g.orderDate;
      const iso = orderDateToIso(dStr);
      if (iso) isoDates.push(iso);
    });
    isoDates.sort();
    return {
      min: isoDates.length > 0 ? isoDates[0] : "",
      max: isoDates.length > 0 ? isoDates[isoDates.length - 1] : "",
    };
  }, [groups, dateBasis]);

  // Filter matching data in real-time
  const matchingData = useMemo(() => {
    return groups.filter((g) => {
      // Date Range Filter based on selected dateBasis
      if (startDate || endDate) {
        const dStr = dateBasis === "transaction" ? (g.transactionDate || g.orderDate) : g.orderDate;
        const itemIso = orderDateToIso(dStr);
        if (!itemIso) return false;
        if (startDate && itemIso < startDate) return false;
        if (endDate && itemIso > endDate) return false;
      }
      // Status Filter
      if (statusFilter === "printed" && !g.allPrinted) return false;
      if (statusFilter === "unprinted" && g.allPrinted) return false;
      // Jenis Filter
      if (jenisFilter !== "all" && g.jenisTransaksi !== jenisFilter) return false;
      // Kategori Filter
      if (katFilter !== "all" && g.kategori !== katFilter) return false;

      return true;
    });
  }, [groups, dateBasis, startDate, endDate, statusFilter, jenisFilter, katFilter]);

  // Count unique Sales Orders (SO) in matching data
  const uniqueSoCount = useMemo(() => {
    const set = new Set<string>();
    matchingData.forEach((g) => {
      const s = String(g.so || "").trim();
      if (s && s !== "-") set.add(s);
    });
    return set.size;
  }, [matchingData]);

  const totalNilai = useMemo(() => {
    return matchingData.reduce((acc, curr) => acc + ((curr.totalHarga || 0) * 1.11), 0);
  }, [matchingData]);

  // Quick Preset Handlers (using local time to prevent UTC date shift)
  const handlePresetAll = () => {
    setStartDate("");
    setEndDate("");
  };

  const handlePresetToday = () => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    setStartDate(today);
    setEndDate(today);
  };

  const handlePreset7Days = () => {
    const now = new Date();
    const past = new Date();
    past.setDate(now.getDate() - 7);
    const pad = (n: number) => String(n).padStart(2, "0");
    setStartDate(`${past.getFullYear()}-${pad(past.getMonth() + 1)}-${pad(past.getDate())}`);
    setEndDate(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`);
  };

  const handlePresetThisMonth = () => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    setStartDate(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`);
    setEndDate(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`);
  };

  const handleDownload = () => {
    if (matchingData.length === 0) {
      alert("Tidak ada data faktur yang sesuai dengan rentang tanggal dan kriteria filter.");
      return;
    }

    const sortedForExport = [...matchingData].sort((a, b) => {
      const na = parseInvNum(a.invoiceNumber);
      const nb = parseInvNum(b.invoiceNumber);
      return na - nb; // Ascending order
    });

    const rows = sortedForExport.map((g, idx) => {
      const dpp = Math.round((g.totalHarga || 0) * 100) / 100;
      const ppn = Math.round(dpp * 0.11 * 100) / 100;
      const grandTotal = Math.round(dpp * 1.11 * 100) / 100;

      return {
        No: idx + 1,
        "No SO": g.so,
        "No Invoice": g.invoiceNumber,
        "Tanggal Order (SO)": g.orderDate || "-",
        "Tanggal Faktur (Tx)": g.transactionDate && g.transactionDate !== "-" ? g.transactionDate : g.orderDate || "-",
        "Kat Produk": g.kategoriProduk,
        "Jenis Transaksi": g.jenisTransaksi,
        Pelanggan: g.customerName,
        Kategori: g.kategori,
        "Status Cetak": g.allPrinted ? "Sudah Terprint" : "Belum Terprint",
        "Waktu Cetak": g.allPrinted && g.printedAt ? formatPrintTime(g.printedAt) : "-",
        "Dicetak Oleh": g.allPrinted && g.printedBy ? g.printedBy : "-",
        "Subtotal (DPP)": dpp,
        "PPN (11%)": ppn,
        "Total Harga (Grand Total)": grandTotal,
      };
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Faktur Tracker");

    let filename = dateBasis === "order" ? "Faktur_Tracker_TglOrder_SO" : "Faktur_Tracker_TglFaktur_Tx";
    if (startDate && endDate) {
      filename += `_${startDate}_sd_${endDate}`;
    } else if (startDate) {
      filename += `_dari_${startDate}`;
    } else if (endDate) {
      filename += `_sd_${endDate}`;
    } else {
      const pad = (n: number) => String(n).padStart(2, "0");
      const d = new Date();
      filename += `_Semua_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }
    filename += ".xlsx";

    XLSX.writeFile(wb, filename);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/70 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className={`relative w-full max-w-lg rounded-2xl shadow-2xl border overflow-hidden flex flex-col transition-all ${
          isDarkMode
            ? "bg-[#0c1426] border-slate-700/80 text-slate-100"
            : "bg-white border-slate-200 text-slate-800"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className={`px-5 py-4 border-b flex items-center justify-between ${
            isDarkMode
              ? "bg-[#0e1935] border-slate-800"
              : "bg-gradient-to-r from-blue-700 to-indigo-800 text-white"
          }`}
        >
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-white/20 text-white flex items-center justify-center text-base shadow-xs">
              📥
            </div>
            <div>
              <h2 className="font-extrabold text-sm sm:text-base text-white tracking-tight">
                Ekspor Data ke Excel
              </h2>
              <p className="text-[11px] text-blue-100 font-medium">
                Tarik data berdasarkan Tanggal Masuk SO atau Tanggal Terfaktur
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-md flex items-center justify-center text-white/80 hover:text-white hover:bg-white/20 transition-colors text-xs font-bold cursor-pointer"
            title="Tutup (Esc)"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-5 space-y-4 text-xs sm:text-sm overflow-y-auto max-h-[80vh] custom-scrollbar">
          {/* Rentang Tanggal Section */}
          <div
            className={`p-3.5 rounded-xl border space-y-3 ${
              isDarkMode
                ? "bg-[#111c33] border-slate-700/60"
                : "bg-slate-50 border-slate-200"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className={`font-bold text-xs uppercase tracking-wider ${isDarkMode ? "text-slate-300" : "text-slate-700"}`}>
                🗓️ Acuan & Rentang Tanggal
              </span>
              {availableDates.min && availableDates.max && (
                <span className={`text-[10px] ${isDarkMode ? "text-slate-500" : "text-slate-400"}`}>
                  Data: {isoToDisplayDate(availableDates.min)} s/d {isoToDisplayDate(availableDates.max)}
                </span>
              )}
            </div>

            {/* Acuan Tanggal Filter Toggle */}
            <div className={`p-2.5 rounded-xl border space-y-2 ${
              isDarkMode ? "bg-[#0c1426] border-slate-700/80" : "bg-white border-slate-200 shadow-xs"
            }`}>
              <div className="flex items-center justify-between">
                <span className={`text-[11px] font-bold uppercase tracking-wider ${isDarkMode ? "text-slate-400" : "text-slate-600"}`}>
                  Pilih Mode Tarik Data:
                </span>
                <span className="text-[10px] text-blue-600 dark:text-blue-400 font-bold">
                  {dateBasis === "order" ? "✓ Mode Tanggal Masuk SO" : "✓ Mode Tanggal Terfaktur"}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setDateBasis("order")}
                  className={`p-2.5 rounded-lg text-left border transition-all cursor-pointer ${
                    dateBasis === "order"
                      ? "bg-blue-600 text-white border-blue-600 shadow-md ring-2 ring-blue-500/30"
                      : isDarkMode
                      ? "bg-slate-800/80 border-slate-700 text-slate-300 hover:bg-slate-700"
                      : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-bold text-xs">
                    <span>📦</span>
                    <span>Tanggal Masuk SO (Order)</span>
                  </div>
                  <div className={`text-[10px] mt-1 leading-tight ${dateBasis === "order" ? "text-blue-100" : "opacity-75"}`}>
                    Cari ada berapa SO di tanggal sekian yang sudah terfaktur
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setDateBasis("transaction")}
                  className={`p-2.5 rounded-lg text-left border transition-all cursor-pointer ${
                    dateBasis === "transaction"
                      ? "bg-blue-600 text-white border-blue-600 shadow-md ring-2 ring-blue-500/30"
                      : isDarkMode
                      ? "bg-slate-800/80 border-slate-700 text-slate-300 hover:bg-slate-700"
                      : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-bold text-xs">
                    <span>📄</span>
                    <span>Tanggal Terfaktur (Tx Date)</span>
                  </div>
                  <div className={`text-[10px] mt-1 leading-tight ${dateBasis === "transaction" ? "text-blue-100" : "opacity-75"}`}>
                    Cari ada berapa faktur yang terbit di tanggal sekian
                  </div>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div>
                <label className={`block text-[11px] font-semibold mb-1 ${isDarkMode ? "text-slate-400" : "text-slate-600"}`}>
                  Dari Tanggal ({dateBasis === "order" ? "Tgl Order SO" : "Tgl Terfaktur"}):
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className={`w-full px-2.5 py-1.5 rounded-lg border text-xs font-medium outline-hidden transition-all ${
                    isDarkMode
                      ? "bg-[#0c1426] border-slate-700 text-slate-200 focus:border-blue-500"
                      : "bg-white border-slate-300 text-slate-800 focus:border-blue-600"
                  }`}
                />
              </div>

              <div>
                <label className={`block text-[11px] font-semibold mb-1 ${isDarkMode ? "text-slate-400" : "text-slate-600"}`}>
                  Hingga Tanggal ({dateBasis === "order" ? "Tgl Order SO" : "Tgl Terfaktur"}):
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className={`w-full px-2.5 py-1.5 rounded-lg border text-xs font-medium outline-hidden transition-all ${
                    isDarkMode
                      ? "bg-[#0c1426] border-slate-700 text-slate-200 focus:border-blue-500"
                      : "bg-white border-slate-300 text-slate-800 focus:border-blue-600"
                  }`}
                />
              </div>
            </div>

            {/* Quick Preset Buttons */}
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className={`text-[10px] font-semibold mr-1 ${isDarkMode ? "text-slate-500" : "text-slate-400"}`}>
                Pilihan Cepat:
              </span>
              <button
                type="button"
                onClick={handlePresetAll}
                className={`px-2 py-0.5 rounded text-[11px] font-semibold border transition-all cursor-pointer ${
                  !startDate && !endDate
                    ? "bg-blue-600 text-white border-blue-600"
                    : isDarkMode
                    ? "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700"
                    : "bg-white border-slate-200 text-slate-700 hover:bg-slate-100"
                }`}
              >
                Semua Tanggal
              </button>
              <button
                type="button"
                onClick={handlePresetToday}
                className={`px-2 py-0.5 rounded text-[11px] font-semibold border transition-all cursor-pointer ${
                  isDarkMode
                    ? "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700"
                    : "bg-white border-slate-200 text-slate-700 hover:bg-slate-100"
                }`}
              >
                Hari Ini
              </button>
              <button
                type="button"
                onClick={handlePreset7Days}
                className={`px-2 py-0.5 rounded text-[11px] font-semibold border transition-all cursor-pointer ${
                  isDarkMode
                    ? "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700"
                    : "bg-white border-slate-200 text-slate-700 hover:bg-slate-100"
                }`}
              >
                7 Hari Terakhir
              </button>
              <button
                type="button"
                onClick={handlePresetThisMonth}
                className={`px-2 py-0.5 rounded text-[11px] font-semibold border transition-all cursor-pointer ${
                  isDarkMode
                    ? "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700"
                    : "bg-white border-slate-200 text-slate-700 hover:bg-slate-100"
                }`}
              >
                Bulan Ini
              </button>
            </div>
          </div>

          {/* Kriteria Filter Tambahan (Status, Jenis, Kategori) */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {/* Status Cetak */}
            <div>
              <label className={`block text-[11px] font-semibold mb-1 ${isDarkMode ? "text-slate-400" : "text-slate-600"}`}>
                Status Cetak:
              </label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as "all" | "printed" | "unprinted")}
                className={`w-full px-2 py-1.5 rounded-lg border text-xs font-medium outline-hidden ${
                  isDarkMode
                    ? "bg-[#111c33] border-slate-700 text-slate-200"
                    : "bg-white border-slate-300 text-slate-800"
                }`}
              >
                <option value="all">Semua Status</option>
                <option value="printed">Sudah Dicetak (✓)</option>
                <option value="unprinted">Belum Dicetak</option>
              </select>
            </div>

            {/* Jenis Transaksi */}
            <div>
              <label className={`block text-[11px] font-semibold mb-1 ${isDarkMode ? "text-slate-400" : "text-slate-600"}`}>
                Jenis Transaksi:
              </label>
              <select
                value={jenisFilter}
                onChange={(e) => setJenisFilter(e.target.value as "all" | "ORA" | "DOO")}
                className={`w-full px-2 py-1.5 rounded-lg border text-xs font-medium outline-hidden ${
                  isDarkMode
                    ? "bg-[#111c33] border-slate-700 text-slate-200"
                    : "bg-white border-slate-300 text-slate-800"
                }`}
              >
                <option value="all">Semua (ORA & DOO)</option>
                <option value="ORA">Khusus ORA</option>
                <option value="DOO">Khusus DOO</option>
              </select>
            </div>

            {/* Kategori */}
            <div>
              <label className={`block text-[11px] font-semibold mb-1 ${isDarkMode ? "text-slate-400" : "text-slate-600"}`}>
                Kategori Prioritas:
              </label>
              <select
                value={katFilter}
                onChange={(e) => setKatFilter(e.target.value as "all" | "1P" | "2P" | "3P")}
                className={`w-full px-2 py-1.5 rounded-lg border text-xs font-medium outline-hidden ${
                  isDarkMode
                    ? "bg-[#111c33] border-slate-700 text-slate-200"
                    : "bg-white border-slate-300 text-slate-800"
                }`}
              >
                <option value="all">Semua Kategori</option>
                <option value="1P">1P</option>
                <option value="2P">2P</option>
                <option value="3P">3P</option>
              </select>
            </div>
          </div>

          {/* Pratinjau Hasil Data (Preview KPI Cards) */}
          <div
            className={`p-3.5 rounded-xl border space-y-2.5 ${
              isDarkMode
                ? "bg-[#0b1222] border-slate-700/80"
                : "bg-blue-50/70 border-blue-200 text-blue-950"
            }`}
          >
            <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider opacity-80">
              <span>📊 Pratinjau Data Terpilih:</span>
              <span className="font-mono text-emerald-600 dark:text-emerald-400 font-extrabold text-xs">
                Rp {formatRupiah(totalNilai)}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <div className={`p-2 rounded-lg border text-center ${
                isDarkMode ? "bg-[#111c33] border-slate-700/60" : "bg-white border-blue-100"
              }`}>
                <div className="text-[10px] text-slate-500 font-medium">Total SO Terfaktur</div>
                <div className="text-base font-extrabold font-mono text-blue-600 dark:text-blue-400">
                  {uniqueSoCount}
                </div>
              </div>

              <div className={`p-2 rounded-lg border text-center ${
                isDarkMode ? "bg-[#111c33] border-slate-700/60" : "bg-white border-blue-100"
              }`}>
                <div className="text-[10px] text-slate-500 font-medium">Total Lembar Faktur</div>
                <div className="text-base font-extrabold font-mono text-indigo-600 dark:text-indigo-400">
                  {matchingData.length}
                </div>
              </div>

              <div className={`col-span-2 sm:col-span-1 p-2 rounded-lg border text-center ${
                isDarkMode ? "bg-[#111c33] border-slate-700/60" : "bg-white border-blue-100"
              }`}>
                <div className="text-[10px] text-slate-500 font-medium">Basis Penarikan</div>
                <div className="text-xs font-bold text-slate-700 dark:text-slate-300 mt-0.5">
                  {dateBasis === "order" ? "Tanggal Order SO" : "Tanggal Faktur (Tx)"}
                </div>
              </div>
            </div>

            {/* Informative Explanation Helper */}
            <div className={`text-[11px] leading-relaxed p-2 rounded-lg border flex items-start gap-1.5 ${
              isDarkMode
                ? "bg-slate-900/60 border-slate-800 text-slate-300"
                : "bg-blue-100/60 border-blue-200 text-blue-900"
            }`}>
              <span className="text-xs mt-0.5">💡</span>
              <div>
                {dateBasis === "order" ? (
                  <span>
                    Menarik <strong>{uniqueSoCount} SO</strong> yang masuk pada rentang tanggal terpilih dan sudah memiliki faktur terbit (total <strong>{matchingData.length} faktur</strong>).
                  </span>
                ) : (
                  <span>
                    Menarik <strong>{matchingData.length} faktur</strong> yang diterbitkan pada rentang tanggal terpilih (mencakup <strong>{uniqueSoCount} SO</strong>).
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          className={`px-5 py-3 border-t flex items-center justify-between gap-3 ${
            isDarkMode ? "bg-[#0e1935] border-slate-800" : "bg-slate-50 border-slate-200"
          }`}
        >
          <button
            type="button"
            onClick={onClose}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
              isDarkMode ? "hover:bg-slate-800 text-slate-400" : "hover:bg-slate-200 text-slate-600"
            }`}
          >
            Batal
          </button>

          <button
            type="button"
            onClick={handleDownload}
            disabled={matchingData.length === 0}
            className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 shadow-md transition-all ${
              matchingData.length === 0
                ? "opacity-50 cursor-not-allowed bg-slate-400 text-white"
                : "bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-600/30 active:scale-95 cursor-pointer"
            }`}
          >
            <span>📥</span>
            <span>Unduh Excel ({matchingData.length} Faktur | {uniqueSoCount} SO)</span>
          </button>
        </div>
      </div>
    </div>
  );
}
