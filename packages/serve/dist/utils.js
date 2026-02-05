export const ensureArray = (value) => {
    if (!value) {
        return [];
    }
    return Array.isArray(value) ? value : [value];
};
export const mergeTags = (existing, next) => {
    const merged = [...existing, ...(next ?? [])];
    return Array.from(new Set(merged.filter(Boolean)));
};
export const generateRequestId = () => {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
        return globalThis.crypto.randomUUID();
    }
    return `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
};
