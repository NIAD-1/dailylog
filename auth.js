import { getAuth, onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import { doc, getDoc, setDoc, serverTimestamp } from "./db.js";

const auth = getAuth();
let currentUser = null;
let currentUserRole = 'inspector';

const initAuth = (db, onAuthChangeCallback) => {
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            const userDocRef = doc(db, 'users', user.uid);
            const snap = await getDoc(userDocRef);
            currentUser = user;
            currentUserRole = snap.exists() ? snap.data().role || 'inspector' : 'inspector';
            if (!snap.exists()) {
                await setDoc(userDocRef, { name: user.displayName || user.email, email: user.email, role: 'inspector', createdAt: serverTimestamp() });
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
