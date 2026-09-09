"use client";

import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { ParsedExcelRow } from "@/lib/types";

type Props = {
  onParsed: (headers: string[], rows: ParsedExcelRow[]) => void;
};

export default function UploadExcel({ onParsed }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const firstSheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[firstSheetName];

      // Ambil sebagai array-of-array dulu supaya bisa deteksi header row
      const raw: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: "",
      });

      if (raw.length === 0) {
        setError("File Excel kosong.");
        return;
      }

      // Cari baris header yang sesungguhnya (skip metadata report Oracle di baris 0-10)
      let headerRowIndex = 0;
      for (let i = 0; i < Math.min(30, raw.length); i++) {
        const rowCells = (raw[i] as unknown[]).map((c) => String(c ?? "").trim());
        const nonEmpties = rowCells.filter((c) => c !== "");
        // Baris header biasanya punya banyak kolom dan berisi teks
        if (
          nonEmpties.length >= 3 &&
          rowCells.some((c) =>
            /invoice|faktur|order|pelanggan|customer|item|entity/i.test(c)
          )
        ) {
          headerRowIndex = i;
          break;
        } else if (nonEmpties.length >= 5) {
          headerRowIndex = i;
          break;
        }
      }

      const headerRow = (raw[headerRowIndex] as unknown[]).map((h, idx) => {
        const val = String(h ?? "").trim();
        return val !== "" ? val : `Kolom_${idx + 1}`;
      });

      const dataRows = raw.slice(headerRowIndex + 1);

      const rows: ParsedExcelRow[] = dataRows
        .filter((r) => (r as unknown[]).some((cell) => String(cell ?? "").trim() !== ""))
        .map((r) => {
          const obj: ParsedExcelRow = {};
          headerRow.forEach((h, i) => {
            const val = (r as unknown[])[i];
            obj[h] = val === undefined || val === "" ? null : (val as string | number);
          });
          return obj;
        });

      setFileName(file.name);
      onParsed(headerRow, rows);
    } catch (err) {
      console.error(err);
      setError("Gagal membaca file. Pastikan formatnya .xlsx atau .xls.");
    }
  }

  return (
    <div className="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center">
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
      <p className="text-sm text-gray-600 mb-3">
        Upload file Excel hasil export dari Oracle (.xlsx / .xls)
      </p>
      <button
        onClick={() => inputRef.current?.click()}
        className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
      >
        Pilih File Excel
      </button>
      {fileName && (
        <p className="text-xs text-gray-500 mt-2">File terpilih: {fileName}</p>
      )}
      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
    </div>
  );
}
