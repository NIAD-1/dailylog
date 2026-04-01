import { db, doc, getDoc } from "./db.js";
import { initAuth, signInWithGoogle, logOut, currentUser, currentUserData } from "./auth.js";
import { renderDashboard, bindDashboard } from "./dashboard.js";
import { initWizard, startReportWizard } from "./wizard.js";
import { clearRoot } from "./ui.js";

// -- National Hierarchy Constants (Exported for other modules) --
export const ZONES = {
    "North Central": ["Benue", "Kogi", "Kwara", "Nasarawa", "Niger", "Plateau", "FCT Abuja"],
    "North East": ["Adamawa", "Bauchi", "Borno", "Gombe", "Taraba", "Yobe"],
    "North West": ["Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Sokoto", "Zamfara"],
    "South East": ["Abia", "Anambra", "Ebonyi", "Enugu", "Imo"],
    "South South": ["Akwa Ibom", "Bayelsa", "Cross River", "Delta", "Edo", "Rivers"],
    "South West": ["Ekiti", "Lagos", "Ogun", "Ondo", "Osun", "Oyo"]
};

const root = document.getElementById('app');
const loginScreen = document.getElementById('loginScreen');
const authenticatedApp = document.getElementById('authenticatedApp');
const userNameDisplay = document.getElementById('userName');
const userRoleDisplay = document.getElementById('userRole');

const pages = {
    welcome: () => `
        <div class="animate-fade-in" style="display:flex; align-items:center; justify-content:center; min-height: 80vh;">
            <div class="card" style="text-align:center; padding: 80px 40px; max-width: 700px; width: 100%; border-width: 3px;">
                <h1 style="font-size: 48px; font-weight: 900; color: var(--accent); text-transform: uppercase; margin-bottom: 12px; letter-spacing: 2px;">National Intelligence</h1>
                <p class="muted" style="font-size: 18px; margin-bottom: 48px; font-weight: 500;">
                    Post Marketing Surveillance Portal<br>
                    <span style="font-size: 13px; opacity: 0.8; text-transform: uppercase; letter-spacing: 2px;">Secure Central Administration</span>
                </p>
                
                <div style="display:grid; grid-template-columns: 1fr; gap: 16px;">
                    <button id="startWizardBtn" style="padding: 24px; font-size: 18px; box-shadow: 0 4px 0 var(--accent-dark);">⚡ Start New Intelligence Report</button>
                    <button id="viewDashboardBtn" class="secondary" style="padding: 24px; font-size: 18px; border-width: 3px;">📊 Access National Database</button>
                </div>
            </div>
        </div>
    `,
    dashboard: () => renderDashboard(),
    wizard: () => '<div id="wizard-container"></div>'
};

export function navigate(pageId) {
    if (!pages[pageId]) pageId = 'welcome';
    
    // Update Nav Buttons
    document.querySelectorAll('.nav-btn').forEach(btn => {
        if (btn.dataset.target === pageId) btn.classList.add('active');
        else btn.classList.remove('active');
    });

    clearRoot(root);
    root.innerHTML = pages[pageId]();

    // Initialize Page Logic
    if (pageId === 'welcome') {
        document.getElementById('startWizardBtn').onclick = () => navigate('wizard');
        document.getElementById('viewDashboardBtn').onclick = () => navigate('dashboard');
        document.getElementById('accessTierLabel').textContent = currentUserData?.role || 'Guest';
    } else if (pageId === 'dashboard') {
        bindDashboard(root);
    } else if (pageId === 'wizard') {
        startReportWizard(root);
    }
}

// -- Global Listeners --
window.addEventListener('navigate', (e) => navigate(e.detail));

document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.onclick = (e) => navigate(e.target.dataset.target);
});

document.getElementById('btnSignIn').onclick = signInWithGoogle;
document.getElementById('btnSignOut').onclick = logOut;

// -- Auth Lifecycle --
initAuth(db, (user, userData) => {
    if (user && userData && userData.status !== 'pending') {
        loginScreen.style.display = 'none';
        authenticatedApp.style.display = 'flex';
        userNameDisplay.textContent = userData.displayName || user.email;
        userRoleDisplay.textContent = userData.role === 'admin' ? "National Admin" : "Field Officer";
        
        // Initialize Wizard with user session
        initWizard(user, userData);

        // Landing
        navigate('welcome');
    } else {
        loginScreen.style.display = 'flex';
        authenticatedApp.style.display = 'none';
        clearRoot(root);
    }
});

