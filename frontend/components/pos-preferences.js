export const defaultRegisterPreferences = Object.freeze({
    catalogView: "list", compactRows: false, showPhotos: true, showDetails: true,
});

export function parseRegisterPreferences(raw) {
    const saved = raw == null ? {} : JSON.parse(raw);
    const preferences = { ...defaultRegisterPreferences };
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return preferences;
    if (saved.catalogView === "list" || saved.catalogView === "card") preferences.catalogView = saved.catalogView;
    for (const key of ["compactRows", "showPhotos", "showDetails"])
        if (typeof saved[key] === "boolean") preferences[key] = saved[key];
    return preferences;
}
