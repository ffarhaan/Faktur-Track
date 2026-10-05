const { initializeApp } = require("firebase/app");
const { getFirestore, doc, getDoc, setDoc, collection, getDocs } = require("firebase/firestore");

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

const targetDooKeys = [
  "25077", "25078", "25079", "25080", "25081",
  "25082", "25083", "25084", "25085", "25086",
  "25087", "25088", "25089", "25090", "25091", "25092"
];
const targetOraKey = "18031-1P";
const allTargetKeys = [...targetDooKeys, targetOraKey];

async function restore() {
  const nowIso = new Date().toISOString();
  console.log("Restoring print status for keys:", allTargetKeys);

  // 1. Update part_25000_29999
  const part25Ref = doc(db, "print_state_partitions", "part_25000_29999");
  const p25Snap = await getDoc(part25Ref);
  let p25Keys = new Set(p25Snap.exists() ? (p25Snap.data().printedKeys || []) : []);
  let p25Map = { ...(p25Snap.exists() ? (p25Snap.data().printedAtMap || {}) : {}) };

  targetDooKeys.forEach((k) => {
    p25Keys.add(k);
    if (!p25Map[k]) p25Map[k] = nowIso;
  });

  await setDoc(part25Ref, {
    partitionId: "part_25000_29999",
    printedKeys: Array.from(p25Keys),
    printedAtMap: p25Map,
    count: p25Keys.size,
    updatedAt: nowIso,
  });
  console.log("Updated part_25000_29999 with total keys:", p25Keys.size);

  // 2. Update part_15000_19999
  const part15Ref = doc(db, "print_state_partitions", "part_15000_19999");
  const p15Snap = await getDoc(part15Ref);
  let p15Keys = new Set(p15Snap.exists() ? (p15Snap.data().printedKeys || []) : []);
  let p15Map = { ...(p15Snap.exists() ? (p15Snap.data().printedAtMap || {}) : {}) };

  p15Keys.add(targetOraKey);
  if (!p15Map[targetOraKey]) p15Map[targetOraKey] = nowIso;

  await setDoc(part15Ref, {
    partitionId: "part_15000_19999",
    printedKeys: Array.from(p15Keys),
    printedAtMap: p15Map,
    count: p15Keys.size,
    updatedAt: nowIso,
  });
  console.log("Updated part_15000_19999 with total keys:", p15Keys.size);

  // 3. Update legacy doc
  const legRef = doc(db, "app_data", "print_state");
  const legSnap = await getDoc(legRef);
  if (legSnap.exists()) {
    const legData = legSnap.data();
    let lKeys = new Set(legData.printedKeys || []);
    let lMap = { ...(legData.printedAtMap || {}) };
    allTargetKeys.forEach((k) => {
      lKeys.add(k);
      if (!lMap[k]) lMap[k] = nowIso;
    });
    await setDoc(legRef, {
      printedKeys: Array.from(lKeys),
      printedAtMap: lMap,
      updatedAt: nowIso,
    });
    console.log("Updated app_data/print_state with total keys:", lKeys.size);
  }

  // 4. Update chunks so items have status_cetak: true
  const chunksSnap = await getDocs(collection(db, "faktur_chunks"));
  const targetSet = new Set(allTargetKeys);
  let modifiedChunksCount = 0;

  for (const c of chunksSnap.docs) {
    const items = c.data().items || [];
    let chunkModified = false;
    items.forEach((item) => {
      const k = item.id || item.no_faktur;
      if (k && targetSet.has(k)) {
        item.status_cetak = true;
        if (!item.printed_at) item.printed_at = nowIso;
        chunkModified = true;
      }
    });

    if (chunkModified) {
      await setDoc(doc(db, "faktur_chunks", c.id), {
        ...c.data(),
        items,
        updatedAt: nowIso,
      });
      modifiedChunksCount++;
      console.log(`Updated chunk ${c.id} with marked items`);
    }
  }

  console.log(`Finished restoring! Modified ${modifiedChunksCount} chunks.`);
}

restore().then(() => {
  console.log("SUCCESS!");
  process.exit(0);
}).catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
