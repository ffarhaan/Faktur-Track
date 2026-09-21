const { initializeApp } = require('firebase/app');
const { getFirestore, doc, setDoc, getDoc, deleteDoc } = require('firebase/firestore');

const firebaseConfig = {
  apiKey: "AIzaSyCgRV7IW9G-OzgzqkT2NHy0gJSo8kKnnm8",
  authDomain: "faktur-tracker.firebaseapp.com",
  projectId: "faktur-tracker",
  storageBucket: "faktur-tracker.firebasestorage.app",
  messagingSenderId: "783800852576",
  appId: "1:783800852576:web:4d7cc4e79324d9ea22a305",
  measurementId: "G-WM491WECWP"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function testFirebase() {
  console.log('Testing Firestore connection...');
  try {
    const testRef = doc(db, 'system_test', 'test_connection');
    await setDoc(testRef, {
      message: 'Connection successful',
      timestamp: new Date().toISOString()
    });
    console.log('Successfully wrote test document to Firestore!');

    const snap = await getDoc(testRef);
    if (snap.exists()) {
      console.log('Successfully read document back from Firestore:', snap.data());
    }

    await deleteDoc(testRef);
    console.log('Successfully deleted test document. Firestore is 100% READY!');
  } catch(e) {
    console.error('Firestore Test Failed:', e);
  }
}

testFirebase();
