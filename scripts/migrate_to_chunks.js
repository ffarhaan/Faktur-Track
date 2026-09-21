const { initializeApp } = require("firebase/app");
const { getFirestore, collection, doc, getDocs, setDoc } = require("firebase/firestore");

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyCgRV7IW9G-OzgzqkT2NHy0gJSo8kKnnm8",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "faktur-tracker.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "faktur-tracker",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "faktur-tracker.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "783800852576",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:783800852576:web:4d7cc4e79324d9ea22a305",
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || "G-WM491WECWP"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function migrate() {
  console.log("Reading existing documents from 'fakturs'...");
  const snap = await getDocs(collection(db, "fakturs"));
  console.log(`Found ${snap.size} legacy documents in 'fakturs'.`);

  const allItems = [];
  const printedKeys = [];
  const printedAtMap = {};

  snap.forEach((d) => {
    if (d.id === "__SYSTEM_METADATA__") return;
    const data = d.data();
    allItems.push(data);
    if (data.status_cetak) {
      printedKeys.push(d.id || data.no_faktur);
      if (data.printed_at) {
        printedAtMap[d.id || data.no_faktur] = data.printed_at;
      }
    }
  });

  console.log(`Migrating ${allItems.length} items to chunks...`);
  const CHUNK_SIZE = 500;
  const chunks = [];
  for (let i = 0; i < allItems.length; i += CHUNK_SIZE) {
    chunks.push(allItems.slice(i, i + CHUNK_SIZE));
  }

  const nowIso = new Date().toISOString();
  const chunkIds = [];

  for (let idx = 0; idx < chunks.length; idx++) {
    const chunk = chunks[idx];
    const chunkId = `chunk_${idx}`;
    chunkIds.push(chunkId);
    await setDoc(doc(db, "faktur_chunks", chunkId), {
      chunkIndex: idx,
      count: chunk.length,
      items: chunk,
      updatedAt: nowIso
    });
    console.log(`Saved ${chunkId} (${chunk.length} items)`);
  }

  // Save metadata & print_state (only 2 writes!)
  await setDoc(doc(db, "app_data", "metadata"), {
    totalInvoices: allItems.length,
    totalChunks: chunks.length,
    chunkIds,
    updatedAt: nowIso
  }, { merge: true });

  await setDoc(doc(db, "app_data", "print_state"), {
    printedKeys,
    printedAtMap,
    updatedAt: nowIso
  });

  console.log(`Migration Complete! Total writes: ${chunks.length + 2}. Printed count: ${printedKeys.length}`);
  process.exit(0);
}

migrate().catch((e) => {
  console.error("Migration error:", e);
  process.exit(1);
});
