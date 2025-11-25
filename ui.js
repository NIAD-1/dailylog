let activeChoicesInstances = [];

export const clearRoot = (root) => {
    activeChoicesInstances.forEach(item => {
        if (item && item.instance && typeof item.instance.destroy === 'function') {
            item.instance.destroy();
        }
    });
    activeChoicesInstances = [];
    root.innerHTML = '';
};

export const addChoicesInstance = (key, instance) => {
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
    const currentHash = window.location.hash.substring(1);
    if (pushState && page !== currentHash) {
        history.pushState({ page: page }, '', `#${page}`);
    }
    window.dispatchEvent(new CustomEvent('navigate', { detail: { page } }));
};
