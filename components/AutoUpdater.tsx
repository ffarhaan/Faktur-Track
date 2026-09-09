"use client";

import { useEffect, useRef } from "react";

export default function AutoUpdater() {
  const currentVersionRef = useRef<string | null>(null);

  useEffect(() => {
    // Cek versi aplikasi saat pertama kali halaman dimuat
    async function checkVersion(isInitial = false) {
      try {
        const res = await fetch("/api/version?t=" + Date.now());
        if (!res.ok) return;
        const data = (await res.json()) as { version: string };

        if (isInitial) {
          currentVersionRef.current = data.version;
          return;
        }

        // Jika versi berubah (deploy baru selesai di Vercel), otomatis reload halaman!
        if (
          currentVersionRef.current &&
          data.version !== "dev" &&
          data.version !== currentVersionRef.current
        ) {
          console.log("🚀 Update baru terdeteksi dari Vercel! Mereload halaman secara otomatis...");
          window.location.reload();
        }
      } catch {
        // Abaikan error jaringan sementara
      }
    }

    checkVersion(true);

    // Cek setiap 20 detik apakah ada update/deploy baru
    const interval = setInterval(() => {
      checkVersion(false);
    }, 20000);

    return () => clearInterval(interval);
  }, []);

  return null;
}
