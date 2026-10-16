"use client";

import { useState, useMemo } from "react";
import masterProductList from "@/lib/masterProduct.json";
import { normalize } from "@/lib/parser";

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

function getEffectiveCategory(
  item: ProductItem,
  productOverrides?: Record<string, string>
): { category: string; isCustom: boolean } {
  if (productOverrides && Object.keys(productOverrides).length > 0) {
    const codes = [item.kodeBarang, item.kodeOracle, item.kodeAccurate]
      .filter(Boolean)
      .map((c) => String(c).trim());

    for (const c of codes) {
      if (productOverrides[c]) return { category: productOverrides[c].toUpperCase(), isCustom: true };
      const num = c.replace(/[^0-9]/g, "");
      if (num && productOverrides[num]) return { category: productOverrides[num].toUpperCase(), isCustom: true };
    }
    const norm = normalize(item.namaBarang);
    if (productOverrides[norm]) return { category: productOverrides[norm].toUpperCase(), isCustom: true };
    const rawTrim = item.namaBarang.trim();
    if (productOverrides[rawTrim]) return { category: productOverrides[rawTrim].toUpperCase(), isCustom: true };
  }

  return { category: (item.kategori || "FARMA").toUpperCase(), isCustom: false };
}

export default function MasterProductModal({
  isOpen,
  onClose,
  productOverrides,
  onUpdateCategory,
  isReadOnly,
  isDarkMode,
}: {
  isOpen: boolean;
  onClose: () => void;
  productOverrides?: Record<string, string>;
  onUpdateCategory?: (code: string, name: string, newCategory: string) => void;
  isReadOnly?: boolean;
  isDarkMode?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState<string>("all");
  const [page, setPage] = useState(0);

  const productData = masterProductList as ProductItem[];

  const filtered = useMemo(() => {
    let list = productData;

    if (catFilter !== "all") {
      list = list.filter((item) => {
        const { category } = getEffectiveCategory(item, productOverrides);
        return category === catFilter;
      });
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
  }, [productData, catFilter, search, productOverrides]);

  const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
  const pageData = filtered.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/75 animate-in fade-in duration-150">
      <div className={`border rounded-2xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden transition-colors ${
        isDarkMode ? "bg-[#0e1628] border-slate-700/80 text-slate-100 shadow-black/60" : "bg-white border-slate-200 text-slate-800"
      }`}>
        {/* Modal Header */}
        <div className={`px-5 py-4 border-b flex items-center justify-between ${
          isDarkMode ? "bg-[#142038] border-slate-700/80" : "bg-slate-50 border-slate-200"
        }`}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-teal-500 to-emerald-600 text-white flex items-center justify-center font-bold text-base shadow-sm">
              💊
            </div>
            <div>
              <h2 className={`text-base font-bold flex items-center gap-2 ${isDarkMode ? "text-white" : "text-slate-900"}`}>
                <span>Master Produk</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                  isDarkMode ? "bg-teal-950 text-teal-300 border border-teal-700/50" : "bg-teal-100 text-teal-800"
                }`}>
                  {filtered.length.toLocaleString("id-ID")} Produk
                </span>
              </h2>
              <p className={`text-xs ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>
                Database Klasifikasi Kategori Produk (FARMA / ALKES / CCP / PREKURSOR / OOT) — Ubah & Simpan Permanen
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
              placeholder="Cari nama barang / kode oracle / kode barang..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              className={`w-full pl-8 pr-3 py-1.5 border rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500 ${
                isDarkMode ? "bg-[#142038] border-slate-700 text-white placeholder-slate-500" : "bg-slate-50 border-slate-200 text-slate-800"
              }`}
            />
          </div>

          <div className={`flex items-center gap-1 p-1 rounded-xl overflow-x-auto ${isDarkMode ? "bg-[#142038] border border-slate-700/80" : "bg-slate-100"}`}>
            {(["all", "FARMA", "ALKES", "CCP", "PREKURSOR", "OOT"] as const).map((k) => (
              <button
                key={k}
                onClick={() => {
                  setCatFilter(k);
                  setPage(0);
                }}
                className={`flex-1 py-1 px-2 rounded-lg text-xs font-bold whitespace-nowrap transition-all ${
                  catFilter === k
                    ? (isDarkMode ? "bg-[#1d3567] text-teal-300 shadow-xs border border-teal-500/40" : "bg-white text-slate-900 shadow-xs")
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
                <th className="py-2 px-3">Kode Oracle</th>
                <th className="py-2 px-3">Kode Barang</th>
                <th className="py-2 px-3">Nama Barang</th>
                <th className="py-2 px-3 text-center">Kategori</th>
                <th className="py-2 px-3">Klasifikasi Asli</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${isDarkMode ? "divide-slate-800/80" : "divide-slate-100"}`}>
              {pageData.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-slate-400">
                    Tidak ditemukan data produk yang sesuai.
                  </td>
                </tr>
              ) : (
                pageData.map((item, idx) => {
                  const { category: cat, isCustom } = getEffectiveCategory(item, productOverrides);
                  const primaryCode = String(item.kodeBarang || item.kodeOracle || item.kodeAccurate || "").trim();

                  return (
                    <tr key={idx} className={`transition-colors ${isDarkMode ? "hover:bg-[#142038]/70" : "hover:bg-slate-50"}`}>
                      <td className="py-2 px-3 text-center text-slate-400 font-mono text-[11px]">
                        {page * ITEMS_PER_PAGE + idx + 1}
                      </td>
                      <td className={`py-2 px-3 font-mono font-medium ${isDarkMode ? "text-slate-300" : "text-slate-700"}`}>
                        {item.kodeOracle || "-"}
                      </td>
                      <td className={`py-2 px-3 font-mono ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>
                        {item.kodeBarang || item.kodeAccurate || "-"}
                      </td>
                      <td className={`py-2 px-3 font-semibold ${isDarkMode ? "text-slate-100" : "text-slate-900"}`}>
                        {item.namaBarang}
                      </td>
                      <td className="py-2 px-3 text-center">
                        {isReadOnly ? (
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold border ${
                              cat === "ALKES"
                                ? (isDarkMode ? "bg-teal-950/80 text-teal-300 border-teal-700/60" : "bg-teal-50 text-teal-800 border-teal-200")
                                : cat === "CCP"
                                ? (isDarkMode ? "bg-sky-950/80 text-sky-300 border-sky-700/60" : "bg-sky-50 text-sky-800 border-sky-200")
                                : cat === "PREKURSOR"
                                ? (isDarkMode ? "bg-amber-950/80 text-amber-300 border-amber-700/60" : "bg-amber-50 text-amber-900 border-amber-200")
                                : cat === "OOT"
                                ? (isDarkMode ? "bg-purple-950/80 text-purple-300 border-purple-700/60" : "bg-purple-50 text-purple-900 border-purple-200")
                                : (isDarkMode ? "bg-indigo-950/80 text-indigo-300 border-indigo-700/60" : "bg-indigo-50 text-indigo-700 border-indigo-200")
                            }`}
                          >
                            {cat}
                          </span>
                        ) : (
                          <div className="inline-flex items-center gap-1.5 justify-center">
                            <select
                              value={cat}
                              onChange={(e) => {
                                const newKat = e.target.value;
                                onUpdateCategory?.(primaryCode, item.namaBarang, newKat);
                              }}
                              className={`text-[11px] font-bold py-1 px-2 rounded-lg border cursor-pointer focus:outline-none focus:ring-2 focus:ring-teal-500/30 transition-all ${
                                cat === "ALKES"
                                  ? (isDarkMode ? "bg-teal-950/80 text-teal-300 border-teal-700/70" : "bg-teal-50 text-teal-800 border-teal-300")
                                  : cat === "CCP"
                                  ? (isDarkMode ? "bg-sky-950/80 text-sky-300 border-sky-700/70" : "bg-sky-50 text-sky-800 border-sky-300")
                                  : cat === "PREKURSOR"
                                  ? (isDarkMode ? "bg-amber-950/80 text-amber-300 border-amber-700/70" : "bg-amber-50 text-amber-800 border-amber-300")
                                  : cat === "OOT"
                                  ? (isDarkMode ? "bg-purple-950/80 text-purple-300 border-purple-700/70" : "bg-purple-50 text-purple-800 border-purple-300")
                                  : (isDarkMode ? "bg-[#142038] text-slate-200 border-slate-700" : "bg-white text-slate-800 border-slate-300")
                              }`}
                            >
                              <option value="FARMA">FARMA</option>
                              <option value="ALKES">ALKES</option>
                              <option value="CCP">CCP</option>
                              <option value="PREKURSOR">PREKURSOR</option>
                              <option value="OOT">OOT</option>
                            </select>
                            {isCustom && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded font-bold bg-teal-500/20 text-teal-400 border border-teal-500/30 whitespace-nowrap">
                                Kustom
                              </span>
                            )}
                          </div>
                        )}
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
