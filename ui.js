let activeChoicesInstances = [];

export const clearRoot = (root) => {
    activeChoicesInstances.forEach(item => {
        if (item && item.instance && typeof item.instance.destroy === 'function') {
            item.instance.destroy();
        }
    });
    activeChoicesInstances = [];
    const modalContainer = document.getElementById("modalContainer");
    if (modalContainer) modalContainer.innerHTML = '';
    const hubEditModal = document.getElementById("hubEditModalContainer");
    if (hubEditModal) hubEditModal.innerHTML = '';
    root.innerHTML = '';
};

export const addChoicesInstance = (key, instance) => {
    const existing = activeChoicesInstances.find(item => item.key === key);
    if (existing && existing.instance && typeof existing.instance.destroy === 'function') {
        existing.instance.destroy();
    }
    activeChoicesInstances = activeChoicesInstances.filter(item => item.key !== key);
    activeChoicesInstances.push({ key, instance });
};

export const getChoicesInstance = (key) => {
    return activeChoicesInstances.find(item => item.key === key);
};

export const removeChoicesInstance = (key) => {
    const item = getChoicesInstance(key);
    if (item) {
        item.instance.destroy();
        activeChoicesInstances = activeChoicesInstances.filter(i => i.key !== key);
    }
};

export const navigate = (page, pushState = true) => {
    const cleanPage = String(page || 'report').replace(/^#/, '');
    const currentHash = window.location.hash.replace(/^#/, '');
    if (pushState && cleanPage !== currentHash) {
        history.pushState({ page: cleanPage }, '', `#${cleanPage}`);
    }
    window.dispatchEvent(new CustomEvent('navigate', { detail: { page: cleanPage } }));
};
