/**
 * Shared UI Utilities & Routing Engine
 */

let choicesInstances = {};

export const clearRoot = (root) => {
    root.innerHTML = '';
    // Clean up choices instances whenever we clear a page
    Object.keys(choicesInstances).forEach(key => {
        if (choicesInstances[key] && typeof choicesInstances[key].destroy === 'function') {
            choicesInstances[key].destroy();
        }
    });
    choicesInstances = {};
};

/**
 * Register a Choices.js instance so it can be managed/destroyed automatically
 */
export const addChoicesInstance = (id, instance) => {
    choicesInstances[id] = instance;
};

/**
 * Retrieve a choices instance by ID
 */
export const getChoicesInstance = (id) => {
    return choicesInstances[id];
};

/**
 * Page Navigation Utility
 * This essentially acts as a central event hub for switching views
 */
export const navigate = (pageId) => {
    // We emit a custom event that app.js listens for to perform the actual DOM swap
    const event = new CustomEvent('navigate', { detail: pageId });
    window.dispatchEvent(event);
};

/**
 * Display a loading spinner in an element
 */
export const showLoading = (el, message = "Loading...") => {
    el.innerHTML = `
        <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding: 40px; text-align:center;">
            <div class="spinner" style="border-top-color: var(--accent); margin-bottom: 12px; height:40px; width:40px;"></div>
            <div class="muted font-bold">${message}</div>
        </div>
    `;
};
