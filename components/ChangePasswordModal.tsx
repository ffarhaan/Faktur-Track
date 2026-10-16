"use client";

import React, { useState } from "react";
import { changeUserPassword } from "@/lib/firestoreService";

interface ChangePasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  userName: string;
  isDarkMode: boolean;
  onSuccess: (msg: string) => void;
}

export default function ChangePasswordModal({
  isOpen,
  onClose,
  userName,
  isDarkMode,
  onSuccess,
}: ChangePasswordModalProps) {
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");

    if (!oldPassword) {
      setErrorMsg("Masukkan password lama Anda.");
      return;
    }
    if (!newPassword || newPassword.length < 3) {
      setErrorMsg("Password baru minimal 3 karakter.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMsg("Konfirmasi password baru tidak cocok.");
      return;
    }

    setLoading(true);
    try {
      const res = await changeUserPassword(userName, oldPassword, newPassword);
      if (res.success) {
        onSuccess(res.message);
        setOldPassword("");
        setNewPassword("");
        setConfirmPassword("");
        onClose();
      } else {
        setErrorMsg(res.message);
      }
    } catch {
      setErrorMsg("Terjadi kesalahan saat mengganti password.");
    } finally {
      setLoading(false);
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
        {/* Header */}
        <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <span className="text-base">🔑</span>
            <h2 className="text-xs font-bold tracking-tight">
              Ganti Password: <span className="text-blue-500">{userName}</span>
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-xs px-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-2.5">
          <div>
            <label className="block text-[11px] font-semibold mb-1 opacity-80">
              Password Lama
            </label>
            <input
              type="password"
              placeholder="Ketik password lama..."
              value={oldPassword}
              onChange={(e) => {
                setOldPassword(e.target.value);
                setErrorMsg("");
              }}
              autoFocus
              className={`w-full px-3 py-1.5 text-xs rounded-lg border outline-none transition-all ${
                isDarkMode
                  ? "bg-[#1e293b] border-slate-700 text-white focus:border-blue-500 placeholder-slate-500"
                  : "bg-slate-50 border-slate-300 text-slate-800 focus:border-blue-500 placeholder-slate-400"
              }`}
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold mb-1 opacity-80">
              Password Baru
            </label>
            <input
              type="password"
              placeholder="Minimal 3 karakter..."
              value={newPassword}
              onChange={(e) => {
                setNewPassword(e.target.value);
                setErrorMsg("");
              }}
              className={`w-full px-3 py-1.5 text-xs rounded-lg border outline-none transition-all ${
                isDarkMode
                  ? "bg-[#1e293b] border-slate-700 text-white focus:border-blue-500 placeholder-slate-500"
                  : "bg-slate-50 border-slate-300 text-slate-800 focus:border-blue-500 placeholder-slate-400"
              }`}
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold mb-1 opacity-80">
              Ulangi Password Baru
            </label>
            <input
              type="password"
              placeholder="Ketik ulang password baru..."
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                setErrorMsg("");
              }}
              className={`w-full px-3 py-1.5 text-xs rounded-lg border outline-none transition-all ${
                isDarkMode
                  ? "bg-[#1e293b] border-slate-700 text-white focus:border-blue-500 placeholder-slate-500"
                  : "bg-slate-50 border-slate-300 text-slate-800 focus:border-blue-500 placeholder-slate-400"
              }`}
            />
          </div>

          {errorMsg && (
            <div className="text-[11px] text-rose-500 font-medium text-center">
              ⚠️ {errorMsg}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
                isDarkMode
                  ? "border-slate-700 hover:bg-slate-800 text-slate-300"
                  : "border-slate-200 hover:bg-slate-100 text-slate-600"
              }`}
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={loading}
              className={`flex-1 py-1.5 text-xs font-bold rounded-lg text-white shadow-xs transition-all flex items-center justify-center gap-1 cursor-pointer ${
                loading
                  ? "opacity-60 cursor-not-allowed bg-slate-500"
                  : "bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 text-white shadow-blue-500/20"
              }`}
            >
              <span>{loading ? "Menyimpan..." : "Simpan Password Baru"}</span>
              {!loading && <span>✓</span>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
