"use client";

import { Fragment, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabaseClient";
import { FakturRecord, ItemDetail } from "@/lib/types";

import { getKategori, getOrderType } from "@/lib/kategoriHelper";

type Props = {
  records: FakturRecord[];
  onRecordUpdated: (updated: FakturRecord) => void;
  onRecordDeleted: (id: string) => void;
  highlightImportedAt: string | null;
  onClearHighlight: () => void;
};

type ViewTab = "queue_normal" | "queue_split" | "printed" | "all";
type DateFilter = "all" | "today" | "7days" | "30days";
export type OrderTypeFilter = "all" | "DOO" | "ORA";

const PAGE_SIZE = 50;
const NEW_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export { getOrderType, getKategori };

function isNew(importedAt: string) {
  return Date.now() - new Date(importedAt).getTime() < NEW_THRESHOLD_MS;
}

function parseFakturNum(val?: string | null): number {
  if (!val) return 0;
  const num = parseInt(val.replace(/\D/g, ""), 10);
  return isNaN(num) ? 0 : num;
}

function formatRp(val?: string | number | null) {
  if (val === null || val === undefined || val === "") return "-";
  const num = typeof val === "number" ? val : parseFloat(String(val).replace(/[^0-9.-]+/g, ""));
  if (isNaN(num)) return String(val);
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(num);
}

export type InvoiceSubGroup = {
  no_faktur: string | null;
  record: FakturRecord;
  items: ItemDetail[];
};

export type GroupedOrder = {
  id: string;
  groupKey: string;
  no_sales_order: string | null;
  no_fakturs: (string | null)[];
  records: FakturRecord[];
  status_cetak: boolean;
  has_unprinted: boolean;
  printed_at: string | null;
  imported_at: string;
  isSplit: boolean;
  extra: {
    nama_pelanggan?: string | null;
    order_type?: string | null;
    items: ItemDetail[];
    invoiceGroups: InvoiceSubGroup[];
  };
  representativeRecord: FakturRecord;
};

export default function DataTable({
  records,
  onRecordUpdated,
  onRecordDeleted,
  highlightImportedAt,
  onClearHighlight,
}: Props) {
  const [activeTab, setActiveTab] = useState<ViewTab>("queue_normal");
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  // ── Gabungkan Record Berdasarkan Order Number (SO) ───────────────
  // Jika 1 SO punya 2+ No Faktur, disatukan jadi 1 Baris SO dengan daftar No Faktur di dalamnya
  const groupedOrders = useMemo(() => {
    const map = new Map<string, GroupedOrder>();

    for (const r of records) {
      const key = r.no_sales_order ? r.no_sales_order.trim() : `INV_${r.no_faktur}`;

      if (!map.has(key)) {
        map.set(key, {
          id: r.id,
          groupKey: key,
          no_sales_order: r.no_sales_order,
          no_fakturs: [r.no_faktur],
          records: [r],
          status_cetak: r.status_cetak,
          has_unprinted: !r.status_cetak,
          printed_at: r.printed_at,
          imported_at: r.imported_at,
          isSplit: false,
          extra: {
            nama_pelanggan: r.extra?.nama_pelanggan,
            order_type: r.extra?.order_type,
            items: [...(r.extra?.items || [])],
            invoiceGroups: [
              {
                no_faktur: r.no_faktur,
                record: r,
                items: r.extra?.items || [],
              },
            ],
          },
          representativeRecord: r,
        });
      } else {
        const g = map.get(key)!;
        if (!g.no_fakturs.includes(r.no_faktur)) {
          g.no_fakturs.push(r.no_faktur);
        }
        g.records.push(r);
        g.isSplit = true;
        g.status_cetak = g.status_cetak && r.status_cetak;
        if (!r.status_cetak) g.has_unprinted = true;
        if (r.printed_at && (!g.printed_at || r.printed_at > g.printed_at)) {
          g.printed_at = r.printed_at;
        }
        if (r.imported_at > g.imported_at) {
          g.imported_at = r.imported_at;
        }
        if (!g.extra.nama_pelanggan && r.extra?.nama_pelanggan) {
          g.extra.nama_pelanggan = r.extra.nama_pelanggan;
        }
        if (!g.extra.order_type && r.extra?.order_type) {
          g.extra.order_type = r.extra.order_type;
        }
        if (r.extra?.items) {
          g.extra.items.push(...r.extra.items);
          g.extra.invoiceGroups.push({
            no_faktur: r.no_faktur,
            record: r,
            items: r.extra.items,
          });
        }
      }
    }

    return Array.from(map.values());
  }, [records]);

  // ── Statistik ──────────────────────────────────────────────────
  const stats = useMemo(() => {
    const total = groupedOrders.length;
    const printed = groupedOrders.filter((g) => g.status_cetak).length;
    const notPrinted = total - printed;
    const splitCount = groupedOrders.filter((g) => g.isSplit && g.has_unprinted).length;
    const normalQueue = notPrinted - splitCount;
    const newItems = groupedOrders.filter((g) => isNew(g.imported_at)).length;
    return { total, printed, notPrinted, splitCount, normalQueue, newItems };
  }, [groupedOrders]);

  // ── Filter Data Sesuai Tab, Search & Date ───────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const now = Date.now();
    const cutoffs: Record<DateFilter, number> = {
      all: 0,
      today: now - 24 * 60 * 60 * 1000,
      "7days": now - 7 * 24 * 60 * 60 * 1000,
      "30days": now - 30 * 24 * 60 * 60 * 1000,
    };

    return groupedOrders
      .filter((g) => {
        const custName = g.extra?.nama_pelanggan ? String(g.extra.nama_pelanggan).toLowerCase() : "";
        const itemNames = (g.extra?.items || [])
          .map((it: ItemDetail) => `${it.item_code ?? ""} ${it.item_description ?? ""}`)
          .join(" ")
          .toLowerCase();
        const orderType = getOrderType(g.representativeRecord).toLowerCase();
        const kategori = getKategori(g.representativeRecord).toLowerCase();
        const fakturMatches = g.no_fakturs.some((f) => f != null && f.toLowerCase().includes(q));

        const matchesSearch =
          !q ||
          fakturMatches ||
          g.no_sales_order?.toLowerCase().includes(q) ||
          orderType.includes(q) ||
          kategori.includes(q) ||
          custName.includes(q) ||
          itemNames.includes(q);

        let matchesTab = true;
        if (activeTab === "queue_normal") {
          matchesTab = g.has_unprinted && !g.isSplit;
        } else if (activeTab === "queue_split") {
          matchesTab = g.isSplit;
        } else if (activeTab === "printed") {
          matchesTab = g.status_cetak;
        }

        const matchesDate =
          dateFilter === "all" ||
          new Date(g.imported_at).getTime() >= cutoffs[dateFilter];

        const matchesHighlight =
          !highlightImportedAt ||
          g.imported_at === highlightImportedAt ||
          Math.abs(new Date(g.imported_at).getTime() - new Date(highlightImportedAt).getTime()) < 5000;

        return matchesSearch && matchesTab && matchesDate && matchesHighlight;
      })
      .sort((a, b) => {
        const numA = parseFakturNum(a.no_fakturs[0]);
        const numB = parseFakturNum(b.no_fakturs[0]);
        if (numA !== numB) {
          return numB - numA;
        }
        return (b.no_fakturs[0] || "").localeCompare(a.no_fakturs[0] || "", undefined, { numeric: true });
      });
  }, [groupedOrders, search, activeTab, dateFilter, highlightImportedAt]);

  // ── Pagination ──────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // ── Actions ─────────────────────────────────────────────────────
  async function toggleGroupStatus(group: GroupedOrder) {
    const newStatus = !group.status_cetak;
    const nowIso = new Date().toISOString();
    const ids = group.records.map((r) => r.id);

    // Optimistic Update
    group.records.forEach((r) => {
      onRecordUpdated({
        ...r,
        status_cetak: newStatus,
        printed_at: newStatus ? nowIso : null,
      });
    });

    setUpdatingId(group.id);
    const { error } = await supabase
      .from("faktur_records")
      .update({
        status_cetak: newStatus,
        printed_at: newStatus ? nowIso : null,
      })
      .in("id", ids);
    setUpdatingId(null);

    if (error) {
      alert("Gagal update status di database: " + error.message);
      group.records.forEach((r) => onRecordUpdated(r));
    }
  }

  async function deleteGroup(group: GroupedOrder) {
    const label = group.no_sales_order || group.no_fakturs.join(", ");
    if (!confirm(`Hapus data order SO ${label} ini (${group.records.length} faktur)?`)) return;
    setDeletingId(group.id);
    const ids = group.records.map((r) => r.id);
    const { error } = await supabase.from("faktur_records").delete().in("id", ids);
    setDeletingId(null);
    if (error) { alert("Gagal hapus: " + error.message); return; }
    ids.forEach((id) => onRecordDeleted(id));
  }

  function exportToExcel() {
    const rows = filtered.map((g) => {
      const oType = getOrderType(g.representativeRecord);
      const kat = getKategori(g.representativeRecord);
      return {
        "Order Number (SO)": g.no_sales_order,
        "No Invoice AR": g.no_fakturs.join(", "),
        "Jumlah Faktur": g.no_fakturs.length,
        "Nama Pelanggan": g.extra?.nama_pelanggan ?? "",
        "Kategori": kat,
        "Jenis Transaksi": oType === "DOO" ? "DOO (3rd Party)" : oType === "ORA" ? "ORA (Priority)" : "-",
        "Jumlah Item": g.extra?.items?.length ?? 0,
        "Status Cetak": g.status_cetak ? "Sudah Print" : "Belum Print",
        "Tanggal Print": g.printed_at ? new Date(g.printed_at).toLocaleString("id-ID") : "",
        "Tanggal Import": new Date(g.imported_at).toLocaleString("id-ID"),
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Data Faktur");
    XLSX.writeFile(wb, `faktur-export-${Date.now()}.xlsx`);
  }

  return (
    <div>
      {/* ── 3 TAB UTAMA WORKFLOW KERJA OPERATOR ── */}
      <div className="flex flex-wrap gap-2.5 mb-4 p-1.5 bg-slate-200/80 rounded-2xl border border-slate-300 shadow-inner">
        <button
          onClick={() => { setActiveTab("queue_normal"); setPage(1); }}
          className={`flex-1 min-w-[200px] flex items-center justify-between px-4 py-3 rounded-xl font-bold text-sm transition ${
            activeTab === "queue_normal"
              ? "bg-white text-blue-900 shadow-md ring-2 ring-blue-600"
              : "text-slate-700 hover:bg-white/60"
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="text-base">📋</span>
            <span>1. Antrian Siap Print (Normal)</span>
          </div>
          <span className={`px-2 py-0.5 rounded-full text-xs font-black ${
            activeTab === "queue_normal" ? "bg-blue-100 text-blue-800" : "bg-slate-300 text-slate-800"
          }`}>
            {stats.normalQueue}
          </span>
        </button>

        <button
          onClick={() => { setActiveTab("queue_split"); setPage(1); }}
          className={`flex-1 min-w-[200px] flex items-center justify-between px-4 py-3 rounded-xl font-bold text-sm transition ${
            activeTab === "queue_split"
              ? "bg-red-600 text-white shadow-md ring-2 ring-red-700"
              : "text-red-700 bg-red-100/70 hover:bg-red-200/80 border border-red-300"
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="text-base">⚡</span>
            <span>2. Perhatian: 1 SO 2+ Faktur (Pecah Inv)</span>
          </div>
          <span className={`px-2 py-0.5 rounded-full text-xs font-black ${
            activeTab === "queue_split" ? "bg-white text-red-700" : "bg-red-600 text-white"
          }`}>
            {stats.splitCount}
          </span>
        </button>

        <button
          onClick={() => { setActiveTab("printed"); setPage(1); }}
          className={`flex-1 min-w-[180px] flex items-center justify-between px-4 py-3 rounded-xl font-bold text-sm transition ${
            activeTab === "printed"
              ? "bg-green-700 text-white shadow-md ring-2 ring-green-800"
              : "text-green-800 bg-green-100/70 hover:bg-green-200/80 border border-green-300"
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="text-base">✅</span>
            <span>3. Selesai (Sudah Print)</span>
          </div>
          <span className={`px-2 py-0.5 rounded-full text-xs font-black ${
            activeTab === "printed" ? "bg-white text-green-800" : "bg-green-700 text-white"
          }`}>
            {stats.printed}
          </span>
        </button>

        <button
          onClick={() => { setActiveTab("all"); setPage(1); }}
          className={`px-4 py-3 rounded-xl font-bold text-sm transition flex items-center gap-2 ${
            activeTab === "all"
              ? "bg-slate-800 text-white shadow-md"
              : "text-slate-600 hover:bg-white/60"
          }`}
        >
          <span>📊 Semua Order ({stats.total})</span>
        </button>
      </div>

      {/* ── Highlight aktif banner ── */}
      {highlightImportedAt && (
        <div className="mb-3 flex items-center gap-2 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
          <span>🔍 Menampilkan data baru dari sesi import terakhir</span>
          <button onClick={onClearHighlight} className="ml-auto underline font-medium">
            Hapus filter
          </button>
        </div>
      )}

      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          type="text"
          placeholder="Cari No Invoice / SO / DOO / ORA / Nama Pelanggan / Nama Barang..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm flex-1 min-w-[280px] shadow-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
        />
        <select
          value={dateFilter}
          onChange={(e) => { setDateFilter(e.target.value as DateFilter); setPage(1); }}
          className="border border-gray-300 rounded-xl px-3 py-2.5 text-sm bg-white shadow-sm font-medium"
        >
          <option value="all">Semua Tanggal</option>
          <option value="today">Hari ini (Baru)</option>
          <option value="7days">7 hari terakhir</option>
          <option value="30days">30 hari terakhir</option>
        </select>
        <button
          onClick={exportToExcel}
          className="px-4 py-2.5 bg-slate-700 text-white rounded-xl text-sm font-bold hover:bg-slate-800 shadow-sm transition"
        >
          Export Excel
        </button>
      </div>

      <p className="text-xs text-gray-500 mb-2">
        Menampilkan <strong>{filtered.length}</strong> order SO dari total {groupedOrders.length} order
        {totalPages > 1 && ` — Hal. ${safePage} / ${totalPages}`}
      </p>

      {/* ── Tabel Utama ── */}
      <div className="overflow-x-auto border border-gray-200 rounded-2xl shadow-sm bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-700">
            <tr>
              <th className="text-left px-4 py-3 font-bold">Order Number</th>
              <th className="text-left px-4 py-3 font-bold">Inv AR</th>
              <th className="text-left px-4 py-3 font-bold">Nama Pelanggan</th>
              <th className="text-left px-4 py-3 font-bold">Jenis Transaksi</th>
              <th className="text-left px-4 py-3 font-bold">Daftar Barang</th>
              <th className="text-left px-4 py-3 font-bold">Status Print</th>
              <th className="text-center px-4 py-3 font-bold w-16">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {paginated.map((g) => {
              const isExpanded = expandedKey === g.groupKey;
              const items = g.extra?.items || [];
              const custName = g.extra?.nama_pelanggan;
              const orderType = getOrderType(g.representativeRecord);
              const kategori = getKategori(g.representativeRecord);

              return (
                <Fragment key={g.groupKey}>
                  <tr className={`transition hover:bg-slate-50/80 ${
                    g.isSplit
                      ? "bg-amber-50/40 border-l-4 border-l-amber-500"
                      : g.status_cetak
                      ? "bg-green-50/30"
                      : isNew(g.imported_at)
                      ? "bg-yellow-50/30"
                      : ""
                  }`}>
                    {/* 1. Order Number (SO) */}
                    <td className="px-4 py-3">
                      <div>
                        <span
                          onClick={() => {
                            if (g.no_sales_order) {
                              setSearch(g.no_sales_order.split(",")[0].trim());
                              setPage(1);
                            }
                          }}
                          className="font-mono font-bold text-slate-900 cursor-pointer hover:underline text-base"
                          title="Klik untuk filter SO ini"
                        >
                          {g.no_sales_order ?? "-"}
                        </span>
                        {g.isSplit && (
                          <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-[10px] font-black bg-amber-100 text-amber-800 border border-amber-300">
                            ⚡ 1 SO {g.no_fakturs.length} Faktur
                          </span>
                        )}
                      </div>
                    </td>

                    {/* 2. Inv AR (Daftar Faktur yang Terpisah) */}
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {g.no_fakturs.map((inv, idx) => (
                          <span
                            key={inv ?? `pending-${idx}`}
                            className={`px-2 py-1 rounded-lg font-mono font-black text-sm border shadow-sm ${
                              g.isSplit
                                ? "bg-amber-100/80 text-amber-900 border-amber-300 ring-1 ring-amber-400"
                                : inv == null
                                ? "bg-gray-100 text-gray-400 border-gray-300 italic"
                                : "bg-slate-100 text-slate-900 border-slate-300"
                            }`}
                          >
                            {inv != null ? `#${inv}` : "Pending"}
                          </span>
                        ))}
                        {isNew(g.imported_at) && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-700">
                            BARU
                          </span>
                        )}
                      </div>
                    </td>

                    {/* 3. Nama Pelanggan */}
                    <td className="px-4 py-3">
                      <span className="font-semibold text-slate-800 block max-w-[220px] truncate" title={String(custName || "-")}>
                        {custName ? String(custName) : <span className="text-gray-400 italic">-</span>}
                      </span>
                    </td>

                    {/* 4. Jenis Transaksi */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {kategori === "1P" && (
                          <span
                            className="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-black bg-blue-100 text-blue-800 border border-blue-300 shadow-sm"
                            title="1P (Direct / Mandiri)"
                          >
                            1P
                          </span>
                        )}
                        {kategori === "2P" && (
                          <span
                            className="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-black bg-emerald-100 text-emerald-800 border border-emerald-300 shadow-sm"
                            title="2P (2nd Party)"
                          >
                            2P
                          </span>
                        )}
                        {kategori === "3P" && (
                          <span
                            className="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-black bg-purple-100 text-purple-800 border border-purple-300 shadow-sm"
                            title="3P (3rd Party)"
                          >
                            3P
                          </span>
                        )}

                        {orderType === "DOO" && (
                          <span
                            className="inline-flex items-center px-2 py-0.5 rounded-lg text-[11px] font-bold bg-purple-50 text-purple-700 border border-purple-200 shadow-sm"
                            title="DOO (TRADE_3RD PARTY)"
                          >
                            DOO
                          </span>
                        )}
                        {orderType === "ORA" && (
                          <span
                            className="inline-flex items-center px-2 py-0.5 rounded-lg text-[11px] font-bold bg-teal-50 text-teal-700 border border-teal-200 shadow-sm"
                            title="ORA (TRADE_PRIORITY)"
                          >
                            ORA
                          </span>
                        )}
                        {kategori === "OTHER" && orderType === "OTHER" && (
                          <span className="text-gray-400 text-xs">-</span>
                        )}
                      </div>
                    </td>

                    {/* 5. Daftar Barang */}
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setExpandedKey(isExpanded ? null : g.groupKey)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition shadow-sm ${
                          isExpanded
                            ? "bg-slate-800 text-white"
                            : items.length > 0
                            ? "bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100"
                            : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                        }`}
                      >
                        <span>{isExpanded ? "▲ Tutup Rincian" : `📦 ${items.length} Barang (Buka)`}</span>
                      </button>
                    </td>

                    {/* 6. Status Print */}
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1 items-start">
                        <button
                          disabled={updatingId === g.id}
                          onClick={() => toggleGroupStatus(g)}
                          className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition shadow-sm cursor-pointer ${
                            g.status_cetak
                              ? "bg-green-100 text-green-800 border border-green-300 hover:bg-yellow-50 hover:text-yellow-800 hover:border-yellow-300"
                              : "bg-green-600 text-white hover:bg-green-700 ring-2 ring-green-600/30"
                          } ${updatingId === g.id ? "opacity-50" : ""}`}
                          title={g.status_cetak ? "Sudah dicetak. Klik jika ingin membatalkan." : "Klik untuk tandai selesai dicetak"}
                        >
                          <span>{g.status_cetak ? "✅ Sudah Print" : "✓ Selesai Print"}</span>
                        </button>
                        {g.printed_at && (
                          <span className="text-[10px] text-gray-500 font-mono">
                            {new Date(g.printed_at).toLocaleString("id-ID")}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* 7. Aksi */}
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => deleteGroup(g)}
                        disabled={deletingId === g.id}
                        className="px-2 py-1 bg-red-50 text-red-600 rounded text-xs hover:bg-red-100 disabled:opacity-50 font-bold"
                        title="Hapus Order Ini"
                      >
                        {deletingId === g.id ? "..." : "🗑️"}
                      </button>
                    </td>
                  </tr>

                  {/* ── EXPANDED ITEM ACCORDION DRAWER ── */}
                  {isExpanded && (
                    <tr className="bg-slate-100/70 border-b border-slate-300">
                      <td colSpan={7} className="px-6 py-4">
                        <div className="rounded-2xl border border-slate-300 bg-white p-5 shadow-md">
                          <div className="flex flex-wrap items-center justify-between gap-2 mb-4 pb-3 border-b border-slate-200">
                            <div>
                              <div className="flex items-center gap-2">
                                <p className="text-base font-black text-slate-900">
                                  📦 Rincian Barang — SO {g.no_sales_order || g.no_fakturs.join(", ")}
                                </p>
                                {orderType === "DOO" && (
                                  <span className="px-2 py-0.5 rounded text-xs font-black bg-purple-100 text-purple-800 border border-purple-300">
                                    DOO (TRADE_3RD PARTY)
                                  </span>
                                )}
                                {orderType === "ORA" && (
                                  <span className="px-2 py-0.5 rounded text-xs font-black bg-teal-100 text-teal-800 border border-teal-300">
                                    ORA (TRADE_PRIORITY)
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-slate-600 mt-1">
                                No Faktur: <span className="font-mono font-bold text-slate-900">{g.no_fakturs.map(f => f ? `#${f}` : "Pending").join(", ")}</span>
                                {custName && (
                                  <> | Pelanggan: <span className="font-bold text-blue-900">{String(custName)}</span></>
                                )}
                              </p>
                            </div>
                            <span className="text-xs font-black px-3 py-1.5 bg-blue-100 text-blue-800 rounded-lg">
                              Total: {items.length} Item Barang ({g.no_fakturs.length} Faktur)
                            </span>
                          </div>

                          {/* Rincian per Faktur (jika pecah faktur) */}
                          {g.extra.invoiceGroups.map((invGroup, gIdx) => (
                            <div key={gIdx} className="mb-4 last:mb-0">
                              {g.isSplit && (
                                <div className="flex items-center gap-2 mb-2">
                                  <span className="px-2.5 py-1 rounded-lg text-xs font-black bg-blue-700 text-white font-mono shadow-sm">
                                    📄 Faktur {invGroup.no_faktur ? `#${invGroup.no_faktur}` : "Pending"}
                                  </span>
                                  <span className="text-xs text-slate-500 font-semibold">
                                    ({invGroup.items.length} Item Barang)
                                  </span>
                                </div>
                              )}

                              {invGroup.items.length === 0 ? (
                                <p className="text-xs text-gray-400 italic py-2">
                                  Tidak ada data item pada faktur ini.
                                </p>
                              ) : (
                                <div className="overflow-x-auto rounded-xl border border-slate-200">
                                  <table className="min-w-full text-xs">
                                    <thead className="bg-slate-100 text-slate-700">
                                      <tr>
                                        <th className="px-3 py-2 text-center font-bold w-8">#</th>
                                        <th className="px-3 py-2 text-left font-bold">Kode Barang</th>
                                        <th className="px-3 py-2 text-left font-bold">Nama Barang (Description)</th>
                                        <th className="px-3 py-2 text-center font-bold">Qty</th>
                                        <th className="px-3 py-2 text-center font-bold">Satuan</th>
                                        <th className="px-3 py-2 text-left font-bold">LOT Number</th>
                                        <th className="px-3 py-2 text-right font-bold">Harga Jual</th>
                                        <th className="px-3 py-2 text-right font-bold">Total Harga</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                      {invGroup.items.map((it: ItemDetail, idx: number) => (
                                        <tr key={idx} className="hover:bg-slate-50">
                                          <td className="px-3 py-2 text-center text-slate-400 font-mono">{idx + 1}</td>
                                          <td className="px-3 py-2 font-mono font-semibold text-slate-700">{it.item_code ?? "-"}</td>
                                          <td className="px-3 py-2 font-bold text-slate-900">{it.item_description ?? "-"}</td>
                                          <td className="px-3 py-2 text-center font-black text-blue-700 bg-blue-50/50">{it.qty ?? "-"}</td>
                                          <td className="px-3 py-2 text-center font-semibold text-slate-600">{it.uom ?? "-"}</td>
                                          <td className="px-3 py-2 font-mono text-slate-600">{it.lot_number ?? "-"}</td>
                                          <td className="px-3 py-2 text-right text-slate-600">{formatRp(it.harga_jual)}</td>
                                          <td className="px-3 py-2 text-right font-black text-slate-900">{formatRp(it.total_harga)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {paginated.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-gray-400 py-10 font-medium">
                  Tidak ada data pada tampilan ini.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={safePage === 1}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm disabled:opacity-40 hover:bg-gray-50 font-medium"
          >
            ← Prev
          </button>
          <span className="text-sm text-gray-600 font-semibold">
            Hal {safePage} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={safePage === totalPages}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm disabled:opacity-40 hover:bg-gray-50 font-medium"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
