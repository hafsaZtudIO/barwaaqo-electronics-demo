import { useSyncExternalStore } from "react";

const changeEvent = "barwaaqo:navigation";
const refreshEvent = "barwaaqo:refresh";
const subscribe = callback => {
    window.addEventListener("popstate", callback);
    window.addEventListener("hashchange", callback);
    window.addEventListener(changeEvent, callback);
    return () => {
        window.removeEventListener("popstate", callback);
        window.removeEventListener("hashchange", callback);
        window.removeEventListener(changeEvent, callback);
    };
};

export function publicUrl(href) {
    if (!href.startsWith("/")) return href;
    const original = new URL(href, window.location.origin);
    if (original.pathname === "/") return new URL("index.html", window.location.href).href;
    const parameters = new URLSearchParams(original.search);
    parameters.set("section", original.pathname.slice(1));
    return new URL("demo.html?" + parameters + original.hash, window.location.href).href;
}

function navigate(href, replace = false) {
    const target = publicUrl(href);
    if (new URL(target, window.location.href).pathname.endsWith("/index.html")) {
        window.location.assign(target);
        return;
    }
    window.history[replace ? "replaceState" : "pushState"]({}, "", target);
    window.dispatchEvent(new Event(changeEvent));
    window.scrollTo({ top: 0 });
}

export const router = {
    push: href => navigate(href),
    replace: href => navigate(href, true),
    refresh: () => window.dispatchEvent(new Event(refreshEvent)),
    back: () => window.history.back(),
};
export function useRouter() { return router; }
export function usePathname() {
    const location = useSyncExternalStore(subscribe, () => window.location.href, () => "http://localhost/");
    const url = new URL(location);
    return "/" + (url.searchParams.get("section") || url.hash.slice(1) || "dashboard");
}
export function unstable_rethrow(error) {
    if (error?.navigation) throw error;
}
export function redirect(href) {
    navigate(href);
    const error = new Error("Navigation");
    error.navigation = true;
    throw error;
}
export function notFound() {
    const error = new Error("This record was not found.");
    error.notFound = true;
    throw error;
}
export function revalidatePath() { router.refresh(); }
export { changeEvent, refreshEvent };
