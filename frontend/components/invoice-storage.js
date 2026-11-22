// Reject unreadable queues without overwriting the original records.
export function readInvoices(storage, key) {
    const entries = JSON.parse(storage.getItem(key) ?? "[]");
    if (!Array.isArray(entries)) throw new Error("Invalid invoice list");
    const ids = new Set();
    for (const entry of entries) {
        if (!entry || typeof entry.id !== "string" || !entry.id || ids.has(entry.id) ||
            typeof entry.customerName !== "string" || typeof entry.createdAt !== "string" ||
            !Number.isFinite(Date.parse(entry.createdAt)) ||
            (entry.error !== undefined && typeof entry.error !== "string") ||
            !entry.data || !Array.isArray(entry.data.items) || !entry.data.items.length ||
            typeof entry.data.payment !== "string" ||
            !Number.isSafeInteger(entry.total) || entry.total < 0 ||
            (entry.receiptItems !== undefined && (!Array.isArray(entry.receiptItems) ||
                !entry.receiptItems.every(item => item && typeof item.name === "string" &&
                    typeof item.unit === "string" && Number.isSafeInteger(item.quantity) && item.quantity > 0 &&
                    Number.isSafeInteger(item.total) && item.total >= 0))) ||
            !entry.data.items.every(item => item && typeof item.product_id === "string" &&
                Number.isSafeInteger(Number(item.quantity)) && Number(item.quantity) > 0)) {
            throw new Error("Invalid saved invoice");
        }
        ids.add(entry.id);
    }
    return entries;
}

export function updateInvoice(storage, key, id, result) {
    const entries = readInvoices(storage, key);
    const next = result.ok ? entries.filter(entry => entry.id !== id) : entries.map(entry =>
        entry.id === id ? { ...entry, error: result.message || "This invoice needs review before syncing." } : entry);
    storage.setItem(key, JSON.stringify(next));
    return next;
}

export function removeRejectedInvoice(storage, key, id) {
    const entries = readInvoices(storage, key);
    const next = entries.filter(entry => entry.id !== id || !entry.error);
    storage.setItem(key, JSON.stringify(next));
    return next;
}
