"use client";

import { useState, useMemo } from "react";
import masterApotekList from "@/lib/masterApotekList.json";

interface ApotekItem {
  namaApotek: string;
  kodeCustomer?: string;
  namaMerchant?: string;
  kategori: string;
  keterangan?: string;
}

const ITEMS_PER_PAGE = 50;

export default function MasterApotekModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [katFilter, setKatFilter] = useState<"all" | "1P" | "2P" | "3P">("all");
  const [page, setPage] = useState(0);

  const apotekData = masterApotekList as ApotekItem[];

  const filtered = useMemo(() => {
    let list = apotekData;

    if (katFilter !== "all") {
      list = list.filter((item) => item.kategori === katFilter);
    }

    if (search.trim()) {
      const s = search.toLowerCase().trim();
      list = list.filter(
        (item) =>
          item.namaApotek.toLowerCase().includes(s) ||
          (item.kodeCustomer && item.kodeCustomer.toLowerCase().includes(s)) ||
          (item.namaMerchant && item.namaMerchant.toLowerCase().includes(s))
      );
    }

    return list;
  }, [apotekData, katFilter, search]);

  const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
  const pageData = filtered.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold text-base shadow-sm">
              🏢
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                Master Apotek
                <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 font-semibold">
                  {filtered.length.toLocaleString("id-ID")} Apotek
                </span>
              </h2>
              <p className="text-xs text-slate-500">
                Database Klasifikasi Prioritas Apotek (1P / 2P / 3P)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 flex items-center justify-center text-lg font-bold transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Modal Filter & Search Bar */}
        <div className="p-4 border-b border-slate-100 bg-white grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2 relative">
            <span className="absolute left-3 top-2.5 text-xs text-slate-400">🔍</span>
            <input
              type="text"
              placeholder="Cari nama apotek / kode customer..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
          </div>

          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
            {(["all", "1P", "2P", "3P"] as const).map((k) => (
              <button
                key={k}
                onClick={() => {
                  setKatFilter(k);
                  setPage(0);
                }}
                className={`flex-1 py-1 rounded-lg text-xs font-bold transition-all ${
                  katFilter === k
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {k === "all" ? "Semua" : k}
              </button>
            ))}
          </div>
        </div>

        {/* Modal Table Content */}
        <div className="flex-1 overflow-y-auto p-4">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-100 text-slate-600 font-semibold border-b border-slate-200 sticky top-0 z-10">
                <th className="py-2 px-3 w-12 text-center">#</th>
                <th className="py-2 px-3">Kode Customer / Merchant</th>
                <th className="py-2 px-3">Nama Apotek (MBI)</th>
                <th className="py-2 px-3 text-center">Kategori</th>
                <th className="py-2 px-3">Keterangan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pageData.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-slate-400">
                    Tidak ditemukan data apotek yang sesuai.
                  </td>
                </tr>
              ) : (
                pageData.map((item, idx) => (
                  <tr key={idx} className="hover:bg-slate-50 transition-colors">
                    <td className="py-2 px-3 text-center text-slate-400 font-mono">
                      {page * ITEMS_PER_PAGE + idx + 1}
                    </td>
                    <td className="py-2 px-3 font-mono text-slate-600">
                      <div>{item.kodeCustomer || "-"}</div>
                      {item.namaMerchant && item.namaMerchant !== "-" && (
                        <div className="text-[10px] text-slate-400">{item.namaMerchant}</div>
                      )}
                    </td>
                    <td className="py-2 px-3 font-semibold text-slate-900">
                      {item.namaApotek}
                    </td>
                    <td className="py-2 px-3 text-center">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                          item.kategori === "1P"
                            ? "bg-blue-100 text-blue-700"
                            : item.kategori === "2P"
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-purple-100 text-purple-700"
                        }`}
                      >
                        {item.kategori}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-slate-500 text-[11px]">
                      {item.keterangan || "-"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Modal Pagination Footer */}
        {totalPages > 1 && (
          <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
            <span>
              Halaman <strong>{page + 1}</strong> dari <strong>{totalPages}</strong>
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-3 py-1 bg-white border border-slate-200 rounded-lg font-semibold disabled:opacity-40 hover:bg-slate-100"
              >
                Sebelumnya
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="px-3 py-1 bg-white border border-slate-200 rounded-lg font-semibold disabled:opacity-40 hover:bg-slate-100"
              >
                Berikutnya
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
