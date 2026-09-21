const { initializeApp } = require("firebase/app");
const { getFirestore, collection, doc, getDocs, setDoc, getDoc } = require("firebase/firestore");

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

async function markAllPrinted() {
  console.log("Fetching all chunk documents from 'faktur_chunks'...");
  const snap = await getDocs(collection(db, "faktur_chunks"));
  console.log(`Found ${snap.size} chunks.`);

  const allKeys = [];
  const printedAtMap = {};
  const nowIso = new Date().toISOString();

  snap.forEach((d) => {
    const data = d.data();
    if (Array.isArray(data.items)) {
      data.items.forEach((item) => {
        const key = item.id || item.no_faktur;
        if (key) {
          allKeys.push(key);
          printedAtMap[key] = nowIso;
        }
      });
    }
  });

  console.log(`Total invoices found across chunks: ${allKeys.length}`);

  // Update print_state in 1 single write!
  await setDoc(doc(db, "app_data", "print_state"), {
    printedKeys: allKeys,
    printedAtMap,
    updatedAt: nowIso
  });

  console.log(`SUCCESS! Marked all ${allKeys.length} invoices as printed in 1 write!`);
  process.exit(0);
}

markAllPrinted().catch((e) => {
  console.error("Error:", e);
  process.exit(1);
});
