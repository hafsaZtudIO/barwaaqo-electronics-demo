"use client";

import { useCallback, useEffect, useState } from "react";
import { syncInvoice } from "@/backend/actions";
import { useOffline } from "./connection";
import { readInvoices, removeRejectedInvoice, updateInvoice } from "./invoice-storage";

export function useOfflineInvoices(employeeId, refresh) {
    const key = `barwaaqo:invoices:v1:${employeeId}`;
    const [invoices, setInvoices] = useState([]);
    const offline = useOffline();
    const [syncing, setSyncing] = useState(false);
    const [storageError, setStorageError] = useState("");

    const write = useCallback((entries) => {
        localStorage.setItem(key, JSON.stringify(entries));
        setInvoices(entries);
    }, [key]);

    const send = useCallback(async (invoice) => {
        if (!navigator.onLine) return { retry: true };
        let timer;
        try {
            const deadline = new Promise(resolve => { timer = setTimeout(() => resolve({ retry: true }), 20000); });
            return await Promise.race([syncInvoice(employeeId, invoice.id, invoice.data), deadline]);
        } catch {
            return { retry: true };
        } finally {
            clearTimeout(timer);
        }
    }, [employeeId]);

    const sync = useCallback(async (retryBlocked = false) => {
        if (!navigator.onLine) return;
        try {
            await navigator.locks.request(key, { ifAvailable: true }, async (lock) => {
                if (!lock) return;
                let changed = false;
                setSyncing(true);
                try {
                    for (const invoice of readInvoices(localStorage, key)) {
                        if (invoice.error && !retryBlocked) continue;
                        const result = await send(invoice);
                        if (result.retry) {
                            if (result.message) setStorageError(result.message);
                            break;
                        }
                        setInvoices(updateInvoice(localStorage, key, invoice.id, result));
                        if (result.ok) {
                            changed = true;
                            setStorageError("");
                        }
                    }
                } finally {
                    setSyncing(false);
                    if (changed) refresh();
                }
            });
        } catch {
            setStorageError("Could not sync invoices saved on this device.");
        }
    }, [key, refresh, send]);

    useEffect(() => {
        function load() {
            try {
                setInvoices(readInvoices(localStorage, key));
            } catch {
                setStorageError("Could not open invoices saved on this device.");
            }
        }
        function online() { void sync(); }
        const timer = window.setInterval(() => { void sync(); }, 15000);
        window.addEventListener("online", online);
        window.addEventListener("storage", load);
        const initialSync = window.setTimeout(() => { load(); void sync(); }, 0);
        return () => {
            window.clearTimeout(initialSync);
            window.clearInterval(timer);
            window.removeEventListener("online", online);
            window.removeEventListener("storage", load);
        };
    }, [key, sync]);

    async function submit(invoice) {
        try {
            return await navigator.locks.request(key, async () => {
                const current = readInvoices(localStorage, key);
                const saved = current.find(entry => entry.id === invoice.id) ?? invoice;
                if (saved === invoice) write([...current, invoice]);
                const result = await send(saved);
                if (result.retry) return { ok: true, queued: true, invoice: saved };
                try {
                    // A definitive rejection is shown on the open cart. Background
                    // rejections stay in the queue so their invoice can be reviewed.
                    write(readInvoices(localStorage, key).filter(entry => entry.id !== saved.id));
                } catch {
                    // A retained copy can safely replay its original request.
                    setStorageError("Could not update the local invoice list.");
                }
                return result;
            });
        } catch {
            return { message: "Could not save this invoice on this device. Your cart is still open." };
        }
    }

    async function dismissRejected(id) {
        try {
            await navigator.locks.request(key, async () => {
                setInvoices(removeRejectedInvoice(localStorage, key, id));
            });
        } catch {
            setStorageError("Could not update the local invoice list. The invoice has been kept.");
        }
    }

    return { invoices, offline, syncing, storageError, sync, submit, dismissRejected };
}
