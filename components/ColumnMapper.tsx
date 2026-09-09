"use client";

import { useEffect, useMemo, useState } from "react";
import { ColumnMapping, REQUIRED_FIELDS, RequiredFieldKey } from "@/lib/types";

type Props = {
  headers: string[];
  onConfirm: (mapping: ColumnMapping) => void;
  onCancel: () => void;
};

const STORAGE_KEY = "faktur-tracker:column-mappings";

// Signature dari kombinasi header, dipakai sebagai key penyimpanan mapping
function signatureOf(headers: string[]) {
  return [...headers].sort().join("|");
}

function loadSavedMapping(headers: string[]): ColumnMapping | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const store = JSON.parse(raw) as Record<string, ColumnMapping>;
    return store[signatureOf(headers)] ?? null;
  } catch {
    return null;
  }
}

function saveMapping(headers: string[], mapping: ColumnMapping) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const store = raw ? (JSON.parse(raw) as Record<string, ColumnMapping>) : {};
    store[signatureOf(headers)] = mapping;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // localStorage tidak tersedia, abaikan
  }
}

// Tebak otomatis kolom berdasarkan kemiripan nama
function guessColumn(headers: string[], fieldLabel: string, fieldKey: string): string {
  const normalized = headers.map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ""));
  const targets: Record<string, string[]> = {
    no_faktur: ["nofaktur", "faktur", "invoiceno", "nomorfaktur", "invoicenumber"],
    no_delivery_order: ["nodo", "deliveryorder", "nodeliveryorder", "do"],
    no_sales_order: ["noso", "salesorder", "nosalesorder", "so"],
  };
  const candidates = targets[fieldKey] ?? [];
  for (const candidate of candidates) {
    const idx = normalized.findIndex((h) => h.includes(candidate));
    if (idx !== -1) return headers[idx];
  }
  return "";
}

export default function ColumnMapper({ headers, onConfirm, onCancel }: Props) {
  const [mapping, setMapping] = useState<ColumnMapping>(() => {
    const saved = loadSavedMapping(headers);
    if (saved) return saved;
    const guessed = {} as ColumnMapping;
    REQUIRED_FIELDS.forEach((f) => {
      guessed[f.key] = guessColumn(headers, f.label, f.key);
    });
    return guessed;
  });

  const wasAutoRemembered = useMemo(() => !!loadSavedMapping(headers), [headers]);

  const isComplete = REQUIRED_FIELDS.every((f) => mapping[f.key]);

  function handleConfirm() {
    saveMapping(headers, mapping);
    onConfirm(mapping);
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <h3 className="font-semibold text-gray-800 mb-1">Cocokkan Kolom</h3>
      <p className="text-xs text-gray-500 mb-4">
        {wasAutoRemembered
          ? "Mapping ini diisi otomatis dari upload sebelumnya dengan kolom yang sama. Cek dan ubah kalau perlu."
          : "Pilih kolom Excel mana yang sesuai dengan tiap field di bawah. Ini akan diingat untuk upload berikutnya kalau susunan kolomnya sama."}
      </p>

      <div className="space-y-3">
        {REQUIRED_FIELDS.map((field) => (
          <div key={field.key} className="flex items-center gap-3">
            <label className="w-40 text-sm font-medium text-gray-700">
              {field.label}
            </label>
            <select
              value={mapping[field.key] ?? ""}
              onChange={(e) =>
                setMapping((m) => ({ ...m, [field.key]: e.target.value }))
              }
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">-- Pilih kolom Excel --</option>
              {headers.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <p className="text-xs text-gray-400 mt-3">
        Kolom lain selain yang dipetakan di atas akan tetap disimpan sebagai data tambahan.
      </p>

      <div className="flex gap-2 mt-5">
        <button
          onClick={handleConfirm}
          disabled={!isComplete}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-blue-700"
        >
          Lanjutkan Import
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200"
        >
          Batal
        </button>
      </div>
    </div>
  );
}

export type { RequiredFieldKey };
