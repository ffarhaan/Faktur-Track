"use client";

import { useEffect } from "react";

export default function ErrorBoundary({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Silently auto-reload without displaying any error UI or screens
    console.warn("Client exception caught, auto-reloading cleanly:", error);
    try {
      if (typeof window !== "undefined") {
        sessionStorage.removeItem("faktur_cache");
      }
    } catch {
      // ignore
    }
    window.location.reload();
  }, [error]);

  return null;
}
