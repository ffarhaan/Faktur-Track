"use client";

import { useState, useMemo, useEffect, useCallback, useRef, useDeferredValue, Fragment } from "react";
import * as XLSX from "xlsx";
import {
  parseExcelFile,
  categorize,
  isOraCustomer,
  getProductCategory,
  getPrekursorOOTClassification,
  normalize,
} from "@/lib/parser";
import { FakturRecord, FirestoreFakturDoc, InvoiceProgression, FakturGroup, UploadNotification, ActiveUserPresence } from "@/lib/types";
import {
  subscribeToFakturs,
  getExistingFakturs,
  getLivePrintState,
  fetchAllLivePrintKeys,
  saveFaktursBatch,
  updateFakturPrintStatus,
  updateFaktursPrintStatusBatch,
  updateFakturCategory,
  updateProductCategoryOverride,
  clearAllFakturs,
  updateUserPresence,
  removeUserPresence,
  subscribeToOnlinePresence,
  isStalePrintTimestamp,
} from "@/lib/firestoreService";
import MasterApotekModal from "@/components/MasterApotekModal";
import MasterProductModal from "@/components/MasterProductModal";
import LoginModal, { AppUser } from "@/components/LoginModal";
import ChangePasswordModal from "@/components/ChangePasswordModal";
import ExportExcelModal from "@/components/ExportExcelModal";

type Filter = "belum" | "sudah" | "all" | "double" | "retur";
type KatFilter = "all" | "1P" | "2P" | "3P";
type JenisFilter = "all" | "ORA" | "DOO";
type KlasFilter = "all" | "prekursor" | "oot" | "ccp" | "alkes" | "farma";

const ROWS_PER_PAGE = 50;

function parseInvNum(invs: string | string[]): number {
  if (!invs) return 0;
  const s = Array.isArray(invs) ? invs[0] : String(invs);
  const n = parseInt(s.replace(/\D/g, ""), 10);
  return isNaN(n) ? 0 : n;
}

function parseDateMs(dStr: string): number {
  if (!dStr || dStr === "-") return 0;
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

function dbRowsToFakturRecords(
  rows: Array<Record<string, unknown>>,
  productOverrides?: Record<string, string>
): {
  records: FakturRecord[];
  printedSet: Set<string>;
  printedAtMap: Record<string, string>;
  printedByMap: Record<string, string>;
} {
  const records: FakturRecord[] = [];
  const printedSet = new Set<string>();
  const printedAtMap: Record<string, string> = {};
  const printedByMap: Record<string, string> = {};

  for (const r of rows) {
    const rawInv = String(r.no_faktur || "");
    const cleanInv = rawInv.replace(/-1P$/i, "");
    const extra = (r.extra as Record<string, unknown>) || {};
    const items = (extra.items as Array<Record<string, unknown>>) || [];
    const cust = String(extra.nama_pelanggan || r.customer_name || "");
    const date = String(extra.order_date || r.order_date || extra.accounting_date || "");
    const txDate = String(r.transaction_date || extra.transaction_date || date);
    const isOra = r.jenis_transaksi === "ORA" || isOraCustomer(cust);
    const invKey = isOra ? `${cleanInv}-1P` : cleanInv;
    const cleanJenis: "DOO" | "ORA" = isOra ? "ORA" : "DOO";
    const kategori = (r.kategori as "1P" | "2P" | "3P") || categorize(cleanJenis, cust, cleanJenis);
    const pAt = (r.printed_at as string) || null;
    const pBy = (r.printed_by as string) || (extra.printed_by as string) || null;

    const isStale = isStalePrintTimestamp(pAt, date);
    const isPrinted = !isStale && Boolean(r.status_cetak);

    if (isPrinted) {
      printedSet.add(invKey);
      if (pAt) {
        printedAtMap[invKey] = pAt;
      }
      if (pBy) {
        printedByMap[invKey] = pBy;
      }
    }

    if (items.length > 0) {
      for (let idx = 0; idx < items.length; idx++) {
        const it = items[idx];
        const itemCode = String(it.item_code || "");
        const itemDesc = String(it.item_description || "");
        const katProd = getProductCategory(itemCode, itemDesc, productOverrides) || (it.kategori_produk as string) || "FARMA";
        const klasObat =
          katProd === "PREKURSOR"
            ? "Prekursor"
            : katProd === "OOT"
            ? "OOT"
            : getPrekursorOOTClassification(itemDesc, itemCode) || undefined;
        const validSO = String(it.order_number || r.no_sales_order || "-").trim();

        records.push({
          orderDate: date,
          transactionDate: txDate,
          orderNumber: validSO || "-",
          invoiceNumber: cleanInv,
          invoiceKey: invKey,
          jenisTransaksi: cleanJenis,
          customerName: cust,
          itemCode,
          itemDescription: itemDesc,
          qty: (it.qty as number | string) || 0,
          uom: String(it.uom || "-"),
          lotNumber: String(it.lot_number || "-"),
          totalHarga: typeof it.total_harga === "number" ? it.total_harga : parseFloat(String(it.total_harga || 0)) || 0,
          kategori,
          kategoriProduk: katProd,
          klasifikasiObat: klasObat,
          isDoubleInv: false,
          isRetur: (typeof it.total_harga === "number" ? it.total_harga : parseFloat(String(it.total_harga || 0)) || 0) < 0 || itemDesc.toUpperCase().includes("RETUR") || cleanInv.toUpperCase().includes("RETUR") || String(extra.jenis_transaksi || "").toUpperCase().includes("RETUR"),
          status_cetak: isPrinted,
          printed_at: isPrinted ? pAt : null,
          printed_by: isPrinted ? pBy : null,
          rowIndex: idx,
        });
      }
    } else {
      const docSO = String(r.no_sales_order || "-").trim();
      const docAmount = typeof extra.total_harga === "number" ? extra.total_harga : parseFloat(String(extra.total_harga || 0)) || 0;

      records.push({
        orderDate: date,
        transactionDate: txDate,
        orderNumber: docSO || "-",
        invoiceNumber: cleanInv,
        invoiceKey: invKey,
        jenisTransaksi: cleanJenis,
        customerName: cust,
        itemCode: "-",
        itemDescription: "-",
        qty: 1,
        uom: "-",
        lotNumber: "-",
        totalHarga: docAmount,
        kategori,
        isDoubleInv: false,
        isRetur: docAmount < 0 || cleanInv.toUpperCase().includes("RETUR") || String(extra.jenis_transaksi || "").toUpperCase().includes("RETUR"),
        status_cetak: isPrinted,
        printed_at: isPrinted ? pAt : null,
        printed_by: isPrinted ? pBy : null,
        rowIndex: 0,
      });
    }
  }

  // Detect double invoices
  const soInvMap: Record<string, Set<string>> = {};
  for (const rec of records) {
    if (rec.orderNumber && rec.orderNumber !== "-") {
      if (!soInvMap[rec.orderNumber]) soInvMap[rec.orderNumber] = new Set();
      if (rec.invoiceNumber && rec.invoiceNumber !== "-") {
        soInvMap[rec.orderNumber].add(rec.invoiceNumber);
      }
    }
  }
  for (const rec of records) {
    if (rec.orderNumber && rec.orderNumber !== "-" && (soInvMap[rec.orderNumber]?.size || 0) > 1) {
      rec.isDoubleInv = true;
    }
  }

  return { records, printedSet, printedAtMap, printedByMap };
}

export default function Home() {
  const [records, setRecords] = useState<FakturRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mainView, setMainView] = useState<"workspace" | "dashboard">("workspace");
  const [filter, setFilter] = useState<Filter>("belum");
  const [katFilter, setKatFilter] = useState<KatFilter>("all");
  const [jenisFilter, setJenisFilter] = useState<JenisFilter>("all");
  const [klasFilter, setKlasFilter] = useState<KlasFilter>("all");
  const [dateFilter, setDateFilter] = useState<string>("all");
  const [dashboardStartDate, setDashboardStartDate] = useState<string>("");
  const [dashboardEndDate, setDashboardEndDate] = useState<string>("");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [page, setPage] = useState(0);
  const [printedInvoices, setPrintedInvoices] = useState<Set<string>>(new Set());
  const [printedAtMap, setPrintedAtMap] = useState<Record<string, string>>({});
  const [printedByMap, setPrintedByMap] = useState<Record<string, string>>({});
  const [invoiceProgression, setInvoiceProgression] = useState<InvoiceProgression | null>(null);
  const [expandedInvoices, setExpandedInvoices] = useState<Set<string>>(new Set());
  const [dragOver, setDragOver] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [showApotekModal, setShowApotekModal] = useState(false);
  const [showProductModal, setShowProductModal] = useState(false);
  const [showChangelogModal, setShowChangelogModal] = useState(false);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const deviceIdRef = useRef<string>(Math.random().toString(36).substring(2, 9));
  const [uploadNotification, setUploadNotification] = useState<UploadNotification | null>(null);

  // User Authentication & Role State
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const currentUserRef = useRef<AppUser | null>(null);
  const [showLoginModal, setShowLoginModal] = useState(true);
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);

  // Real-time Online Users Presence
  const [onlineUsers, setOnlineUsers] = useState<ActiveUserPresence[]>([]);
  const [showOnlinePopover, setShowOnlinePopover] = useState(false);

  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);

  // Subscribe to real-time online presence
  useEffect(() => {
    const unsub = subscribeToOnlinePresence((users) => {
      setOnlineUsers(users);
    });
    return () => unsub();
  }, []);

  // Heartbeat reporter for current user
  useEffect(() => {
    if (!currentUser) return;
    updateUserPresence(currentUser, deviceIdRef.current);

    const timer = setInterval(() => {
      updateUserPresence(currentUser, deviceIdRef.current);
    }, 20000);

    const handleUnload = () => {
      removeUserPresence(deviceIdRef.current);
    };
    window.addEventListener("beforeunload", handleUnload);

    return () => {
      clearInterval(timer);
      window.removeEventListener("beforeunload", handleUnload);
    };
  }, [currentUser]);

  useEffect(() => {
    try {
      const saved = typeof window !== "undefined" ? sessionStorage.getItem("faktur_tracker_user") : null;
      if (saved) {
        const u = JSON.parse(saved);
        if (u && typeof u === "object" && typeof u.name === "string" && (u.role === "admin" || u.role === "readonly")) {
          setCurrentUser(u);
          setShowLoginModal(false);
          return;
        } else {
          sessionStorage.removeItem("faktur_tracker_user");
        }
      }
    } catch {
      // ignore
    }
    setShowLoginModal(true);
  }, []);

  const handleLogin = (user: AppUser) => {
    setCurrentUser(user);
    currentUserRef.current = user;
    try {
      if (typeof window !== "undefined") {
        sessionStorage.setItem("faktur_tracker_user", JSON.stringify(user));
      }
    } catch {
      // ignore
    }
    updateUserPresence(user, deviceIdRef.current);
    setShowLoginModal(false);
    showToast(`✓ Pengguna aktif (ON): ${user.name}${user.role === "readonly" ? " (Hanya Lihat)" : ""}`);
  };

  // Clear / Reset All Data
  const handleClearAll = async () => {
    if (currentUserRef.current?.role === "readonly") {
      alert("⚠️ Akses Stranger: Anda hanya memiliki izin melihat data (Read Only).");
      return;
    }
    if (!confirm("⚠️ YAKIN INGIN MENGHAPUS SEMUA DATA?\\n\\nSemua data faktur dan riwayat status cetak di database cloud akan direset seperti semula.")) {
      return;
    }

    setLoading(true);
    try {
      await clearAllFakturs();
      setRecords([]);
      setPrintedInvoices(new Set());
      setPrintedAtMap({});
      setInvoiceProgression(null);
      setUploadNotification(null);
      setExpandedInvoices(new Set());
      setPage(0);
      showToast("✓ Seluruh data berhasil direset.");
    } catch (err) {
      console.error("Clear error:", err);
      alert("Gagal mereset data di database.");
    } finally {
      setLoading(false);
    }
  };

  const [selectedRowIndex, setSelectedRowIndex] = useState(0);
  const [selectedColIdx, setSelectedColIdx] = useState(3); // Default to No Invoice column
  const [categoryOverrides, setCategoryOverrides] = useState<Record<string, "1P" | "2P" | "3P">>({});
  const categoryOverridesRef = useRef<Record<string, "1P" | "2P" | "3P">>({});
  const [productOverrides, setProductOverrides] = useState<Record<string, string>>({});
  const productOverridesRef = useRef<Record<string, string>>({});
  const printedInvoicesRef = useRef<Set<string>>(new Set());
  const printedAtMapRef = useRef<Record<string, string>>({});
  const printedByMapRef = useRef<Record<string, string>>({});
  const invoiceProgressionRef = useRef<InvoiceProgression | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const isUploadingRef = useRef(false);
  const currentFakturDocsRef = useRef<FirestoreFakturDoc[]>([]);

  // Smooth & lag-free keyboard navigation refs
  const pageDataRef = useRef<FakturGroup[]>([]);
  const selectedRowIndexRef = useRef(0);
  const selectedColIdxRef = useRef(3);
  const totalPagesRef = useRef(1);
  const showApotekModalRef = useRef(false);
  const showProductModalRef = useRef(false);
  const showChangelogModalRef = useRef(false);
  const showExportModalRef = useRef(false);
  const togglePrintRef = useRef<(group: FakturGroup) => void>(() => {});
  const toggleExpandRef = useRef<(key: string) => void>(() => {});
  const lastSpaceTimeRef = useRef(0);

  useEffect(() => {
    selectedRowIndexRef.current = selectedRowIndex;
  }, [selectedRowIndex]);

  useEffect(() => {
    selectedColIdxRef.current = selectedColIdx;
  }, [selectedColIdx]);

  useEffect(() => {
    showApotekModalRef.current = showApotekModal;
  }, [showApotekModal]);

  useEffect(() => {
    showProductModalRef.current = showProductModal;
  }, [showProductModal]);

  useEffect(() => {
    showChangelogModalRef.current = showChangelogModal;
  }, [showChangelogModal]);

  useEffect(() => {
    showExportModalRef.current = showExportModal;
  }, [showExportModal]);

  useEffect(() => {
    categoryOverridesRef.current = categoryOverrides;
  }, [categoryOverrides]);

  useEffect(() => {
    productOverridesRef.current = productOverrides;
  }, [productOverrides]);

  useEffect(() => {
    printedInvoicesRef.current = printedInvoices;
  }, [printedInvoices]);

  useEffect(() => {
    printedAtMapRef.current = printedAtMap;
  }, [printedAtMap]);

  useEffect(() => {
    printedByMapRef.current = printedByMap;
  }, [printedByMap]);

  useEffect(() => {
    invoiceProgressionRef.current = invoiceProgression;
  }, [invoiceProgression]);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3500);
  }, []);


  const handleUpdateCategory = useCallback(
    async (invoiceKey: string, newKat: "1P" | "2P" | "3P", customerName?: string) => {
      if (currentUserRef.current?.role === "readonly") {
        showToast("⚠️ Akses Stranger: Anda hanya memiliki izin melihat data (Read Only).");
        return;
      }
      const cleanInv = invoiceKey.replace(/-1P$/i, "");
      const cleanCust = (customerName || "").trim();
      const normCust = cleanCust ? normalize(cleanCust) : "";

      // 1. Optimistic instant local update for all records of this apotek/customer
      setRecords((prev) =>
        prev.map((r) => {
          const rCleanCust = (r.customerName || "").trim();
          const rNormCust = rCleanCust ? normalize(rCleanCust) : "";
          const isMatch =
            r.invoiceKey === invoiceKey ||
            r.invoiceNumber === cleanInv ||
            (normCust && rNormCust === normCust) ||
            (cleanCust && rCleanCust === cleanCust);

          return isMatch && r.jenisTransaksi !== "ORA"
            ? { ...r, kategori: newKat }
            : r;
        })
      );

      // 2. Persist in memory ref and state
      if (normCust) categoryOverridesRef.current[normCust] = newKat;
      if (cleanCust) categoryOverridesRef.current[cleanCust] = newKat;
      if (cleanInv) categoryOverridesRef.current[cleanInv] = newKat;
      setCategoryOverrides((prev) => ({
        ...prev,
        ...(normCust ? { [normCust]: newKat } : {}),
        ...(cleanCust ? { [cleanCust]: newKat } : {}),
        ...(cleanInv ? { [cleanInv]: newKat } : {}),
      }));

      showToast(`✓ Kategori ${cleanCust ? `Apotek "${cleanCust}"` : `faktur ${cleanInv}`} disimpan ke ${newKat}`);

      // 3. Persist to Firestore chunk & category_overrides doc
      try {
        await updateFakturCategory(invoiceKey, newKat, cleanCust);
      } catch (err) {
        console.warn("Update category error:", err);
      }
    },
    [showToast]
  );

  const handleUpdateProductCategory = useCallback(
    async (productCode: string, productName: string, newKat: string) => {
      if (currentUser?.role === "readonly") return;

      const cleanCode = productCode ? productCode.trim() : "";
      const numOnly = cleanCode ? cleanCode.replace(/[^0-9]/g, "") : "";
      const cleanName = productName ? productName.trim() : "";
      const normName = cleanName ? normalize(cleanName) : "";

      // 1. Optimistically update productOverrides state and ref
      const newOverrides = { ...productOverridesRef.current };
      if (cleanCode && cleanCode !== "-") newOverrides[cleanCode] = newKat;
      if (numOnly) newOverrides[numOnly] = newKat;
      if (cleanName && cleanName !== "-") newOverrides[cleanName] = newKat;
      if (normName) newOverrides[normName] = newKat;

      productOverridesRef.current = newOverrides;
      setProductOverrides(newOverrides);

      // 2. Optimistically update all records matching product in state
      setRecords((prev) =>
        prev.map((r) => {
          const rCode = String(r.itemCode || "").trim();
          const rDesc = String(r.itemDescription || "").trim();
          const rNorm = rDesc ? normalize(rDesc) : "";

          const isMatch =
            (cleanCode && cleanCode !== "-" && rCode === cleanCode) ||
            (cleanName && cleanName !== "-" && rDesc === cleanName) ||
            (normName && rNorm === normName);

          if (isMatch) {
            const klasObat =
              newKat === "PREKURSOR" ? "Prekursor" : newKat === "OOT" ? "OOT" : undefined;
            return {
              ...r,
              kategoriProduk: newKat,
              klasifikasiObat: klasObat,
            };
          }
          return r;
        })
      );

      showToast(`✓ Kategori produk "${cleanName || cleanCode}" disimpan ke ${newKat}`);

      // 3. Persist to Firestore chunk & product_category_overrides doc
      try {
        await updateProductCategoryOverride(productCode, productName, newKat);
      } catch (err) {
        console.warn("Update product category error:", err);
      }
    },
    [currentUser, showToast]
  );

  // Real-time Firestore Subscription
  useEffect(() => {
    setLoading(true);
    const unsubscribe = subscribeToFakturs(
      (docs, prog, printState, overrides, uploadNotif, reason, prodOverrides) => {
        if (isUploadingRef.current) return;

        if (prog) setInvoiceProgression(prog);

        if (overrides) {
          setCategoryOverrides(overrides);
          categoryOverridesRef.current = overrides;
        }

        if (prodOverrides) {
          setProductOverrides(prodOverrides);
          productOverridesRef.current = prodOverrides;
        }

        if (printState && (printState.printedKeys?.length || 0) > 0) {
          const newKeys = printState.printedKeys;
          const newMap = printState.printedAtMap || {};
          const newByMap = printState.printedByMap || {};
          setPrintedInvoices((prev) => {
            const next = new Set<string>([...Array.from(prev), ...newKeys]);
            printedInvoicesRef.current = next;
            return next;
          });
          setPrintedAtMap((prev) => {
            const next = { ...prev, ...newMap };
            printedAtMapRef.current = next;
            return next;
          });
          setPrintedByMap((prev) => {
            const next = { ...prev, ...newByMap };
            printedByMapRef.current = next;
            return next;
          });
        }

        // Real-time Upload Broadcast to all other devices!
        if (uploadNotif && uploadNotif.uploaderId !== deviceIdRef.current) {
          setUploadNotification(uploadNotif);
          showToast(`📤 File baru diunggah rekan: ${uploadNotif.fileName} (${uploadNotif.newUnprinted} faktur baru)`);
        }

        if (reason === "print" || reason === "meta") {
          setLoading(false);
          return;
        }

        if (docs.length > 0) {
          currentFakturDocsRef.current = docs;
          const { records: recs, printedSet: docPrintedSet, printedAtMap: docPrintedAtMap, printedByMap: docPrintedByMap } = dbRowsToFakturRecords(
            docs as unknown as Array<Record<string, unknown>>,
            prodOverrides || productOverridesRef.current
          );
          setRecords(recs);

          // Synchronously merge printed invoices so they NEVER desynchronize!
          setPrintedInvoices((prev) => {
            const next = new Set<string>([
              ...Array.from(prev),
              ...(printState?.printedKeys || []),
              ...Array.from(docPrintedSet),
            ]);
            printedInvoicesRef.current = next;
            return next;
          });

          setPrintedAtMap((prev) => {
            const next = {
              ...prev,
              ...(printState?.printedAtMap || {}),
              ...docPrintedAtMap,
            };
            printedAtMapRef.current = next;
            return next;
          });

          setPrintedByMap((prev) => {
            const next = {
              ...prev,
              ...(printState?.printedByMap || {}),
              ...docPrintedByMap,
            };
            printedByMapRef.current = next;
            return next;
          });
        } else if (reason === "chunks") {
          currentFakturDocsRef.current = [];
          setRecords([]);
          printedInvoicesRef.current = new Set();
          printedAtMapRef.current = {};
          printedByMapRef.current = {};
          setPrintedInvoices(new Set());
          setPrintedAtMap({});
          setPrintedByMap({});
        }
        setLoading(false);
      },
      (err) => {
        console.error("Firestore sync error:", err);
        setError("Gagal sinkronisasi data dengan database.");
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  const handleManualRefresh = useCallback(async () => {
    setLoading(true);
    try {
      const { docs, progression: prog, printState, categoryOverrides: overrides, productCategoryOverrides: prodOverrides } = await getExistingFakturs();
      if (prog) setInvoiceProgression(prog);
      if (overrides) {
        setCategoryOverrides(overrides);
        categoryOverridesRef.current = overrides;
      }
      if (prodOverrides) {
        setProductOverrides(prodOverrides);
        productOverridesRef.current = prodOverrides;
      }
      const { records: recs, printedSet: docPrintedSet, printedAtMap: docPrintedAtMap, printedByMap: docPrintedByMap } = dbRowsToFakturRecords(
        docs as unknown as Array<Record<string, unknown>>,
        prodOverrides || productOverridesRef.current
      );
      const unifiedPrintedKeys = new Set([
        ...(printState?.printedKeys || []),
        ...Array.from(docPrintedSet),
      ]);
      setPrintedInvoices(unifiedPrintedKeys);
      setPrintedAtMap({
        ...(printState?.printedAtMap || {}),
        ...docPrintedAtMap,
      });
      setPrintedByMap({
        ...(printState?.printedByMap || {}),
        ...docPrintedByMap,
      });
      setRecords(recs);
      showToast("✓ Data berhasil diperbarui.");
    } catch (err) {
      console.error("Refresh error:", err);
      setError("Gagal memperbarui data.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Toggle Print Status (Immediate Firestore write & real-time sync)
  const togglePrint = useCallback(
    async (group: FakturGroup) => {
      if (currentUserRef.current?.role === "readonly") {
        showToast("⚠️ Akses Stranger: Anda hanya memiliki izin melihat data (Read Only).");
        return;
      }
      const willBePrinted = !group.allPrinted;
      // Strict Key Isolation: use group.invoiceKey directly (DOO uses '20078', ORA uses '20078-1P')
      const targetKey = group.invoiceKey;
      const nowIso = new Date().toISOString();
      const currentUserName = currentUserRef.current?.name || "Admin";

      // 1. Optimistic Local Update - strictly targetKey only
      setPrintedInvoices((prev) => {
        const next = new Set(prev);
        if (willBePrinted) next.add(targetKey);
        else next.delete(targetKey);
        printedInvoicesRef.current = next;
        return next;
      });

      setPrintedAtMap((prev) => {
        const next = { ...prev };
        if (willBePrinted) next[targetKey] = nowIso;
        else delete next[targetKey];
        printedAtMapRef.current = next;
        return next;
      });

      setPrintedByMap((prev) => {
        const next = { ...prev };
        if (willBePrinted) next[targetKey] = currentUserName;
        else delete next[targetKey];
        printedByMapRef.current = next;
        return next;
      });

      if (currentFakturDocsRef.current) {
        currentFakturDocsRef.current.forEach((d) => {
          const k = d.id || d.no_faktur;
          if (k === targetKey) {
            d.status_cetak = willBePrinted;
            d.printed_at = willBePrinted ? nowIso : null;
            d.printed_by = willBePrinted ? currentUserName : null;
          }
        });
      }

      // INSTANT OPTIMISTIC TOAST (< 1ms immediate feedback upon click or spacebar)
      showToast(
        willBePrinted
          ? `✓ Faktur ${targetKey} ditandai SUDAH dicetak.`
          : `↩ Faktur ${targetKey} dikembalikan ke BELUM dicetak.`
      );

      // 2. Firestore Sync - strictly updates targetKey in background
      try {
        await updateFakturPrintStatus(
          targetKey,
          willBePrinted,
          willBePrinted ? nowIso : null,
          willBePrinted ? currentUserName : null
        );
      } catch (err) {
        console.error("Print toggle sync error:", err);
        showToast(`⚠️ Gagal menyimpan status faktur ${targetKey} ke server.`);
      }
    },
    [showToast]
  );

  const toggleExpand = useCallback((key: string) => {
    setExpandedInvoices((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // 1. Base invoice groups (Depends ONLY on records and productOverrides)
  // Pre-groups, calculates line totals, classifications, precomputes searchStr, and sorts ONCE
  const baseGroups = useMemo<FakturGroup[]>(() => {
    const map = new Map<string, FakturGroup>();

    for (const r of records) {
      const key = r.invoiceKey || r.invoiceNumber;
      if (!key) continue;

      if (!map.has(key)) {
        map.set(key, {
          key,
          invoiceNumber: r.invoiceNumber,
          invoiceKey: key,
          so: r.orderNumber,
          items: [],
          orderDate: r.orderDate,
          transactionDate: r.transactionDate || r.orderDate,
          jenisTransaksi: r.jenisTransaksi,
          customerName: r.customerName,
          kategori: r.kategori,
          kategoriProduk: r.kategoriProduk || "FARMA",
          hasPrekursor: false,
          hasOOT: false,
          hasCCP: false,
          hasAlkes: false,
          hasFarma: false,
          isDoubleInv: false,
          isRetur: false,
          totalHarga: 0,
          totalItems: 0,
          allPrinted: false,
          printedAt: null,
          printedBy: null,
        });
      }

      const g = map.get(key)!;
      g.items.push(r);
      g.totalHarga += r.totalHarga;
      g.totalItems += 1;

      if (r.isDoubleInv) g.isDoubleInv = true;
      if (r.isRetur || r.totalHarga < 0) g.isRetur = true;

      const kat = (getProductCategory(r.itemCode, r.itemDescription, productOverrides) || r.kategoriProduk || "FARMA").toUpperCase();
      if (kat === "PREKURSOR" || r.klasifikasiObat === "Prekursor") g.hasPrekursor = true;
      if (kat === "OOT" || r.klasifikasiObat === "OOT") g.hasOOT = true;
      if (kat === "CCP") g.hasCCP = true;
      if (kat === "ALKES") g.hasAlkes = true;
      if (kat === "FARMA") g.hasFarma = true;
    }

    for (const g of map.values()) {
      if (g.totalHarga < 0) g.isRetur = true;

      // Calculate DOMINANT Category across all items in this invoice
      const katCounts: Record<string, number> = {};
      for (const item of g.items) {
        const k = (getProductCategory(item.itemCode, item.itemDescription, productOverrides) || item.kategoriProduk || "FARMA").toUpperCase();
        katCounts[k] = (katCounts[k] || 0) + 1;
      }

      let dominantKat = "FARMA";
      let maxCount = -1;
      const priorityOrder = ["CCP", "PREKURSOR", "OOT", "FARMA", "ALKES"];
      for (const [k, count] of Object.entries(katCounts)) {
        if (count > maxCount) {
          maxCount = count;
          dominantKat = k;
        } else if (count === maxCount) {
          const currIdx = priorityOrder.indexOf(dominantKat);
          const newIdx = priorityOrder.indexOf(k);
          if (newIdx !== -1 && (currIdx === -1 || newIdx < currIdx)) {
            dominantKat = k;
          }
        }
      }
      g.kategoriProduk = dominantKat;

      // Precompute lowercase search string for blazing fast instant search
      const itemText = g.items.map((i) => `${i.itemCode} ${i.itemDescription}`).join(" ");
      g.searchStr = `${g.so} ${g.invoiceNumber} ${g.customerName} ${g.transactionDate || ""} ${g.orderDate} ${g.kategoriProduk} ${g.isRetur ? "retur" : ""} ${itemText}`.toLowerCase();
      g.invNum = parseInvNum(g.invoiceNumber);
    }

    return Array.from(map.values()).sort((a, b) => (b.invNum || 0) - (a.invNum || 0));
  }, [records, productOverrides]);

  // 2. Max Invoice KPIs (Depends ONLY on baseGroups - Never recomputes when print status toggles!)
  const highestInvoices = useMemo(() => {
    let maxOraStr = "-";
    let maxOraNum = -1;
    let max1PDooStr = "-";
    let max1PDooNum = -1;
    let max2PStr = "-";
    let max2PNum = -1;
    let max3PStr = "-";
    let max3PNum = -1;

    for (const g of baseGroups) {
      const num = g.invNum || 0;
      if (num <= 0) continue;

      if (g.jenisTransaksi === "ORA") {
        if (num > maxOraNum) {
          maxOraNum = num;
          maxOraStr = g.invoiceNumber;
        }
      } else {
        if (g.kategori === "1P" && num > max1PDooNum) {
          max1PDooNum = num;
          max1PDooStr = g.invoiceNumber;
        } else if (g.kategori === "2P" && num > max2PNum) {
          max2PNum = num;
          max2PStr = g.invoiceNumber;
        } else if (g.kategori === "3P" && num > max3PNum) {
          max3PNum = num;
          max3PStr = g.invoiceNumber;
        }
      }
    }

    return { maxOraStr, max1PDooStr, max2PStr, max3PStr };
  }, [baseGroups]);

  // 3. Unique order dates for filter dropdown
  const availableDates = useMemo(() => {
    const set = new Set<string>();
    for (const r of records) {
      if (r.orderDate && r.orderDate !== "-") set.add(r.orderDate);
    }
    return Array.from(set).sort((a, b) => parseDateMs(b) - parseDateMs(a));
  }, [records]);

  // 4. Dynamic Print-Aware Groups (Lightning-fast shallow projection, takes <1ms)
  const grouped = useMemo<FakturGroup[]>(() => {
    return baseGroups.map((g) => {
      const isPrinted = printedInvoices.has(g.key);
      const pAt = isPrinted ? (printedAtMap[g.key] || null) : null;
      return {
        ...g,
        allPrinted: isPrinted,
        printedAt: pAt,
        printedBy: isPrinted ? (printedByMap[g.key] || null) : null,
        printTimeMs: pAt ? parseDateMs(pAt) : 0,
      };
    });
  }, [baseGroups, printedInvoices, printedAtMap, printedByMap]);

  // 5. Precomputed Stats & Counts (Single O(N) pass, with optional dashboard date range)
  const stats = useMemo(() => {
    let belumCount = 0;
    let sudahCount = 0;
    let doubleCount = 0;
    let returCount = 0;
    let totalNilaiRp = 0;
    let minDateMs = 0;
    let maxDateMs = 0;
    let minDateStr = "";
    let maxDateStr = "";
    const soSet = new Set<string>();
    const katCounts = { "1P": 0, "2P": 0, "3P": 0 };
    const jenisCounts = { DOO: 0, ORA: 0 };
    const prodCounts: Record<string, number> = { PREKURSOR: 0, OOT: 0, CCP: 0, ALKES: 0, FARMA: 0 };
    const custMap = new Map<string, { count: number; totalRp: number }>();

    const filterStartMs = dashboardStartDate ? parseDateMs(dashboardStartDate) : 0;
    // Set end date to end of that day (23:59:59)
    const filterEndMs = dashboardEndDate ? parseDateMs(dashboardEndDate) + (24 * 60 * 60 * 1000 - 1) : 0;

    for (let i = 0; i < grouped.length; i++) {
      const g = grouped[i];
      const d = g.transactionDate || g.orderDate;
      const dMs = d && d !== "-" ? parseDateMs(d) : 0;

      // Apply accurate millisecond-based Dashboard Date Range Filter
      if (filterStartMs > 0 && dMs < filterStartMs) continue;
      if (filterEndMs > 0 && dMs > filterEndMs) continue;

      if (g.allPrinted) sudahCount++;
      else belumCount++;
      if (g.isDoubleInv) doubleCount++;
      if (g.isRetur) returCount++;
      if (g.so && g.so !== "-") soSet.add(g.so);
      totalNilaiRp += (g.totalHarga || 0);

      if (g.kategori in katCounts) katCounts[g.kategori as "1P" | "2P" | "3P"]++;
      if (g.jenisTransaksi in jenisCounts) jenisCounts[g.jenisTransaksi as "DOO" | "ORA"]++;

      const pKat = (g.kategoriProduk || "FARMA").toUpperCase();
      if (pKat in prodCounts) prodCounts[pKat]++;
      else prodCounts.FARMA++;

      const cName = g.customerName || "Tanpa Nama";
      const existing = custMap.get(cName) || { count: 0, totalRp: 0 };
      existing.count += 1;
      existing.totalRp += (g.totalHarga || 0);
      custMap.set(cName, existing);

      if (dMs > 0) {
        if (!minDateMs || dMs < minDateMs) {
          minDateMs = dMs;
          minDateStr = d;
        }
        if (!maxDateMs || dMs > maxDateMs) {
          maxDateMs = dMs;
          maxDateStr = d;
        }
      }
    }

    const topCustomers = Array.from(custMap.entries())
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.totalRp - a.totalRp)
      .slice(0, 5);

    const totalActiveCount = belumCount + sudahCount;

    return {
      totalSO: soSet.size,
      belumCount,
      sudahCount,
      totalCount: totalActiveCount,
      doubleCount,
      returCount,
      totalNilaiRp,
      dateRangeStr: minDateStr && maxDateStr ? (minDateStr === maxDateStr ? minDateStr : `${minDateStr} s/d ${maxDateStr}`) : "Semua Data",
      katCounts,
      jenisCounts,
      prodCounts,
      topCustomers,
    };
  }, [grouped, dashboardStartDate, dashboardEndDate]);

  // 6. Filtered Faktur Groups (Instant single-string matching & 0ms numeric sorting)
  const filtered = useMemo(() => {
    let result = grouped;

    if (deferredSearch.trim()) {
      const s = deferredSearch.toLowerCase().trim();
      result = result.filter((g) => (g.searchStr ? g.searchStr.includes(s) : (
        g.so.toLowerCase().includes(s) ||
        g.invoiceNumber.toLowerCase().includes(s) ||
        g.customerName.toLowerCase().includes(s)
      )));
    }

    if (filter === "belum") {
      result = result.filter((g) => !g.allPrinted);
    } else if (filter === "sudah") {
      result = result.filter((g) => g.allPrinted);
    } else if (filter === "double") {
      result = result.filter((g) => g.isDoubleInv);
    } else if (filter === "retur") {
      result = result.filter((g) => g.isRetur);
    }

    if (dateFilter !== "all") {
      result = result.filter((g) => g.orderDate === dateFilter);
    }
    if (katFilter !== "all") {
      result = result.filter((g) => g.kategori === katFilter);
    }
    if (jenisFilter !== "all") {
      result = result.filter((g) => g.jenisTransaksi === jenisFilter);
    }
    if (klasFilter === "prekursor") result = result.filter((g) => g.hasPrekursor);
    else if (klasFilter === "oot") result = result.filter((g) => g.hasOOT);
    else if (klasFilter === "ccp") result = result.filter((g) => g.hasCCP);
    else if (klasFilter === "alkes") result = result.filter((g) => g.hasAlkes);
    else if (klasFilter === "farma") result = result.filter((g) => g.hasFarma);

    // In tab 'Semua' ('all'):
    // 1. Invoices that are NOT YET PRINTED stay on top (sorted by invoice number descending)
    // 2. Invoices that are ALREADY PRINTED flow below, sorted by Done Print timestamp descending (newest print first)
    // Pure integer subtraction = 3ms execution instead of 2,500ms regex overhead!
    if (filter === "all") {
      result = [...result].sort((a, b) => {
        if (!a.allPrinted && b.allPrinted) return -1;
        if (a.allPrinted && !b.allPrinted) return 1;

        if (!a.allPrinted && !b.allPrinted) {
          return (b.invNum || 0) - (a.invNum || 0);
        }

        const timeDiff = (b.printTimeMs || 0) - (a.printTimeMs || 0);
        if (timeDiff !== 0) {
          return timeDiff;
        }

        return (b.invNum || 0) - (a.invNum || 0);
      });
    }

    return result;
  }, [grouped, filter, katFilter, jenisFilter, klasFilter, dateFilter, deferredSearch]);

  const totalPages = Math.ceil(filtered.length / ROWS_PER_PAGE);
  const pageData = filtered.slice(page * ROWS_PER_PAGE, (page + 1) * ROWS_PER_PAGE);

  pageDataRef.current = pageData;
  totalPagesRef.current = totalPages;
  togglePrintRef.current = togglePrint;
  toggleExpandRef.current = toggleExpand;

  useEffect(() => {
    if (pageData.length > 0 && selectedRowIndex >= pageData.length) {
      setSelectedRowIndex(pageData.length - 1);
    }
  }, [pageData.length, selectedRowIndex]);

  const unprintedCountInFiltered = useMemo(() => {
    if (filter === "belum") return filtered.length;
    if (filter === "sudah") return 0;
    let count = 0;
    for (let i = 0; i < filtered.length; i++) {
      if (!filtered[i].allPrinted) count++;
    }
    return count;
  }, [filtered, filter]);

  // Batch Done Print: Mark All Visible As Printed
  const handleMarkAllPrinted = useCallback(async () => {
    if (currentUserRef.current?.role === "readonly") {
      showToast("⚠️ Akses Stranger: Anda hanya memiliki izin melihat data (Read Only).");
      return;
    }
    const unprinted = filtered.filter((g) => !g.allPrinted);
    if (unprinted.length === 0) {
      alert("Semua faktur yang sedang tampil sudah selesai dicetak.");
      return;
    }

    if (!confirm(`Tandai ${unprinted.length} faktur yang tampil sebagai SUDAH TERPRINT?`)) return;

    const nowIso = new Date().toISOString();
    const currentUserName = currentUserRef.current?.name || "Admin";
    const targetKeys = unprinted.map((g) => g.invoiceKey);

    setPrintedInvoices((prev) => {
      const next = new Set(prev);
      targetKeys.forEach((k) => next.add(k));
      printedInvoicesRef.current = next;
      return next;
    });

    setPrintedAtMap((prev) => {
      const next = { ...prev };
      targetKeys.forEach((k) => {
        next[k] = nowIso;
      });
      printedAtMapRef.current = next;
      return next;
    });

    setPrintedByMap((prev) => {
      const next = { ...prev };
      targetKeys.forEach((k) => {
        next[k] = currentUserName;
      });
      printedByMapRef.current = next;
      return next;
    });

    const targetSet = new Set(targetKeys);
    if (currentFakturDocsRef.current) {
      currentFakturDocsRef.current.forEach((d) => {
        const k = d.id || d.no_faktur;
        if (k && targetSet.has(k)) {
          d.status_cetak = true;
          d.printed_at = nowIso;
          d.printed_by = currentUserName;
        }
      });
    }

    // INSTANT OPTIMISTIC TOAST (< 1ms feedback)
    showToast(`✓ Menandai ${targetKeys.length} faktur selesai dicetak oleh ${currentUserName}...`);

    try {
      setLoading(true);
      await updateFaktursPrintStatusBatch(targetKeys, true, nowIso, currentUserName);
      showToast(`✓ Berhasil menandai ${targetKeys.length} faktur selesai dicetak oleh ${currentUserName}!`);
    } catch (err) {
      console.error("Batch print error:", err);
      alert("Terjadi kesalahan saat menyimpan ke database.");
    } finally {
      setLoading(false);
    }
  }, [filtered, showToast]);

  // Global Keyboard Navigation & Shortcut Controller (Lag-Free & Crash-Proof)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput = target && (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.tagName === "BUTTON" ||
        (target as HTMLElement).isContentEditable
      );

      if (e.key === "Escape") {
        if (isInput) (target as HTMLElement).blur();
        if (showApotekModalRef.current) setShowApotekModal(false);
        if (showProductModalRef.current) setShowProductModal(false);
        if (showChangelogModalRef.current) setShowChangelogModal(false);
        if (showExportModalRef.current) setShowExportModal(false);
        return;
      }

      if (isInput) return;
      if (showApotekModalRef.current || showProductModalRef.current || showChangelogModalRef.current || showExportModalRef.current) return;

      const currentPages = pageDataRef.current;
      const maxRow = Math.max(0, currentPages.length - 1);
      const curIdx = Math.min(selectedRowIndexRef.current, maxRow);
      const currentRow = currentPages[curIdx];

      // Quick Search Focus: '/' or 'f'
      if (e.key === "/" || e.key === "f" || e.key === "F") {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      // Space: Toggle Print on active row (with 150ms debounce and repeat lock)
      if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        if (e.repeat) return; // Prevent repeated toggle storm when holding space
        const now = Date.now();
        if (now - lastSpaceTimeRef.current < 150) return; // 150ms debounce
        lastSpaceTimeRef.current = now;

        if (currentRow) {
          togglePrintRef.current(currentRow);
        }
        return;
      }

      // Enter: Toggle Expand Detail on active row
      if (e.key === "Enter") {
        e.preventDefault();
        if (e.repeat) return;
        if (currentRow) {
          toggleExpandRef.current(currentRow.key);
        }
        return;
      }

      // Arrow Navigation (Smooth scroll into view)
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        setSelectedRowIndex((prev) => {
          const next = Math.min(maxRow, prev + 1);
          requestAnimationFrame(() => {
            const el = document.getElementById(`faktur-row-${next}`);
            el?.scrollIntoView({ block: "nearest", behavior: "auto" });
          });
          return next;
        });
        return;
      }
      if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        setSelectedRowIndex((prev) => {
          const next = Math.max(0, prev - 1);
          requestAnimationFrame(() => {
            const el = document.getElementById(`faktur-row-${next}`);
            el?.scrollIntoView({ block: "nearest", behavior: "auto" });
          });
          return next;
        });
        return;
      }
      if (e.key === "ArrowRight" || e.key === "l") {
        e.preventDefault();
        setSelectedColIdx((prev) => Math.min(11, prev + 1));
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "h") {
        e.preventDefault();
        setSelectedColIdx((prev) => Math.max(0, prev - 1));
        return;
      }

      // Page Navigation
      if (e.key === "PageDown") {
        e.preventDefault();
        if (e.repeat) return;
        setPage((p) => Math.min(totalPagesRef.current - 1, p + 1));
        setSelectedRowIndex(0);
        return;
      }
      if (e.key === "PageUp") {
        e.preventDefault();
        if (e.repeat) return;
        setPage((p) => Math.max(0, p - 1));
        setSelectedRowIndex(0);
        return;
      }

      // Copy on 'c' OR 'Ctrl+C' / 'Cmd+C'
      if (e.key === "c" || e.key === "C") {
        if (e.repeat) return;
        // If user highlighted text with mouse, let default browser copy work for Ctrl+C
        const textSelected = typeof window !== "undefined" && window.getSelection()?.toString();
        if (textSelected && (e.ctrlKey || e.metaKey)) {
          return;
        }

        if (currentRow) {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
          }

          const colIdx = selectedColIdxRef.current;
          let textToCopy = currentRow.invoiceNumber;
          let label = "No Invoice";

          if (colIdx === 2) {
            textToCopy = currentRow.so;
            label = "No SO";
          } else if (colIdx === 3) {
            textToCopy = currentRow.invoiceNumber;
            label = "No Invoice";
          } else if (colIdx === 6) {
            textToCopy = currentRow.customerName;
            label = "Pelanggan";
          } else if (colIdx === 7) {
            textToCopy = currentRow.transactionDate && currentRow.transactionDate !== "-" ? currentRow.transactionDate : currentRow.orderDate;
            label = "Tgl Faktur";
          } else if (colIdx === 8) {
            textToCopy = currentRow.orderDate && currentRow.orderDate !== "-" ? currentRow.orderDate : "-";
            label = "Tgl Order";
          } else if (colIdx === 11) {
            const grandTotal = Math.round(currentRow.totalHarga * 1.11 * 100) / 100;
            textToCopy = String(grandTotal);
            label = "Total (+PPN)";
          } else {
            textToCopy = currentRow.invoiceNumber;
            label = "No Invoice";
          }

          if (textToCopy && textToCopy !== "-") {
            navigator.clipboard.writeText(textToCopy).then(() => {
              showToast(`📋 ${label} disalin: ${textToCopy}`);
            }).catch(() => {
              const ta = document.createElement("textarea");
              ta.value = textToCopy;
              document.body.appendChild(ta);
              ta.select();
              document.execCommand("copy");
              document.body.removeChild(ta);
              showToast(`📋 ${label} disalin: ${textToCopy}`);
            });
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // File Upload Handler
  const handleUpload = useCallback(
    async (filesInput: File[] | FileList | File) => {
      const files: File[] = Array.isArray(filesInput)
        ? filesInput
        : typeof FileList !== "undefined" && filesInput instanceof FileList
        ? Array.from(filesInput)
        : [filesInput as File];

      if (files.length === 0) return;

      if (currentUserRef.current?.role === "readonly") {
        showToast("⚠️ Akses Stranger: Anda tidak dapat mengunggah file (Read Only).");
        return;
      }

      if (isUploadingRef.current) {
        showToast("⚠️ Sedang memproses dan menyimpan file sebelumnya. Mohon tunggu beberapa detik...");
        return;
      }
      isUploadingRef.current = true;
      setLoading(true);
      setError(null);

      try {
        const parsed: FakturRecord[] = [];
        const fileNames: string[] = [];

        for (const file of files) {
          fileNames.push(file.name);
          const p = await parseExcelFile(file, productOverridesRef.current);
          parsed.push(...p);
        }

        if (parsed.length === 0) {
          setError("File berhasil dibaca tetapi tidak memiliki baris data transaksi.");
          isUploadingRef.current = false;
          setLoading(false);
          return;
        }

        const importedAt = new Date().toISOString();

        // 1. Authoritative complete live printed keys from remote Firestore partitions, module caches, and refs
        const serverLive = await fetchAllLivePrintKeys();
        const livePrint = getLivePrintState();
        const livePrintedKeys = new Set<string>([
          ...Array.from(serverLive.printedKeys),
          ...livePrint.printedKeys,
          ...Array.from(printedInvoicesRef.current),
        ]);
        const livePrintedAtMap: Record<string, string> = {
          ...serverLive.printedAtMap,
          ...livePrint.printedAtMap,
          ...printedAtMapRef.current,
        };
        let loadedProgression: InvoiceProgression | null = invoiceProgressionRef.current;
        let existingDBDocs: FirestoreFakturDoc[] = currentFakturDocsRef.current || [];

        // If existing docs are empty, fetch remote DB to guarantee zero data loss
        if (existingDBDocs.length === 0) {
          try {
            const res = await getExistingFakturs();
            existingDBDocs = res.docs;
            if (!loadedProgression) loadedProgression = res.progression;
            if (res.printState) {
              (res.printState.printedKeys || []).forEach((k) => livePrintedKeys.add(k));
              Object.assign(livePrintedAtMap, res.printState.printedAtMap || {});
            }
          } catch (err) {
            console.warn("Could not fetch remote DB:", err);
          }
        }

        // Unify with current in-memory documents to guarantee zero data loss between fast consecutive uploads
        const combinedExistingMap = new Map<string, FirestoreFakturDoc>();
        currentFakturDocsRef.current.forEach((d) => {
          const k = d.id || d.no_faktur;
          if (k) combinedExistingMap.set(k, d);
        });
        existingDBDocs.forEach((d) => {
          const k = d.id || d.no_faktur;
          if (k) combinedExistingMap.set(k, d);
        });
        const existingDBDocsUnified = Array.from(combinedExistingMap.values());

        const existingDB = existingDBDocsUnified as unknown as Array<Record<string, unknown>>;

        const existingStatusMap = new Map<
          string,
          { status_cetak: boolean; printed_at: string | null; no_sales_order: string; extra: Record<string, unknown> }
        >();

        let prevOraNum = -1;
        let prevOraStr = "-";
        let prevDooNum = -1;
        let prevDooStr = "-";
        let prev1PDooNum = -1;
        let prev1PDooStr = "-";
        let prev2PNum = -1;
        let prev2PStr = "-";
        let prev3PNum = -1;
        let prev3PStr = "-";

        existingDB.forEach((row) => {
          const rawInv = String(row.no_faktur || "");
          const cleanInv = rawInv.replace(/-1P$/i, "");
          const extra = (row.extra as Record<string, unknown>) || {};
          const cust = String(extra.nama_pelanggan || row.customer_name || "");
          const isOra = row.jenis_transaksi === "ORA" || isOraCustomer(cust);
          const targetKey = isOra ? `${cleanInv}-1P` : cleanInv;
          const num = parseInvNum(cleanInv);
          const kat = isOra ? "1P" : categorize("DOO", cust);

          if (num > 0) {
            if (isOra) {
              if (num > prevOraNum) {
                prevOraNum = num;
                prevOraStr = cleanInv;
              }
            } else {
              if (num > prevDooNum) {
                prevDooNum = num;
                prevDooStr = cleanInv;
              }
              if (kat === "1P" && num > prev1PDooNum) {
                prev1PDooNum = num;
                prev1PDooStr = cleanInv;
              } else if (kat === "2P" && num > prev2PNum) {
                prev2PNum = num;
                prev2PStr = cleanInv;
              } else if (kat === "3P" && num > prev3PNum) {
                prev3PNum = num;
                prev3PStr = cleanInv;
              }
            }
          }

          const pCandidate = (row.printed_at as string) || livePrintedAtMap[targetKey];
          const isStale = isStalePrintTimestamp(pCandidate, (row.order_date as string) || (extra.order_date as string));
          const isDocPrinted = !isStale && Boolean(
            row.status_cetak ||
            livePrintedKeys.has(targetKey)
          );
          if (isDocPrinted) {
            livePrintedKeys.add(targetKey);
            const pTime = pCandidate || new Date().toISOString();
            livePrintedAtMap[targetKey] = pTime;
          }
          const docPrintedAt = isDocPrinted
            ? (livePrintedAtMap[targetKey] || (row.printed_at as string) || null)
            : null;

          const statusInfo = {
            status_cetak: isDocPrinted,
            printed_at: docPrintedAt,
            no_sales_order: String(row.no_sales_order || "-"),
            extra,
          };

          existingStatusMap.set(targetKey, statusInfo);
        });

        // 2. Pre-populate invMap with existing records
        const invMap = new Map<string, FirestoreFakturDoc>();
        existingDBDocsUnified.forEach((doc) => {
          const k = doc.id || doc.no_faktur;
          const pCandidate = doc.printed_at || livePrintedAtMap[k];
          const isStale = isStalePrintTimestamp(pCandidate, doc.order_date || (doc.extra && (doc.extra.order_date as string)));
          const isDocPrinted = !isStale && Boolean(
            doc.status_cetak ||
            livePrintedKeys.has(k)
          );
          if (isDocPrinted) {
            livePrintedKeys.add(k);
          }
          const docPAt = isDocPrinted
            ? (livePrintedAtMap[k] || doc.printed_at || null)
            : null;

          invMap.set(k, {
            ...doc,
            status_cetak: isDocPrinted,
            printed_at: docPAt,
          });
        });

        const mergedPrintedSet = livePrintedKeys;
        const mergedPrintedAtMap = livePrintedAtMap;

        const newUnprintedKeysSet = new Set<string>();
        const brandNewUnprintedKeysSet = new Set<string>();
        // Preserve all existing unprinted invoices from database ONLY if not printed!
        invMap.forEach((doc, k) => {
          const isPrinted = Boolean(
            doc.status_cetak ||
            mergedPrintedSet.has(k)
          );
          if (!isPrinted) {
            newUnprintedKeysSet.add(k);
          }
        });

        // 3. Merge incoming records
        for (const r of parsed) {
          const isOra = r.jenisTransaksi === "ORA" || isOraCustomer(r.customerName);
          const cleanInv = String(r.invoiceNumber || "").trim().replace(/-1P$/i, "");
          const num = parseInvNum(cleanInv);
          if (!cleanInv || cleanInv === "-" || cleanInv === "0") continue;

          const targetKey = isOra ? `${cleanInv}-1P` : cleanInv;
          const prevInfo = existingStatusMap.get(targetKey);
          const existingEntry = invMap.get(targetKey);

          // Determine if this invoice already exists in the database
          const isExistingInDB = existingEntry !== undefined || prevInfo !== undefined;

          let isPrinted = false;
          let printedAt: string | null = null;

          const candidatePAt = (existingEntry && existingEntry.printed_at) ||
            mergedPrintedAtMap[targetKey] ||
            (prevInfo && prevInfo.printed_at);
          const isStale = isStalePrintTimestamp(candidatePAt, r.orderDate);

          if (isExistingInDB && !isStale) {
            // Already in database: check if it was marked printed
            const wasPrinted = Boolean(
              (existingEntry && existingEntry.status_cetak) ||
              mergedPrintedSet.has(targetKey) ||
              (prevInfo && prevInfo.status_cetak)
            );

            if (wasPrinted) {
              // Permanently preserve printed status (Anti-Reappearance Guaranteed)
              isPrinted = true;
              printedAt = candidatePAt || new Date().toISOString();
              mergedPrintedSet.add(targetKey);
              mergedPrintedAtMap[targetKey] = printedAt;
              newUnprintedKeysSet.delete(targetKey);
            } else {
              // Already in database but unprinted: keep unprinted
              isPrinted = false;
              printedAt = null;
              newUnprintedKeysSet.add(targetKey);
            }
          } else {
            // BRAND NEW INVOICE NOT YET IN DATABASE (OR STALE COLLISION FROM PAST CYCLE):
            // WAJIB masuk ke "Belum Terprint" (Unprinted Guarantee)
            isPrinted = false;
            printedAt = null;
            newUnprintedKeysSet.add(targetKey);
            brandNewUnprintedKeysSet.add(targetKey);
            // Ensure clean state: purge any accidental partition key for this brand new invoice
            mergedPrintedSet.delete(targetKey);
          }

          const rawCust = String(r.customerName || "-").trim();
          const normCust = rawCust ? normalize(rawCust) : "";
          const overriddenKat =
            categoryOverridesRef.current[normCust] ||
            categoryOverridesRef.current[rawCust] ||
            categoryOverridesRef.current[cleanInv] ||
            (prevInfo && (prevInfo.extra?.kategori as ("1P" | "2P" | "3P") | undefined));

          if (!invMap.has(targetKey)) {
            const kategori = isOra
              ? "1P"
              : (overriddenKat || r.kategori || categorize("DOO", r.customerName));
            invMap.set(targetKey, {
              id: targetKey,
              no_faktur: targetKey,
              no_sales_order: r.orderNumber || "-",
              customer_name: r.customerName || "-",
              order_date: r.orderDate || "-",
              transaction_date: r.transactionDate || r.orderDate || "-",
              jenis_transaksi: isOra ? "ORA" : "DOO",
              kategori,
              status_cetak: isPrinted,
              printed_at: printedAt,
              imported_at: importedAt,
              source_file: isOra ? "ORA" : "DOO",
              extra: {
                nama_pelanggan: r.customerName,
                order_date: r.orderDate,
                transaction_date: r.transactionDate || r.orderDate,
                accounting_date: r.orderDate,
                jenis_transaksi: isOra ? "ORA" : "DOO",
                kategori,
                total_harga: r.totalHarga || 0,
                items: [],
              },
            });
          }

          const entry = invMap.get(targetKey)!;
          entry.status_cetak = entry.status_cetak || isPrinted;
          entry.printed_at = entry.printed_at || printedAt;

          if (r.transactionDate && (r.sourceFile === "XXCUST" || !entry.transaction_date || entry.transaction_date === "-")) {
            entry.transaction_date = r.transactionDate;
            if (entry.extra) entry.extra.transaction_date = r.transactionDate;
          }
          if (r.sourceFile === "XXCUST" && r.orderDate && r.orderDate !== "-") {
            entry.order_date = r.orderDate;
            if (entry.extra) entry.extra.order_date = r.orderDate;
          }

          if (overriddenKat && !isOra) {
            entry.kategori = overriddenKat;
            if (entry.extra) entry.extra.kategori = overriddenKat;
          }

          if (isOra && r.orderNumber && r.orderNumber !== "-") {
            entry.no_sales_order = r.orderNumber;
          } else if (!isOra && (entry.no_sales_order === "-" || !entry.no_sales_order) && r.orderNumber) {
            entry.no_sales_order = r.orderNumber;
          }

          const currentCust = String(entry.customer_name || "").trim();
          const incomingCust = String(r.customerName || "").trim();
          const upperCurrent = currentCust.toUpperCase();
          const upperIncoming = incomingCust.toUpperCase();
          if (
            (upperCurrent.includes("HELIOS") || currentCust === "1001" || currentCust === "-" || !currentCust) &&
            incomingCust && !upperIncoming.includes("HELIOS") && incomingCust !== "1001"
          ) {
            entry.customer_name = incomingCust;
            if (!entry.extra) entry.extra = {};
            entry.extra.nama_pelanggan = incomingCust;
          } else if (
            (!entry.customer_name || entry.customer_name === "-" || entry.customer_name === "1001") &&
            incomingCust
          ) {
            entry.customer_name = incomingCust;
            if (!entry.extra) entry.extra = {};
            entry.extra.nama_pelanggan = incomingCust;
          }

          if (r.itemCode && r.itemCode !== "-") {
            if (!Array.isArray(entry.extra.items)) entry.extra.items = [];
            const katProd = getProductCategory(r.itemCode, r.itemDescription, productOverridesRef.current) || r.kategoriProduk || "FARMA";
            const isDup = entry.extra.items.some(
              (it) => it.item_code === r.itemCode && it.lot_number === r.lotNumber && it.qty === r.qty
            );
            if (!isDup) {
              entry.extra.items.push({
                item_code: r.itemCode,
                item_description: r.itemDescription,
                kategori_produk: katProd,
                qty: r.qty,
                uom: r.uom,
                lot_number: r.lotNumber,
                total_harga: r.totalHarga,
                order_number: r.orderNumber,
              });
            }
          }
        }

        // Calculate DOMINANT Category for each invoice document
        for (const entry of invMap.values()) {
          if (entry.extra && Array.isArray(entry.extra.items) && entry.extra.items.length > 0) {
            const katCounts: Record<string, number> = {};
            for (const it of entry.extra.items) {
              const k = (it.kategori_produk || "FARMA").toUpperCase();
              katCounts[k] = (katCounts[k] || 0) + 1;
            }
            let dominantKat = "FARMA";
            let maxCount = -1;
            const priorityOrder = ["CCP", "PREKURSOR", "OOT", "FARMA", "ALKES"];
            for (const [k, count] of Object.entries(katCounts)) {
              if (count > maxCount) {
                maxCount = count;
                dominantKat = k;
              } else if (count === maxCount) {
                const currIdx = priorityOrder.indexOf(dominantKat);
                const newIdx = priorityOrder.indexOf(k);
                if (newIdx !== -1 && (currIdx === -1 || newIdx < currIdx)) {
                  dominantKat = k;
                }
              }
            }
            entry.extra.kategori_produk = dominantKat;
          }
        }

        const newUnprintedKeys = Array.from(newUnprintedKeysSet);
        const payload = Array.from(invMap.values());

        // 4. Calculate Progression Ranges
        let minOra = Infinity; let maxOra = -1; let maxOraStr = "-"; let minOraStr = "-";
        let minDoo = Infinity; let maxDoo = -1; let maxDooStr = "-"; let minDooStr = "-";
        let min1PDoo = Infinity; let max1PDoo = -1; let max1PDooStr = "-"; let min1PDooStr = "-";
        let min2P = Infinity; let max2P = -1; let max2PStr = "-"; let min2PStr = "-";
        let min3P = Infinity; let max3P = -1; let max3PStr = "-"; let min3PStr = "-";

        for (const r of parsed) {
          const isOra = r.jenisTransaksi === "ORA" || isOraCustomer(r.customerName);
          const cleanInv = String(r.invoiceNumber || "").trim().replace(/-1P$/i, "");
          const num = parseInvNum(cleanInv);
          const kat = isOra ? "1P" : (r.kategori || categorize("DOO", r.customerName));

          if (num > 0) {
            if (isOra) {
              if (num > maxOra) { maxOra = num; maxOraStr = cleanInv; }
              if (num < minOra) { minOra = num; minOraStr = cleanInv; }
            } else {
              if (num > maxDoo) { maxDoo = num; maxDooStr = cleanInv; }
              if (num < minDoo) { minDoo = num; minDooStr = cleanInv; }

              if (kat === "1P") {
                if (num > max1PDoo) { max1PDoo = num; max1PDooStr = cleanInv; }
                if (num < min1PDoo) { min1PDoo = num; min1PDooStr = cleanInv; }
              } else if (kat === "2P") {
                if (num > max2P) { max2P = num; max2PStr = cleanInv; }
                if (num < min2P) { min2P = num; min2PStr = cleanInv; }
              } else if (kat === "3P") {
                if (num > max3P) { max3P = num; max3PStr = cleanInv; }
                if (num < min3P) { min3P = num; min3PStr = cleanInv; }
              }
            }
          }
        }

        const existingProg: InvoiceProgression = loadedProgression || {};
        let rangeOra = existingProg.rangeOra || null;
        let prevOra = existingProg.prevOra || null;
        let newOra = existingProg.newOra || null;
        if (maxOra > 0) {
          newOra = maxOraStr;
          if (prevOraNum > 0 && maxOra > prevOraNum) {
            prevOra = prevOraStr;
            rangeOra = `${prevOraNum + 1} ➔ ${maxOraStr}`;
          } else {
            prevOra = prevOraStr !== "-" ? prevOraStr : maxOraStr;
            rangeOra = minOraStr !== maxOraStr ? `${minOraStr} ➔ ${maxOraStr}` : maxOraStr;
          }
        }

        let rangeDoo = existingProg.rangeDoo || null;
        let prevDoo = existingProg.prevDoo || null;
        let newDoo = existingProg.newDoo || null;
        if (maxDoo > 0) {
          newDoo = maxDooStr;
          if (prevDooNum > 0 && maxDoo > prevDooNum) {
            prevDoo = prevDooStr;
            rangeDoo = `${prevDooNum + 1} ➔ ${maxDooStr}`;
          } else {
            prevDoo = prevDooStr !== "-" ? prevDooStr : maxDooStr;
            rangeDoo = minDooStr !== maxDooStr ? `${minDooStr} ➔ ${maxDooStr}` : maxDooStr;
          }
        }

        let range1PDoo = existingProg.range1PDoo || null;
        let prev1PDoo = existingProg.prev1PDoo || null;
        let new1PDoo = existingProg.new1PDoo || null;
        if (max1PDoo > 0) {
          new1PDoo = max1PDooStr;
          if (prev1PDooNum > 0 && max1PDoo > prev1PDooNum) {
            prev1PDoo = prev1PDooStr;
            range1PDoo = `${prev1PDooNum + 1} ➔ ${max1PDooStr}`;
          } else {
            prev1PDoo = prev1PDooStr !== "-" ? prev1PDooStr : max1PDooStr;
            range1PDoo = min1PDooStr !== max1PDooStr ? `${min1PDooStr} ➔ ${max1PDooStr}` : max1PDooStr;
          }
        }

        let range2P = existingProg.range2P || null;
        let prev2P = existingProg.prev2P || null;
        let new2P = existingProg.new2P || null;
        if (max2P > 0) {
          new2P = max2PStr;
          if (prev2PNum > 0 && max2P > prev2PNum) {
            prev2P = prev2PStr;
            range2P = `${prev2PNum + 1} ➔ ${max2PStr}`;
          } else {
            prev2P = prev2PStr !== "-" ? prev2PStr : max2PStr;
            range2P = min2PStr !== max2PStr ? `${min2PStr} ➔ ${max2PStr}` : max2PStr;
          }
        }

        let range3P = existingProg.range3P || null;
        let prev3P = existingProg.prev3P || null;
        let new3P = existingProg.new3P || null;
        if (max3P > 0) {
          new3P = max3PStr;
          if (prev3PNum > 0 && max3P > prev3PNum) {
            prev3P = prev3PStr;
            range3P = `${prev3PNum + 1} ➔ ${max3PStr}`;
          } else {
            prev3P = prev3PStr !== "-" ? prev3PStr : max3PStr;
            range3P = min3PStr !== max3PStr ? `${min3PStr} ➔ ${max3PStr}` : max3PStr;
          }
        }

        const progObj: InvoiceProgression = {
          ...existingProg,
          prev1PDoo,
          new1PDoo,
          range1PDoo,
          prev2P,
          new2P,
          range2P,
          prev3P,
          new3P,
          range3P,
          prevDoo,
          newDoo,
          rangeDoo,
          prevOra,
          newOra,
          rangeOra,
          updatedAt: new Date().toLocaleTimeString("id-ID"),
        };

        // 5. Update Local State Instantly (< 1 second response)
        const { records: localRecs } = dbRowsToFakturRecords(
          payload as unknown as Array<Record<string, unknown>>
        );

        const finalPrintedSet = new Set<string>(mergedPrintedSet);
        const finalPrintedAtMap = { ...mergedPrintedAtMap };

        printedInvoicesRef.current = finalPrintedSet;
        printedAtMapRef.current = finalPrintedAtMap;

        currentFakturDocsRef.current = payload;
        setRecords(localRecs);
        setPrintedInvoices(finalPrintedSet);
        setPrintedAtMap(finalPrintedAtMap);
        const notifPayload: UploadNotification = {
          fileName: fileNames.join(", "),
          prevOra,
          maxOra: maxOraStr,
          rangeOra,
          prevDoo,
          maxDoo: maxDooStr,
          rangeDoo,
          totalItems: parsed.length,
          totalInvoices: invMap.size,
          newUnprinted: brandNewUnprintedKeysSet.size,
          time: new Date().toLocaleTimeString("id-ID"),
          uploaderId: deviceIdRef.current,
        };

        setInvoiceProgression(progObj);
        invoiceProgressionRef.current = progObj;
        setUploadNotification(notifPayload);
        setPage(0);
        setLoading(false);

        // 6. Save to Firestore and AWAIT completion so consecutive uploads cannot collide or overwrite with stale data
        await saveFaktursBatch(
          payload,
          progObj,
          {
            printedKeys: Array.from(finalPrintedSet),
            printedAtMap: finalPrintedAtMap,
            updatedAt: new Date().toISOString(),
          },
          newUnprintedKeys,
          notifPayload
        );

        setTimeout(() => {
          isUploadingRef.current = false;
        }, 500);
        showToast(`✓ Berhasil mengupload ${parsed.length} baris data!`);
      } catch (err) {
        console.error("Upload error:", err);
        setError(err instanceof Error ? err.message : "Gagal memproses file upload.");
        isUploadingRef.current = false;
        setLoading(false);
      }
    },
    []
  );


  // Export to Excel Dialog (Date range & filters)
  const handleExportExcel = () => {
    if (grouped.length === 0) {
      showToast("⚠️ Tidak ada data faktur untuk diekspor.");
      return;
    }
    setShowExportModal(true);
  };

  return (
    <div className={`min-h-screen flex flex-col font-sans relative overflow-hidden ${
      isDarkMode
        ? "dark mesh-bg-dark text-slate-100 selection:bg-blue-500/30"
        : "mesh-bg-light text-slate-800 selection:bg-blue-500/20"
    }`}>
      {/* Toast Notification */}
      {toastMsg && (
        <div className={`fixed top-5 right-5 z-50 px-4 py-3 rounded-xl shadow-2xl flex items-center gap-3 border animate-in fade-in slide-in-from-top-2 duration-200 ${
          isDarkMode ? "bg-[#16223d] text-white border-slate-700 shadow-black/50" : "bg-slate-900 text-white border-slate-700"
        }`}>
          <span className="text-emerald-400 font-bold">✓</span>
          <span className="text-sm font-medium">{toastMsg}</span>
        </div>
      )}

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-2 sm:p-3 space-y-2 relative z-10">
        {/* Top Header Card - Floating Frosted Glass Bar */}
        <div className="glass-panel rounded-xl px-3 py-1.5 sm:py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {/* Left: Brand & Live Online Users Widget */}
            <div className="flex items-center gap-2 sm:gap-2.5">
              <div className="flex items-center gap-1 bg-slate-200/70 dark:bg-slate-800/80 p-0.5 rounded-lg border border-slate-300 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => setMainView("workspace")}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-bold transition-all cursor-pointer ${
                    mainView === "workspace"
                      ? (isDarkMode ? "bg-white text-black shadow-sm" : "bg-black text-white shadow-sm")
                      : (isDarkMode ? "text-slate-300 hover:text-white" : "text-slate-700 hover:text-black")
                  }`}
                >
                  <span>📋</span>
                  <span>Faktur</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMainView("dashboard")}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-bold transition-all cursor-pointer ${
                    mainView === "dashboard"
                      ? (isDarkMode ? "bg-white text-black shadow-sm" : "bg-black text-white shadow-sm")
                      : (isDarkMode ? "text-slate-300 hover:text-white" : "text-slate-700 hover:text-black")
                  }`}
                >
                  <span>📊</span>
                  <span>Dashboard</span>
                </button>
              </div>

              {/* Settings Drawer Toggle Button */}
              <button
                type="button"
                onClick={() => setShowSettingsPanel(true)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border transition-all cursor-pointer shadow-2xs ${
                  isDarkMode
                    ? "bg-slate-800/80 hover:bg-slate-700 text-slate-200 border-slate-700"
                    : "bg-white hover:bg-slate-100 text-slate-800 border-slate-300"
                }`}
                title="Buka Pengaturan"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                </svg>
                <span className="hidden sm:inline">Menu</span>
              </button>

              <div className="flex items-center gap-2">
                <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-slate-950 p-0.5 flex items-center justify-center shadow-md border border-slate-800/80 shrink-0">
                  <img
                    src="/logo-3d.png"
                    alt="FT 3D Glass Logo"
                    className="w-full h-full object-contain drop-shadow-md select-none"
                  />
                </div>
                <div>
                  <div className="flex items-center gap-1.5 leading-tight">
                    <span className={`font-black text-xs sm:text-sm tracking-wider ${
                      isDarkMode ? "text-white" : "text-slate-900"
                    }`}>
                      FAKTUR TRACKER
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowChangelogModal(true)}
                      className={`text-[9px] px-1.5 py-0.2 rounded-full font-semibold border transition-all cursor-pointer inline-flex items-center gap-1 ${
                        isDarkMode
                          ? "bg-blue-950/60 hover:bg-blue-900/80 text-blue-300 border-blue-500/30 shadow-xs"
                          : "bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200 shadow-xs"
                      }`}
                      title="Klik untuk melihat catatan pembaruan & perbaikan v2.2"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span>
                      v2.2
                    </button>
                  </div>
                  <span className={`text-[9px] hidden md:inline leading-none font-medium ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>
                    Oracle ERP Live Tracker
                  </span>
                </div>
              </div>

              {/* Live Online Users Presence Button & Dropdown */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowOnlinePopover((prev) => !prev)}
                  className={`px-2 py-0.5 rounded-full text-[11px] font-semibold flex items-center gap-1.5 border transition-all shadow-xs ${
                    isDarkMode
                      ? "bg-slate-800/80 hover:bg-slate-800 border-slate-700 text-slate-300"
                      : "bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-700"
                  }`}
                  title="Klik untuk melihat siapa saja yang sedang ON & melihat sistem ini"
                >
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-slate-500 dark:bg-slate-300"></span>
                  </span>
                  <span>Online ({onlineUsers.filter(u => u && u.name).length}):</span>
                  <span className="font-bold max-w-[100px] sm:max-w-[160px] truncate text-left">
                    {onlineUsers.filter(u => u && u.name).length > 0
                      ? onlineUsers
                          .filter(u => u && u.name)
                          .map((u) => (u.name === currentUser?.name ? `${u.name} (Anda)` : u.name))
                          .join(", ")
                      : currentUser?.name || "Menghubungkan..."}
                  </span>
                  <span className="text-[8px] opacity-70">▼</span>
                </button>

                {/* Popover Card */}
                {showOnlinePopover && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setShowOnlinePopover(false)}
                    />
                    <div className={`absolute left-0 mt-1.5 w-72 sm:w-80 rounded-2xl shadow-2xl border p-3.5 z-50 ${
                      isDarkMode ? "bg-[#10192E] border-slate-700 text-slate-100 shadow-black/60" : "bg-white border-slate-200 text-slate-800 shadow-slate-300/50"
                    }`}>
                      <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-200 dark:border-slate-700/60">
                        <div className="flex items-center gap-1.5 font-bold text-xs">
                          <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                          </span>
                          <span>Pengguna Sedang ON ({onlineUsers.filter(u => u && u.name).length})</span>
                        </div>
                        <button
                          onClick={() => setShowOnlinePopover(false)}
                          className="text-xs px-1.5 py-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                        >
                          ✕
                        </button>
                      </div>

                      <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                        {onlineUsers.filter(u => u && u.name).length === 0 ? (
                          <div className="text-xs text-slate-500 py-2 text-center">
                            Memeriksa pengguna online...
                          </div>
                        ) : (
                          onlineUsers
                            .filter(u => u && u.name)
                            .map((u) => {
                              const isMe = u.name === currentUser?.name;
                            return (
                              <div
                                key={u.deviceId || u.name}
                                className={`flex items-center justify-between p-2 rounded-xl text-xs ${
                                  isMe
                                    ? isDarkMode
                                      ? "bg-blue-950/50 border border-blue-800/60"
                                      : "bg-blue-50 border border-blue-200"
                                    : isDarkMode
                                    ? "bg-slate-800/40 hover:bg-slate-800/70"
                                    : "bg-slate-50 hover:bg-slate-100"
                                }`}
                              >
                                <div className="flex items-center gap-2">
                                  <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-xs shadow-emerald-500/50"></span>
                                  <div>
                                    <div className="font-bold flex items-center gap-1">
                                      <span>{u.name}</span>
                                      {isMe && (
                                        <span className="text-[10px] text-blue-500 font-semibold">(Anda)</span>
                                      )}
                                    </div>
                                    <span className="text-[10px] opacity-70">
                                      {u.role === "readonly" ? "Hanya Lihat (Stranger)" : "Pencetak Aktif"}
                                    </span>
                                  </div>
                                </div>
                                <span className="text-[10px] px-1.5 py-0.5 rounded font-mono bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold border border-emerald-500/20">
                                  Online
                                </span>
                              </div>
                            );
                          })
                        )}
                      </div>

                      <div className="mt-2.5 pt-2 border-t border-slate-200 dark:border-slate-700/60 text-[11px] text-slate-500 dark:text-slate-400 flex items-center justify-between">
                        <span>Realtime terdeteksi otomatis</span>
                        <button
                          onClick={() => {
                            if (currentUser) updateUserPresence(currentUser, deviceIdRef.current);
                            showToast("✓ Status kehadiran diperbarui");
                          }}
                          className="text-blue-500 hover:underline font-semibold"
                        >
                          Ping Status
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Right: Compact Actions Toolbar */}
            <div className="flex items-center gap-1.5 ml-auto">

              {/* Upload Button */}
              <label
                onDragOver={(e) => {
                  if (currentUser?.role === "readonly") return;
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  if (currentUser?.role === "readonly") {
                    showToast("⚠️ Akses Stranger: Anda hanya dapat melihat data (Read Only).");
                    return;
                  }
                  const files = Array.from(e.dataTransfer.files || []);
                  if (files.length > 0) handleUpload(files);
                }}
                onClick={(e) => {
                  if (currentUser?.role === "readonly") {
                    e.preventDefault();
                    showToast("⚠️ Akses Stranger: Anda hanya dapat melihat data (Read Only).");
                  }
                }}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shadow-xs ${
                  currentUser?.role === "readonly"
                    ? "opacity-50 cursor-not-allowed bg-slate-300 text-slate-500"
                    : dragOver
                    ? "cursor-pointer bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-white border-2 border-dashed border-slate-500"
                    : "cursor-pointer bg-slate-900 hover:bg-slate-800 text-white dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100 shadow-xs"
                }`}
                title="Upload file export Oracle (.xls / .xlsx)"
              >
                <span>+</span>
                <span>Upload Data</span>
                <input
                  type="file"
                  multiple
                  disabled={currentUser?.role === "readonly"}
                  accept=".xls,.xlsx"
                  className="hidden"
                  onChange={(e) => {
                    if (currentUser?.role === "readonly") return;
                    const files = e.target.files ? Array.from(e.target.files) : [];
                    if (files.length > 0) handleUpload(files);
                    e.target.value = "";
                  }}
                />
              </label>

              {/* Direct Ekspor Excel Button (Sesuai Mockup) */}
              <button
                type="button"
                onClick={handleExportExcel}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 border shadow-2xs cursor-pointer ${
                  isDarkMode
                    ? "bg-[#141E34]/80 hover:bg-[#1C2A48] border-white/[0.08] text-slate-200"
                    : "bg-white/80 hover:bg-white border-white/90 text-slate-700 shadow-slate-100"
                }`}
                title="Ekspor Data ke Excel (.xlsx)"
              >
                <span>📥</span>
                <span className="hidden sm:inline">Ekspor Excel</span>
              </button>

              {/* Refresh */}
              <button
                onClick={handleManualRefresh}
                disabled={loading}
                className={`p-1 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1 border ${
                  isDarkMode
                    ? "bg-[#141E34]/80 hover:bg-[#1C2A48] border-white/[0.08] text-slate-200"
                    : "bg-white/80 hover:bg-white border-white/90 text-slate-700"
                }`}
                title="Refresh Data dari Server"
              >
                <span className={loading ? "animate-spin" : ""}>🔄</span>
              </button>



              {/* User Pill */}
              <button
                onClick={() => setShowLoginModal(true)}
                className={`px-2 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1 border shadow-2xs cursor-pointer ${
                  !currentUser
                    ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900 animate-pulse"
                    : isDarkMode
                    ? "bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700"
                    : "bg-slate-100 border-slate-300 text-slate-800 hover:bg-slate-200"
                }`}
                title="Ganti Pengguna yang Sedang ON"
              >
                <span>👤</span>
                <span className="font-bold">{currentUser ? currentUser.name : "Pilih User"}</span>
              </button>

            </div>
          </div>
        </div>

        {/* ─── Dashboard & Settings Left Floating Drawer ─── */}
        {showSettingsPanel && (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-[2px] transition-opacity"
              onClick={() => setShowSettingsPanel(false)}
            />
            {/* Drawer Sliding from Left */}
            <div className={`fixed top-0 left-0 h-full w-80 sm:w-96 z-50 shadow-2xl flex flex-col border-r animate-in slide-in-from-left duration-200 ${
              isDarkMode
                ? "bg-[#0c1220] border-slate-800 text-slate-100 shadow-black/80"
                : "bg-white border-slate-200 text-slate-900 shadow-2xl"
            }`}>
              {/* Drawer Header */}
              <div className={`px-4 py-3.5 border-b flex items-center justify-between ${
                isDarkMode ? "border-slate-800 bg-[#090d18]" : "border-slate-200 bg-slate-50"
              }`}>
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-500"></div>
                  <span className="font-black text-xs uppercase tracking-wider">Dashboard & Pengaturan</span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowSettingsPanel(false)}
                  className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold transition-colors ${
                    isDarkMode ? "text-slate-400 hover:text-white hover:bg-slate-800" : "text-slate-500 hover:text-black hover:bg-slate-200"
                  }`}
                  title="Tutup (Esc)"
                >
                  ✕
                </button>
              </div>

              {/* Drawer Scrollable Body */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                
                {/* PRATINJAU DATA TERPILIH (CARD DARI MOCKUP USER) */}
                <div className={`p-4 rounded-xl border ${
                  isDarkMode
                    ? "bg-[#11192e] border-slate-800"
                    : "bg-slate-50 border-slate-200"
                }`}>
                  <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800">
                    <span className="text-[11px] font-black uppercase tracking-wider flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                      <span>📊</span> PRATINJAU DATA TERPILIH:
                    </span>
                    <span className="text-xs font-mono font-black text-emerald-600 dark:text-emerald-400">
                      RP {Math.round(stats.totalNilaiRp).toLocaleString("id-ID")}
                    </span>
                  </div>

                  {/* 3 Metric Box Horizontal */}
                  <div className="grid grid-cols-3 gap-2 mt-3">
                    <div className={`p-2.5 rounded-lg border text-center ${
                      isDarkMode ? "bg-[#0c1220] border-slate-800" : "bg-white border-slate-200"
                    }`}>
                      <div className="text-[10px] text-slate-500 font-semibold">Total SO Terfaktur</div>
                      <div className="text-sm font-black font-mono mt-1 text-slate-900 dark:text-white">
                        {stats.totalSO}
                      </div>
                    </div>

                    <div className={`p-2.5 rounded-lg border text-center ${
                      isDarkMode ? "bg-[#0c1220] border-slate-800" : "bg-white border-slate-200"
                    }`}>
                      <div className="text-[10px] text-slate-500 font-semibold">Total Lembar Faktur</div>
                      <div className="text-sm font-black font-mono mt-1 text-slate-900 dark:text-white">
                        {stats.totalCount}
                      </div>
                    </div>

                    <div className={`p-2.5 rounded-lg border text-center ${
                      isDarkMode ? "bg-[#0c1220] border-slate-800" : "bg-white border-slate-200"
                    }`}>
                      <div className="text-[10px] text-slate-500 font-semibold">Basis Penarikan</div>
                      <div className="text-xs font-black mt-1 text-slate-900 dark:text-white truncate" title="Tanggal Faktur (Tx)">
                        Tanggal Faktur
                      </div>
                    </div>
                  </div>

                  {/* Info Notice Box */}
                  <div className={`mt-3 p-2.5 rounded-lg border text-[11px] flex items-start gap-2 ${
                    isDarkMode ? "bg-[#0a0f1c] border-slate-800 text-slate-300" : "bg-white border-slate-200 text-slate-700"
                  }`}>
                    <span>💡</span>
                    <span className="leading-relaxed">
                      Menarik <strong>{stats.totalCount} faktur</strong> yang diterbitkan pada rentang <strong>{stats.dateRangeStr}</strong> (mencakup <strong>{stats.totalSO} SO</strong>).
                    </span>
                  </div>
                </div>

                {/* Section: Status Pengerjaan */}
                <div className="space-y-1.5">
                  <p className={`text-[10px] font-bold uppercase tracking-widest px-1 ${isDarkMode ? "text-slate-500" : "text-slate-400"}`}>
                    Progress Pengerjaan Cetak
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <div className={`p-2.5 rounded-lg border flex flex-col justify-between ${
                      isDarkMode ? "bg-slate-900 border-slate-800" : "bg-slate-50 border-slate-200"
                    }`}>
                      <span className="text-[10px] font-semibold text-slate-500">Belum Terprint</span>
                      <span className="text-base font-black font-mono text-slate-900 dark:text-white mt-1">
                        {stats.belumCount}
                      </span>
                    </div>
                    <div className={`p-2.5 rounded-lg border flex flex-col justify-between ${
                      isDarkMode ? "bg-slate-900 border-slate-800" : "bg-slate-50 border-slate-200"
                    }`}>
                      <span className="text-[10px] font-semibold text-slate-500">Selesai Print</span>
                      <span className="text-base font-black font-mono text-slate-900 dark:text-white mt-1">
                        {stats.sudahCount}
                      </span>
                    </div>
                  </div>
                </div>

                <div className={`h-px ${isDarkMode ? "bg-slate-800" : "bg-slate-200"}`}></div>

                {/* Section: Master Data */}
                <div className="space-y-1">
                  <p className={`text-[10px] font-bold uppercase tracking-widest px-1 pb-1 ${isDarkMode ? "text-slate-500" : "text-slate-400"}`}>
                    Master Data & Ekspor
                  </p>

                  <button
                    type="button"
                    onClick={() => { setShowApotekModal(true); setShowSettingsPanel(false); }}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left border ${
                      isDarkMode ? "border-slate-800 hover:bg-slate-800/70 text-slate-200" : "border-slate-200 hover:bg-slate-100 text-slate-800"
                    }`}
                  >
                    <span className="text-base">🏢</span>
                    <div>
                      <div className="font-bold text-xs">Master Apotek</div>
                      <div className={`text-[10px] ${isDarkMode ? "text-slate-500" : "text-slate-400"}`}>Kategori 1P / 2P / 3P</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => { setShowProductModal(true); setShowSettingsPanel(false); }}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left border ${
                      isDarkMode ? "border-slate-800 hover:bg-slate-800/70 text-slate-200" : "border-slate-200 hover:bg-slate-100 text-slate-800"
                    }`}
                  >
                    <span className="text-base">💊</span>
                    <div>
                      <div className="font-bold text-xs">Master Produk</div>
                      <div className={`text-[10px] ${isDarkMode ? "text-slate-500" : "text-slate-400"}`}>Farma / Alkes / Prekursor / OOT / CCP</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => { handleExportExcel(); setShowSettingsPanel(false); }}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left border ${
                      isDarkMode ? "border-slate-800 hover:bg-slate-800/70 text-slate-200" : "border-slate-200 hover:bg-slate-100 text-slate-800"
                    }`}
                  >
                    <span className="text-base">📥</span>
                    <div>
                      <div className="font-bold text-xs">Ekspor ke Excel</div>
                      <div className={`text-[10px] ${isDarkMode ? "text-slate-500" : "text-slate-400"}`}>Unduh arsip laporan (.xlsx)</div>
                    </div>
                  </button>
                </div>

                <div className={`h-px ${isDarkMode ? "bg-slate-800" : "bg-slate-200"}`}></div>

                {/* Section: Tampilan & Sesi */}
                <div className="space-y-1">
                  <p className={`text-[10px] font-bold uppercase tracking-widest px-1 pb-1 ${isDarkMode ? "text-slate-500" : "text-slate-400"}`}>
                    Sistem & Tampilan
                  </p>

                  {/* Dark Mode Toggle */}
                  <div className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border ${
                    isDarkMode ? "border-slate-800 bg-[#090d18]" : "border-slate-200 bg-slate-50"
                  }`}>
                    <div className="flex items-center gap-2.5">
                      <span className="text-base">{isDarkMode ? "☀️" : "🌙"}</span>
                      <div>
                        <div className={`font-bold text-xs ${isDarkMode ? "text-slate-200" : "text-slate-800"}`}>Mode Gelap</div>
                        <div className={`text-[10px] ${isDarkMode ? "text-slate-500" : "text-slate-400"}`}>{isDarkMode ? "Aktif" : "Nonaktif"}</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsDarkMode(prev => !prev)}
                      className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ${isDarkMode ? "bg-white" : "bg-slate-300"}`}
                      title={isDarkMode ? "Nonaktifkan Mode Gelap" : "Aktifkan Mode Gelap"}
                    >
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${
                        isDarkMode ? "left-5 bg-black" : "left-0.5 bg-white shadow"
                      }`} />
                    </button>
                  </div>

                  {/* Change Password */}
                  {currentUser && currentUser.role !== "readonly" && (
                    <button
                      type="button"
                      onClick={() => { setShowChangePasswordModal(true); setShowSettingsPanel(false); }}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left border ${
                        isDarkMode ? "border-slate-800 hover:bg-slate-800/70 text-slate-200" : "border-slate-200 hover:bg-slate-100 text-slate-800"
                      }`}
                    >
                      <span className="text-base">🔑</span>
                      <div>
                        <div className="font-bold text-xs">Ganti Password</div>
                        <div className={`text-[10px] ${isDarkMode ? "text-slate-500" : "text-slate-400"}`}>Akun {currentUser.name}</div>
                      </div>
                    </button>
                  )}

                  {/* Clear / Reset Data */}
                  {currentUser && currentUser.role !== "readonly" && (
                    <button
                      type="button"
                      onClick={() => { handleClearAll(); setShowSettingsPanel(false); }}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left border border-rose-500/20 text-rose-500 hover:bg-rose-500/10`}
                    >
                      <span className="text-base">🗑️</span>
                      <div>
                        <div className="font-bold text-xs">Reset Seluruh Data</div>
                        <div className="text-[10px] opacity-75">Hapus antrean faktur saat ini</div>
                      </div>
                    </button>
                  )}
                </div>

              </div>

              {/* Drawer Footer */}
              <div className={`px-4 py-3 border-t text-[11px] flex items-center justify-between ${
                isDarkMode ? "border-slate-800 bg-[#090d18] text-slate-500" : "border-slate-200 bg-slate-50 text-slate-600"
              }`}>
                <span>User: <strong>{currentUser?.name || "Admin"}</strong></span>
                <span className="text-emerald-500 font-bold">● Aktif</span>
              </div>
            </div>
          </>
        )}

        {/* Upload Notification Banner */}
        {uploadNotification && (
          <div className={`border rounded-xl px-3 py-1.5 text-xs flex items-center justify-between gap-2 shadow-xs ${
            isDarkMode ? "bg-gradient-to-r from-blue-950/70 to-indigo-950/70 border-blue-700/60 text-blue-200 shadow-blue-950/20" : "bg-blue-50/90 border-blue-200 text-blue-900"
          }`}>
            <div className="flex items-center gap-2">
              <span className="text-sm">📋</span>
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px]">
                <span className="font-bold">{uploadNotification.fileName}</span>
                <span className={`text-[9px] px-1 py-0.2 rounded font-semibold ${
                  isDarkMode ? "bg-blue-900/80 text-blue-200" : "bg-blue-200/80 text-blue-800"
                }`}>{uploadNotification.time}</span>
                {uploadNotification.rangeOra && (
                  <span>• <strong>ORA</strong>: {uploadNotification.rangeOra}</span>
                )}
                {uploadNotification.rangeDoo && (
                  <span>• <strong>DOO</strong>: {uploadNotification.rangeDoo}</span>
                )}
                <span>• Baru Masuk: <strong>{uploadNotification.newUnprinted} faktur</strong></span>
              </div>
            </div>
            <button
              onClick={() => setUploadNotification(null)}
              className={`p-0.5 rounded text-xs ${isDarkMode ? "text-blue-400 hover:text-white" : "text-blue-400 hover:text-blue-700"}`}
            >
              ✕
            </button>
          </div>
        )}

        {/* Error Banner */}
        {error && (
          <div className={`border rounded-xl px-3 py-1.5 text-xs flex items-center justify-between gap-2 ${
            isDarkMode ? "bg-rose-950/60 border-rose-800 text-rose-300" : "bg-rose-50 border-rose-200 text-rose-800"
          }`}>
            <div className="flex items-center gap-1.5 font-medium">
              <span className="text-rose-400">⚠️</span>
              <span>{error}</span>
            </div>
            <button onClick={() => setError(null)} className={isDarkMode ? "text-rose-400 hover:text-white" : "text-rose-400 hover:text-rose-700"}>
              ✕
            </button>
          </div>
        )}

        {/* VIEW CONDITIONAL: FULL DASHBOARD ANALYTICS OR WORKSPACE */}
        {mainView === "dashboard" ? (
          <div className="space-y-3 animate-in fade-in duration-200">
            {/* PRATINJAU DATA TERPILIH HERO BANNER (From user's image) */}
            <div className={`p-4 sm:p-5 rounded-2xl border shadow-sm ${
              isDarkMode
                ? "bg-[#0f172a] border-slate-800 text-white"
                : "bg-white border-slate-200 text-slate-900"
            }`}>
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <span className="text-xl">📊</span>
                  <span className="font-black text-sm tracking-wide text-slate-600 dark:text-slate-300">
                    PRATINJAU DATA TERPILIH:
                  </span>
                </div>
                
                {/* DATE RANGE FILTER CONTROLS */}
                <div className="flex flex-wrap items-center gap-2">
                  {/* Quick Select from Actual Available Dates */}
                  <div className="flex items-center gap-1 text-xs">
                    <span className="text-[11px] text-slate-500 font-semibold">Pilih Tanggal:</span>
                    <select
                      value={dashboardStartDate === dashboardEndDate && dashboardStartDate ? dashboardStartDate : "custom"}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === "all") {
                          setDashboardStartDate("");
                          setDashboardEndDate("");
                        } else if (val !== "custom") {
                          // convert DD/MM/YYYY to YYYY-MM-DD for consistency
                          if (/^\d{2}\/\d{2}\/\d{4}$/.test(val)) {
                            const [d, m, y] = val.split("/");
                            const iso = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
                            setDashboardStartDate(iso);
                            setDashboardEndDate(iso);
                          } else {
                            setDashboardStartDate(val);
                            setDashboardEndDate(val);
                          }
                        }
                      }}
                      className={`px-2 py-1 text-xs rounded-lg border font-mono ${
                        isDarkMode ? "bg-slate-900 border-slate-700 text-white" : "bg-white border-slate-300 text-slate-900"
                      }`}
                    >
                      <option value="all">Semua Tanggal Data</option>
                      {availableDates.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </div>

                  <span className="text-slate-400 text-xs">|</span>

                  <div className="flex items-center gap-1 text-xs">
                    <span className="text-[11px] text-slate-500 font-semibold">Rentang:</span>
                    <input
                      type="date"
                      value={dashboardStartDate}
                      onChange={(e) => setDashboardStartDate(e.target.value)}
                      className={`px-2 py-1 text-xs rounded-lg border font-mono ${
                        isDarkMode ? "bg-slate-900 border-slate-700 text-white" : "bg-white border-slate-300 text-slate-900"
                      }`}
                    />
                  </div>
                  <div className="flex items-center gap-1 text-xs">
                    <span className="text-[11px] text-slate-500 font-semibold">s/d</span>
                    <input
                      type="date"
                      value={dashboardEndDate}
                      onChange={(e) => setDashboardEndDate(e.target.value)}
                      className={`px-2 py-1 text-xs rounded-lg border font-mono ${
                        isDarkMode ? "bg-slate-900 border-slate-700 text-white" : "bg-white border-slate-300 text-slate-900"
                      }`}
                    />
                  </div>
                  {(dashboardStartDate || dashboardEndDate) && (
                    <button
                      type="button"
                      onClick={() => { setDashboardStartDate(""); setDashboardEndDate(""); }}
                      className="px-2.5 py-1 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 rounded-lg text-xs font-bold transition"
                      title="Reset filter tanggal"
                    >
                      Reset
                    </button>
                  )}
                  <div className="text-lg sm:text-2xl font-black font-mono text-emerald-600 dark:text-emerald-400 ml-2">
                    RP {Math.round(stats.totalNilaiRp).toLocaleString("id-ID")}
                  </div>
                </div>
              </div>

              {/* 3 Metric Box Horizontal */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
                <div className={`p-4 rounded-xl border text-center ${
                  isDarkMode ? "bg-[#090d18] border-slate-800" : "bg-slate-50 border-slate-200"
                }`}>
                  <div className="text-xs text-slate-500 font-semibold">Total SO Terfaktur</div>
                  <div className="text-2xl sm:text-3xl font-black font-mono text-blue-600 dark:text-blue-400 mt-1">
                    {stats.totalSO}
                  </div>
                </div>

                <div className={`p-4 rounded-xl border text-center ${
                  isDarkMode ? "bg-[#090d18] border-slate-800" : "bg-slate-50 border-slate-200"
                }`}>
                  <div className="text-xs text-slate-500 font-semibold">Total Lembar Faktur</div>
                  <div className="text-2xl sm:text-3xl font-black font-mono text-indigo-600 dark:text-indigo-400 mt-1">
                    {stats.totalCount}
                  </div>
                </div>

                <div className={`p-4 rounded-xl border text-center ${
                  isDarkMode ? "bg-[#090d18] border-slate-800" : "bg-slate-50 border-slate-200"
                }`}>
                  <div className="text-xs text-slate-500 font-semibold">Basis Penarikan</div>
                  <div className="text-base sm:text-lg font-black text-slate-900 dark:text-white mt-2">
                    Tanggal Faktur (Tx)
                  </div>
                </div>
              </div>

              {/* Notice Banner */}
              <div className={`mt-4 p-3 rounded-xl border text-xs flex items-center gap-2.5 ${
                isDarkMode ? "bg-[#090d18] border-slate-800 text-slate-300" : "bg-blue-50/60 border-blue-200 text-slate-800"
              }`}>
                <span className="text-base">💡</span>
                <span>
                  Menarik <strong>{stats.totalCount} faktur</strong> yang diterbitkan pada rentang <strong>{stats.dateRangeStr}</strong> (mencakup <strong>{stats.totalSO} SO</strong>).
                </span>
              </div>
            </div>

            {/* GRID ANALYTICS CARDS */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* Card 1: Progress Print */}
              <div className={`p-4 rounded-2xl border ${
                isDarkMode ? "bg-[#0f172a] border-slate-800" : "bg-white border-slate-200"
              }`}>
                <div className="flex items-center justify-between mb-3">
                  <span className="font-bold text-xs uppercase tracking-wider text-slate-500">Status Cetak</span>
                  <span className="text-xs font-mono font-bold">
                    {stats.totalCount > 0 ? Math.round((stats.sudahCount / stats.totalCount) * 100) : 0}% Selesai
                  </span>
                </div>
                
                {/* Progress bar */}
                <div className="w-full bg-slate-200 dark:bg-slate-800 h-3 rounded-full overflow-hidden flex mb-4">
                  <div
                    className="bg-emerald-500 h-full transition-all duration-300"
                    style={{ width: `${stats.totalCount > 0 ? (stats.sudahCount / stats.totalCount) * 100 : 0}%` }}
                  />
                </div>

                <div className="grid grid-cols-2 gap-2 text-center">
                  <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#090d18]">
                    <div className="text-[10px] text-slate-500 font-semibold">Belum Cetak</div>
                    <div className="text-lg font-black font-mono mt-0.5">{stats.belumCount}</div>
                  </div>
                  <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#090d18]">
                    <div className="text-[10px] text-slate-500 font-semibold">Sudah Dicetak</div>
                    <div className="text-lg font-black font-mono mt-0.5 text-emerald-600 dark:text-emerald-400">{stats.sudahCount}</div>
                  </div>
                </div>
              </div>

              {/* Card 2: Kategori Faktur (1P, 2P, 3P & ORA) */}
              <div className={`p-4 rounded-2xl border ${
                isDarkMode ? "bg-[#0f172a] border-slate-800" : "bg-white border-slate-200"
              }`}>
                <span className="font-bold text-xs uppercase tracking-wider text-slate-500 block mb-3">
                  Klasifikasi Kategori Pajak
                </span>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs p-2 rounded-lg bg-slate-50 dark:bg-[#090d18] border border-slate-200 dark:border-slate-800">
                    <span className="font-bold">1P (ORA + DOO)</span>
                    <span className="font-mono font-bold">{stats.katCounts["1P"]} faktur</span>
                  </div>
                  <div className="flex items-center justify-between text-xs p-2 rounded-lg bg-slate-50 dark:bg-[#090d18] border border-slate-200 dark:border-slate-800">
                    <span className="font-bold">2P</span>
                    <span className="font-mono font-bold">{stats.katCounts["2P"]} faktur</span>
                  </div>
                  <div className="flex items-center justify-between text-xs p-2 rounded-lg bg-slate-50 dark:bg-[#090d18] border border-slate-200 dark:border-slate-800">
                    <span className="font-bold">3P</span>
                    <span className="font-mono font-bold">{stats.katCounts["3P"]} faktur</span>
                  </div>
                </div>
              </div>

              {/* Card 3: Distribusi Kategori Produk */}
              <div className={`p-4 rounded-2xl border ${
                isDarkMode ? "bg-[#0f172a] border-slate-800" : "bg-white border-slate-200"
              }`}>
                <span className="font-bold text-xs uppercase tracking-wider text-slate-500 block mb-3">
                  Kategori Produk
                </span>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2 rounded-lg bg-slate-50 dark:bg-[#090d18] border border-slate-200 dark:border-slate-800">
                    <div className="text-[10px] text-slate-500 font-semibold">PREKURSOR</div>
                    <div className="text-sm font-bold font-mono mt-0.5">{stats.prodCounts.PREKURSOR}</div>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-50 dark:bg-[#090d18] border border-slate-200 dark:border-slate-800">
                    <div className="text-[10px] text-slate-500 font-semibold">OOT</div>
                    <div className="text-sm font-bold font-mono mt-0.5">{stats.prodCounts.OOT}</div>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-50 dark:bg-[#090d18] border border-slate-200 dark:border-slate-800">
                    <div className="text-[10px] text-slate-500 font-semibold">CCP</div>
                    <div className="text-sm font-bold font-mono mt-0.5">{stats.prodCounts.CCP}</div>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-50 dark:bg-[#090d18] border border-slate-200 dark:border-slate-800">
                    <div className="text-[10px] text-slate-500 font-semibold">ALKES</div>
                    <div className="text-sm font-bold font-mono mt-0.5">{stats.prodCounts.ALKES}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* TOP 5 OUTLET / CUSTOMER TERBESAR */}
            <div className={`p-4 rounded-2xl border ${
              isDarkMode ? "bg-[#0f172a] border-slate-800" : "bg-white border-slate-200"
            }`}>
              <span className="font-bold text-xs uppercase tracking-wider text-slate-500 block mb-3">
                Top 5 Outlet / Pelanggan Terbesar
              </span>
              <div className="divide-y divide-slate-200 dark:divide-slate-800">
                {stats.topCustomers.map((c, idx) => (
                  <div key={idx} className="py-2.5 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-800 flex items-center justify-center font-bold text-[10px]">
                        {idx + 1}
                      </span>
                      <span className="font-semibold text-slate-900 dark:text-white">{c.name}</span>
                      <span className="text-[10px] text-slate-500 font-mono">({c.count} faktur)</span>
                    </div>
                    <span className="font-mono font-bold text-slate-900 dark:text-white">
                      Rp {Math.round(c.totalRp).toLocaleString("id-ID")}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* QUICK BUTTON TO RETURN TO WORKSPACE */}
            <div className="text-center pt-2">
              <button
                type="button"
                onClick={() => setMainView("workspace")}
                className="px-5 py-2.5 bg-black dark:bg-white text-white dark:text-black font-bold text-xs rounded-xl shadow-md hover:opacity-90 transition active:scale-95"
              >
                ➔ Kembali ke Antrean Kerja Faktur
              </button>
            </div>
          </div>
        ) : (
          <>
        {/* 9 Metric KPI - SINGLE COMPACT MONOCHROME CAPSULE */}
        <div className={`rounded-xl overflow-hidden grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-9 divide-y sm:divide-y-0 sm:divide-x border ${
          isDarkMode
            ? "border-slate-800 divide-slate-800 bg-[#0c1220]"
            : "border-slate-300 divide-slate-200 bg-white"
        }`}>
          {/* Cell 1: Belum Terprint (Clickable Filter) */}
          <button
            type="button"
            onClick={() => { setFilter(filter === "belum" ? "all" : "belum"); setPage(0); }}
            className={`py-1.5 px-1.5 flex flex-col justify-between items-center text-center cursor-pointer group transition-colors ${
              filter === "belum"
                ? (isDarkMode ? "bg-slate-800 ring-2 ring-inset ring-white" : "bg-slate-200 ring-2 ring-inset ring-slate-900")
                : (isDarkMode ? "hover:bg-slate-800/60" : "hover:bg-slate-100")
            }`}
            title="Klik untuk filter Belum Terprint"
          >
            <span className={`text-[10px] font-black uppercase tracking-wider ${
              filter === "belum" ? (isDarkMode ? "text-white" : "text-slate-900") : (isDarkMode ? "text-slate-300 group-hover:text-white" : "text-slate-700 group-hover:text-black")
            }`}>
              Belum Terprint
            </span>
            <div className={`my-0.5 px-2.5 py-0.2 rounded font-black text-xs sm:text-sm font-mono tracking-tight border ${
              isDarkMode
                ? "bg-slate-800 border-slate-600 text-white"
                : "bg-slate-100 border-slate-300 text-slate-900"
            }`}>
              {stats.belumCount}
            </div>
            <span className={`text-[9px] font-bold leading-none ${isDarkMode ? "text-slate-300" : "text-slate-700"}`}>
              {filter === "belum" ? "● Aktif" : "Sisa Antrean"}
            </span>
          </button>

          {/* Cell 2: Total Faktur (Semua - Clickable Filter) */}
          <button
            type="button"
            onClick={() => { setFilter("all"); setPage(0); }}
            className={`py-1.5 px-1.5 flex flex-col justify-between items-center text-center cursor-pointer group transition-colors ${
              filter === "all"
                ? (isDarkMode ? "bg-slate-800 ring-2 ring-inset ring-white" : "bg-slate-200 ring-2 ring-inset ring-slate-900")
                : (isDarkMode ? "hover:bg-slate-800/60" : "hover:bg-slate-100")
            }`}
            title="Klik untuk tampilkan Semua Faktur"
          >
            <span className={`text-[10px] font-black uppercase tracking-wider ${
              filter === "all" ? (isDarkMode ? "text-white" : "text-slate-900") : (isDarkMode ? "text-slate-300 group-hover:text-white" : "text-slate-700 group-hover:text-black")
            }`}>
              Total Faktur
            </span>
            <div className={`my-0.5 font-black text-xs sm:text-sm font-mono tracking-tight ${isDarkMode ? "text-white" : "text-slate-900"}`}>
              {stats.totalCount}
            </div>
            <span className={`text-[9px] font-bold leading-none ${
              filter === "all" ? (isDarkMode ? "text-white" : "text-slate-900") : (isDarkMode ? "text-slate-400" : "text-slate-500")
            }`}>
              {filter === "all" ? "● Semua Aktif" : "Semua Data"}
            </span>
          </button>

          {/* Cell 3: Total SO */}
          <div className="py-1.5 px-1.5 flex flex-col justify-between items-center text-center">
            <span className={`text-[10px] font-black uppercase tracking-wider ${isDarkMode ? "text-slate-300" : "text-slate-700"}`}>
              Total SO
            </span>
            <div className={`my-0.5 font-black text-xs sm:text-sm font-mono tracking-tight ${isDarkMode ? "text-white" : "text-slate-900"}`}>
              {stats.totalSO}
            </div>
            <span className={`text-[9px] font-semibold leading-none ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>
              SO Terdata
            </span>
          </div>

          {/* Cell 4: 1P ORA */}
          <div className="py-1.5 px-1.5 flex flex-col justify-between items-center text-center">
            <span className={`text-[10px] font-black uppercase tracking-wider ${isDarkMode ? "text-slate-300" : "text-slate-700"}`}>
              1P (ORA)
            </span>
            <div className={`my-0.5 font-black text-xs font-mono ${isDarkMode ? "text-white" : "text-slate-900"}`}>
              {highestInvoices.maxOraStr}
            </div>
            <span className={`text-[9px] font-semibold leading-none truncate max-w-full px-0.5 ${isDarkMode ? "text-slate-400" : "text-slate-500"}`} title={invoiceProgression?.rangeOra || ""}>
              {invoiceProgression?.rangeOra ? `R: ${invoiceProgression.rangeOra}` : "Belum ada"}
            </span>
          </div>

          {/* Cell 5: 1P DOO */}
          <div className="py-1.5 px-1.5 flex flex-col justify-between items-center text-center">
            <span className={`text-[10px] font-black uppercase tracking-wider ${isDarkMode ? "text-slate-300" : "text-slate-700"}`}>
              1P (DOO)
            </span>
            <div className={`my-0.5 font-black text-xs font-mono ${isDarkMode ? "text-white" : "text-slate-900"}`}>
              {highestInvoices.max1PDooStr}
            </div>
            <span className={`text-[9px] font-semibold leading-none truncate max-w-full px-0.5 ${isDarkMode ? "text-slate-400" : "text-slate-500"}`} title={invoiceProgression?.range1PDoo || ""}>
              {invoiceProgression?.range1PDoo ? `R: ${invoiceProgression.range1PDoo}` : "Belum ada"}
            </span>
          </div>

          {/* Cell 6: 2P */}
          <div className="py-1.5 px-1.5 flex flex-col justify-between items-center text-center">
            <span className={`text-[10px] font-black uppercase tracking-wider ${isDarkMode ? "text-slate-300" : "text-slate-700"}`}>
              2P
            </span>
            <div className={`my-0.5 font-black text-xs font-mono ${isDarkMode ? "text-white" : "text-slate-900"}`}>
              {highestInvoices.max2PStr}
            </div>
            <span className={`text-[9px] font-semibold leading-none truncate max-w-full px-0.5 ${isDarkMode ? "text-slate-400" : "text-slate-500"}`} title={invoiceProgression?.range2P || ""}>
              {invoiceProgression?.range2P ? `R: ${invoiceProgression.range2P}` : "Belum ada"}
            </span>
          </div>

          {/* Cell 7: 3P */}
          <div className="py-1.5 px-1.5 flex flex-col justify-between items-center text-center">
            <span className={`text-[10px] font-black uppercase tracking-wider ${isDarkMode ? "text-slate-300" : "text-slate-700"}`}>
              3P
            </span>
            <div className={`my-0.5 font-black text-xs font-mono ${isDarkMode ? "text-white" : "text-slate-900"}`}>
              {highestInvoices.max3PStr}
            </div>
            <span className={`text-[9px] font-semibold leading-none truncate max-w-full px-0.5 ${isDarkMode ? "text-slate-400" : "text-slate-500"}`} title={invoiceProgression?.range3P || ""}>
              {invoiceProgression?.range3P ? `R: ${invoiceProgression.range3P}` : "Belum ada"}
            </span>
          </div>

          {/* Cell 8: Double INV (Clickable Filter) */}
          <button
            type="button"
            onClick={() => { setFilter(filter === "double" ? "all" : "double"); setPage(0); }}
            className={`py-1.5 px-1.5 flex flex-col justify-between items-center text-center cursor-pointer group transition-colors ${
              filter === "double"
                ? (isDarkMode ? "bg-slate-800 ring-2 ring-inset ring-white" : "bg-slate-200 ring-2 ring-inset ring-slate-900")
                : (isDarkMode ? "hover:bg-slate-800/60" : "hover:bg-slate-100")
            }`}
            title="Klik untuk filter Double INV"
          >
            <span className={`text-[10px] font-black uppercase tracking-wider ${
              filter === "double" ? (isDarkMode ? "text-white" : "text-slate-900") : (isDarkMode ? "text-slate-300 group-hover:text-white" : "text-slate-700 group-hover:text-black")
            }`}>
              Double INV
            </span>
            <div className={`my-0.5 px-2 py-0.2 rounded font-black text-xs sm:text-sm font-mono tracking-tight border ${
              isDarkMode
                ? "bg-slate-800 border-slate-600 text-white"
                : "bg-slate-100 border-slate-300 text-slate-900"
            }`}>
              {stats.doubleCount}
            </div>
            <span className={`text-[9px] font-bold leading-none ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>
              {filter === "double" ? "● Aktif" : "Perlu Cek"}
            </span>
          </button>

          {/* Cell 9: Retur (Clickable Filter) */}
          <button
            type="button"
            onClick={() => { setFilter(filter === "retur" ? "all" : "retur"); setPage(0); }}
            className={`py-1.5 px-1.5 flex flex-col justify-between items-center text-center cursor-pointer group transition-colors ${
              filter === "retur"
                ? (isDarkMode ? "bg-slate-800 ring-2 ring-inset ring-white" : "bg-slate-200 ring-2 ring-inset ring-slate-900")
                : (isDarkMode ? "hover:bg-slate-800/60" : "hover:bg-slate-100")
            }`}
            title="Klik untuk filter Retur"
          >
            <span className={`text-[10px] font-black uppercase tracking-wider ${
              filter === "retur" ? (isDarkMode ? "text-white" : "text-slate-900") : (isDarkMode ? "text-slate-300 group-hover:text-white" : "text-slate-700 group-hover:text-black")
            }`}>
              Retur
            </span>
            <div className={`my-0.5 px-2 py-0.2 rounded font-black text-xs sm:text-sm font-mono tracking-tight border ${
              isDarkMode
                ? "bg-slate-800 border-slate-600 text-white"
                : "bg-slate-100 border-slate-300 text-slate-900"
            }`}>
              {stats.returCount}
            </div>
            <span className={`text-[9px] font-bold leading-none ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>
              {filter === "retur" ? "● Aktif" : "Faktur Retur"}
            </span>
          </button>
        </div>

        {/* Search Bar & Quick Action Section - Compact Capsule */}
        <div className="flex items-center gap-2 w-full">
          {/* Expanded Full-Width Search Input Capsule */}
          <div className={`relative flex items-center rounded-lg flex-1 min-w-0 border ${
            isDarkMode ? "bg-[#0c1220] border-slate-700" : "bg-white border-slate-300"
          }`}>
            <span className="pl-3 text-sm text-slate-400">🔍</span>
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Cari no faktur, no SO, nama pelanggan, produk obat... (Ctrl+K)"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              className={`w-full pl-2 pr-12 py-1.5 rounded-lg text-xs font-bold focus:outline-none transition-colors bg-transparent ${
                isDarkMode ? "text-white placeholder:text-slate-500" : "text-slate-900 placeholder:text-slate-400"
              }`}
            />
            {search && (
              <button
                type="button"
                onClick={() => { setSearch(""); setPage(0); searchInputRef.current?.focus(); }}
                className={`mr-7 px-1.5 py-0.2 rounded text-xs font-bold transition-colors cursor-pointer ${
                  isDarkMode ? "text-slate-400 hover:text-white" : "text-slate-500 hover:text-slate-900"
                }`}
                title="Hapus pencarian"
              >
                ✕
              </button>
            )}
            <span className={`absolute right-2 text-[9px] font-mono font-bold px-1.5 py-0.2 rounded border pointer-events-none ${
              isDarkMode ? "bg-slate-800 text-slate-300 border-slate-700" : "bg-slate-100 text-slate-700 border-slate-300 shadow-2xs"
            }`}>
              ⌘K
            </span>
          </div>

          {/* Batch Done Print Button */}
          {unprintedCountInFiltered > 0 && currentUser?.role !== "readonly" && (
            <button
              onClick={handleMarkAllPrinted}
              className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100 rounded-lg text-xs font-black transition-all flex items-center gap-1.5 shadow-xs cursor-pointer shrink-0 active:scale-95"
            >
              <span>✓</span>
              <span>Tandai Semua Selesai ({unprintedCountInFiltered})</span>
            </button>
          )}
        </div>

        {/* Filter Dropdowns - Compact Clean Row */}
        <div className={`p-1 rounded-lg border grid grid-cols-2 sm:grid-cols-4 gap-1.5 ${
          isDarkMode ? "bg-[#0c1220] border-slate-700" : "bg-white border-slate-300"
        }`}>
          {/* Kategori Filter */}
          <select
            value={katFilter}
            onChange={(e) => { setKatFilter(e.target.value as KatFilter); setPage(0); }}
            className={`w-full px-2.5 py-1 rounded-md text-xs font-bold focus:outline-none transition-colors border ${
              isDarkMode
                ? "bg-slate-900 border-slate-700 text-white"
                : "bg-slate-50 border-slate-300 text-slate-900"
            }`}
          >
            <option value="all">Semua Kategori (1P/2P/3P)</option>
            <option value="1P">1P</option>
            <option value="2P">2P</option>
            <option value="3P">3P</option>
          </select>

          {/* Jenis Transaksi Filter */}
          <select
            value={jenisFilter}
            onChange={(e) => { setJenisFilter(e.target.value as JenisFilter); setPage(0); }}
            className={`w-full px-2.5 py-1 rounded-md text-xs font-bold focus:outline-none transition-colors border ${
              isDarkMode
                ? "bg-slate-900 border-slate-700 text-white"
                : "bg-slate-50 border-slate-300 text-slate-900"
            }`}
          >
            <option value="all">Semua Jenis (ORA/DOO)</option>
            <option value="ORA">ORA</option>
            <option value="DOO">DOO</option>
          </select>

          {/* Kategori Produk Filter */}
          <select
            value={klasFilter}
            onChange={(e) => { setKlasFilter(e.target.value as KlasFilter); setPage(0); }}
            className={`w-full px-2.5 py-1 rounded-md text-xs font-bold focus:outline-none transition-colors border ${
              isDarkMode
                ? "bg-slate-900 border-slate-700 text-white"
                : "bg-slate-50 border-slate-300 text-slate-900"
            }`}
          >
            <option value="all">Semua Produk</option>
            <option value="prekursor">Prekursor</option>
            <option value="oot">OOT</option>
            <option value="ccp">CCP (Cold Chain)</option>
            <option value="alkes">Alkes</option>
            <option value="farma">Farma</option>
          </select>

          {/* Filter Tanggal */}
          <select
            value={dateFilter}
            onChange={(e) => { setDateFilter(e.target.value); setPage(0); }}
            className={`w-full px-2.5 py-1 rounded-md text-xs font-bold focus:outline-none transition-colors border ${
              isDarkMode
                ? "bg-slate-900 border-slate-700 text-white"
                : "bg-slate-50 border-slate-300 text-slate-900"
            }`}
          >
            <option value="all">Semua Tanggal</option>
            {availableDates.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>

        {/* Faktur Table Card - Clean High-Contrast Table Canvas */}
        <div className={`rounded-xl overflow-hidden border-2 ${
          isDarkMode ? "bg-[#0b101b] border-slate-800" : "bg-white border-slate-300 shadow-sm"
        }`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className={`border-b-2 font-black text-xs sm:text-sm tracking-wider uppercase ${
                  isDarkMode
                    ? "bg-[#0c1322] border-slate-800 text-slate-200"
                    : "bg-slate-100 border-slate-300 text-slate-800"
                }`}>
                  <th className="px-3 py-2.5 w-8 text-center">#</th>
                  <th className="px-3 py-2.5 w-12 text-center">Print</th>
                  <th className="px-3 py-2.5">No SO</th>
                  <th className="px-3 py-2.5">No Invoice</th>
                  <th className="px-3 py-2.5">Kat Produk</th>
                  <th className="px-3 py-2.5">Jenis</th>
                  <th className="px-3 py-2.5">Pelanggan</th>
                  <th className="px-3 py-2.5" title="Tanggal Faktur / Invoice Date (Transaction Date)">Tgl Faktur</th>
                  <th className="px-3 py-2.5" title="Tanggal Sales Order Masuk (Order Date)">Tgl Order</th>
                  <th className="px-3 py-2.5">Kat</th>
                  <th className="px-3 py-2.5">Done Print (Waktu)</th>
                  <th className="px-3 py-2.5 text-right" title="Grand Total sudah termasuk PPN 11% (sesuai faktur fisik)">Total (+PPN)</th>
                </tr>
              </thead>
              <tbody className={`divide-y-2 ${isDarkMode ? "divide-slate-800/80" : "divide-slate-200"}`}>
                {loading && records.length === 0 ? (
                  <tr>
                    <td colSpan={12} className={`text-center py-8 ${isDarkMode ? "text-slate-400" : "text-slate-400"}`}>
                      <div className="flex flex-col items-center gap-1.5">
                        <span className="text-xl animate-spin text-blue-400">🔄</span>
                        <span className="text-xs font-bold">Memuat data faktur...</span>
                      </div>
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={12} className={`text-center py-8 ${isDarkMode ? "text-slate-400" : "text-slate-400"}`}>
                      <div className="flex flex-col items-center gap-1.5">
                        <span className="text-2xl">{filter === "belum" ? "🎉" : "📄"}</span>
                        <span className="text-xs font-bold">
                          {filter === "belum"
                            ? "Semua faktur sudah dicetak (tidak ada yang belum)."
                            : filter === "sudah"
                            ? "Belum ada faktur yang dicetak."
                            : filter === "double"
                            ? "Tidak ada faktur dengan nomor SO ganda."
                            : filter === "retur"
                            ? "Tidak ada transaksi retur."
                            : "Tidak ada faktur yang sesuai filter."}
                        </span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  pageData.map((g, rowIdx) => {
                    const isExpanded = expandedInvoices.has(g.key);
                    const isRowSelected = selectedRowIndex === rowIdx;
                    const getCellCls = (colIdx: number) =>
                      isRowSelected && selectedColIdx === colIdx
                        ? (isDarkMode
                            ? "ring-2 ring-white ring-inset bg-slate-800 text-white font-bold"
                            : "ring-2 ring-slate-900 ring-inset bg-slate-200 text-slate-900 font-bold")
                        : "";

                    const onSelectCell = (colIdx: number) => {
                      setSelectedRowIndex(rowIdx);
                      setSelectedColIdx(colIdx);
                    };

                    return (
                      <Fragment key={g.key}>
                        <tr
                          id={`faktur-row-${rowIdx}`}
                          onClick={() => {
                            setSelectedRowIndex(rowIdx);
                            toggleExpand(g.key);
                          }}
                          className={`cursor-pointer transition-colors ${
                            isRowSelected
                              ? (isDarkMode
                                  ? "bg-slate-800 border-l-4 border-l-white text-white"
                                  : "bg-slate-200 border-l-4 border-l-black text-black")
                              : g.isDoubleInv
                              ? (isDarkMode ? "bg-slate-900 hover:bg-slate-800" : "bg-slate-100 hover:bg-slate-200")
                              : g.allPrinted
                              ? (isDarkMode ? "bg-[#0b101b] hover:bg-slate-800/70" : "bg-slate-50 hover:bg-slate-100")
                              : (isDarkMode ? "bg-[#0d1424] hover:bg-slate-800/70" : "bg-white hover:bg-slate-100")
                          }`}
                        >
                          {/* Col 0: Expand */}
                          <td
                            className={`px-2.5 py-1.5 text-center text-xs font-black ${
                              isDarkMode ? "text-white" : "text-black"
                            } ${getCellCls(0)}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectCell(0);
                              toggleExpand(g.key);
                            }}
                          >
                            {isExpanded ? "▼" : "▶"}
                          </td>

                          {/* Col 1: Print Checkbox */}
                          <td
                            className={`px-2.5 py-1.5 text-center ${getCellCls(1)}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectCell(1);
                              togglePrint(g);
                            }}
                          >
                            <button
                              type="button"
                              disabled={currentUser?.role === "readonly"}
                              className={`w-5 h-5 rounded flex items-center justify-center text-xs font-black shadow-xs transition-all ${
                                currentUser?.role === "readonly"
                                  ? "cursor-not-allowed opacity-50"
                                  : ""
                              } ${
                                g.allPrinted
                                  ? "bg-slate-200 dark:bg-slate-800 text-black dark:text-white border-2 border-slate-400 dark:border-slate-500 hover:bg-slate-300"
                                  : isDarkMode
                                  ? "bg-white text-black hover:bg-slate-200 shadow-sm"
                                  : "bg-black text-white hover:bg-slate-800 shadow-sm"
                              }`}
                              title={
                                currentUser?.role === "readonly"
                                  ? "Akses Stranger (Hanya Lihat)"
                                  : g.allPrinted
                                  ? "Klik untuk UNPRINT"
                                  : "Klik untuk TANDAI PRINT"
                              }
                            >
                              {g.allPrinted ? "✓" : "○"}
                            </button>
                          </td>

                          {/* Col 2: No SO */}
                          <td
                            className={`px-2.5 py-1.5 font-mono font-bold text-xs whitespace-nowrap ${
                              isDarkMode ? "text-white" : "text-black"
                            } ${getCellCls(2)}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectCell(2);
                            }}
                          >
                            <div className="flex items-center gap-1">
                              <span>{g.so}</span>
                              {g.isDoubleInv && (
                                <span className="font-black text-black dark:text-white" title="Double Invoice Detected">⚠</span>
                              )}
                            </div>
                          </td>

                          {/* Col 3: No Invoice */}
                          <td
                            className={`px-2.5 py-1.5 font-mono font-black text-xs sm:text-sm whitespace-nowrap ${
                              isDarkMode ? "text-white" : "text-black"
                            } ${getCellCls(3)}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectCell(3);
                            }}
                          >
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span>{g.invoiceNumber}</span>
                              {g.isRetur && (
                                <span
                                  className={`px-1.5 py-0.2 rounded text-[10px] font-black uppercase border border-black dark:border-white ${
                                    isDarkMode
                                      ? "bg-slate-800 text-white"
                                      : "bg-slate-200 text-black"
                                  }`}
                                  title="Faktur Retur / Credit Memo (Nilai Minus)"
                                >
                                  RETUR
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Col 4: Kat Produk */}
                          <td
                            className={`px-2.5 py-1.5 whitespace-nowrap ${getCellCls(4)}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectCell(4);
                            }}
                          >
                            <span
                              className={`inline-block px-2 py-0.5 rounded text-xs font-bold border ${
                                isDarkMode
                                  ? "bg-slate-800 text-white border-slate-600"
                                  : "bg-slate-100 text-black border-slate-400"
                              }`}
                            >
                              {g.kategoriProduk}
                            </span>
                          </td>

                          {/* Col 5: Jenis */}
                          <td
                            className={`px-2.5 py-1.5 whitespace-nowrap ${getCellCls(5)}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectCell(5);
                            }}
                          >
                            <span className={`inline-block px-2 py-0.5 rounded text-xs font-mono font-black border ${
                              g.jenisTransaksi === "ORA"
                                ? (isDarkMode ? "bg-slate-700 text-white border-slate-500" : "bg-slate-300 text-black border-slate-500")
                                : (isDarkMode ? "bg-slate-800 text-slate-100 border-slate-600" : "bg-slate-100 text-black border-slate-400")
                            }`}>
                              {g.jenisTransaksi}
                            </span>
                          </td>

                          {/* Col 6: Pelanggan */}
                          <td
                            className={`px-2.5 py-1.5 max-w-xs truncate font-black text-xs sm:text-sm ${
                              isDarkMode ? "text-white" : "text-black"
                            } ${getCellCls(6)}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectCell(6);
                            }}
                          >
                            {g.customerName}
                          </td>

                          {/* Col 7: Tgl Faktur (Transaction Date) */}
                          <td
                            className={`px-2.5 py-1.5 whitespace-nowrap font-mono text-xs font-bold ${
                              isDarkMode ? "text-white" : "text-black"
                            } ${getCellCls(7)}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectCell(7);
                            }}
                          >
                            {g.transactionDate && g.transactionDate !== "-" ? g.transactionDate : g.orderDate}
                          </td>

                          {/* Col 8: Tgl Order (Order Date / SO) */}
                          <td
                            className={`px-2.5 py-1.5 whitespace-nowrap font-mono text-xs font-bold ${
                              isDarkMode ? "text-slate-200" : "text-slate-800"
                            } ${getCellCls(8)}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectCell(8);
                            }}
                          >
                            {g.orderDate && g.orderDate !== "-" ? g.orderDate : "-"}
                          </td>

                          {/* Col 9: Kat (Editable Dropdown) */}
                          <td
                            className={`px-2.5 py-1.5 whitespace-nowrap ${getCellCls(9)}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectCell(9);
                            }}
                          >
                            <select
                              value={g.kategori}
                              disabled={currentUser?.role === "readonly"}
                              onChange={(e) => {
                                handleUpdateCategory(g.invoiceKey, e.target.value as "1P" | "2P" | "3P", g.customerName);
                              }}
                              className={`px-2 py-0.5 rounded text-xs font-black border ${
                                currentUser?.role === "readonly" ? "cursor-not-allowed opacity-70" : "cursor-pointer"
                              } ${
                                isDarkMode
                                  ? "bg-slate-800 text-white border-slate-600 hover:border-slate-400"
                                  : "bg-white text-black border-slate-400 hover:border-slate-600"
                              }`}
                              title={
                                currentUser?.role === "readonly"
                                  ? "Akses Stranger (Hanya Lihat)"
                                  : "Klik untuk ubah Kategori (1P / 2P / 3P)"
                              }
                            >
                              <option value="1P">1P</option>
                              <option value="2P">2P</option>
                              <option value="3P">3P</option>
                            </select>
                          </td>

                          {/* Col 10: Done Print Waktu */}
                          <td
                            className={`px-2.5 py-1.5 whitespace-nowrap font-mono text-xs ${getCellCls(10)}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectCell(10);
                            }}
                          >
                            {g.allPrinted && g.printedAt ? (
                              <div className="flex flex-col gap-0.5">
                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border font-bold text-xs ${
                                  isDarkMode
                                    ? "text-white bg-slate-800 border-slate-600"
                                    : "text-black bg-slate-100 border-slate-300"
                                }`}>
                                  ⏱ {formatPrintTime(g.printedAt)}
                                </span>
                                {g.printedBy && (
                                  <span className={`text-[10px] font-sans font-bold px-0.5 ${
                                    isDarkMode ? "text-slate-300" : "text-slate-800"
                                  }`}>
                                    oleh: <strong>{String(g.printedBy)}</strong>
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className={isDarkMode ? "text-slate-500 font-bold" : "text-slate-400 font-bold"}>-</span>
                            )}
                          </td>

                          {/* Col 11: Total Harga (Grand Total include PPN 11%) */}
                          <td
                            className={`px-2.5 py-1.5 text-right font-medium whitespace-nowrap ${
                              isDarkMode
                                ? "text-white"
                                : "text-black"
                            } ${getCellCls(11)}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectCell(11);
                            }}
                          >
                            <div className="font-mono font-black text-xs sm:text-sm">
                              {formatRupiah(Math.round(g.totalHarga * 1.11 * 100) / 100)}
                            </div>
                            <div className={`text-[10px] font-mono font-bold ${isDarkMode ? "text-slate-300" : "text-slate-700"}`}>
                              DPP: {formatRupiah(Math.round(g.totalHarga * 100) / 100)}
                            </div>
                          </td>
                        </tr>

                        {/* Expanded Detail Rows */}
                        {isExpanded && (
                          <tr className={isDarkMode ? "bg-[#080d19] border-b border-slate-800" : "bg-slate-50/80 border-b border-slate-200"}>
                            <td colSpan={12} className="p-3">
                              <div className={`border rounded-xl p-3 shadow-xs space-y-3 ${
                                isDarkMode ? "bg-[#0e1628] border-slate-700/70 text-slate-200 shadow-black/40" : "bg-white border-slate-200 text-slate-800"
                              }`}>
                                <div className={`flex flex-wrap items-center justify-between gap-2 pb-2 border-b text-xs ${
                                  isDarkMode ? "border-slate-800 text-slate-300" : "border-slate-100 text-slate-600"
                                }`}>
                                  <div>
                                    <span className={`font-semibold ${isDarkMode ? "text-white" : "text-slate-900"}`}>
                                      Rincian Obat (Invoice: {g.invoiceNumber})
                                    </span>
                                    {g.isRetur && (
                                      <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] font-extrabold uppercase border ${
                                        isDarkMode
                                          ? "bg-rose-950 text-rose-300 border-rose-700/60"
                                          : "bg-rose-100 text-rose-700 border-rose-300"
                                      }`}>
                                        RETUR / CREDIT MEMO
                                      </span>
                                    )} · SO: <span className={`font-mono ${isDarkMode ? "text-slate-200" : "text-slate-900"}`}>{g.so}</span> · Pelanggan: <span className={`font-semibold ${isDarkMode ? "text-white" : "text-slate-900"}`}>{g.customerName}</span>
                                    {g.allPrinted && g.printedAt && (
                                      <span className="ml-3 inline-flex items-center gap-1 font-semibold text-emerald-400">
                                        <span>⏱ Selesai Print:</span>
                                        <span className="font-mono">{formatPrintTime(g.printedAt)}</span>
                                      </span>
                                    )}
                                  </div>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      togglePrint(g);
                                    }}
                                    className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors ${
                                      g.allPrinted
                                        ? (isDarkMode ? "bg-orange-950/80 text-orange-300 border border-orange-800 hover:bg-orange-900" : "bg-orange-100 text-orange-800 hover:bg-orange-200")
                                        : "bg-emerald-600 text-white hover:bg-emerald-700"
                                    }`}
                                  >
                                    {g.allPrinted ? "↩ Batalkan Print" : "✓ Tandai Selesai Print"}
                                  </button>
                                </div>

                                <table className="w-full text-xs text-left">
                                  <thead>
                                    <tr className={`border-b font-semibold ${
                                      isDarkMode ? "text-slate-400 border-slate-700/80" : "text-slate-500 border-slate-100"
                                    }`}>
                                      <th className="py-1.5 px-2">Item Code</th>
                                      <th className="py-1.5 px-2">Kat</th>
                                      <th className="py-1.5 px-2">Item Description</th>
                                      <th className="py-1.5 px-2 text-right">Qty</th>
                                      <th className="py-1.5 px-2">UOM</th>
                                      <th className="py-1.5 px-2">LOT Number</th>
                                      <th className="py-1.5 px-2 text-right">Harga (DPP)</th>
                                    </tr>
                                  </thead>
                                  <tbody className={`divide-y ${isDarkMode ? "divide-slate-800/60" : "divide-slate-100"}`}>
                                    {g.items.map((it, idx) => (
                                      <tr key={idx} className={isDarkMode ? "hover:bg-[#141e33]" : "hover:bg-slate-50"}>
                                        <td className={`py-1.5 px-2 font-mono ${isDarkMode ? "text-slate-400" : "text-slate-600"}`}>{it.itemCode}</td>
                                        <td className="py-1.5 px-2">
                                          {currentUser?.role === "readonly" ? (
                                            <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${
                                              isDarkMode ? "bg-[#182542] text-slate-300 border border-slate-700/60" : "bg-slate-100 text-slate-700"
                                            }`}>
                                              {it.kategoriProduk || "FARMA"}
                                            </span>
                                          ) : (
                                            <select
                                              value={(it.kategoriProduk || "FARMA").toUpperCase()}
                                              onChange={(e) => {
                                                handleUpdateProductCategory(it.itemCode, it.itemDescription, e.target.value);
                                              }}
                                              className={`text-[10px] font-bold py-0.5 px-1.5 rounded border cursor-pointer focus:outline-none focus:ring-1 focus:ring-teal-500 transition-all ${
                                                (it.kategoriProduk || "FARMA").toUpperCase() === "ALKES"
                                                  ? (isDarkMode ? "bg-teal-950/70 text-teal-200 border-teal-700/70" : "bg-teal-50 text-teal-800 border-teal-300")
                                                  : (it.kategoriProduk || "FARMA").toUpperCase() === "CCP"
                                                  ? (isDarkMode ? "bg-sky-950/70 text-sky-200 border-sky-700/70" : "bg-sky-50 text-sky-800 border-sky-300")
                                                  : (it.kategoriProduk || "FARMA").toUpperCase() === "PREKURSOR"
                                                  ? (isDarkMode ? "bg-amber-950/70 text-amber-200 border-amber-700/70" : "bg-amber-50 text-amber-800 border-amber-300")
                                                  : (it.kategoriProduk || "FARMA").toUpperCase() === "OOT"
                                                  ? (isDarkMode ? "bg-purple-950/70 text-purple-200 border-purple-700/70" : "bg-purple-50 text-purple-800 border-purple-300")
                                                  : (isDarkMode ? "bg-[#182542] text-slate-200 border-slate-700" : "bg-slate-50 text-slate-800 border-slate-200")
                                              }`}
                                            >
                                              <option value="FARMA">FARMA</option>
                                              <option value="ALKES">ALKES</option>
                                              <option value="CCP">CCP</option>
                                              <option value="PREKURSOR">PREKURSOR</option>
                                              <option value="OOT">OOT</option>
                                            </select>
                                          )}
                                        </td>
                                        <td className={`py-1.5 px-2 font-medium ${isDarkMode ? "text-slate-200" : "text-slate-800"}`}>{it.itemDescription}</td>
                                        <td className={`py-1.5 px-2 text-right font-mono font-semibold ${isDarkMode ? "text-white" : "text-slate-900"}`}>{it.qty}</td>
                                        <td className={`py-1.5 px-2 ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>{it.uom}</td>
                                        <td className={`py-1.5 px-2 font-mono ${isDarkMode ? "text-slate-400" : "text-slate-600"}`}>{it.lotNumber}</td>
                                        <td className={`py-1.5 px-2 text-right font-medium ${
                                          it.totalHarga < 0
                                            ? "text-rose-500 font-bold"
                                            : isDarkMode
                                            ? "text-slate-200"
                                            : "text-slate-900"
                                        }`}>{formatRupiah(it.totalHarga)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>

                                {/* Summary Box (DPP, PPN 11%, Grand Total) */}
                                <div className={`p-2.5 rounded-lg border flex flex-wrap items-center justify-between gap-3 text-xs ${
                                  isDarkMode ? "bg-[#0b1222] border-slate-700/80" : "bg-slate-50 border-slate-200"
                                }`}>
                                  <div className={`flex items-center gap-2 ${isDarkMode ? "text-slate-400" : "text-slate-600"}`}>
                                    <span>📦 Total Item: <strong className={isDarkMode ? "text-white" : "text-slate-900"}>{g.items.length}</strong></span>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-3 sm:gap-4 font-mono">
                                    <div>
                                      <span className={`text-[11px] mr-1 ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>Subtotal (DPP):</span>
                                      <span className="font-semibold">Rp {formatRupiah(Math.round(g.totalHarga * 100) / 100)}</span>
                                    </div>
                                    <div>
                                      <span className={`text-[11px] mr-1 ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>PPN (11%):</span>
                                      <span className="font-semibold text-amber-500">Rp {formatRupiah(Math.round(g.totalHarga * 0.11 * 100) / 100)}</span>
                                    </div>
                                    <div className={`px-2.5 py-1 rounded-md border font-bold ${
                                      isDarkMode ? "bg-blue-950/60 border-blue-800 text-blue-300" : "bg-blue-50 border-blue-200 text-blue-800"
                                    }`}>
                                      <span className="text-[11px] mr-1">Grand Total:</span>
                                      <span>Rp {formatRupiah(Math.round(g.totalHarga * 1.11 * 100) / 100)}</span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Footer */}
          {totalPages > 1 && (
            <div className={`p-2.5 border-t flex items-center justify-between text-xs transition-colors ${
              isDarkMode
                ? "bg-[#111c33] border-slate-700/80 text-slate-400"
                : "bg-slate-50 border-slate-200 text-slate-600"
            }`}>
              <span>
                Halaman <strong>{page + 1}</strong> dari <strong>{totalPages}</strong> ({filtered.length} total faktur)
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className={`px-3 py-1 border rounded-lg font-semibold disabled:opacity-40 transition-colors ${
                    isDarkMode
                      ? "bg-[#182542] border-slate-700 text-slate-200 hover:bg-[#223359]"
                      : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  Sebelumnya
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className={`px-3 py-1 border rounded-lg font-semibold disabled:opacity-40 transition-colors ${
                    isDarkMode
                      ? "bg-[#182542] border-slate-700 text-slate-200 hover:bg-[#223359]"
                      : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  Berikutnya
                </button>
              </div>
            </div>
          )}
        </div>
        </>
        )}
      </main>

      {/* Master Modals */}
      <MasterApotekModal
        isOpen={showApotekModal}
        onClose={() => setShowApotekModal(false)}
        categoryOverrides={categoryOverrides}
        isDarkMode={isDarkMode}
      />
      <MasterProductModal
        isOpen={showProductModal}
        onClose={() => setShowProductModal(false)}
        productOverrides={productOverrides}
        onUpdateCategory={handleUpdateProductCategory}
        isReadOnly={currentUser?.role === "readonly"}
        isDarkMode={isDarkMode}
      />
      <LoginModal
        isOpen={showLoginModal}
        onClose={currentUser ? () => setShowLoginModal(false) : undefined}
        onLogin={handleLogin}
        currentUser={currentUser}
        isDarkMode={isDarkMode}
      />
      {showChangePasswordModal && currentUser && currentUser.role !== "readonly" && (
        <ChangePasswordModal
          isOpen={showChangePasswordModal}
          onClose={() => setShowChangePasswordModal(false)}
          userName={currentUser.name}
          isDarkMode={isDarkMode}
          onSuccess={(msg) => showToast(`✓ ${msg}`)}
        />
      )}

      {/* Export to Excel Date-Range Modal */}
      <ExportExcelModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        groups={grouped}
        isDarkMode={isDarkMode}
      />

      {/* Changelog & System Update Notes Modal (v2.1) - High Contrast & Polished Design */}
      {showChangelogModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/75 animate-in fade-in duration-150"
          onClick={() => setShowChangelogModal(false)}
        >
          <div
            className={`relative w-full max-w-xl max-h-[90vh] flex flex-col rounded-2xl shadow-2xl overflow-hidden border transition-all ${
              isDarkMode
                ? "bg-[#0a0f1d] border-slate-700/80 text-slate-100"
                : "bg-slate-100 border-slate-300 text-slate-900"
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header: High Contrast & Vibrant */}
            <div className={`px-5 py-4 border-b flex items-center justify-between ${
              isDarkMode
                ? "bg-[#0e172e] border-slate-700/80 text-white"
                : "bg-gradient-to-r from-blue-700 via-blue-800 to-indigo-800 border-blue-900 text-white shadow-sm"
            }`}>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-white/15 border border-white/20 text-white flex items-center justify-center text-lg shadow-inner">
                  📢
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-extrabold tracking-tight text-white">
                      Catatan Pembaruan Sistem
                    </h2>
                    <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-amber-400 text-slate-950 shadow-xs">
                      v2.2
                    </span>
                  </div>
                  <p className="text-xs text-blue-100 font-medium mt-0.5">
                    Pita telemetri interaktif, kolom pencarian luas, optimasi GPU 60 FPS, & isolasi mutlak
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowChangelogModal(false)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-white/80 hover:text-white hover:bg-white/20 transition-colors font-bold text-sm cursor-pointer"
                title="Tutup (Esc)"
              >
                ✕
              </button>
            </div>

            {/* Modal Body: Structured Cards with Distinct Icon Badges & Bold Contrast */}
            <div className="overflow-y-auto p-4 sm:p-5 space-y-3 text-xs sm:text-sm custom-scrollbar">
              {/* Item 1: Interactive Telemetry Ribbon & Instant Filters */}
              <div className={`p-3.5 rounded-xl border flex items-start gap-3 shadow-xs transition-all ${
                isDarkMode
                  ? "bg-[#11192e] border-slate-700/80 text-slate-200"
                  : "bg-white border-slate-200/90 text-slate-800"
              }`}>
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-base font-bold ${
                  isDarkMode
                    ? "bg-sky-950/70 border border-sky-700/60 text-sky-400"
                    : "bg-sky-50 border border-sky-200 text-sky-700"
                }`}>
                  🎛️
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`font-bold text-sm ${isDarkMode ? "text-sky-400" : "text-sky-800"}`}>
                      Pita Metrik Telemetri Interaktif (Klik-Langsung)
                    </span>
                    <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded ${
                      isDarkMode
                        ? "bg-sky-900/60 text-sky-300 border border-sky-700/50"
                        : "bg-sky-100 text-sky-800"
                    }`}>
                      UI & FILTER
                    </span>
                  </div>
                  <p className={`text-xs leading-relaxed ${isDarkMode ? "text-slate-300" : "text-slate-700"}`}>
                    Kartu telemetri di bagian atas (<strong className={isDarkMode ? "text-white" : "text-slate-900 font-bold"}>Belum Terprint</strong>, <strong className={isDarkMode ? "text-white" : "text-slate-900 font-bold"}>Total Faktur</strong>, <strong className={isDarkMode ? "text-white" : "text-slate-900 font-bold"}>Double INV</strong>, dan <strong className={isDarkMode ? "text-white" : "text-slate-900 font-bold"}>Retur</strong>) kini berfungsi ganda sebagai tombol filter sekali klik dengan cincin indikator aktif (<span className="text-amber-400 font-bold">● Aktif</span>). Tab kecil duplikat telah dihilangkan dan kartu <strong className={isDarkMode ? "text-white" : "text-slate-900 font-bold"}>Total Faktur</strong> diposisikan berdampingan langsung di sebelah kanan <strong className={isDarkMode ? "text-white" : "text-slate-900 font-bold"}>Belum Terprint</strong>.
                  </p>
                </div>
              </div>

              {/* Item 2: Full-Width Search Input */}
              <div className={`p-3.5 rounded-xl border flex items-start gap-3 shadow-xs transition-all ${
                isDarkMode
                  ? "bg-[#11192e] border-slate-700/80 text-slate-200"
                  : "bg-white border-slate-200/90 text-slate-800"
              }`}>
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-base font-bold ${
                  isDarkMode
                    ? "bg-teal-950/70 border border-teal-700/60 text-teal-400"
                    : "bg-teal-50 border border-teal-200 text-teal-700"
                }`}>
                  🔍
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`font-bold text-sm ${isDarkMode ? "text-teal-400" : "text-teal-800"}`}>
                      Kolom Pencarian Luas & Full-Width
                    </span>
                    <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded ${
                      isDarkMode
                        ? "bg-teal-900/60 text-teal-300 border border-teal-700/50"
                        : "bg-teal-100 text-teal-800"
                    }`}>
                      PENCARIAN
                    </span>
                  </div>
                  <p className={`text-xs leading-relaxed ${isDarkMode ? "text-slate-300" : "text-slate-700"}`}>
                    Kotak pencarian kini membentang penuh (<strong className={isDarkMode ? "text-white" : "text-slate-900 font-bold"}>Full-Width Capsule</strong>) memberikan ruang yang lapang untuk mengetik nomor faktur, nomor SO, nama apotek/rumah sakit, maupun nama obat. Dilengkapi pintasan keyboard cepat (<strong className={isDarkMode ? "text-white" : "text-slate-900 font-bold"}>⌘K</strong>) dan tombol hapus (<strong className={isDarkMode ? "text-white" : "text-slate-900 font-bold"}>✕</strong>) sekali klik.
                  </p>
                </div>
              </div>

              {/* Item 3: 60 FPS GPU Acceleration & Smooth Navigation */}
              <div className={`p-3.5 rounded-xl border flex items-start gap-3 shadow-xs transition-all ${
                isDarkMode
                  ? "bg-[#11192e] border-slate-700/80 text-slate-200"
                  : "bg-white border-slate-200/90 text-slate-800"
              }`}>
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-base font-bold ${
                  isDarkMode
                    ? "bg-amber-950/70 border border-amber-700/60 text-amber-400"
                    : "bg-amber-50 border border-amber-200 text-amber-800"
                }`}>
                  🚀
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`font-bold text-sm ${isDarkMode ? "text-amber-400" : "text-amber-800"}`}>
                      Optimasi Performa GPU 60 FPS (Bebas Lag & Delay)
                    </span>
                    <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded ${
                      isDarkMode
                        ? "bg-amber-900/60 text-amber-300 border border-amber-700/50"
                        : "bg-amber-100 text-amber-800"
                    }`}>
                      PERFORMA
                    </span>
                  </div>
                  <p className={`text-xs leading-relaxed ${isDarkMode ? "text-slate-300" : "text-slate-700"}`}>
                    Efek filter blur bertingkat dan fixed attachment latar belakang yang berat telah dihapus total dan diganti dengan <strong className={isDarkMode ? "text-white" : "text-slate-900 font-bold"}>akselerasi hardware CSS (translateZ)</strong>. Scrolling ribuan baris, pengetikan, dan navigasi keyboard (<strong className={isDarkMode ? "text-white" : "text-slate-900 font-bold"}>Spasi / Panah</strong>) kini bergerak sangat halus dan responsif di seluruh perangkat.
                  </p>
                </div>
              </div>

              {/* Item 4: Strict Database Isolation */}
              <div className={`p-3.5 rounded-xl border flex items-start gap-3 shadow-xs transition-all ${
                isDarkMode
                  ? "bg-[#11192e] border-slate-700/80 text-slate-200"
                  : "bg-white border-slate-200/90 text-slate-800"
              }`}>
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-base font-bold ${
                  isDarkMode
                    ? "bg-emerald-950/70 border border-emerald-700/60 text-emerald-400"
                    : "bg-emerald-50 border border-emerald-200 text-emerald-700"
                }`}>
                  🔒
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`font-bold text-sm ${isDarkMode ? "text-emerald-400" : "text-emerald-800"}`}>
                      Isolasi Mutlak Database & Anti Data Hantu
                    </span>
                    <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded ${
                      isDarkMode
                        ? "bg-emerald-900/60 text-emerald-300 border border-emerald-700/50"
                        : "bg-emerald-100 text-emerald-800"
                    }`}>
                      DATABASE
                    </span>
                  </div>
                  <p className={`text-xs leading-relaxed ${isDarkMode ? "text-slate-300" : "text-slate-700"}`}>
                    Menjamin kepatuhan standar mutlak (<strong className={isDarkMode ? "text-white" : "text-slate-900 font-bold"}>LOCKED_RULES.md</strong>). Diterapkan <strong className={isDarkMode ? "text-white" : "text-slate-900 font-bold"}>Isolasi Partisi Ketat (Strict Key Isolation)</strong> antara faktur reguler (DOO) dan faktur ORA (<strong className={isDarkMode ? "text-white" : "text-slate-900 font-bold"}>-1P</strong>) sehingga status cetak tidak akan pernah tertukar atau saling menimpa.
                  </p>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className={`px-5 py-3.5 border-t flex items-center justify-between gap-3 ${
              isDarkMode
                ? "bg-[#0e172e] border-slate-700/80"
                : "bg-white border-slate-200"
            }`}>
              <div className="flex items-center gap-2 text-xs">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block animate-pulse"></span>
                <span className={`font-semibold ${isDarkMode ? "text-slate-300" : "text-slate-700"}`}>
                  Semua sistem beroperasi normal & stabil
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowChangelogModal(false)}
                className="px-5 py-2 rounded-xl font-bold text-xs bg-blue-600 hover:bg-blue-700 text-white transition-all shadow-md shadow-blue-500/25 active:scale-95 cursor-pointer"
              >
                Tutup & Mengerti
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
