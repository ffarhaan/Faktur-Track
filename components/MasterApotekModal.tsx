"use client";

import { useState, useMemo } from "react";
import masterApotekList from "@/lib/masterApotekList.json";
import { normalize } from "@/lib/parser";

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
  categoryOverrides,
  isDarkMode,
}: {
  isOpen: boolean;
  onClose: () => void;
  categoryOverrides?: Record<string, "1P" | "2P" | "3P">;
  isDarkMode?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [katFilter, setKatFilter] = useState<"all" | "1P" | "2P" | "3P">("all");
  const [page, setPage] = useState(0);

  const apotekData = useMemo(() => {
    const raw = masterApotekList as ApotekItem[];
    if (!categoryOverrides || Object.keys(categoryOverrides).length === 0) return raw;

    return raw.map((item) => {
      const norm = normalize(item.namaApotek);
      const customKat = categoryOverrides[norm] || categoryOverrides[item.namaApotek];
      if (customKat) {
        return {
          ...item,
          kategori: customKat,
          keterangan: item.keterangan ? `${item.keterangan} (Kustom User)` : "Kustom User",
        };
      }
      return item;
    });
  }, [categoryOverrides]);

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/75 animate-in fade-in duration-150">
      <div className={`border rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden transition-colors ${
        isDarkMode ? "bg-[#0e1628] border-slate-700/80 text-slate-100 shadow-black/60" : "bg-white border-slate-200 text-slate-800"
      }`}>
        {/* Modal Header */}
        <div className={`px-5 py-4 border-b flex items-center justify-between ${
          isDarkMode ? "bg-[#142038] border-slate-700/80" : "bg-slate-50 border-slate-200"
        }`}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 text-white flex items-center justify-center font-bold text-base shadow-sm">
              🏢
            </div>
            <div>
              <h2 className={`text-base font-bold flex items-center gap-2 ${isDarkMode ? "text-white" : "text-slate-900"}`}>
                <span>Master Apotek</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                  isDarkMode ? "bg-blue-950 text-blue-300 border border-blue-700/50" : "bg-blue-100 text-blue-800"
                }`}>
                  {filtered.length.toLocaleString("id-ID")} Apotek
                </span>
              </h2>
              <p className={`text-xs ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>
                Database Klasifikasi Prioritas Apotek (1P / 2P / 3P)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className={`w-8 h-8 rounded-lg flex items-center justify-center text-lg font-bold transition-colors ${
              isDarkMode ? "text-slate-400 hover:text-white hover:bg-[#1b2b4b]" : "text-slate-400 hover:text-slate-700 hover:bg-slate-200/60"
            }`}
          >
            ✕
          </button>
        </div>

        {/* Modal Filter & Search Bar */}
        <div className={`p-4 border-b grid grid-cols-1 sm:grid-cols-3 gap-3 ${
          isDarkMode ? "bg-[#0b1220] border-slate-800" : "bg-white border-slate-100"
        }`}>
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
              className={`w-full pl-8 pr-3 py-1.5 border rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 ${
                isDarkMode ? "bg-[#142038] border-slate-700 text-white placeholder-slate-500" : "bg-slate-50 border-slate-200 text-slate-800"
              }`}
            />
          </div>

          <div className={`flex items-center gap-1 p-1 rounded-xl ${isDarkMode ? "bg-[#142038] border border-slate-700/80" : "bg-slate-100"}`}>
            {(["all", "1P", "2P", "3P"] as const).map((k) => (
              <button
                key={k}
                onClick={() => {
                  setKatFilter(k);
                  setPage(0);
                }}
                className={`flex-1 py-1 rounded-lg text-xs font-bold transition-all ${
                  katFilter === k
                    ? (isDarkMode ? "bg-[#1d3567] text-blue-300 shadow-xs border border-blue-500/40" : "bg-white text-slate-900 shadow-xs")
                    : (isDarkMode ? "text-slate-400 hover:text-white" : "text-slate-600 hover:text-slate-900")
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
              <tr className={`font-semibold border-b sticky top-0 z-10 ${
                isDarkMode ? "bg-[#16223d] text-slate-300 border-slate-700" : "bg-slate-100 text-slate-600 border-slate-200"
              }`}>
                <th className="py-2 px-3 w-12 text-center">#</th>
                <th className="py-2 px-3">Kode Customer / Merchant</th>
                <th className="py-2 px-3">Nama Apotek (MBI)</th>
                <th className="py-2 px-3 text-center">Kategori</th>
                <th className="py-2 px-3">Keterangan</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${isDarkMode ? "divide-slate-800/80" : "divide-slate-100"}`}>
              {pageData.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-slate-400">
                    Tidak ditemukan data apotek yang sesuai.
                  </td>
                </tr>
              ) : (
                pageData.map((item, idx) => (
                  <tr key={idx} className={`transition-colors ${isDarkMode ? "hover:bg-[#142038]/70" : "hover:bg-slate-50"}`}>
                    <td className="py-2 px-3 text-center text-slate-400 font-mono">
                      {page * ITEMS_PER_PAGE + idx + 1}
                    </td>
                    <td className={`py-2 px-3 font-mono ${isDarkMode ? "text-slate-300" : "text-slate-600"}`}>
                      <div>{item.kodeCustomer || "-"}</div>
                      {item.namaMerchant && item.namaMerchant !== "-" && (
                        <div className="text-[10px] text-slate-500">{item.namaMerchant}</div>
                      )}
                    </td>
                    <td className={`py-2 px-3 font-semibold ${isDarkMode ? "text-slate-100" : "text-slate-900"}`}>
                      {item.namaApotek}
                    </td>
                    <td className="py-2 px-3 text-center">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                          item.kategori === "1P"
                            ? (isDarkMode ? "bg-[#182a4d] text-blue-300 border border-blue-600/60" : "bg-blue-100 text-blue-700")
                            : item.kategori === "2P"
                            ? (isDarkMode ? "bg-[#143329] text-emerald-300 border border-emerald-600/60" : "bg-emerald-100 text-emerald-700")
                            : (isDarkMode ? "bg-[#2f1b47] text-purple-300 border border-purple-600/60" : "bg-purple-100 text-purple-700")
                        }`}
                      >
                        {item.kategori}
                      </span>
                    </td>
                    <td className={`py-2 px-3 text-[11px] ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>
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
          <div className={`px-5 py-3 border-t flex items-center justify-between text-xs ${
            isDarkMode ? "bg-[#142038] border-slate-700/80 text-slate-400" : "bg-slate-50 border-slate-200 text-slate-600"
          }`}>
            <span>
              Halaman <strong>{page + 1}</strong> dari <strong>{totalPages}</strong>
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className={`px-3 py-1 border rounded-lg font-semibold disabled:opacity-40 ${
                  isDarkMode ? "bg-[#1b2b4b] border-slate-700 text-slate-200 hover:bg-[#253961]" : "bg-white border-slate-200 hover:bg-slate-50"
                }`}
              >
                Sebelumnya
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className={`px-3 py-1 border rounded-lg font-semibold disabled:opacity-40 ${
                  isDarkMode ? "bg-[#1b2b4b] border-slate-700 text-slate-200 hover:bg-[#253961]" : "bg-white border-slate-200 hover:bg-slate-50"
                }`}
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
