"use client";

import { useEffect } from "react";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Faktur Tracker Client Exception caught:", error);
  }, [error]);

  const handleHardRefresh = () => {
    try {
      if (typeof window !== "undefined") {
        sessionStorage.clear();
        localStorage.clear();
      }
    } catch {
      // ignore
    }
    window.location.reload();
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[#0a0f1d] text-white">
      <div className="max-w-md w-full bg-[#111c33] p-6 rounded-2xl border border-rose-500/40 shadow-2xl space-y-4 text-center">
        <div className="w-12 h-12 rounded-full bg-rose-500/20 text-rose-400 text-2xl flex items-center justify-center mx-auto border border-rose-500/30">
          ⚠️
        </div>

        <div>
          <h2 className="text-base font-bold text-white mb-1">
            Terjadi Pembaruan Sistem (Cache Reload)
          </h2>
          <p className="text-xs text-slate-400">
            Ada pembaruan kode aplikasi terbaru. Klik tombol di bawah untuk memuat ulang sistem secara bersih.
          </p>
        </div>

        {error?.message && (
          <div className="text-[11px] text-rose-300 bg-rose-950/40 p-2.5 rounded-lg font-mono text-left max-h-28 overflow-auto border border-rose-800/40">
            {error.message}
          </div>
        )}

        <div className="flex gap-2.5 pt-2">
          <button
            type="button"
            onClick={() => reset()}
            className="flex-1 py-2 px-3 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white transition-all shadow-xs cursor-pointer"
          >
            🔄 Coba Lagi
          </button>
          <button
            type="button"
            onClick={handleHardRefresh}
            className="flex-1 py-2 px-3 rounded-lg text-xs font-bold bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 text-white transition-all shadow-xs cursor-pointer"
          >
            ⚡ Bersihkan Cache & Reload
          </button>
        </div>
      </div>
    </div>
  );
}
