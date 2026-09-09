"use client";

import { Fragment, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabaseClient";
import { FakturRecord, ItemDetail } from "@/lib/types";

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

export function getOrderType(r: FakturRecord): "DOO" | "ORA" | "OTHER" {
  if (r.extra?.order_type) {
    const ot = String(r.extra.order_type).toUpperCase();
    if (ot.includes("3RD") || ot.includes("DOO")) return "DOO";
    if (ot.includes("PRIORITY") || ot.includes("ORA")) return "ORA";
  }
  if (!r.no_sales_order) return "OTHER";
  // Alphanumeric SO (e.g. ZLGMXL-5393, KY74DY-8596) -> DOO (TRADE_3RD PARTY)
  if (/[A-Za-z]/.test(r.no_sales_order)) {
    return "DOO";
  }
  // Numeric SO (e.g. 9066, 9512, 9328) -> ORA (TRADE_PRIORITY)
  if (/^\s*\d+[\d\s,]*$/.test(r.no_sales_order)) {
    return "ORA";
  }
  return "OTHER";
}

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
  const [typeFilter, setTypeFilter] = useState<OrderTypeFilter>("all");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<FakturRecord>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deletingBulk, setDeletingBulk] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null); // Accordion item detail

  // ── Pemetaan 1 SO -> Multiple Invoice ─────────────────────────
  const soToInvoicesMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const r of records) {
      if (!r.no_sales_order) continue;
      const sos = r.no_sales_order.split(",").map((s) => s.trim()).filter(Boolean);
      for (const s of sos) {
        if (!map.has(s)) map.set(s, []);
        map.get(s)!.push(r.no_faktur);
      }
    }
    return map;
  }, [records]);

  function getRelatedInvoices(r: FakturRecord): string[] {
    if (!r.no_sales_order) return [];
    const sos = r.no_sales_order.split(",").map((s) => s.trim()).filter(Boolean);
    const related = new Set<string>();
    for (const s of sos) {
      const list = soToInvoicesMap.get(s) || [];
      for (const inv of list) {
        if (inv !== r.no_faktur) related.add(inv);
      }
    }
    return Array.from(related);
  }

  // ── Statistik ──────────────────────────────────────────────────
  const stats = useMemo(() => {
    const total = records.length;
    const printed = records.filter((r) => r.status_cetak).length;
    const notPrinted = total - printed;
    const splitCount = records.filter((r) => !r.status_cetak && getRelatedInvoices(r).length > 0).length;
    const normalQueue = notPrinted - splitCount;
    const newItems = records.filter((r) => isNew(r.imported_at)).length;
    const dooCount = records.filter((r) => getOrderType(r) === "DOO").length;
    const oraCount = records.filter((r) => getOrderType(r) === "ORA").length;
    return { total, printed, notPrinted, splitCount, normalQueue, newItems, dooCount, oraCount };
  }, [records, soToInvoicesMap]);

  // ── Filter Data Sesuai Tab, Search, Date & Type ─────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const now = Date.now();
    const cutoffs: Record<DateFilter, number> = {
      all: 0,
      today: now - 24 * 60 * 60 * 1000,
      "7days": now - 7 * 24 * 60 * 60 * 1000,
      "30days": now - 30 * 24 * 60 * 60 * 1000,
    };

    return records
      .filter((r) => {
        const custName = r.extra?.nama_pelanggan ? String(r.extra.nama_pelanggan).toLowerCase() : "";
        const itemNames = (r.extra?.items || [])
          .map((it: ItemDetail) => `${it.item_code ?? ""} ${it.item_description ?? ""}`)
          .join(" ")
          .toLowerCase();

        const matchesSearch =
          !q ||
          r.no_faktur?.toLowerCase().includes(q) ||
          r.no_sales_order?.toLowerCase().includes(q) ||
          custName.includes(q) ||
          itemNames.includes(q);

        const isSplit = getRelatedInvoices(r).length > 0;

        let matchesTab = true;
        if (activeTab === "queue_normal") {
          matchesTab = !r.status_cetak && !isSplit;
        } else if (activeTab === "queue_split") {
          matchesTab = isSplit;
        } else if (activeTab === "printed") {
          matchesTab = r.status_cetak;
        }

        const matchesDate =
          dateFilter === "all" ||
          new Date(r.imported_at).getTime() >= cutoffs[dateFilter];

        const matchesHighlight =
          !highlightImportedAt ||
          r.imported_at === highlightImportedAt ||
          Math.abs(new Date(r.imported_at).getTime() - new Date(highlightImportedAt).getTime()) < 5000;

        const orderType = getOrderType(r);
        const matchesType = typeFilter === "all" || orderType === typeFilter;

        return matchesSearch && matchesTab && matchesDate && matchesHighlight && matchesType;
      })
      .sort((a, b) => {
        const numA = parseFakturNum(a.no_faktur);
        const numB = parseFakturNum(b.no_faktur);
        if (numA !== numB) {
          return numB - numA;
        }
        return (b.no_faktur || "").localeCompare(a.no_faktur || "", undefined, { numeric: true });
      });
  }, [records, search, activeTab, dateFilter, typeFilter, highlightImportedAt, soToInvoicesMap]);

  // ── Pagination ──────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // ── Actions ─────────────────────────────────────────────────────
  async function toggleStatus(record: FakturRecord) {
    const newStatus = !record.status_cetak;
    const nowIso = new Date().toISOString();

    // Optimistic Update: Langsung ubah status di state
    onRecordUpdated({
      ...record,
      status_cetak: newStatus,
      printed_at: newStatus ? nowIso : null,
    });

    setUpdatingId(record.id);
    const { data, error } = await supabase
      .from("faktur_records")
      .update({
        status_cetak: newStatus,
        printed_at: newStatus ? nowIso : null,
      })
      .eq("id", record.id)
      .select()
      .single();
    setUpdatingId(null);

    if (error) {
      alert("Gagal update status di database: " + error.message);
      onRecordUpdated(record);
      return;
    }
    if (data) onRecordUpdated(data as FakturRecord);
  }

  // Bulk update status print untuk semua yang dicentang
  async function setBulkStatus(markAsPrinted: boolean) {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    const nowIso = new Date().toISOString();

    records.forEach((r) => {
      if (selectedIds.has(r.id)) {
        onRecordUpdated({
          ...r,
          status_cetak: markAsPrinted,
          printed_at: markAsPrinted ? nowIso : null,
        });
      }
    });

    const { error } = await supabase
      .from("faktur_records")
      .update({
        status_cetak: markAsPrinted,
        printed_at: markAsPrinted ? nowIso : null,
      })
      .in("id", ids);

    if (error) {
      alert("Gagal update status massal: " + error.message);
      return;
    }
    setSelectedIds(new Set());
  }

  async function deleteRecord(id: string) {
    if (!confirm("Hapus data faktur ini?")) return;
    setDeletingId(id);
    const { error } = await supabase.from("faktur_records").delete().eq("id", id);
    setDeletingId(null);
    if (error) { alert("Gagal hapus: " + error.message); return; }
    onRecordDeleted(id);
  }

  async function deleteBulk() {
    if (selectedIds.size === 0) return;
    if (!confirm(`Hapus ${selectedIds.size} data yang dipilih?`)) return;
    setDeletingBulk(true);
    const ids = Array.from(selectedIds);
    const { error } = await supabase.from("faktur_records").delete().in("id", ids);
    setDeletingBulk(false);
    if (error) { alert("Gagal hapus: " + error.message); return; }
    ids.forEach((id) => onRecordDeleted(id));
    setSelectedIds(new Set());
  }

  function startEdit(record: FakturRecord) {
    setEditingId(record.id);
    setEditDraft({
      no_faktur: record.no_faktur,
      no_sales_order: record.no_sales_order,
    });
  }

  async function saveEdit(record: FakturRecord) {
    setSavingId(record.id);
    const { data, error } = await supabase
      .from("faktur_records")
      .update({
        no_faktur: editDraft.no_faktur ?? record.no_faktur,
        no_sales_order: editDraft.no_sales_order ?? null,
      })
      .eq("id", record.id)
      .select()
      .single();
    setSavingId(null);
    if (error) { alert("Gagal simpan: " + error.message); return; }
    if (data) onRecordUpdated(data as FakturRecord);
    setEditingId(null);
    setEditDraft({});
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === paginated.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(paginated.map((r) => r.id)));
    }
  }

  function exportToExcel() {
    const rows = filtered.map((r) => {
      const oType = getOrderType(r);
      return {
        "No Invoice AR": r.no_faktur,
        "Order Number (SO)": r.no_sales_order,
        "Tipe Order": oType === "DOO" ? "DOO (3rd Party)" : oType === "ORA" ? "ORA (Priority)" : "-",
        "Nama Pelanggan": r.extra?.nama_pelanggan ?? "",
        "Jumlah Item": r.extra?.items?.length ?? 0,
        "Status Cetak": r.status_cetak ? "Sudah Print" : "Belum Print",
        "Tanggal Print": r.printed_at ? new Date(r.printed_at).toLocaleString("id-ID") : "",
        "Tanggal Import": new Date(r.imported_at).toLocaleString("id-ID"),
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
            <span className="text-base">⚠️</span>
            <span>2. Perhatian: 1 SO 2+ Faktur</span>
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
          <span>📊 Semua Data ({stats.total})</span>
        </button>
      </div>

      {/* ── Quick Filter: DOO vs ORA ── */}
      <div className="flex flex-wrap items-center gap-2 mb-4 bg-white p-2 rounded-xl border border-slate-200 shadow-sm">
        <span className="text-xs font-bold text-slate-500 px-2">Filter Tipe:</span>
        <button
          onClick={() => { setTypeFilter("all"); setPage(1); }}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
            typeFilter === "all"
              ? "bg-slate-800 text-white shadow-sm"
              : "bg-slate-100 text-slate-600 hover:bg-slate-200"
          }`}
        >
          Semua Tipe ({stats.total})
        </button>
        <button
          onClick={() => { setTypeFilter("DOO"); setPage(1); }}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
            typeFilter === "DOO"
              ? "bg-purple-700 text-white shadow-sm ring-2 ring-purple-400"
              : "bg-purple-50 text-purple-800 border border-purple-200 hover:bg-purple-100"
          }`}
        >
          <span>🟣 DOO (3rd Party)</span>
          <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-black ${
            typeFilter === "DOO" ? "bg-white text-purple-900" : "bg-purple-200 text-purple-900"
          }`}>
            {stats.dooCount}
          </span>
        </button>
        <button
          onClick={() => { setTypeFilter("ORA"); setPage(1); }}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
            typeFilter === "ORA"
              ? "bg-teal-700 text-white shadow-sm ring-2 ring-teal-400"
              : "bg-teal-50 text-teal-800 border border-teal-200 hover:bg-teal-100"
          }`}
        >
          <span>🔷 ORA (Priority)</span>
          <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-black ${
            typeFilter === "ORA" ? "bg-white text-teal-900" : "bg-teal-200 text-teal-900"
          }`}>
            {stats.oraCount}
          </span>
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
          placeholder="Cari No Invoice / SO / Nama Pelanggan / Nama Barang..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm flex-1 min-w-[260px] shadow-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
        />
        <select
          value={dateFilter}
          onChange={(e) => { setDateFilter(e.target.value as DateFilter); setPage(1); }}
          className="border border-gray-300 rounded-xl px-3 py-2.5 text-sm bg-white shadow-sm"
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

        {selectedIds.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-300">
            <span className="text-xs font-bold text-slate-700">{selectedIds.size} dipilih:</span>
            <button
              onClick={() => setBulkStatus(true)}
              className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-bold hover:bg-green-700 shadow-sm transition"
            >
              ✓ Selesai Print
            </button>
            <button
              onClick={() => setBulkStatus(false)}
              className="px-3 py-1.5 bg-yellow-500 text-white rounded-lg text-xs font-bold hover:bg-yellow-600 shadow-sm transition"
            >
              ✕ Belum Print
            </button>
            <button
              onClick={deleteBulk}
              disabled={deletingBulk}
              className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-bold hover:bg-red-700 shadow-sm transition disabled:opacity-50"
            >
              {deletingBulk ? "Menghapus..." : "🗑️ Hapus"}
            </button>
          </div>
        )}
      </div>

      <p className="text-xs text-gray-500 mb-2">
        Menampilkan <strong>{filtered.length}</strong> dari {records.length} data
        {typeFilter !== "all" && <span className="font-bold text-purple-700"> ({typeFilter} saja)</span>}
        {totalPages > 1 && ` — Hal. ${safePage} / ${totalPages}`}
      </p>

      {/* ── Tabel Utama ── */}
      <div className="overflow-x-auto border border-gray-200 rounded-2xl shadow-sm bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-700">
            <tr>
              <th className="px-3 py-3 w-10 text-center">
                <input
                  type="checkbox"
                  checked={paginated.length > 0 && selectedIds.size === paginated.length}
                  onChange={toggleSelectAll}
                />
              </th>
              <th className="text-left px-4 py-3 font-bold">No Invoice AR</th>
              <th className="text-left px-4 py-3 font-bold">Order Number (SO)</th>
              <th className="text-left px-4 py-3 font-bold">Nama Pelanggan</th>
              <th className="text-left px-4 py-3 font-bold">Daftar Barang</th>
              <th className="text-left px-4 py-3 font-bold">Status Print (Aksi)</th>
              <th className="text-left px-4 py-3 font-bold">Tanggal Print</th>
              <th className="text-left px-4 py-3 font-bold">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {paginated.map((r) => {
              const relatedInvoices = getRelatedInvoices(r);
              const hasSplit = relatedInvoices.length > 0;
              const isExpanded = expandedId === r.id;
              const items = r.extra?.items || [];
              const custName = r.extra?.nama_pelanggan;
              const orderType = getOrderType(r);

              return (
                <Fragment key={r.id}>
                  <tr className={`transition hover:bg-slate-50/80 ${
                    hasSplit
                      ? "bg-red-50/40 border-l-4 border-l-red-500"
                      : r.status_cetak
                      ? "bg-green-50/30"
                      : isNew(r.imported_at)
                      ? "bg-yellow-50/30"
                      : ""
                  }`}>
                    <td className="px-3 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(r.id)}
                        onChange={() => toggleSelect(r.id)}
                      />
                    </td>

                    {/* No Invoice AR */}
                    <td className="px-4 py-3 font-bold text-gray-900">
                      {editingId === r.id ? (
                        <input
                          value={editDraft.no_faktur ?? ""}
                          onChange={(e) => setEditDraft((d) => ({ ...d, no_faktur: e.target.value }))}
                          className="border border-blue-300 rounded px-2 py-0.5 text-sm w-full"
                        />
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <span className="text-base font-black text-slate-900 font-mono">{r.no_faktur}</span>
                          {isNew(r.imported_at) && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-700">
                              BARU
                            </span>
                          )}
                          {hasSplit && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700 border border-red-200">
                              ⚠️ Pecah Inv
                            </span>
                          )}
                        </div>
                      )}
                    </td>

                    {/* No SO + Badge DOO / ORA */}
                    <td className="px-4 py-3">
                      {editingId === r.id ? (
                        <input
                          value={editDraft.no_sales_order ?? ""}
                          onChange={(e) => setEditDraft((d) => ({ ...d, no_sales_order: e.target.value }))}
                          className="border border-blue-300 rounded px-2 py-0.5 text-sm w-full"
                        />
                      ) : (
                        <div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span
                              onClick={() => {
                                if (r.no_sales_order) {
                                  setSearch(r.no_sales_order.split(",")[0].trim());
                                  setPage(1);
                                }
                              }}
                              className="font-mono font-semibold text-gray-800 cursor-pointer hover:underline"
                              title="Klik untuk filter SO ini"
                            >
                              {r.no_sales_order ?? "-"}
                            </span>

                            {/* Badge DOO vs ORA */}
                            {orderType === "DOO" && (
                              <span
                                className="px-1.5 py-0.5 rounded text-[10px] font-black bg-purple-100 text-purple-800 border border-purple-300"
                                title="DOO (TRADE_3RD PARTY)"
                              >
                                DOO
                              </span>
                            )}
                            {orderType === "ORA" && (
                              <span
                                className="px-1.5 py-0.5 rounded text-[10px] font-black bg-teal-100 text-teal-800 border border-teal-300"
                                title="ORA (TRADE_PRIORITY)"
                              >
                                ORA
                              </span>
                            )}
                          </div>

                          {hasSplit && (
                            <div className="text-[11px] text-red-600 font-medium mt-0.5">
                              ↳ Juga di Faktur:{" "}
                              {relatedInvoices.map((inv, idx) => (
                                <button
                                  key={inv}
                                  onClick={() => {
                                    if (r.no_sales_order) {
                                      setSearch(r.no_sales_order.split(",")[0].trim());
                                      setPage(1);
                                    }
                                  }}
                                  className="underline font-bold hover:text-red-800 ml-1"
                                >
                                  #{inv}{idx < relatedInvoices.length - 1 ? "," : ""}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </td>

                    {/* Nama Pelanggan */}
                    <td className="px-4 py-3">
                      <span className="font-semibold text-slate-800 block max-w-[220px] truncate" title={String(custName || "-")}>
                        {custName ? String(custName) : <span className="text-gray-400 italic">-</span>}
                      </span>
                    </td>

                    {/* Tombol Buka Daftar Barang */}
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : r.id)}
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

                    {/* Status Print / Aksi */}
                    <td className="px-4 py-3">
                      <button
                        disabled={updatingId === r.id || editingId === r.id}
                        onClick={() => toggleStatus(r)}
                        className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition shadow-sm cursor-pointer ${
                          r.status_cetak
                            ? "bg-green-100 text-green-800 border border-green-300 hover:bg-yellow-50 hover:text-yellow-800 hover:border-yellow-300"
                            : "bg-green-600 text-white hover:bg-green-700 ring-2 ring-green-600/30"
                        } ${updatingId === r.id ? "opacity-50" : ""}`}
                        title={r.status_cetak ? "Sudah selesai dicetak. Klik jika ingin membatalkan." : "Klik untuk menandai faktur ini SELESAI DICETAK dan langsung pindah ke list Sudah Print"}
                      >
                        <span>{r.status_cetak ? "✅ Sudah Print (Batalkan)" : "✓ Selesai Print"}</span>
                      </button>
                    </td>

                    {/* Tanggal Print */}
                    <td className="px-4 py-3 text-gray-500 text-xs font-mono">
                      {r.printed_at ? new Date(r.printed_at).toLocaleString("id-ID") : "-"}
                    </td>

                    {/* Aksi */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {editingId === r.id ? (
                          <>
                            <button
                              onClick={() => saveEdit(r)}
                              disabled={savingId === r.id}
                              className="px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 disabled:opacity-50"
                            >
                              {savingId === r.id ? "..." : "Simpan"}
                            </button>
                            <button
                              onClick={() => { setEditingId(null); setEditDraft({}); }}
                              className="px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs hover:bg-gray-200"
                            >
                              Batal
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => startEdit(r)}
                              className="px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs hover:bg-gray-200"
                              title="Edit"
                            >
                              ✏️
                            </button>
                            <button
                              onClick={() => deleteRecord(r.id)}
                              disabled={deletingId === r.id}
                              className="px-2 py-1 bg-red-50 text-red-600 rounded text-xs hover:bg-red-100 disabled:opacity-50"
                              title="Hapus"
                            >
                              {deletingId === r.id ? "..." : "🗑️"}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>

                  {/* ── EXPANDED ITEM ACCORDION DRAWER ── */}
                  {isExpanded && (
                    <tr className="bg-slate-100/70 border-b border-slate-300">
                      <td colSpan={8} className="px-6 py-4">
                        <div className="rounded-2xl border border-slate-300 bg-white p-5 shadow-md">
                          <div className="flex flex-wrap items-center justify-between gap-2 mb-4 pb-3 border-b border-slate-200">
                            <div>
                              <div className="flex items-center gap-2">
                                <p className="text-base font-black text-slate-900">
                                  📦 Rincian Barang — Faktur #{r.no_faktur}
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
                                No SO: <span className="font-mono font-bold text-slate-800">{r.no_sales_order || "-"}</span>
                                {custName && (
                                  <> | Pelanggan: <span className="font-bold text-blue-900">{String(custName)}</span></>
                                )}
                              </p>
                            </div>
                            <span className="text-xs font-black px-3 py-1.5 bg-blue-100 text-blue-800 rounded-lg">
                              Total: {items.length} Item Barang
                            </span>
                          </div>

                          {items.length === 0 ? (
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
                                  {items.map((it: ItemDetail, idx: number) => (
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
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {paginated.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center text-gray-400 py-10 font-medium">
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

