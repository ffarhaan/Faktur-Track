"use client";

import React, { useState, useEffect, useRef } from "react";

export interface AppUser {
  name: string;
  role: "admin" | "readonly";
}

export const ALLOWED_USERS = [
  { name: "Farhan", icon: "👨‍💻", color: "from-blue-500 to-indigo-600" },
  { name: "Rendy", icon: "👨‍💼", color: "from-indigo-500 to-purple-600" },
  { name: "Afuan", icon: "👨‍💻", color: "from-sky-500 to-blue-600" },
  { name: "Aqsal", icon: "👨‍🔬", color: "from-teal-500 to-emerald-600" },
  { name: "Wibi", icon: "👨‍🔧", color: "from-cyan-500 to-blue-600" },
  { name: "Andre", icon: "👨‍💼", color: "from-emerald-500 to-teal-600" },
  { name: "Melin", icon: "👩‍💼", color: "from-rose-500 to-pink-600" },
  { name: "Mahendra", icon: "👨‍💻", color: "from-violet-500 to-purple-600" },
  { name: "stranger", icon: "👁️", color: "from-amber-500 to-orange-600", isReadOnly: true },
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
  const passwordInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setErrorMsg("");
      setPassword("");
      if (currentUser?.name) {
        setSelectedName(currentUser.name);
      }
    }
  }, [isOpen, currentUser]);

  useEffect(() => {
    if (selectedName.toLowerCase() !== "stranger") {
      passwordInputRef.current?.focus();
    }
  }, [selectedName]);

  if (!isOpen) return null;

  const isStranger = selectedName.toLowerCase() === "stranger";

  const handleSelectUser = (name: string) => {
    setSelectedName(name);
    setErrorMsg("");
    setPassword("");
  };

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
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
      setErrorMsg("Password salah! (Gunakan 123)");
      passwordInputRef.current?.focus();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className={`w-full max-w-md rounded-2xl p-6 shadow-2xl border transition-all duration-200 ${
          isDarkMode
            ? "bg-[#0f172a] border-slate-700/80 text-slate-100 shadow-black/60"
            : "bg-white border-slate-200 text-slate-800 shadow-slate-400/30"
        }`}
      >
        {/* Header */}
        <div className="text-center mb-5">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-emerald-500/15 text-emerald-500 text-2xl mb-2.5 shadow-inner">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
            </span>
          </div>
          <h2 className="text-lg font-bold tracking-tight">Siapa yang Sedang ON?</h2>
          <p
            className={`text-xs mt-1 ${
              isDarkMode ? "text-slate-400" : "text-slate-500"
            }`}
          >
            Pilih nama Anda di bawah untuk mengaktifkan sesi kerja & cetak
          </p>
        </div>

        {/* User Selection Cards Grid (Langsung Pilihan Nama, Tanpa Dropdown) */}
        <div className="mb-4">
          <label className="block text-xs font-semibold mb-2 opacity-80">
            Pilih Pengguna:
          </label>
          <div className="grid grid-cols-3 gap-2">
            {ALLOWED_USERS.map((usr) => {
              const isSelected = selectedName === usr.name;
              const isReadOnly = "isReadOnly" in usr && usr.isReadOnly;

              return (
                <button
                  key={usr.name}
                  type="button"
                  onClick={() => handleSelectUser(usr.name)}
                  className={`flex flex-col items-center justify-center p-2.5 rounded-xl border text-center transition-all cursor-pointer relative group ${
                    isSelected
                      ? isDarkMode
                        ? "bg-blue-950/80 border-blue-500 ring-2 ring-blue-500/40 shadow-md shadow-blue-500/20"
                        : "bg-blue-50 border-blue-500 ring-2 ring-blue-500/30 shadow-md shadow-blue-500/10 text-blue-900"
                      : isDarkMode
                      ? "bg-[#182542]/60 hover:bg-[#223359] border-slate-700/80 text-slate-300"
                      : "bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700"
                  }`}
                >
                  {/* Selected Badge Indicator */}
                  {isSelected && (
                    <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-blue-950"></span>
                  )}

                  <span className="text-xl mb-1 group-hover:scale-110 transition-transform">
                    {usr.icon}
                  </span>
                  <span className="font-bold text-xs truncate w-full">
                    {usr.name}
                  </span>
                  <span
                    className={`text-[9px] mt-0.5 px-1 py-0.2 rounded font-medium ${
                      isReadOnly
                        ? isDarkMode
                          ? "bg-amber-950/80 text-amber-300"
                          : "bg-amber-100 text-amber-800"
                        : isDarkMode
                        ? "text-slate-400"
                        : "text-slate-500"
                    }`}
                  >
                    {isReadOnly ? "Hanya Lihat" : "Pencetak"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Form Input Password / Info Stranger */}
        <form onSubmit={handleSubmit} className="space-y-3">
          {!isStranger ? (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold">
                  Password untuk <strong className="text-blue-500">{selectedName}</strong>
                </label>
                <span className="text-[10px] text-slate-400 font-mono">(pw: 123)</span>
              </div>
              <input
                ref={passwordInputRef}
                type="password"
                placeholder="Ketik password (123)"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setErrorMsg("");
                }}
                className={`w-full px-3.5 py-2 text-sm rounded-xl border outline-none transition-all ${
                  errorMsg
                    ? "border-rose-500 ring-2 ring-rose-500/20"
                    : isDarkMode
                    ? "bg-[#1e293b] border-slate-700 text-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 placeholder-slate-500"
                    : "bg-slate-50 border-slate-300 text-slate-800 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 placeholder-slate-400"
                }`}
              />
            </div>
          ) : (
            <div
              className={`p-3 rounded-xl text-xs border flex items-start gap-2 ${
                isDarkMode
                  ? "bg-amber-950/40 border-amber-800/60 text-amber-200"
                  : "bg-amber-50 border-amber-200 text-amber-800"
              }`}
            >
              <span className="text-base leading-none">👁️</span>
              <div>
                <strong>Akses Stranger (Tanpa Password):</strong>
                <p className="mt-0.5 text-[11px] opacity-90">
                  Hanya bisa melihat daftar faktur & status live. Tindakan cetak, upload, dan reset dinonaktifkan.
                </p>
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="text-xs text-rose-500 font-medium text-center animate-shake">
              ⚠️ {errorMsg}
            </div>
          )}

          {/* Action Buttons */}
          <div className="pt-2 flex gap-2">
            {currentUser && onClose && (
              <button
                type="button"
                onClick={onClose}
                className={`flex-1 py-2.5 text-xs font-semibold rounded-xl border transition-colors ${
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
              className={`flex-1 py-2.5 text-xs font-bold rounded-xl text-white shadow-md transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                isStranger
                  ? "bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 shadow-orange-500/20"
                  : "bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 shadow-emerald-500/30"
              }`}
            >
              <span>{isStranger ? "👁️ Masuk sebagai Stranger" : `🟢 Masuk sebagai ${selectedName}`}</span>
              <span>➔</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
