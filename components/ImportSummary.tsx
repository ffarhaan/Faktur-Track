"use client";

type Props = {
  totalImported: number;       // total baris yang diproses di sesi ini
  newCount: number;            // no faktur yang baru muncul (belum ada sebelumnya)
  newUnprintedCount: number;   // dari yang baru, berapa yang belum diprint
  importedAt: string;          // timestamp sesi import (ISO string)
  onDismiss: () => void;
  onViewNew: () => void;       // callback: filter tabel ke data baru belum diprint
};

export default function ImportSummary({
  totalImported,
  newCount,
  newUnprintedCount,
  importedAt,
  onDismiss,
  onViewNew,
}: Props) {
  const sessionLabel = new Date(importedAt).toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <p className="text-sm font-semibold text-blue-900 mb-2">
            ✅ Import berhasil — {sessionLabel}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-blue-100 text-blue-700 font-bold text-sm">
                {totalImported}
              </span>
              <span className="text-xs text-blue-700">Total baris diimport</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-100 text-indigo-700 font-bold text-sm">
                {newCount}
              </span>
              <span className="text-xs text-indigo-700">No Faktur baru</span>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center justify-center w-8 h-8 rounded-lg font-bold text-sm ${
                  newUnprintedCount > 0
                    ? "bg-yellow-100 text-yellow-700"
                    : "bg-green-100 text-green-700"
                }`}
              >
                {newUnprintedCount}
              </span>
              <span
                className={`text-xs ${
                  newUnprintedCount > 0 ? "text-yellow-700" : "text-green-700"
                }`}
              >
                {newUnprintedCount > 0
                  ? "Baru belum diprint"
                  : "Semua sudah diprint ✓"}
              </span>
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-1 shrink-0">
          {newUnprintedCount > 0 && (
            <button
              onClick={onViewNew}
              className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700"
            >
              Lihat data baru
            </button>
          )}
          <button
            onClick={onDismiss}
            className="px-3 py-1.5 bg-white border border-blue-200 text-blue-600 rounded-lg text-xs font-medium hover:bg-blue-50"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
}
