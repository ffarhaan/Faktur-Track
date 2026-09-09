"use client";

import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabaseClient";
import { FakturRecord } from "@/lib/types";

type Props = {
  records: FakturRecord[];
  onRecordUpdated: (updated: FakturRecord) => void;
  onRecordDeleted: (id: string) => void;
  highlightImportedAt: string | null;   // timestamp sesi import "Lihat data baru"
  onClearHighlight: () => void;
};

type StatusFilter = "all" | "printed" | "not_printed";
type DateFilter = "all" | "today" | "7days" | "30days";

const PAGE_SIZE = 50;

// Threshold "data baru" = 24 jam
const NEW_THRESHOLD_MS = 24 * 60 * 60 * 1000;

function isNew(importedAt: string) {
  return Date.now() - new Date(importedAt).getTime() < NEW_THRESHOLD_MS;
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
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<FakturRecord>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  // Bulk select
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deletingBulk, setDeletingBulk] = useState(false);

  // Kalau highlightImportedAt aktif, otomatis filter ke data baru belum print
  const effectiveStatusFilter: StatusFilter =
    highlightImportedAt ? "not_printed" : statusFilter;

  // ── Statistik ──────────────────────────────────────────────────
  const stats = useMemo(() => {
    const total = records.length;
    const printed = records.filter((r) => r.status_cetak).length;
    const notPrinted = total - printed;
    const newItems = records.filter((r) => isNew(r.imported_at)).length;
    return { total, printed, notPrinted, newItems };
  }, [records]);

  // ── Filter ──────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const now = Date.now();
    const cutoffs: Record<DateFilter, number> = {
      all: 0,
      today: now - 24 * 60 * 60 * 1000,
      "7days": now - 7 * 24 * 60 * 60 * 1000,
      "30days": now - 30 * 24 * 60 * 60 * 1000,
    };

    return records.filter((r) => {
      const matchesSearch =
        !q ||
        r.no_faktur?.toLowerCase().includes(q) ||
        r.no_delivery_order?.toLowerCase().includes(q) ||
        r.no_sales_order?.toLowerCase().includes(q);

      const matchesStatus =
        effectiveStatusFilter === "all" ||
        (effectiveStatusFilter === "printed" && r.status_cetak) ||
        (effectiveStatusFilter === "not_printed" && !r.status_cetak);

      const matchesDate =
        dateFilter === "all" ||
        new Date(r.imported_at).getTime() >= cutoffs[dateFilter];

      // Kalau highlight aktif, hanya tampilkan dari sesi import itu
      const matchesHighlight =
        !highlightImportedAt ||
        r.imported_at === highlightImportedAt ||
        // toleransi ±5 detik karena batch bisa beda beberapa ms
        Math.abs(new Date(r.imported_at).getTime() - new Date(highlightImportedAt).getTime()) < 5000;

      return matchesSearch && matchesStatus && matchesDate && matchesHighlight;
    });
  }, [records, search, effectiveStatusFilter, dateFilter, highlightImportedAt]);

  // ── Pagination ──────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // ── Actions ─────────────────────────────────────────────────────
  async function toggleStatus(record: FakturRecord) {
    setUpdatingId(record.id);
    const newStatus = !record.status_cetak;
    const { data, error } = await supabase
      .from("faktur_records")
      .update({
        status_cetak: newStatus,
        printed_at: newStatus ? new Date().toISOString() : null,
      })
      .eq("id", record.id)
      .select()
      .single();
    setUpdatingId(null);
    if (error) { alert("Gagal update status: " + error.message); return; }
    if (data) onRecordUpdated(data as FakturRecord);
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
      no_delivery_order: record.no_delivery_order,
      no_sales_order: record.no_sales_order,
    });
  }

  async function saveEdit(record: FakturRecord) {
    setSavingId(record.id);
    const { data, error } = await supabase
      .from("faktur_records")
      .update({
        no_faktur: editDraft.no_faktur ?? record.no_faktur,
        no_delivery_order: editDraft.no_delivery_order ?? null,
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
      "No Faktur": r.no_faktur,
      "No Delivery Order": r.no_delivery_order,
      "No Sales Order": r.no_sales_order,
      "Status Cetak": r.status_cetak ? "Sudah Print" : "Belum Print",
      "Tanggal Print": r.printed_at ? new Date(r.printed_at).toLocaleString("id-ID") : "",
      "Tanggal Import": new Date(r.imported_at).toLocaleString("id-ID"),
      ...r.extra,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Data Faktur");
    XLSX.writeFile(wb, `faktur-export-${Date.now()}.xlsx`);
  }

  // ── Row styling ─────────────────────────────────────────────────
  function rowClass(r: FakturRecord) {
    if (r.status_cetak) return "border-t border-gray-100 bg-green-50 hover:bg-green-100";
    if (isNew(r.imported_at)) return "border-t border-yellow-200 bg-yellow-50 hover:bg-yellow-100";
    return "border-t border-gray-100 hover:bg-gray-50";
  }

  return (
    <div>
      {/* ── Statistik ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        {[
          { label: "Total", value: stats.total, color: "bg-gray-100 text-gray-700" },
          { label: "Sudah Print", value: stats.printed, color: "bg-green-100 text-green-700" },
          { label: "Belum Print", value: stats.notPrinted, color: "bg-yellow-100 text-yellow-700" },
          { label: "Baru (<24 jam)", value: stats.newItems, color: "bg-blue-100 text-blue-700" },
        ].map((s) => (
          <div key={s.label} className={`rounded-xl px-4 py-3 ${s.color}`}>
            <p className="text-2xl font-bold">{s.value}</p>
            <p className="text-xs font-medium mt-0.5">{s.label}</p>
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

      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          type="text"
          placeholder="Cari No Faktur / DO / SO..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm flex-1 min-w-[180px]"
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
          onClick={exportToExcel}
          className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700"
        >
          Export Excel
        </button>
        {selectedIds.size > 0 && (
          <button
            onClick={deleteBulk}
            disabled={deletingBulk}
            className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50"
          >
            {deletingBulk ? "Menghapus..." : `Hapus ${selectedIds.size} dipilih`}
          </button>
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
              <th className="px-3 py-2">
                <input
                  type="checkbox"
                  checked={paginated.length > 0 && selectedIds.size === paginated.length}
                  onChange={toggleSelectAll}
                />
              </th>
              <th className="text-left px-4 py-2 font-medium text-gray-600">No Faktur</th>
              <th className="text-left px-4 py-2 font-medium text-gray-600">No Delivery Order</th>
              <th className="text-left px-4 py-2 font-medium text-gray-600">No Sales Order</th>
              <th className="text-left px-4 py-2 font-medium text-gray-600">Status</th>
              <th className="text-left px-4 py-2 font-medium text-gray-600">Tanggal Print</th>
              <th className="text-left px-4 py-2 font-medium text-gray-600">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {paginated.map((r) => (
              <tr key={r.id} className={rowClass(r)}>
                <td className="px-3 py-2 text-center">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(r.id)}
                    onChange={() => toggleSelect(r.id)}
                  />
                </td>

                {/* No Faktur */}
                <td className="px-4 py-2 font-medium">
                  {editingId === r.id ? (
                    <input
                      value={editDraft.no_faktur ?? ""}
                      onChange={(e) => setEditDraft((d) => ({ ...d, no_faktur: e.target.value }))}
                      className="border border-blue-300 rounded px-2 py-0.5 text-sm w-full"
                    />
                  ) : (
                    <span className="flex items-center gap-1">
                      {r.no_faktur}
                      {isNew(r.imported_at) && (
                        <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-700">
                          BARU
                        </span>
                      )}
                    </span>
                  )}
                </td>

                {/* No DO */}
                <td className="px-4 py-2">
                  {editingId === r.id ? (
                    <input
                      value={editDraft.no_delivery_order ?? ""}
                      onChange={(e) => setEditDraft((d) => ({ ...d, no_delivery_order: e.target.value }))}
                      className="border border-blue-300 rounded px-2 py-0.5 text-sm w-full"
                    />
                  ) : (
                    r.no_delivery_order ?? "-"
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
                    r.no_sales_order ?? "-"
                  )}
                </td>

                {/* Status */}
                <td className="px-4 py-2">
                  <button
                    disabled={updatingId === r.id || editingId === r.id}
                    onClick={() => toggleStatus(r)}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition ${
                      r.status_cetak
                        ? "bg-green-200 text-green-800 hover:bg-green-300"
                        : "bg-yellow-100 text-yellow-700 hover:bg-yellow-200"
                    } ${updatingId === r.id ? "opacity-50" : ""}`}
                  >
                    {r.status_cetak ? "✓ Sudah Print" : "Belum Print"}
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
            ))}
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


