const { initializeApp } = require("firebase/app");
const { getFirestore, doc, getDoc, collection, getDocs } = require("firebase/firestore");

const firebaseConfig = {
  apiKey: "AIzaSyBR4DJ8WsfJuLnFyMxLet1m5IrN0LBnkA4",
  authDomain: "faktur-tracker-6fb2b.firebaseapp.com",
  projectId: "faktur-tracker-6fb2b",
  storageBucket: "faktur-tracker-6fb2b.firebasestorage.app",
  messagingSenderId: "400827990470",
  appId: "1:400827990470:web:41f7f69d51b144d1def2c7",
  measurementId: "G-SVCM52BTBM"
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function check() {
  const snap = await getDocs(collection(db, "faktur_chunks"));
  console.log("Total chunks:", snap.size);
  snap.forEach((c) => {
    const items = c.data().items || [];
    items.forEach((it) => {
      const k = it.id || it.no_faktur;
      if (k && (k.includes("18031") || k.includes("25092") || k.includes("25081") || k.includes("25077"))) {
        console.log(`Chunk: ${c.id} | id: ${it.id} | no_faktur: ${it.no_faktur} | jenis: ${it.jenis_transaksi} | status_cetak: ${it.status_cetak} | printed_at: ${it.printed_at}`);
      }
    });
  });
}

check().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
