"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { syncInvoice } from "@/backend/actions";

function readInvoices(key) {
    return JSON.parse(localStorage.getItem(key) ?? "[]");
}

function watchConnection(callback) {
    window.addEventListener("online", callback);
    window.addEventListener("offline", callback);
    return () => {
        window.removeEventListener("online", callback);
        window.removeEventListener("offline", callback);
    };
}

const isOffline = () => !navigator.onLine;
const serverOffline = () => false;

export function useOfflineInvoices(employeeId, refresh) {
    const key = `barwaaqo:invoices:v1:${employeeId}`;
    const [invoices, setInvoices] = useState([]);
    const offline = useSyncExternalStore(watchConnection, isOffline, serverOffline);
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
                    for (const invoice of readInvoices(key)) {
                        if (invoice.error && !retryBlocked) continue;
                        const result = await send(invoice);
                        if (result.retry) {
                            if (result.message) setStorageError(result.message);
                            break;
                        }
                        const remaining = readInvoices(key);
                        if (result.ok) {
                            write(remaining.filter(entry => entry.id !== invoice.id));
                            changed = true;
                            setStorageError("");
                        } else {
                            write(remaining.map(entry => entry.id === invoice.id ? { ...entry, error: result.message } : entry));
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
    }, [key, refresh, send, write]);

    useEffect(() => {
        function load() {
            try {
                setInvoices(readInvoices(key));
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
                const current = readInvoices(key);
                const saved = current.find(entry => entry.id === invoice.id) ?? invoice;
                if (saved === invoice) write([...current, invoice]);
                const result = await send(saved);
                if (result.retry) return { ok: true, queued: true, invoice: saved };
                try {
                    write(readInvoices(key).filter(entry => entry.id !== saved.id));
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

    return { invoices, offline, syncing, storageError, sync, submit };
}
