// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, addDoc, writeBatch, serverTimestamp, collection, getDocs, query, where, orderBy } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-analytics.js";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyC98TWcj1lzG4MtOYpDGt3MxISC5JNW2Yk",
  authDomain: "pms-national.firebaseapp.com",
  projectId: "pms-national",
  storageBucket: "pms-national.firebasestorage.app",
  messagingSenderId: "243598321443",
  appId: "1:243598321443:web:10ad687ac3a3a152f70e96",
  measurementId: "G-1T78ZWE9GB"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const db = getFirestore(app);
const auth = getAuth(app);

// Export Firestore utilities to our modular frontend components
export { db, auth, doc, getDoc, setDoc, addDoc, writeBatch, serverTimestamp, collection, getDocs, query, where, orderBy };
