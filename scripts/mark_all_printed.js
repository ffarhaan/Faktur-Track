const { initializeApp } = require("firebase/app");
const { getFirestore, collection, getDocs, writeBatch } = require("firebase/firestore");

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

async function markAllPrinted() {
  console.log("Fetching all documents from 'fakturs' collection...");
  const snap = await getDocs(collection(db, "fakturs"));
  console.log(`Found ${snap.size} documents in 'fakturs'.`);

  if (snap.size === 0) {
    console.log("No documents to update.");
    return;
  }

  const nowIso = new Date().toISOString();
  const docs = snap.docs;
  const chunkSize = 400;
  let updatedCount = 0;

  for (let i = 0; i < docs.length; i += chunkSize) {
    const chunk = docs.slice(i, i + chunkSize);
    const batch = writeBatch(db);
    for (const d of chunk) {
      if (d.id === "__SYSTEM_METADATA__") continue;
      batch.update(d.ref, {
        status_cetak: true,
        printed_at: nowIso,
        updated_at: nowIso
      });
      updatedCount++;
    }
    await batch.commit();
    console.log(`Updated batch ${Math.min(i + chunkSize, docs.length)} / ${docs.length}...`);
  }

  console.log(`Successfully marked ${updatedCount} invoices as printed!`);
  process.exit(0);
}

markAllPrinted().catch((err) => {
  console.error("Error marking all printed:", err);
  process.exit(1);
});
