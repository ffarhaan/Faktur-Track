"use client";

import { useState, useMemo, useEffect, useCallback, Fragment } from "react";
import * as XLSX from "xlsx";
import { parseExcelFile, categorize, isOraCustomer } from "@/lib/parser";
import { FakturRecord } from "@/lib/types";
import { supabase } from "@/lib/supabaseClient";

type Filter = "all" | "belum" | "sudah" | "double";
type KatFilter = "all" | "1P" | "2P" | "3P";
type JenisFilter = "all" | "ORA" | "DOO";

const ROWS_PER_PAGE = 50;

function parseInvNum(invs: string[] | string): number {
  if (!invs) return 0;
  if (Array.isArray(invs)) {
    if (invs.length === 0) return 0;
    const n = parseInt(invs[0].replace(/\D/g, ""), 10);
    return isNaN(n) ? 0 : n;
  }
  const n = parseInt(String(invs).replace(/\D/g, ""), 10);
  return isNaN(n) ? 0 : n;
}

function parseDateMs(dStr: string): number {
  if (!dStr) return 0;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(dStr)) {
    const [d, m, y] = dStr.split("/").map(Number);
    return new Date(y, m - 1, d).getTime();
  }
  const t = Date.parse(dStr);
  return isNaN(t) ? 0 : t;
}

function formatRupiah(n: number): string {
  if (typeof n !== "number" || isNaN(n)) return "0";
  return new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(n);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function formatPrintTime(dStr?: string | null): string {
  if (!dStr) return "-";
  try {
    const d = new Date(dStr);
    if (isNaN(d.getTime())) return dStr;
    const pad = (n: number) => String(n).padStart(2, "0");
    const day = pad(d.getDate());
    const month = pad(d.getMonth() + 1);
    const year = d.getFullYear();
    const hours = pad(d.getHours());
    const minutes = pad(d.getMinutes());
    const seconds = pad(d.getSeconds());
    return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
  } catch {
    return dStr;
  }
}

type FakturGroup = {
  key: string;
  invoiceNumber: string;
  invoiceKey: string;
  so: string;
  items: FakturRecord[];
  orderDate: string;
  jenisTransaksi: string;
  customerName: string;
  kategori: "1P" | "2P" | "3P";
  isDoubleInv: boolean;
  totalHarga: number;
  totalItems: number;
  allPrinted: boolean;
  anyPrinted: boolean;
  printedAt: string | null;
};

type UploadedFile = {
  name: string;
  count: number;
  time: string;
};

function dbRowsToFakturRecords(rows: Array<Record<string, unknown>>): {
  records: FakturRecord[];
  printedSet: Set<string>;
  printedAtMap: Record<string, string>;
} {
  const records: FakturRecord[] = [];
  const printedSet = new Set<string>();
  const printedAtMap: Record<string, string> = {};

  for (const r of rows) {
    const rawInv = String(r.no_faktur || "");
    const cleanInv = rawInv.replace(/-1P$/i, "");
    const extra = (r.extra as Record<string, unknown>) || {};
    const items = (extra.items as Array<Record<string, unknown>>) || [];
    const cust = String(extra.nama_pelanggan || "");
    const date = String(extra.accounting_date || extra.order_date || r.imported_at || "");
    const isOra = isOraCustomer(cust, r.source_file as string);
    const invKey = isOra ? `${cleanInv}-1P` : cleanInv;
    const cleanJenis: "DOO" | "ORA" = isOra ? "ORA" : "DOO";
    const kategori = categorize(cleanJenis, cust, isOra ? "ORA" : "DOO");
    const pAt = (r.printed_at as string) || (extra.printed_at as string) || null;

    if (r.status_cetak) {
      if (invKey) {
        printedSet.add(invKey);
        if (pAt) printedAtMap[invKey] = pAt;
      }
    }

    if (items.length > 0) {
      for (let idx = 0; idx < items.length; idx++) {
        const it = items[idx];
        records.push({
          orderDate: date,
          orderNumber: String(it.order_number || r.no_sales_order || cleanInv),
          invoiceNumber: cleanInv,
          invoiceKey: invKey,
          jenisTransaksi: cleanJenis,
          customerName: cust,
          itemCode: String(it.item_code || ""),
          itemDescription: String(it.item_description || ""),
          qty: (it.qty as number | string) || 0,
          uom: String(it.uom || ""),
          lotNumber: String(it.lot_number || ""),
          totalHarga: typeof it.total_harga === "number" ? it.total_harga : parseFloat(String(it.total_harga || 0)) || 0,
          kategori,
          isDoubleInv: false,
          rowIndex: idx,
        });
      }
    } else {
      records.push({
        orderDate: date,
        orderNumber: String(r.no_sales_order || cleanInv),
        invoiceNumber: cleanInv,
        invoiceKey: invKey,
        jenisTransaksi: cleanJenis,
        customerName: cust,
        itemCode: "-",
        itemDescription: "Data DOO",
        qty: 1,
        uom: "-",
        lotNumber: "-",
        totalHarga: 0,
        kategori,
        isDoubleInv: false,
        rowIndex: 0,
      });
    }
  }

  // Detect double invoices
  const soInvMap: Record<string, Set<string>> = {};
  for (const rec of records) {
    if (!soInvMap[rec.orderNumber]) soInvMap[rec.orderNumber] = new Set();
    if (rec.invoiceNumber) soInvMap[rec.orderNumber].add(rec.invoiceNumber);
  }
  for (const rec of records) {
    if (soInvMap[rec.orderNumber]?.size > 1) rec.isDoubleInv = true;
  }

  return { records, printedSet, printedAtMap };
}

export default function Home() {
  const [records, setRecords] = useState<FakturRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [filter, setFilter] = useState<Filter>("belum");
  const [katFilter, setKatFilter] = useState<KatFilter>("all");
  const [jenisFilter, setJenisFilter] = useState<JenisFilter>("all");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [printedInvoices, setPrintedInvoices] = useState<Set<string>>(new Set());
  const [printedAtMap, setPrintedAtMap] = useState<Record<string, string>>({});
  const [dragOver, setDragOver] = useState(false);
  const [expandedInvoices, setExpandedInvoices] = useState<Set<string>>(new Set());

  // Fetch all records from Supabase
  const fetchFromSupabase = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      let allRows: Array<Record<string, unknown>> = [];
      let from = 0;
      const step = 1000;
      while (true) {
        const { data, error: sbErr } = await supabase
          .from("faktur_records")
          .select("*")
          .order("created_at", { ascending: false })
          .range(from, from + step - 1);

        if (sbErr || !data || data.length === 0) break;
        allRows = allRows.concat(data as Array<Record<string, unknown>>);
        if (data.length < step) break;
        from += step;
      }

      if (allRows.length > 0) {
        const { records: recs, printedSet, printedAtMap: pMap } = dbRowsToFakturRecords(allRows);
        setRecords(recs);
        setPrintedInvoices(printedSet);
        setPrintedAtMap(pMap);
        try {
          localStorage.setItem("records", JSON.stringify(recs));
          localStorage.setItem("printedInvoices", JSON.stringify([...printedSet]));
          localStorage.setItem("printedAtMap", JSON.stringify(pMap));
        } catch {}
      }
    } catch (err) {
      console.error("Supabase sync error:", err);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  // Load on mount: fast cache first, then sync with Supabase
  useEffect(() => {
    try {
      const storedRecords = localStorage.getItem("records");
      if (storedRecords) setRecords(JSON.parse(storedRecords));
      const storedPrinted = localStorage.getItem("printedInvoices");
      if (storedPrinted) setPrintedInvoices(new Set(JSON.parse(storedPrinted)));
      const storedPMap = localStorage.getItem("printedAtMap");
      if (storedPMap) setPrintedAtMap(JSON.parse(storedPMap));
      const storedFiles = localStorage.getItem("uploadedFiles");
      if (storedFiles) setUploadedFiles(JSON.parse(storedFiles));
    } catch {}

    fetchFromSupabase(true);

    // Sync from Supabase every 15s so all devices stay updated
    const syncInterval = setInterval(() => {
      fetchFromSupabase(false);
    }, 15000);

    return () => clearInterval(syncInterval);
  }, [fetchFromSupabase]);

  // Auto-refresh on new deploy version
  useEffect(() => {
    let currentVersion: string | null = null;
    const checkVersion = async () => {
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        const data = await res.json();
        if (currentVersion === null) {
          currentVersion = data.version;
        } else if (currentVersion !== data.version) {
          window.location.reload();
        }
      } catch {}
    };
    checkVersion();
    const interval = setInterval(checkVersion, 30000);
    return () => clearInterval(interval);
  }, []);

  const toggleExpand = useCallback((key: string) => {
    setExpandedInvoices((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Print / Unprint: toggle local state AND sync to Supabase so all devices see it
  const togglePrint = useCallback(
    async (group: FakturGroup) => {
      const willBePrinted = !group.allPrinted;
      const nowIso = new Date().toISOString();
      const next = new Set(printedInvoices);

      const allKeys = new Set([
        group.invoiceKey,
        group.invoiceNumber,
        `${group.invoiceNumber}-1P`,
        group.invoiceNumber.replace(/-1P$/i, ""),
      ]);

      for (const key of allKeys) {
        if (willBePrinted) next.add(key);
        else next.delete(key);
      }
      setPrintedInvoices(next);
      setPrintedAtMap((prev) => {
        const nextMap = { ...prev };
        for (const key of allKeys) {
          if (willBePrinted) nextMap[key] = nowIso;
          else delete nextMap[key];
        }
        try {
          localStorage.setItem("printedAtMap", JSON.stringify(nextMap));
        } catch {}
        return nextMap;
      });
      try {
        localStorage.setItem("printedInvoices", JSON.stringify([...next]));
      } catch {}

      const targets = Array.from(allKeys);
      await supabase
        .from("faktur_records")
        .update({
          status_cetak: willBePrinted,
          printed_at: willBePrinted ? nowIso : null,
        })
        .in("no_faktur", targets);
    },
    [printedInvoices]
  );

  const markAllAsPrinted = useCallback(async () => {
    const next = new Set(printedInvoices);
    const nowIso = new Date().toISOString();
    const allKeys: string[] = [];
    const nextMap: Record<string, string> = { ...printedAtMap };
    for (const r of records) {
      next.add(r.invoiceKey);
      allKeys.push(r.invoiceKey);
      nextMap[r.invoiceKey] = nowIso;
    }
    setPrintedInvoices(next);
    setPrintedAtMap(nextMap);
    try {
      localStorage.setItem("printedInvoices", JSON.stringify([...next]));
      localStorage.setItem("printedAtMap", JSON.stringify(nextMap));
    } catch {}

    for (const batch of chunk(allKeys, 500)) {
      await supabase
        .from("faktur_records")
        .update({ status_cetak: true, printed_at: nowIso })
        .in("no_faktur", batch);
    }
  }, [records, printedInvoices, printedAtMap]);

  const markAllAsUnprinted = useCallback(async () => {
    if (!confirm("Reset SEMUA faktur menjadi 'Belum Terprint'?")) return;
    setPrintedInvoices(new Set());
    setPrintedAtMap({});
    try {
      localStorage.setItem("printedInvoices", JSON.stringify([]));
      localStorage.setItem("printedAtMap", JSON.stringify({}));
    } catch {}

    const allKeys: string[] = [];
    for (const r of records) {
      allKeys.push(r.invoiceKey);
    }
    for (const batch of chunk(allKeys, 500)) {
      await supabase
        .from("faktur_records")
        .update({ status_cetak: false, printed_at: null })
        .in("no_faktur", batch);
    }
  }, [records]);

  // Upload: Parse & Save directly to Supabase cloud DB so all devices see it
  const handleUpload = useCallback(
    async (file: File) => {
      setLoading(true);
      setError(null);
      try {
        const parsed = await parseExcelFile(file);
        if (parsed.length === 0) {
          setError("File berhasil dibaca tapi tidak ada data.");
          setLoading(false);
          return;
        }

        const importedAt = new Date().toISOString();

        // Fetch ALL existing print status from DB (paginated) so we NEVER reset already printed invoices
        let existingDB: Array<Record<string, unknown>> = [];
        let fromIdx = 0;
        while (true) {
          const { data: pageData, error: pageErr } = await supabase
            .from("faktur_records")
            .select("no_faktur, status_cetak, printed_at, extra")
            .range(fromIdx, fromIdx + 999);
          if (pageErr || !pageData || pageData.length === 0) break;
          existingDB = existingDB.concat(pageData as Array<Record<string, unknown>>);
          if (pageData.length < 1000) break;
          fromIdx += 1000;
        }

        const existingStatusMap = new Map<string, { status_cetak: boolean; printed_at: string | null; extra: Record<string, unknown> | null }>();
        existingDB.forEach((row: Record<string, unknown>) => {
          existingStatusMap.set(String(row.no_faktur).trim(), {
            status_cetak: Boolean(row.status_cetak),
            printed_at: (row.printed_at as string) || null,
            extra: (row.extra as Record<string, unknown>) || null,
          });
        });

        // Group parsed records by invoice to upsert to Supabase
        const invMap = new Map<string, Record<string, unknown>>();
        for (const r of parsed) {
          const isOra = isOraCustomer(r.customerName, r.jenisTransaksi);
          const noFaktur = isOra ? `${r.invoiceNumber}-1P` : r.invoiceNumber;
          if (!noFaktur || noFaktur === "0" || noFaktur === "-1P") continue;

          const prevInfo = existingStatusMap.get(noFaktur);
          const isPrinted = prevInfo ? prevInfo.status_cetak : false;
          const printedAt = prevInfo ? prevInfo.printed_at : null;

          if (!invMap.has(noFaktur)) {
            invMap.set(noFaktur, {
              no_faktur: noFaktur,
              no_sales_order: r.orderNumber,
              no_delivery_order: null,
              status_cetak: isPrinted,
              printed_at: printedAt,
              imported_at: importedAt,
              source_file: isOra ? "ORA" : "DOO",
              extra: {
                nama_pelanggan: r.customerName || (prevInfo?.extra?.nama_pelanggan as string) || null,
                jenis_transaksi: isOra ? "ORA" : "DOO",
                accounting_date: r.orderDate || (prevInfo?.extra?.accounting_date as string) || null,
                order_date: r.orderDate || (prevInfo?.extra?.order_date as string) || null,
                items: [],
              },
              _soSet: new Set([r.orderNumber]),
            });
          }

          const existing = invMap.get(noFaktur)!;
          (existing._soSet as Set<string>).add(r.orderNumber);
          const itList = (existing.extra as Record<string, unknown>).items as Array<Record<string, unknown>>;
          itList.push({
            item_code: r.itemCode,
            item_description: r.itemDescription,
            qty: r.qty,
            uom: r.uom,
            lot_number: r.lotNumber,
            total_harga: r.totalHarga,
            order_number: r.orderNumber,
          });
        }

        const payload = Array.from(invMap.values()).map(({ _soSet, ...rest }) => ({
          ...rest,
          no_sales_order: (_soSet as Set<string>).size > 0 ? Array.from(_soSet as Set<string>).join(", ") : rest.no_sales_order,
        }));

        for (const batch of chunk(payload, 500)) {
          const { error: sbErr } = await supabase
            .from("faktur_records")
            .upsert(batch, { onConflict: "no_faktur" });
          if (sbErr) console.error("Upload upsert error:", sbErr.message);
        }

        setUploadedFiles((prev) => [
          ...prev,
          { name: file.name, count: parsed.length, time: new Date().toLocaleString("id-ID") },
        ]);
        setPage(0);

        await fetchFromSupabase(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Gagal membaca file.");
      } finally {
        setLoading(false);
      }
    },
    [fetchFromSupabase]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleUpload(file);
    },
    [handleUpload]
  );

  const onFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleUpload(file);
      e.target.value = "";
    },
    [handleUpload]
  );

  const clearAll = async () => {
    if (!confirm("Yakin ingin menghapus semua data? Data di database cloud juga akan terhapus.")) return;
    setLoading(true);
    setRecords([]);
    setUploadedFiles([]);
    setPrintedInvoices(new Set());
    setExpandedInvoices(new Set());
    setPrintedAtMap({});
    setFilter("all");
    setKatFilter("all");
    setJenisFilter("all");
    setSearch("");
    setPage(0);
    try {
      localStorage.removeItem("records");
      localStorage.removeItem("uploadedFiles");
      localStorage.removeItem("printedInvoices");
      localStorage.removeItem("printedAtMap");
    } catch {}

    await supabase.from("faktur_records").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    setLoading(false);
  };

  // Group strictly by Invoice Key so every individual faktur/invoice is isolated with exact total harga
  const grouped = useMemo<FakturGroup[]>(() => {
    const map: Record<string, FakturRecord[]> = {};
    for (const r of records) {
      const gKey = r.invoiceKey || r.invoiceNumber;
      if (!map[gKey]) map[gKey] = [];
      map[gKey].push(r);
    }

    // Detect double invoices per SO
    const soInvMap: Record<string, Set<string>> = {};
    for (const r of records) {
      if (!soInvMap[r.orderNumber]) soInvMap[r.orderNumber] = new Set();
      if (r.invoiceNumber && r.invoiceNumber !== "0" && r.invoiceNumber !== "-") {
        soInvMap[r.orderNumber].add(r.invoiceNumber);
      }
    }

    return Object.entries(map)
      .map(([key, items]) => {
        const invNum = items[0].invoiceNumber;
        const invKey = items[0].invoiceKey;
        const soList = [...new Set(items.map((i) => i.orderNumber).filter(Boolean))];
        const soStr = soList.join(", ");
        const isDouble = soList.some((s) => (soInvMap[s]?.size || 0) > 1);
        const pAt = printedAtMap[invKey] || null;
        const isPrinted = printedInvoices.has(invKey);

        return {
          key,
          invoiceNumber: invNum,
          invoiceKey: invKey,
          so: soStr || items[0].orderNumber,
          items,
          orderDate: items[0].orderDate,
          jenisTransaksi: items[0].jenisTransaksi,
          customerName: items[0].customerName,
          kategori: items[0].kategori,
          isDoubleInv: isDouble,
          totalHarga: items.reduce((sum, i) => sum + i.totalHarga, 0),
          totalItems: items.length,
          allPrinted: isPrinted,
          anyPrinted: isPrinted,
          printedAt: pAt,
        };
      })
      .sort((a, b) => {
        const invA = parseInvNum(a.invoiceNumber);
        const invB = parseInvNum(b.invoiceNumber);
        const diff = invA !== invB ? invA - invB : parseDateMs(a.orderDate) - parseDateMs(b.orderDate);
        return sortOrder === "desc" ? -diff : diff;
      });
  }, [records, printedInvoices, printedAtMap, sortOrder]);

  const filtered = useMemo(() => {
    let result = grouped;
    if (filter === "belum") result = result.filter((g) => !g.allPrinted);
    else if (filter === "sudah") result = result.filter((g) => g.allPrinted);
    else if (filter === "double") result = result.filter((g) => g.isDoubleInv);
    if (katFilter !== "all") result = result.filter((g) => g.kategori === katFilter);
    if (jenisFilter !== "all") result = result.filter((g) => g.jenisTransaksi === jenisFilter);
    if (search) {
      const s = search.toLowerCase();
      result = result.filter(
        (g) =>
          g.so.toLowerCase().includes(s) ||
          g.invoiceNumber.toLowerCase().includes(s) ||
          g.customerName.toLowerCase().includes(s) ||
          g.items.some(
            (i) =>
              i.itemDescription.toLowerCase().includes(s) ||
              i.itemCode.toLowerCase().includes(s)
          )
      );
    }
    return result;
  }, [grouped, filter, katFilter, jenisFilter, search]);

  const totalPages = Math.ceil(filtered.length / ROWS_PER_PAGE);
  const pageData = filtered.slice(page * ROWS_PER_PAGE, (page + 1) * ROWS_PER_PAGE);

  useEffect(() => {
    setPage(0);
  }, [filter, katFilter, jenisFilter, search, sortOrder]);

  const summary = useMemo(() => {
    const uniqueInvoices = new Set(records.map((r) => r.invoiceKey));
    const uniqueSO = new Set(records.map((r) => r.orderNumber));
    const belumTerprint = [...uniqueInvoices].filter(
      (key) => !printedInvoices.has(key)
    ).length;
    const doubleInv = grouped.filter((g) => g.isDoubleInv).length;
    const totalHarga = grouped.reduce((sum, g) => sum + g.totalHarga, 0);
    return {
      totalSO: uniqueSO.size,
      totalInvoices: uniqueInvoices.size,
      totalItems: records.length,
      belumTerprint,
      doubleInv,
      totalHarga,
    };
  }, [records, printedInvoices, grouped]);

  const exportToExcel = useCallback(() => {
    if (records.length === 0) {
      alert("Tidak ada data untuk diekspor.");
      return;
    }

    // Filter all groups that have valid invoice numbers
    const validGroups = grouped.filter((g) =>
      g.invoiceNumber && g.invoiceNumber !== "0" && g.invoiceNumber !== "-"
    );

    if (validGroups.length === 0) {
      alert("Tidak ada faktur dengan nomor invoice yang valid untuk diekspor.");
      return;
    }

    // Sort strictly ASCENDING dari nomor faktur terkecil sampai terbesar
    const sorted = [...validGroups].sort((a, b) => {
      const invA = parseInvNum(a.invoiceNumber);
      const invB = parseInvNum(b.invoiceNumber);
      if (invA !== invB) return invA - invB;
      return parseDateMs(a.orderDate) - parseDateMs(b.orderDate);
    });

    // Format 1 Sheet: Rekap Faktur (No, Order Date, No SO, No Invoice, Pelanggan, Total Harga)
    const rekapData = sorted.map((g, idx) => ({
      "No": idx + 1,
      "Order Date": g.orderDate || "-",
      "No SO": g.so || "-",
      "No Invoice": g.invoiceNumber,
      "Pelanggan": g.customerName || "-",
      "Total Harga": g.totalHarga,
    }));

    const workbook = XLSX.utils.book_new();

    const wsRekap = XLSX.utils.json_to_sheet(rekapData);
    wsRekap["!cols"] = [
      { wch: 6 },  // No
      { wch: 14 }, // Order Date
      { wch: 18 }, // No SO
      { wch: 16 }, // No Invoice
      { wch: 35 }, // Pelanggan
      { wch: 18 }, // Total Harga
    ];
    XLSX.utils.book_append_sheet(workbook, wsRekap, "Rekap Faktur");

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    XLSX.writeFile(workbook, `Rekap_Faktur_Ascending_${dateStr}.xlsx`);
  }, [records, grouped]);

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-sm">
              FT
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900">Faktur Tracker</h1>
              <p className="text-xs text-gray-500">Tracking faktur dari Oracle export</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {records.length > 0 && (
              <button
                onClick={exportToExcel}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 px-3.5 py-1.5 rounded-lg shadow-sm transition-colors"
                title="Ekspor rekap faktur ascending (terkecil ke terbesar) ke Excel"
              >
                <span>📥</span>
                <span>Ekspor Excel (Ascending)</span>
              </button>
            )}
            {records.length > 0 && (
              <button
                onClick={clearAll}
                className="text-xs text-red-600 hover:text-red-700 px-3 py-1.5 rounded-lg hover:bg-red-50 border border-transparent hover:border-red-200"
              >
                Hapus Semua Data
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-4">
        {/* Upload bar - compact, always visible */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`flex items-center gap-3 rounded-lg border p-2 mb-3 transition-colors ${
            dragOver ? "border-blue-500 bg-blue-50" : "border-gray-300 bg-white"
          }`}
        >
          <label className="bg-blue-600 text-white px-4 py-1.5 rounded-lg cursor-pointer hover:bg-blue-700 text-sm font-medium whitespace-nowrap">
            Upload Excel
            <input type="file" accept=".xlsx,.xls" onChange={onFileInput} className="hidden" />
          </label>
          {loading && <span className="text-sm text-gray-500">Membaca file...</span>}
          {uploadedFiles.length > 0 && (
            <span className="text-xs text-gray-400 truncate">
              {uploadedFiles.length} file diupload · terakhir: {uploadedFiles[uploadedFiles.length - 1].name}
            </span>
          )}
        </div>
        {error && (
          <div className="mb-3 bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm">
            {error}
          </div>
        )}

        {/* Data loaded */}
        {records.length > 0 && (
          <>
            {/* Summary */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
              <Card label="Total SO" value={summary.totalSO.toLocaleString("id-ID")} />
              <Card label="Total Invoice" value={summary.totalInvoices.toLocaleString("id-ID")} />
              <Card label="Belum Terprint" value={summary.belumTerprint.toLocaleString("id-ID")} color="orange" />
              <Card label="Double INV" value={summary.doubleInv.toLocaleString("id-ID")} color="red" />
              <Card label="Total Harga" value={formatRupiah(summary.totalHarga)} small />
            </div>

            {/* Filters */}
            <div className="bg-white rounded-lg border border-gray-200 p-3 mb-4 flex flex-wrap items-center gap-2">
              <div className="flex gap-1">
                <FBtn active={filter === "belum"} onClick={() => setFilter("belum")} color="orange">Belum Terprint</FBtn>
                <FBtn active={filter === "sudah"} onClick={() => setFilter("sudah")} color="green">Sudah Terprint</FBtn>
                <FBtn active={filter === "all"} onClick={() => setFilter("all")}>Semua</FBtn>
                <FBtn active={filter === "double"} onClick={() => setFilter("double")} color="red">Double INV</FBtn>
              </div>
              <div className="h-6 w-px bg-gray-200 mx-1" />
              <div className="flex gap-1">
                <FBtn active={katFilter === "all"} onClick={() => setKatFilter("all")}>All Kat</FBtn>
                <FBtn active={katFilter === "1P"} onClick={() => setKatFilter("1P")} color="blue">1P</FBtn>
                <FBtn active={katFilter === "2P"} onClick={() => setKatFilter("2P")} color="green">2P</FBtn>
                <FBtn active={katFilter === "3P"} onClick={() => setKatFilter("3P")} color="purple">3P</FBtn>
              </div>
              <div className="h-6 w-px bg-gray-200 mx-1" />
              <div className="flex gap-1">
                <FBtn active={jenisFilter === "all"} onClick={() => setJenisFilter("all")}>All Jenis</FBtn>
                <FBtn active={jenisFilter === "ORA"} onClick={() => setJenisFilter("ORA")} color="blue">ORA</FBtn>
                <FBtn active={jenisFilter === "DOO"} onClick={() => setJenisFilter("DOO")} color="emerald">DOO</FBtn>
              </div>
              <div className="h-6 w-px bg-gray-200 mx-1" />
              <button
                onClick={() => setSortOrder((prev) => (prev === "desc" ? "asc" : "desc"))}
                className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 flex items-center gap-1 whitespace-nowrap"
                title="Ganti urutan faktur"
              >
                {sortOrder === "desc" ? "⬇ Terbaru di Atas" : "⬆ Terlama di Atas"}
              </button>
              <div className="flex-1" />
              <input
                type="text"
                placeholder="Cari SO, Invoice, Apotek, Item..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-full sm:w-64"
              />
              <button
                onClick={exportToExcel}
                className="text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-lg border border-emerald-300 flex items-center gap-1.5 whitespace-nowrap shadow-sm"
                title="Ekspor semua faktur yang ada nomor faktur/invoice (Ascending terkecil ke terbesar)"
              >
                <span>📥</span> Ekspor Excel (Ascending)
              </button>
              <button
                onClick={markAllAsPrinted}
                className="text-xs text-green-700 bg-green-50 hover:bg-green-100 px-3 py-1.5 rounded-lg border border-green-200 whitespace-nowrap"
              >
                Tandai Semua Printed
              </button>
              <button
                onClick={markAllAsUnprinted}
                className="text-xs text-orange-700 bg-orange-50 hover:bg-orange-100 px-3 py-1.5 rounded-lg border border-orange-200 whitespace-nowrap"
              >
                Reset ke Belum Terprint
              </button>
            </div>

            {/* Table */}
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm">
              {/* Top Pagination & Summary Header */}
              <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-blue-100 text-blue-800">
                    Hal {page + 1} / {totalPages || 1}
                  </span>
                  <p className="text-xs text-gray-600 font-medium">
                    {filtered.length.toLocaleString("id-ID")} SO · {summary.totalInvoices.toLocaleString("id-ID")} invoice
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setPage(Math.max(0, page - 1))}
                    disabled={page === 0}
                    className="px-2.5 py-1 text-xs font-medium rounded border border-gray-300 bg-white disabled:opacity-30 hover:bg-gray-100 transition-colors shadow-sm"
                  >
                    ← Prev
                  </button>
                  <span className="text-xs font-semibold text-gray-700 px-1">
                    {page + 1} / {totalPages || 1}
                  </span>
                  <button
                    onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                    disabled={page >= totalPages - 1}
                    className="px-2.5 py-1 text-xs font-medium rounded border border-gray-300 bg-white disabled:opacity-30 hover:bg-gray-100 transition-colors shadow-sm"
                  >
                    Next →
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-2 py-2 w-8"></th>
                      <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">Print</th>
                      <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">Done Print (Waktu)</th>
                      <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">Kat</th>
                      <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">Order Date</th>
                      <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">No SO</th>
                      <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">No Invoice</th>
                      <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">Jenis Transaksi</th>
                      <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">Pelanggan</th>
                      <th className="px-2 py-2 text-right text-xs font-medium text-gray-500 whitespace-nowrap">Total Harga</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {pageData.map((g) => {
                      const expanded = expandedInvoices.has(g.key);
                      const hasInvoice = !!g.invoiceNumber && g.invoiceNumber !== "0" && g.invoiceNumber !== "-";
                      return (
                        <Fragment key={g.key}>
                          <tr
                            onClick={() => toggleExpand(g.key)}
                            className={`cursor-pointer hover:bg-gray-50 ${
                              g.isDoubleInv ? "bg-red-50" : g.allPrinted ? "bg-green-50" : ""
                            }`}
                          >
                            <td className="px-2 py-2 text-center text-gray-400 text-xs">
                              {expanded ? "▼" : "▶"}
                            </td>
                            <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                              <button
                                onClick={() => togglePrint(g)}
                                disabled={!hasInvoice}
                                className={`w-6 h-6 rounded flex items-center justify-center text-xs font-bold transition-all shadow-sm ${
                                   !hasInvoice
                                    ? "bg-gray-100 text-gray-300 cursor-not-allowed"
                                    : g.allPrinted
                                    ? "bg-green-500 text-white hover:bg-orange-500 hover:rotate-180"
                                    : g.anyPrinted
                                    ? "bg-yellow-400 text-white hover:bg-yellow-500"
                                    : "bg-gray-200 text-gray-600 hover:bg-green-500 hover:text-white"
                                }`}
                                title={
                                  !hasInvoice
                                    ? "Menunggu No Faktur (Belum bisa diprint)"
                                    : g.allPrinted
                                    ? "Sudah Terprint · Klik untuk UNPRINT (Batal Cetak)"
                                    : g.anyPrinted
                                    ? "Sebagian terprint · Klik untuk tandai"
                                    : "Belum terprint · Klik untuk tandai SUDAH PRINT"
                                }
                              >
                                {!hasInvoice ? "–" : g.allPrinted ? "✓" : g.anyPrinted ? "◑" : "○"}
                              </button>
                            </td>
                            <td className="px-2 py-2 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                              {g.allPrinted && g.printedAt ? (
                                <span className="inline-flex items-center gap-1 text-[11px] font-mono font-medium text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200" title={`Selesai diprint pada: ${formatPrintTime(g.printedAt)}`}>
                                  <span className="text-emerald-600 font-bold">⏱</span>
                                  {formatPrintTime(g.printedAt)}
                                </span>
                              ) : g.anyPrinted ? (
                                <span className="text-xs text-yellow-600 italic">Sebagian</span>
                              ) : (
                                <span className="text-xs text-gray-300">-</span>
                              )}
                            </td>
                            <td className="px-2 py-2">
                              <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                                g.kategori === "1P" ? "bg-blue-100 text-blue-700"
                                : g.kategori === "2P" ? "bg-green-100 text-green-700"
                                : "bg-purple-100 text-purple-700"
                              }`}>
                                {g.kategori}
                              </span>
                            </td>
                            <td className="px-2 py-2 text-gray-600 whitespace-nowrap text-xs">{g.orderDate}</td>
                            <td className="px-2 py-2 font-mono text-xs text-gray-900 whitespace-nowrap">
                              {g.so}
                              {g.isDoubleInv && <span className="ml-1 text-red-600 font-bold" title="SO ini memiliki lebih dari 1 faktur">⚠</span>}
                            </td>
                            <td className="px-2 py-2 font-mono text-xs text-gray-900 whitespace-nowrap font-medium">
                              {hasInvoice ? (
                                g.invoiceNumber
                              ) : (
                                <span className="text-gray-400 italic text-xs">Menunggu Faktur</span>
                              )}
                            </td>
                            <td className="px-2 py-2 whitespace-nowrap">
                              <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${
                                g.jenisTransaksi === "ORA"
                                  ? "bg-blue-100 text-blue-800"
                                  : "bg-emerald-100 text-emerald-800"
                              }`}>
                                {g.jenisTransaksi}
                              </span>
                            </td>
                            <td className="px-2 py-2 text-gray-700 whitespace-nowrap max-w-xs truncate">{g.customerName}</td>
                            <td className="px-2 py-2 text-right text-gray-900 whitespace-nowrap font-medium text-xs">
                              {formatRupiah(g.totalHarga)}
                            </td>
                          </tr>
                          {expanded && (
                            <tr className="bg-gray-50">
                              <td colSpan={10} className="px-4 py-3">
                                <div className="flex flex-wrap items-center justify-between pb-2 mb-2 border-b border-gray-200 gap-2">
                                  <div className="text-xs text-gray-600">
                                    <span className="font-semibold text-gray-900">Invoice: <span className="font-mono text-blue-700 font-bold">{g.invoiceNumber}</span></span> · SO: <span className="font-semibold text-gray-900">{g.so}</span> · Pelanggan: <span className="font-semibold text-gray-900">{g.customerName}</span>
                                    {g.allPrinted && g.printedAt && (
                                      <span className="ml-2 inline-flex items-center gap-1 font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                                        <span>⏱ Selesai Print:</span>
                                        <span className="font-mono font-bold text-emerald-900">{formatPrintTime(g.printedAt)}</span>
                                      </span>
                                    )}
                                  </div>
                                  <div>
                                    {g.allPrinted ? (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); togglePrint(g); }}
                                        className="px-3 py-1 bg-orange-100 text-orange-800 border border-orange-300 rounded-lg text-xs font-bold hover:bg-orange-200 transition-colors flex items-center gap-1.5 shadow-sm"
                                      >
                                        <span>↩</span> Unprint Faktur Ini
                                      </button>
                                    ) : (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); togglePrint(g); }}
                                        className="px-3 py-1 bg-green-600 text-white rounded-lg text-xs font-bold hover:bg-green-700 transition-colors flex items-center gap-1.5 shadow-sm"
                                      >
                                        <span>✓</span> Tandai Sudah Terprint
                                      </button>
                                    )}
                                  </div>
                                </div>
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="border-b border-gray-200">
                                      <th className="px-2 py-1 text-left font-medium text-gray-500">No Invoice</th>
                                      <th className="px-2 py-1 text-left font-medium text-gray-500">Item Code</th>
                                      <th className="px-2 py-1 text-left font-medium text-gray-500">Item Description</th>
                                      <th className="px-2 py-1 text-right font-medium text-gray-500">Qty</th>
                                      <th className="px-2 py-1 text-left font-medium text-gray-500">UOM</th>
                                      <th className="px-2 py-1 text-left font-medium text-gray-500">LOT Number</th>
                                      <th className="px-2 py-1 text-right font-medium text-gray-500">Total Harga</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-100">
                                    {g.items.map((item, i) => (
                                      <tr key={i} className="hover:bg-gray-100">
                                        <td className="px-2 py-1 font-mono text-gray-900 whitespace-nowrap">{item.invoiceNumber}</td>
                                        <td className="px-2 py-1 font-mono text-gray-600 whitespace-nowrap">{item.itemCode}</td>
                                        <td className="px-2 py-1 text-gray-700">{item.itemDescription}</td>
                                        <td className="px-2 py-1 text-right text-gray-900">{item.qty}</td>
                                        <td className="px-2 py-1 text-gray-600">{item.uom}</td>
                                        <td className="px-2 py-1 font-mono text-gray-600 whitespace-nowrap">{item.lotNumber}</td>
                                        <td className="px-2 py-1 text-right text-gray-900 whitespace-nowrap">{formatRupiah(item.totalHarga)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between">
                <p className="text-xs text-gray-500">
                  {filtered.length.toLocaleString("id-ID")} SO · {summary.totalInvoices.toLocaleString("id-ID")} invoice
                </p>
                <div className="flex items-center gap-2">
                  <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}
                    className="px-3 py-1 text-sm rounded border border-gray-300 disabled:opacity-30 hover:bg-gray-50">←</button>
                  <span className="text-sm text-gray-600">{page + 1} / {totalPages || 1}</span>
                  <button onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1}
                    className="px-3 py-1 text-sm rounded border border-gray-300 disabled:opacity-30 hover:bg-gray-50">→</button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function Card({ label, value, color, small }: { label: string; value: string; color?: "orange" | "red"; small?: boolean }) {
  const colorClass = color === "orange" ? "text-orange-600" : color === "red" ? "text-red-600" : "text-gray-900";
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`${small ? "text-sm" : "text-xl"} font-bold ${colorClass}`}>{value}</p>
    </div>
  );
}

function FBtn({ active, onClick, children, color = "gray" }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
  color?: "gray" | "orange" | "red" | "blue" | "green" | "purple" | "emerald";
}) {
  const colors: Record<string, string> = {
    gray: active ? "bg-gray-800 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200",
    orange: active ? "bg-orange-500 text-white" : "bg-orange-100 text-orange-700 hover:bg-orange-200",
    red: active ? "bg-red-500 text-white" : "bg-red-100 text-red-700 hover:bg-red-200",
    blue: active ? "bg-blue-600 text-white" : "bg-blue-100 text-blue-700 hover:bg-blue-200",
    green: active ? "bg-green-600 text-white" : "bg-green-100 text-green-700 hover:bg-green-200",
    purple: active ? "bg-purple-600 text-white" : "bg-purple-100 text-purple-700 hover:bg-purple-200",
    emerald: active ? "bg-emerald-600 text-white" : "bg-emerald-100 text-emerald-700 hover:bg-emerald-200",
  };
  return (
    <button onClick={onClick} className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${colors[color]}`}>
      {children}
    </button>
  );
}
