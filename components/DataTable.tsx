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

type StatusFilter = "all" | "printed" | "not_printed";
type DateFilter = "all" | "today" | "7days" | "30days";

const PAGE_SIZE = 50;
const NEW_THRESHOLD_MS = 24 * 60 * 60 * 1000;

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
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [onlySplitSo, setOnlySplitSo] = useState(false);
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

  const effectiveStatusFilter: StatusFilter =
    highlightImportedAt ? "not_printed" : statusFilter;

  // ── Statistik ──────────────────────────────────────────────────
  const stats = useMemo(() => {
    const total = records.length;
    const printed = records.filter((r) => r.status_cetak).length;
    const notPrinted = total - printed;
    const newItems = records.filter((r) => isNew(r.imported_at)).length;
    const splitCount = records.filter((r) => getRelatedInvoices(r).length > 0).length;
    return { total, printed, notPrinted, newItems, splitCount };
  }, [records, soToInvoicesMap]);

  // ── Filter & Urutkan Faktur Terbaru (Angka Terbesar) di Paling Atas ─
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
        // Cek search juga ke nama pelanggan & nama barang di items
        const custName = r.extra?.nama_pelanggan ? String(r.extra.nama_pelanggan).toLowerCase() : "";
        const itemNames = (r.extra?.items || [])
          .map((it: ItemDetail) => `${it.item_code} ${it.item_description}`)
          .join(" ")
          .toLowerCase();

        const matchesSearch =
          !q ||
          r.no_faktur?.toLowerCase().includes(q) ||
          r.no_sales_order?.toLowerCase().includes(q) ||
          custName.includes(q) ||
          itemNames.includes(q);

        const matchesStatus =
          effectiveStatusFilter === "all" ||
          (effectiveStatusFilter === "printed" && r.status_cetak) ||
          (effectiveStatusFilter === "not_printed" && !r.status_cetak);

        const matchesDate =
          dateFilter === "all" ||
          new Date(r.imported_at).getTime() >= cutoffs[dateFilter];

        const matchesHighlight =
          !highlightImportedAt ||
          r.imported_at === highlightImportedAt ||
          Math.abs(new Date(r.imported_at).getTime() - new Date(highlightImportedAt).getTime()) < 5000;

        const matchesSplit = !onlySplitSo || getRelatedInvoices(r).length > 0;

        return matchesSearch && matchesStatus && matchesDate && matchesHighlight && matchesSplit;
      })
      .sort((a, b) => {
        const numA = parseFakturNum(a.no_faktur);
        const numB = parseFakturNum(b.no_faktur);
        if (numA !== numB) {
          return numB - numA;
        }
        return (b.no_faktur || "").localeCompare(a.no_faktur || "", undefined, { numeric: true });
      });
  }, [records, search, effectiveStatusFilter, dateFilter, highlightImportedAt, onlySplitSo, soToInvoicesMap]);

  // ── Pagination ──────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // ── Actions ─────────────────────────────────────────────────────
  async function toggleStatus(record: FakturRecord) {
    const newStatus = !record.status_cetak;
    const nowIso = new Date().toISOString();

    // Optimistic Update: Langsung ubah warna & status di layar tanpa nunggu loading
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
      alert("Gagal update status di server: " + error.message);
      // Revert if error
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

    // Optimistic update
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
    if (!confirm("Hapus data ini?")) return;
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
    const rows = filtered.map((r) => ({
      "No Invoice AR": r.no_faktur,
      "Order Number (SO)": r.no_sales_order,
      "Nama Pelanggan": r.extra?.nama_pelanggan ?? "",
      "Jumlah Item": r.extra?.items?.length ?? 0,
      "Status Cetak": r.status_cetak ? "Sudah Print" : "Belum Print",
      "Tanggal Print": r.printed_at ? new Date(r.printed_at).toLocaleString("id-ID") : "",
      "Tanggal Import": new Date(r.imported_at).toLocaleString("id-ID"),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Data Faktur");
    XLSX.writeFile(wb, `faktur-export-${Date.now()}.xlsx`);
  }

  // ── Row styling ─────────────────────────────────────────────────
  function rowClass(r: FakturRecord, hasSplit: boolean) {
    if (hasSplit && !r.status_cetak) {
      return "border-t border-red-200 bg-red-50/70 hover:bg-red-100/70 border-l-4 border-l-red-500";
    }
    if (hasSplit && r.status_cetak) {
      return "border-t border-red-200 bg-green-50/70 hover:bg-green-100 border-l-4 border-l-red-400";
    }
    if (r.status_cetak) return "border-t border-gray-100 bg-green-50 hover:bg-green-100";
    if (isNew(r.imported_at)) return "border-t border-yellow-200 bg-yellow-50 hover:bg-yellow-100";
    return "border-t border-gray-100 hover:bg-gray-50";
  }

  return (
    <div>
      {/* ── Statistik Interaktif (Klik kartu mana saja untuk memfilter atau reset) ── */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5">
        {[
          {
            label: "Total Data",
            value: stats.total,
            sub: "Tampilkan Semua",
            isActive: statusFilter === "all" && !onlySplitSo && dateFilter === "all" && !highlightImportedAt && !search,
            color: (statusFilter === "all" && !onlySplitSo && dateFilter === "all" && !highlightImportedAt && !search)
              ? "bg-slate-800 text-white shadow-md ring-2 ring-slate-900"
              : "bg-slate-100 text-slate-800 hover:bg-slate-200",
            onClick: () => {
              setStatusFilter("all");
              setOnlySplitSo(false);
              setDateFilter("all");
              setSearch("");
              onClearHighlight();
              setPage(1);
            },
          },
          {
            label: "Sudah Print",
            value: stats.printed,
            sub: "Filter Sudah Print",
            isActive: statusFilter === "printed" && !onlySplitSo,
            color: (statusFilter === "printed" && !onlySplitSo)
              ? "bg-green-600 text-white shadow-md ring-2 ring-green-700"
              : "bg-green-50 text-green-700 border border-green-200 hover:bg-green-100",
            onClick: () => {
              setStatusFilter(statusFilter === "printed" ? "all" : "printed");
              setOnlySplitSo(false);
              onClearHighlight();
              setPage(1);
            },
          },
          {
            label: "Belum Print",
            value: stats.notPrinted,
            sub: "Filter Belum Print",
            isActive: statusFilter === "not_printed" && !onlySplitSo,
            color: (statusFilter === "not_printed" && !onlySplitSo)
              ? "bg-yellow-500 text-white shadow-md ring-2 ring-yellow-600"
              : "bg-yellow-50 text-yellow-800 border border-yellow-200 hover:bg-yellow-100",
            onClick: () => {
              setStatusFilter(statusFilter === "not_printed" ? "all" : "not_printed");
              setOnlySplitSo(false);
              onClearHighlight();
              setPage(1);
            },
          },
          {
            label: "Baru (<24 jam)",
            value: stats.newItems,
            sub: "Filter Data Hari Ini",
            isActive: dateFilter === "today" && !onlySplitSo,
            color: (dateFilter === "today" && !onlySplitSo)
              ? "bg-blue-600 text-white shadow-md ring-2 ring-blue-700"
              : "bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100",
            onClick: () => {
              setDateFilter(dateFilter === "today" ? "all" : "today");
              setOnlySplitSo(false);
              setPage(1);
            },
          },
          {
            label: "⚠️ 1 SO 2+ Faktur",
            value: stats.splitCount,
            sub: "Filter Pecah Inv",
            isActive: onlySplitSo,
            color: onlySplitSo
              ? "bg-red-600 text-white shadow-md ring-2 ring-red-700"
              : "bg-red-50 text-red-700 border border-red-200 hover:bg-red-100",
            onClick: () => {
              setOnlySplitSo((s) => !s);
              setPage(1);
            },
          },
        ].map((s) => (
          <div
            key={s.label}
            onClick={s.onClick}
            className={`rounded-xl px-4 py-3 transition cursor-pointer select-none ${s.color}`}
            title={`Klik untuk ${s.sub}`}
          >
            <div className="flex items-baseline justify-between">
              <p className="text-2xl font-bold">{s.value}</p>
              {s.isActive && (
                <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/20">
                  Aktif
                </span>
              )}
            </div>
            <p className="text-xs font-semibold mt-0.5">{s.label}</p>
            <p className="text-[10px] opacity-75 mt-0.5">
              {s.isActive ? "Klik untuk lepas filter" : "Klik untuk filter"}
            </p>
          </div>
        ))}
      </div>

      {/* ── Highlight aktif banner ── */}
      {highlightImportedAt && (
        <div className="mb-3 flex items-center gap-2 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
          <span>🔍 Menampilkan data baru belum diprint dari sesi import terakhir</span>
          <button onClick={onClearHighlight} className="ml-auto underline font-medium">
            Hapus filter
          </button>
        </div>
      )}

      {onlySplitSo && (
        <div className="mb-3 flex items-center gap-2 text-xs text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <span>⚠️ <strong>Filter Aktif:</strong> Hanya menampilkan SO yang terpecah menjadi 2 atau lebih Faktur/Invoice.</span>
          <button onClick={() => setOnlySplitSo(false)} className="ml-auto underline font-semibold text-red-700">
            Tampilkan Semua
          </button>
        </div>
      )}

      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          type="text"
          placeholder="Cari No Invoice / SO / Nama Pelanggan / Barang..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm flex-1 min-w-[220px]"
        />
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value as StatusFilter); setPage(1); onClearHighlight(); }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
        >
          <option value="all">Semua Status</option>
          <option value="printed">Sudah Print</option>
          <option value="not_printed">Belum Print</option>
        </select>
        <select
          value={dateFilter}
          onChange={(e) => { setDateFilter(e.target.value as DateFilter); setPage(1); }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
        >
          <option value="all">Semua Tanggal</option>
          <option value="today">Hari ini</option>
          <option value="7days">7 hari terakhir</option>
          <option value="30days">30 hari terakhir</option>
        </select>
        <button
          onClick={() => { setOnlySplitSo((s) => !s); setPage(1); }}
          className={`px-3 py-2 rounded-lg text-sm font-medium border transition ${
            onlySplitSo
              ? "bg-red-600 text-white border-red-600"
              : "bg-white text-red-700 border-red-300 hover:bg-red-50"
          }`}
        >
          {onlySplitSo ? "✓ Filter 1 SO 2+ Inv Aktif" : "⚠️ Filter 1 SO 2+ Inv"}
        </button>
        <button
          onClick={exportToExcel}
          className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700"
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
              ✓ Tandai Sudah Print
            </button>
            <button
              onClick={() => setBulkStatus(false)}
              className="px-3 py-1.5 bg-yellow-500 text-white rounded-lg text-xs font-bold hover:bg-yellow-600 shadow-sm transition"
            >
              ✕ Tandai Belum Print
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
        Menampilkan {filtered.length} dari {records.length} data
        {totalPages > 1 && ` — Hal. ${safePage} / ${totalPages}`}
      </p>

      {/* ── Tabel ── */}
      <div className="overflow-x-auto border border-gray-200 rounded-xl">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 w-10">
                <input
                  type="checkbox"
                  checked={paginated.length > 0 && selectedIds.size === paginated.length}
                  onChange={toggleSelectAll}
                />
              </th>
              <th className="text-left px-4 py-2 font-medium text-gray-600">No Invoice AR</th>
              <th className="text-left px-4 py-2 font-medium text-gray-600">Order Number (SO)</th>
              <th className="text-left px-4 py-2 font-medium text-gray-600">Pelanggan &amp; Barang</th>
              <th className="text-left px-4 py-2 font-medium text-gray-600">Status Cetak</th>
              <th className="text-left px-4 py-2 font-medium text-gray-600">Tanggal Print</th>
              <th className="text-left px-4 py-2 font-medium text-gray-600">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {paginated.map((r) => {
              const relatedInvoices = getRelatedInvoices(r);
              const hasSplit = relatedInvoices.length > 0;
              const isExpanded = expandedId === r.id;
              const items = r.extra?.items || [];
              const custName = r.extra?.nama_pelanggan;

              return (
                <Fragment key={r.id}>
                  <tr className={rowClass(r, hasSplit)}>
                    <td className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(r.id)}
                        onChange={() => toggleSelect(r.id)}
                      />
                    </td>

                    {/* No Invoice AR */}
                    <td className="px-4 py-2 font-medium">
                      {editingId === r.id ? (
                        <input
                          value={editDraft.no_faktur ?? ""}
                          onChange={(e) => setEditDraft((d) => ({ ...d, no_faktur: e.target.value }))}
                          className="border border-blue-300 rounded px-2 py-0.5 text-sm w-full"
                        />
                      ) : (
                        <div className="flex flex-col">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-gray-900">{r.no_faktur}</span>
                            {isNew(r.imported_at) && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-700">
                                BARU
                              </span>
                            )}
                            {hasSplit && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700 border border-red-200">
                                ⚠️ 1 SO {relatedInvoices.length + 1} Faktur
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </td>

                    {/* No SO */}
                    <td className="px-4 py-2">
                      {editingId === r.id ? (
                        <input
                          value={editDraft.no_sales_order ?? ""}
                          onChange={(e) => setEditDraft((d) => ({ ...d, no_sales_order: e.target.value }))}
                          className="border border-blue-300 rounded px-2 py-0.5 text-sm w-full"
                        />
                      ) : (
                        <div>
                          <span
                            onClick={() => {
                              if (r.no_sales_order) {
                                setSearch(r.no_sales_order.split(",")[0].trim());
                                setPage(1);
                              }
                            }}
                            className="font-mono text-gray-800 cursor-pointer hover:underline"
                            title="Klik untuk tampilkan semua faktur dari SO ini (atas-bawah)"
                          >
                            {r.no_sales_order ?? "-"}
                          </span>

                          {hasSplit && (
                            <div className="text-[11px] text-red-600 font-medium mt-0.5">
                              ↳ Ada di Faktur lain:{" "}
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

                    {/* Pelanggan & Barang */}
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : r.id)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition"
                        >
                          <span>{isExpanded ? "▼ Tutup Barang" : `📦 ${items.length || "Lihat"} Barang`}</span>
                        </button>
                        {custName && (
                          <span className="text-xs text-gray-600 truncate max-w-[150px]" title={String(custName)}>
                            {String(custName)}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Status Print / Done */}
                    <td className="px-4 py-2">
                      <button
                        disabled={updatingId === r.id || editingId === r.id}
                        onClick={() => toggleStatus(r)}
                        className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition shadow-sm cursor-pointer ${
                          r.status_cetak
                            ? "bg-green-50 text-green-800 border border-green-300 hover:bg-yellow-50 hover:text-yellow-800 hover:border-yellow-300"
                            : "bg-green-600 text-white hover:bg-green-700 ring-2 ring-green-600/30"
                        } ${updatingId === r.id ? "opacity-50" : ""}`}
                        title={r.status_cetak ? "Sudah selesai dicetak. Klik jika ingin membatalkan." : "Klik untuk menandai faktur ini SELESAI DICETAK dan langsung pindah ke list Sudah Print"}
                      >
                        <span>{r.status_cetak ? "✅ Sudah Print (Batalkan)" : "✓ Selesai Print"}</span>
                      </button>
                    </td>

                    {/* Tanggal Print */}
                    <td className="px-4 py-2 text-gray-500 text-xs">
                      {r.printed_at ? new Date(r.printed_at).toLocaleString("id-ID") : "-"}
                    </td>

                    {/* Aksi */}
                    <td className="px-4 py-2">
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
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <td colSpan={7} className="px-6 py-4">
                        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                          <div className="flex flex-wrap items-center justify-between gap-2 mb-3 pb-2 border-b border-gray-100">
                            <div>
                              <p className="text-sm font-bold text-gray-800">
                                📦 Rincian Barang — Faktur #{r.no_faktur} (SO: {r.no_sales_order || "-"})
                              </p>
                              {custName && (
                                <p className="text-xs text-gray-500 mt-0.5">
                                  Pelanggan: <span className="font-semibold text-gray-700">{String(custName)}</span>
                                </p>
                              )}
                            </div>
                            <span className="text-xs font-semibold px-2 py-1 bg-slate-100 text-slate-700 rounded-md">
                              Total: {items.length} Item
                            </span>
                          </div>

                          {items.length === 0 ? (
                            <p className="text-xs text-gray-400 italic py-2">
                              Tidak ada rincian item barang pada import ini.
                            </p>
                          ) : (
                            <div className="overflow-x-auto">
                              <table className="min-w-full text-xs">
                                <thead className="bg-slate-100 text-slate-700">
                                  <tr>
                                    <th className="px-3 py-1.5 text-center font-semibold w-8">#</th>
                                    <th className="px-3 py-1.5 text-left font-semibold">Kode Barang</th>
                                    <th className="px-3 py-1.5 text-left font-semibold">Nama Barang (Description)</th>
                                    <th className="px-3 py-1.5 text-center font-semibold">Qty</th>
                                    <th className="px-3 py-1.5 text-center font-semibold">Satuan</th>
                                    <th className="px-3 py-1.5 text-left font-semibold">LOT Number</th>
                                    <th className="px-3 py-1.5 text-right font-semibold">Harga Jual</th>
                                    <th className="px-3 py-1.5 text-right font-semibold">Total Harga</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                  {items.map((it: ItemDetail, idx: number) => (
                                    <tr key={idx} className="hover:bg-slate-50/80">
                                      <td className="px-3 py-2 text-center text-gray-400 font-mono">{idx + 1}</td>
                                      <td className="px-3 py-2 font-mono text-gray-700">{it.item_code ?? "-"}</td>
                                      <td className="px-3 py-2 font-medium text-gray-900">{it.item_description ?? "-"}</td>
                                      <td className="px-3 py-2 text-center font-bold text-blue-700">{it.qty ?? "-"}</td>
                                      <td className="px-3 py-2 text-center text-gray-600">{it.uom ?? "-"}</td>
                                      <td className="px-3 py-2 font-mono text-gray-600">{it.lot_number ?? "-"}</td>
                                      <td className="px-3 py-2 text-right text-gray-600">{formatRp(it.harga_jual)}</td>
                                      <td className="px-3 py-2 text-right font-semibold text-gray-900">{formatRp(it.total_harga)}</td>
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
                <td colSpan={7} className="text-center text-gray-400 py-8">
                  Tidak ada data.
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
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm disabled:opacity-40 hover:bg-gray-50"
          >
            ← Prev
          </button>
          <span className="text-sm text-gray-600">
            Hal {safePage} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={safePage === totalPages}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm disabled:opacity-40 hover:bg-gray-50"
          >
            Next →
          </button>
        </div>
      )}

      {/* ── Legend ── */}
      <div className="flex flex-wrap gap-3 mt-4 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm bg-red-100 border border-red-300 inline-block" />
          <span className="text-red-700 font-medium">1 SO 2+ Faktur (Pecah Invoice)</span>
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm bg-yellow-50 border border-yellow-200 inline-block" />
          Baru belum diprint
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm bg-green-50 border border-green-200 inline-block" />
          Sudah diprint
        </span>
        <span className="flex items-center gap-1">
          <span className="px-1 rounded text-[9px] font-bold bg-blue-100 text-blue-700">BARU</span>
          Diimport dalam 24 jam terakhir
        </span>
      </div>
    </div>
  );
}
