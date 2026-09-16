import { getAuth, onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import { doc, getDoc, setDoc, serverTimestamp } from "./db.js";

const auth = getAuth();
let currentUser = null;
let currentUserRole = 'inspector';

const initAuth = (db, onAuthChangeCallback) => {
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            currentUser = user;
            currentUserRole = 'inspector';
            try {
                const userDocRef = doc(db, 'users', user.uid);
                const snap = await getDoc(userDocRef);
                if (snap.exists()) {
                    currentUserRole = snap.data().role || 'inspector';
                } else {
                    await setDoc(userDocRef, { name: user.displayName || user.email, email: user.email, role: 'inspector', createdAt: serverTimestamp() });
                }
            } catch (err) {
                console.warn("Could not load user profile document, defaulting to inspector:", err);
            }
        } else {
            currentUser = null;
            currentUserRole = 'inspector';
        }
        onAuthChangeCallback(currentUser, currentUserRole);
    });
};

const signIn = async () => {
    const provider = new GoogleAuthProvider();
    try {
        await signInWithPopup(auth, provider);
    } catch (e) {
        alert(e.message);
    }
};

const logOut = async () => {
    await signOut(auth);
};

export { auth, initAuth, signIn, logOut, currentUser, currentUserRole };
