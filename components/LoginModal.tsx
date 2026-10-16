"use client";

import React, { useState, useEffect, useRef } from "react";
import { verifyUserPassword } from "@/lib/firestoreService";

export interface AppUser {
  name: string;
  role: "admin" | "readonly";
}

export const ALLOWED_USERS = [
  { name: "Farhan", icon: "👨‍💻" },
  { name: "Rendy", icon: "👨‍💼" },
  { name: "Afuan", icon: "👨‍💻" },
  { name: "Aqsal", icon: "👨‍🔬" },
  { name: "Wibi", icon: "👨‍🔧" },
  { name: "Andre", icon: "👨‍💼" },
  { name: "Melin", icon: "👩‍💼" },
  { name: "Mahendra", icon: "👨‍💻" },
  { name: "stranger", icon: "👁️", isReadOnly: true },
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
  const [submitting, setSubmitting] = useState(false);
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
    if (selectedName && String(selectedName).toLowerCase() !== "stranger") {
      passwordInputRef.current?.focus();
    }
  }, [selectedName]);

  const handleSelectUser = (name: string) => {
    setSelectedName(name);
    setErrorMsg("");
    setPassword("");
  };

  if (!isOpen) return null;

  const isStranger = String(selectedName || "").toLowerCase() === "stranger";

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (submitting) return;
    setErrorMsg("");

    if (isStranger) {
      onLogin({ name: "stranger", role: "readonly" });
      setPassword("");
      return;
    }

    if (!password) {
      setErrorMsg("Ketik password Anda.");
      passwordInputRef.current?.focus();
      return;
    }

    setSubmitting(true);
    try {
      const isValid = await verifyUserPassword(selectedName, password);
      if (isValid) {
        onLogin({ name: selectedName, role: "admin" });
        setPassword("");
      } else {
        setErrorMsg("Password salah! Silakan coba lagi.");
        passwordInputRef.current?.focus();
      }
    } catch {
      setErrorMsg("Gagal memeriksa password, coba lagi.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/70 animate-in fade-in duration-150">
      <div
        className={`w-full max-w-sm rounded-xl p-4 shadow-xl border transition-all ${
          isDarkMode
            ? "bg-[#0f172a] border-slate-700/80 text-slate-100 shadow-black/60"
            : "bg-white border-slate-200 text-slate-800 shadow-slate-300/40"
        }`}
      >
        {/* Compact Header */}
        <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <h2 className="text-xs font-bold tracking-tight">Siapa yang Sedang ON?</h2>
          </div>
          {currentUser && onClose && (
            <button
              type="button"
              onClick={onClose}
              className="text-xs px-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
            >
              ✕
            </button>
          )}
        </div>

        {/* Compact User Grid (3 Kolom Ringkas) */}
        <div className="mb-3">
          <div className="grid grid-cols-3 gap-1.5">
            {ALLOWED_USERS.map((usr) => {
              const isSelected = selectedName === usr.name;
              const isReadOnly = "isReadOnly" in usr && usr.isReadOnly;

              return (
                <button
                  key={usr.name}
                  type="button"
                  onClick={() => handleSelectUser(usr.name)}
                  className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg border text-left transition-all cursor-pointer ${
                    isSelected
                      ? isDarkMode
                        ? "bg-blue-950/90 border-blue-500 ring-2 ring-blue-500/40 text-blue-200 font-bold shadow-xs"
                        : "bg-blue-50 border-blue-500 ring-2 ring-blue-500/30 text-blue-900 font-bold shadow-xs"
                      : isDarkMode
                      ? "bg-[#182542]/50 hover:bg-[#223359] border-slate-700/80 text-slate-300"
                      : "bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700"
                  }`}
                >
                  <span className="text-sm shrink-0">{usr.icon}</span>
                  <div className="min-w-0 flex-1 leading-tight">
                    <div className="text-xs truncate">{usr.name}</div>
                    {isReadOnly && (
                      <div className="text-[8px] text-amber-500 font-normal leading-none">Lihat</div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Form Password / Stranger Notice */}
        <form onSubmit={handleSubmit} className="space-y-2.5">
          {!isStranger ? (
            <div>
              <input
                ref={passwordInputRef}
                type="password"
                placeholder={`Password untuk ${selectedName}...`}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setErrorMsg("");
                }}
                className={`w-full px-3 py-1.5 text-xs rounded-lg border outline-none transition-all ${
                  errorMsg
                    ? "border-rose-500 ring-2 ring-rose-500/20"
                    : isDarkMode
                    ? "bg-[#1e293b] border-slate-700 text-white focus:border-blue-500 placeholder-slate-500"
                    : "bg-slate-50 border-slate-300 text-slate-800 focus:border-blue-500 placeholder-slate-400"
                }`}
              />
            </div>
          ) : (
            <div
              className={`px-2.5 py-1.5 rounded-lg text-[11px] border flex items-center gap-2 ${
                isDarkMode
                  ? "bg-amber-950/40 border-amber-800/60 text-amber-200"
                  : "bg-amber-50 border-amber-200 text-amber-800"
              }`}
            >
              <span>👁️</span>
              <span><strong>Stranger:</strong> Mode pantau (Hanya Lihat tanpa password).</span>
            </div>
          )}

          {errorMsg && (
            <div className="text-[11px] text-rose-500 font-medium text-center">
              ⚠️ {errorMsg}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-2 pt-0.5">
            {currentUser && onClose && (
              <button
                type="button"
                onClick={onClose}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
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
              disabled={submitting}
              className={`flex-1 py-1.5 text-xs font-bold rounded-lg text-white shadow-xs transition-all flex items-center justify-center gap-1 cursor-pointer ${
                submitting
                  ? "opacity-60 cursor-not-allowed bg-slate-500"
                  : isStranger
                  ? "bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500"
                  : "bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500"
              }`}
            >
              <span>
                {submitting
                  ? "Memeriksa..."
                  : isStranger
                  ? "👁️ Masuk Stranger"
                  : `🟢 Masuk (${selectedName})`}
              </span>
              {!submitting && <span>➔</span>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
