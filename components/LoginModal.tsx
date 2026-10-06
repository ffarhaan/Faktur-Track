"use client";

import React, { useState } from "react";

export interface AppUser {
  name: string;
  role: "admin" | "readonly";
}

export const ALLOWED_USERS = [
  "Farhan",
  "Rendy",
  "Afuan",
  "Aqsal",
  "Wibi",
  "Andre",
  "Melin",
  "Mahendra",
  "stranger",
] as const;

interface LoginModalProps {
  isOpen: boolean;
  onClose?: () => void;
  onLogin: (user: AppUser) => void;
  currentUser: AppUser | null;
  isDarkMode: boolean;
}

export default function LoginModal({
  isOpen,
  onClose,
  onLogin,
  currentUser,
  isDarkMode,
}: LoginModalProps) {
  const [selectedName, setSelectedName] = useState<string>("Farhan");
  const [password, setPassword] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string>("");

  if (!isOpen) return null;

  const isStranger = selectedName.toLowerCase() === "stranger";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");

    if (isStranger) {
      onLogin({ name: "stranger", role: "readonly" });
      setPassword("");
      return;
    }

    if (password === "123") {
      onLogin({ name: selectedName, role: "admin" });
      setPassword("");
    } else {
      setErrorMsg("Password salah! Silakan coba lagi.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className={`w-full max-w-sm rounded-2xl p-6 shadow-2xl border transition-all ${
          isDarkMode
            ? "bg-[#0f172a] border-slate-700/80 text-slate-100"
            : "bg-white border-slate-200 text-slate-800"
        }`}
      >
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-blue-600/10 text-blue-500 text-2xl mb-3">
            🔐
          </div>
          <h2 className="text-lg font-bold">Masuk ke Faktur Tracker</h2>
          <p
            className={`text-xs mt-1 ${
              isDarkMode ? "text-slate-400" : "text-slate-500"
            }`}
          >
            Pilih pengguna Anda untuk melanjutkan
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold mb-1">
              Pilih Pengguna
            </label>
            <select
              value={selectedName}
              onChange={(e) => {
                setSelectedName(e.target.value);
                setErrorMsg("");
              }}
              className={`w-full px-3 py-2 text-sm rounded-lg border outline-hidden transition-colors ${
                isDarkMode
                  ? "bg-[#1e293b] border-slate-700 text-white focus:border-blue-500"
                  : "bg-slate-50 border-slate-300 text-slate-800 focus:border-blue-500"
              }`}
            >
              {ALLOWED_USERS.map((usr) => (
                <option key={usr} value={usr}>
                  {usr === "stranger" ? "stranger (Hanya Lihat / Read Only)" : usr}
                </option>
              ))}
            </select>
          </div>

          {!isStranger && (
            <div>
              <label className="block text-xs font-semibold mb-1">
                Password
              </label>
              <input
                type="password"
                placeholder="Masukkan password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setErrorMsg("");
                }}
                autoFocus
                className={`w-full px-3 py-2 text-sm rounded-lg border outline-hidden transition-colors ${
                  isDarkMode
                    ? "bg-[#1e293b] border-slate-700 text-white focus:border-blue-500 placeholder-slate-500"
                    : "bg-slate-50 border-slate-300 text-slate-800 focus:border-blue-500 placeholder-slate-400"
                }`}
              />
            </div>
          )}

          {isStranger && (
            <div
              className={`p-3 rounded-lg text-xs border ${
                isDarkMode
                  ? "bg-amber-950/30 border-amber-800/40 text-amber-300"
                  : "bg-amber-50 border-amber-200 text-amber-800"
              }`}
            >
              ℹ️ <strong>Mode Stranger:</strong> Anda hanya dapat melihat data faktur. Upload file dan klik aksi (cetak/ubah) dinonaktifkan.
            </div>
          )}

          {errorMsg && (
            <div className="text-xs text-rose-500 font-medium text-center">
              {errorMsg}
            </div>
          )}

          <div className="pt-2 flex gap-2">
            {currentUser && onClose && (
              <button
                type="button"
                onClick={onClose}
                className={`flex-1 py-2 text-xs font-semibold rounded-lg border transition-colors ${
                  isDarkMode
                    ? "border-slate-700 hover:bg-slate-800 text-slate-300"
                    : "border-slate-200 hover:bg-slate-100 text-slate-600"
                }`}
              >
                Batal
              </button>
            )}
            <button
              type="submit"
              className="flex-1 py-2 text-xs font-bold rounded-lg bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-600/30 transition-colors"
            >
              {isStranger ? "Masuk sebagai Stranger" : "Masuk"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
