import { auth, doc, setDoc, getDoc, serverTimestamp } from "./db.js";
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

const googleProvider = new GoogleAuthProvider();

export let currentUser = null;
export let currentUserData = null;

// Initialize auth state listener
export function initAuth(dbInstance, onAuthChangeCallback) {
    onAuthStateChanged(auth, async (user) => {
        currentUser = user;
        if (user) {
            console.log("Portal User Authenticated:", user.email);
            const userRef = doc(dbInstance, "users", user.uid);
            const docSnap = await getDoc(userRef);

            // If user doesn't exist, create profile in 'pending' status
            if (!docSnap.exists()) {
                currentUserData = {
                    email: user.email,
                    displayName: user.displayName || user.email,
                    role: "inspector", // default access tier
                    status: "pending", // IMPENETRABLE GATE: Must be manually approved by Admin
                    createdAt: serverTimestamp()
                };
                await setDoc(userRef, currentUserData);
                alert("Account Created! You are in 'Pending' status. Contact the National Admin for approval.");
            } else {
                currentUserData = docSnap.data();
                if (currentUserData.status === 'pending') {
                    alert("Your account is still PENDING. You cannot access the portal until the National Admin manually approves your email.");
                }
            }
            onAuthChangeCallback(user, currentUserData);
        } else {
            currentUserData = null;
            onAuthChangeCallback(null, null);
        }
    });
}

export async function signInWithGoogle() {
    try {
        await signInWithPopup(auth, googleProvider);
    } catch (error) {
        console.error("Error signing in with Google:", error);
        alert(error.message);
    }
}

export async function logOut() {
    try {
        await signOut(auth);
    } catch (error) {
        console.error("Error signing out:", error);
    }
}
