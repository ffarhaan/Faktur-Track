"use client";

import { useState, useMemo } from "react";
import masterProductList from "@/lib/masterProduct.json";

interface ProductItem {
  kodeBarang?: string;
  kodeOracle?: string | number;
  kodeAccurate?: string | number;
  namaBarang: string;
  kategori: string;
  klasifikasi?: string;
  kategoriWarehouse?: string;
}

const ITEMS_PER_PAGE = 50;

export default function MasterProductModal({
  isOpen,
  onClose,
  isDarkMode,
}: {
  isOpen: boolean;
  onClose: () => void;
  isDarkMode?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState<string>("all");
  const [page, setPage] = useState(0);

  const productData = masterProductList as ProductItem[];

  const filtered = useMemo(() => {
    let list = productData;

    if (catFilter !== "all") {
      list = list.filter(
        (item) => String(item.kategori || "").toUpperCase() === catFilter
      );
    }

    if (search.trim()) {
      const s = search.toLowerCase().trim();
      list = list.filter(
        (item) =>
          item.namaBarang.toLowerCase().includes(s) ||
          (item.kodeBarang && String(item.kodeBarang).toLowerCase().includes(s)) ||
          (item.kodeOracle && String(item.kodeOracle).toLowerCase().includes(s)) ||
          (item.kodeAccurate && String(item.kodeAccurate).toLowerCase().includes(s))
      );
    }

    return list;
  }, [productData, catFilter, search]);

  const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
  const pageData = filtered.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-xs animate-in fade-in duration-150">
      <div className={`border rounded-2xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden ${
        isDarkMode ? "bg-slate-900 border-slate-800 text-slate-100" : "bg-white border-slate-200 text-slate-800"
      }`}>
        {/* Modal Header */}
        <div className={`px-5 py-4 border-b flex items-center justify-between ${
          isDarkMode ? "bg-slate-900 border-slate-800" : "bg-slate-50 border-slate-200"
        }`}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-teal-600 text-white flex items-center justify-center font-bold text-base shadow-sm">
              💊
            </div>
            <div>
              <h2 className={`text-base font-bold flex items-center gap-2 ${isDarkMode ? "text-white" : "text-slate-900"}`}>
                Master Produk
                <span className="text-xs px-2 py-0.5 rounded-full bg-teal-100 text-teal-800 font-semibold">
                  {filtered.length.toLocaleString("id-ID")} Produk
                </span>
              </h2>
              <p className={`text-xs ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>
                Database Klasifikasi Kategori Produk (FARMA / ALKES / CCP / PREKURSOR / OOT)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className={`w-8 h-8 rounded-lg flex items-center justify-center text-lg font-bold transition-colors ${
              isDarkMode ? "text-slate-400 hover:text-white hover:bg-slate-800" : "text-slate-400 hover:text-slate-700 hover:bg-slate-200/60"
            }`}
          >
            ✕
          </button>
        </div>

        {/* Modal Filter & Search Bar */}
        <div className={`p-4 border-b grid grid-cols-1 sm:grid-cols-3 gap-3 ${
          isDarkMode ? "bg-slate-900 border-slate-800" : "bg-white border-slate-100"
        }`}>
          <div className="sm:col-span-2 relative">
            <span className="absolute left-3 top-2.5 text-xs text-slate-400">🔍</span>
            <input
              type="text"
              placeholder="Cari nama barang / kode oracle / kode barang..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              className={`w-full pl-8 pr-3 py-1.5 border rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 ${
                isDarkMode ? "bg-slate-800 border-slate-700 text-white placeholder-slate-500" : "bg-slate-50 border-slate-200 text-slate-800"
              }`}
            />
          </div>

          <div className={`flex items-center gap-1 p-1 rounded-xl overflow-x-auto ${isDarkMode ? "bg-slate-800" : "bg-slate-100"}`}>
            {(["all", "FARMA", "ALKES", "CCP", "PREKURSOR", "OOT"] as const).map((k) => (
              <button
                key={k}
                onClick={() => {
                  setCatFilter(k);
                  setPage(0);
                }}
                className={`flex-1 py-1 px-2 rounded-lg text-xs font-bold whitespace-nowrap transition-all ${
                  catFilter === k
                    ? (isDarkMode ? "bg-slate-700 text-white shadow-xs" : "bg-white text-slate-900 shadow-xs")
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
                isDarkMode ? "bg-slate-800 text-slate-300 border-slate-700" : "bg-slate-100 text-slate-600 border-slate-200"
              }`}>
                <th className="py-2 px-3 w-12 text-center">#</th>
                <th className="py-2 px-3">Kode Oracle</th>
                <th className="py-2 px-3">Kode Barang</th>
                <th className="py-2 px-3">Nama Barang</th>
                <th className="py-2 px-3 text-center">Kategori</th>
                <th className="py-2 px-3">Klasifikasi</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${isDarkMode ? "divide-slate-800" : "divide-slate-100"}`}>
              {pageData.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-slate-400">
                    Tidak ditemukan data produk yang sesuai.
                  </td>
                </tr>
              ) : (
                pageData.map((item, idx) => {
                  const cat = String(item.kategori || "FARMA").toUpperCase();
                  return (
                    <tr key={idx} className={`transition-colors ${isDarkMode ? "hover:bg-slate-800/60" : "hover:bg-slate-50"}`}>
                      <td className="py-2 px-3 text-center text-slate-400 font-mono">
                        {page * ITEMS_PER_PAGE + idx + 1}
                      </td>
                      <td className={`py-2 px-3 font-mono font-medium ${isDarkMode ? "text-slate-300" : "text-slate-700"}`}>
                        {item.kodeOracle || "-"}
                      </td>
                      <td className="py-2 px-3 font-mono text-slate-500">
                        {item.kodeBarang || item.kodeAccurate || "-"}
                      </td>
                      <td className={`py-2 px-3 font-semibold ${isDarkMode ? "text-slate-100" : "text-slate-900"}`}>
                        {item.namaBarang}
                      </td>
                      <td className="py-2 px-3 text-center">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold border ${
                            cat === "ALKES"
                              ? "bg-teal-50 text-teal-800 border-teal-200"
                              : cat === "CCP"
                              ? "bg-sky-50 text-sky-800 border-sky-200"
                              : cat === "PREKURSOR"
                              ? "bg-amber-50 text-amber-900 border-amber-200"
                              : cat === "OOT"
                              ? "bg-purple-50 text-purple-900 border-purple-200"
                              : "bg-indigo-50 text-indigo-700 border-indigo-200"
                          }`}
                        >
                          {cat}
                        </span>
                      </td>
                      <td className={`py-2 px-3 text-[11px] ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>
                        {item.klasifikasi || item.kategoriWarehouse || "-"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Modal Pagination Footer */}
        {totalPages > 1 && (
          <div className={`px-5 py-3 border-t flex items-center justify-between text-xs ${
            isDarkMode ? "bg-slate-900 border-slate-800 text-slate-400" : "bg-slate-50 border-slate-200 text-slate-600"
          }`}>
            <span>
              Halaman <strong>{page + 1}</strong> dari <strong>{totalPages}</strong>
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className={`px-3 py-1 border rounded-lg font-semibold disabled:opacity-40 ${
                  isDarkMode ? "bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700" : "bg-white border-slate-200 hover:bg-slate-50"
                }`}
              >
                Sebelumnya
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className={`px-3 py-1 border rounded-lg font-semibold disabled:opacity-40 ${
                  isDarkMode ? "bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700" : "bg-white border-slate-200 hover:bg-slate-50"
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
