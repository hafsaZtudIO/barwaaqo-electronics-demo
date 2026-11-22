"use client";

import { useSyncExternalStore } from "react";

function watchConnection(callback) {
    window.addEventListener("online", callback);
    window.addEventListener("offline", callback);
    return () => {
        window.removeEventListener("online", callback);
        window.removeEventListener("offline", callback);
    };
}

export function useOffline() {
    return useSyncExternalStore(watchConnection, () => !navigator.onLine, () => false);
}
