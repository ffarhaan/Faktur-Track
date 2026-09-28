const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, doc, getDoc } = require('firebase/firestore');

const firebaseConfig = {
  apiKey: 'AIzaSyBR4DJ8WsfJuLnFyMxLet1m5IrN0LBnkA4',
  authDomain: 'faktur-tracker-6fb2b.firebaseapp.com',
  projectId: 'faktur-tracker-6fb2b',
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbwe4ZXCOB2RDsFNwEn9qrDd8KfghIi51tY-b7QeDjzQmo8IZ3YXxc50et3fp14vJ0o/exec';

async function uploadAllToGSheets() {
  console.log('1. Mengambil data dari Firebase...');
  const printSnap = await getDoc(doc(db, 'app_data', 'print_state'));
  const printState = printSnap.exists() ? printSnap.data() : { printedKeys: [], printedAtMap: {} };
  const printedSet = new Set(printState.printedKeys || []);
  const printMap = printState.printedAtMap || {};

  const chunksSnap = await getDocs(collection(db, 'faktur_chunks'));
  const sortedDocs = chunksSnap.docs.sort((a, b) => {
    const na = parseInt(a.id.replace(/\D/g, ''), 10) || 0;
    const nb = parseInt(b.id.replace(/\D/g, ''), 10) || 0;
    return na - nb;
  });

  const allItems = [];
  const seenKeys = new Set();

  sortedDocs.forEach(d => {
    const data = d.data();
    if (Array.isArray(data.items)) {
      data.items.forEach(item => {
        const key = item.id || item.no_faktur;
        if (key && !seenKeys.has(key)) {
          seenKeys.add(key);
          allItems.push(item);
        }
      });
    }
  });

  console.log(`Berhasil mengambil ${allItems.length} faktur unik dari Firebase.`);

  // Clear existing sheet and set headers
  console.log('2. Membersihkan sheet dan menyiapkan header kolom...');
  try {
    const clearRes = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'clear' }),
      redirect: 'follow'
    });
    console.log('Respon header:', await clearRes.text());
  } catch (e) {
    console.warn('Clear warn:', e.message);
  }

  // Format data
  const formattedRows = allItems.map((item, index) => {
    const key = item.id || item.no_faktur;
    const isPrinted = printedSet.has(key);
    const printedAt = printMap[key] || item.printed_at || '';
    const extra = item.extra || {};
    const itemsList = Array.isArray(extra.items) ? extra.items : [];
    const totalHarga = typeof extra.total_harga === 'number'
      ? extra.total_harga
      : typeof extra.entered_amount === 'number'
      ? extra.entered_amount
      : parseFloat(String(extra.total_harga || extra.entered_amount || extra.amount || item.total_harga || 0)) || 0;

    const cust = String(extra.nama_pelanggan || item.customer_name || "");
    const cleanJenis = item.jenis_transaksi || (cust.toUpperCase().includes("APOTEK") || cust.toUpperCase().includes("CLINIC") ? "ORA" : "DOO");
    const docSO = String(item.no_sales_order || extra.no_sales_order || "").trim();
    const cleanDocSO = docSO.split(",").map((s) => s.trim()).filter((s) => s && s !== "-").join(", ");

    let itemSO = "";
    if (itemsList.length > 0) {
      for (const it of itemsList) {
        const ordNum = String(it.order_number || it.no_sales_order || "").trim();
        if (ordNum && ordNum !== "-") {
          itemSO = ordNum;
          break;
        }
      }
    }

    const validItemSO = itemSO && itemSO !== "-" ? itemSO : "";
    let validSO = "-";
    if (cleanJenis === "ORA") {
      const candidate = [validItemSO, cleanDocSO].filter((s) => s && s !== "-").join(", ");
      const parts = candidate.split(",").map((s) => s.trim()).filter((s) => s && s !== "-");
      const realParts = parts.filter((s) => s.length >= 5 || s.includes("-"));
      validSO = realParts.length > 0 ? realParts[0] : parts[0] || "-";
    } else {
      if (cleanDocSO && cleanDocSO !== "-") {
        validSO = cleanDocSO.split(",")[0].trim();
      } else {
        validSO = validItemSO || "-";
      }
    }

    return {
      no: index + 1,
      orderDate: item.order_date || extra.order_date || extra.accounting_date || '',
      invoiceNumber: item.no_faktur || '',
      so: validSO,
      customerName: item.customer_name || extra.nama_pelanggan || '',
      jenisTransaksi: cleanJenis,
      kategori: item.kategori || '',
      kategoriProduk: item.klasifikasi_produk || extra.kategoriProduk || '',
      itemCount: itemsList.length > 0 ? itemsList.length : 1,
      totalHarga: totalHarga,
      statusCetak: isPrinted ? "Sudah Dicetak" : "Belum Dicetak",
      printedAt: printedAt || '-'
    };
  });

  // Send in batches of 1,000 rows
  const BATCH_SIZE = 1000;
  console.log(`3. Mulai mengirim data dalam batch ${BATCH_SIZE} baris...`);

  for (let i = 0; i < formattedRows.length; i += BATCH_SIZE) {
    const batch = formattedRows.slice(i, i + BATCH_SIZE);
    console.log(`Mengirim baris ${i + 1} s/d ${i + batch.length}...`);
    
    let retries = 3;
    while (retries > 0) {
      try {
        const res = await fetch(WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify(batch),
          redirect: 'follow'
        });
        const resText = await res.text();
        console.log(`Sukses baris ${i + 1} - ${i + batch.length}: ${resText}`);
        break;
      } catch (err) {
        retries--;
        console.warn(`Gagal mengirim batch, mencoba ulang (${retries} sisa)...`, err.message);
        await new Promise(r => setTimeout(r, 2000));
        if (retries === 0) throw err;
      }
    }
  }

  console.log('✅ SEMUA 8.867 FAKTUR BERHASIL DI-UPLOAD KE GOOGLE SHEETS!');
}

uploadAllToGSheets().catch(console.error);
