import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import { getFirestore, collection, addDoc, doc, setDoc, serverTimestamp, query, where, orderBy, getDocs, getDoc, limit } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyDKtEkK9rY7NLFLRjqexRjeUL2jj7tC6tY",
    authDomain: "enilama-system-app.firebaseapp.com",
    projectId: "enilama-system-app",
    storageBucket: "enilama-system-app.firebasestorage.app",
    messagingSenderId: "180395774893",
    appId: "1:180395774893:web:7bd017f2b1478f22264724",
    measurementId: "G-SJ306DRWY9"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export { db, app, collection, addDoc, doc, setDoc, serverTimestamp, query, where, orderBy, getDocs, getDoc, limit };
