"use client";
import { useState, useSyncExternalStore } from "react";
import { finishAuthLink } from "@/backend/actions";
import { ActionForm } from "./action-form";
const subscribe = () => () => { };
const browser = () => true;
const server = () => false;
function readFragment() {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const type = fragment.get("type");
    if (type !== "invite" && type !== "recovery")
        return null;
    const access = fragment.get("access_token");
    const refresh = fragment.get("refresh_token");
    return access && refresh ? { access, refresh } : null;
}
function Ready({ code }) {
    const [tokens] = useState(readFragment);
    if (!code && !tokens)
        return <p className="notice notice-error">This link is incomplete or expired. Request a new one.</p>;
    return <ActionForm action={async (state, form) => {
            window.history.replaceState(null, "", "/auth/callback");
            if (code)
                form.set("code", code);
            else if (tokens) {
                form.set("access", tokens.access);
                form.set("refresh", tokens.refresh);
            }
            return finishAuthLink(state, form);
        }} label="Continue"/>;
}
export function CallbackForm({ code }) {
    const ready = useSyncExternalStore(subscribe, browser, server);
    return ready ? <Ready code={code}/> : <p role="status">Checking your link…</p>;
}
