import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore, enableIndexedDbPersistence } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyCgRV7IW9G-OzgzqkT2NHy0gJSo8kKnnm8",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "faktur-tracker.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "faktur-tracker",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "faktur-tracker.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "783800852576",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:783800852576:web:4d7cc4e79324d9ea22a305",
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || "G-WM491WECWP"
};

// Initialize Firebase (singleton instance)
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const db = getFirestore(app);

// Enable offline persistence in browser
if (typeof window !== "undefined") {
  try {
    enableIndexedDbPersistence(db).catch((err) => {
      if (err.code === "failed-precondition") {
        // Multiple tabs open, persistence can only be enabled in one tab at a time.
        console.warn("Firebase persistence failed: multiple tabs open");
      } else if (err.code === "unimplemented") {
        // The current browser does not support all of the features required to enable persistence
        console.warn("Firebase persistence not supported in this browser");
      }
    });
  } catch (e) {
    console.warn("Firebase persistence error:", e);
  }
}

export { app, db, firebaseConfig };
