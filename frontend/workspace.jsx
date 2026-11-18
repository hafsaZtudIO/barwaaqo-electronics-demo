import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Workspace } from "./components/workspace";
import { AuthShell } from "./components/auth-shell";
import { ActionForm } from "./components/action-form";
import { Field } from "./components/ui";
import SectionPage from "./section";
import { pageEmployee, readShop } from "../backend/shop";
import { login, resetPassword, updatePassword } from "../backend/actions";
import { resetWorkspace } from "../backend/database";
import { publicUrl, router, changeEvent, refreshEvent } from "./platform/navigation";
import { exportCsv } from "../backend/http/export";

function Login() {
    return <AuthShell title="Sign in to your workspace" subtitle="Enter your username and password.">
      <p className="notice">Sample accounts · owner / shop123 · cashier / shop123</p>
      <ActionForm action={login} label="Sign in">
        <div className="form-grid auth-fields">
          <Field label="Username" name="username" autoComplete="username" required/>
          <Field label="Password" name="password" type="password" autoComplete="current-password" required/>
        </div>
      </ActionForm>
      <a className="text-link" href={publicUrl("/password/reset")} onClick={event => {
          event.preventDefault();
          router.push("/password/reset");
      }}>Reset password for an email account</a>
    </AuthShell>;
}

function Password({ updating }) {
    return <AuthShell title={updating ? "Update your password" : "Reset your password"} subtitle="Manage your sample account in this browser.">
      <ActionForm action={updating ? updatePassword : resetPassword} label={updating ? "Update password" : "Send reset link"}>
        {updating ? <>
          <Field label="New password" name="password" type="password" minLength={6} required/>
          <Field label="Confirm password" name="confirm" type="password" minLength={6} required/>
        </> : <Field label="Email address" name="email" type="email" required/>}
      </ActionForm>
    </AuthShell>;
}

async function downloadReport(parameters) {
    const response = await exportCsv(parameters, readShop);
    if (!response.ok) throw new Error((await response.json()).error);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "barwaaqo-" + parameters.get("kind") + ".csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function PublicWorkspace() {
    const [view, setView] = useState(null);
    const [employee, setEmployee] = useState(null);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(true);
    const [revision, setRevision] = useState(0);

    useEffect(() => {
        const update = () => setRevision(value => value + 1);
        window.addEventListener("popstate", update);
        window.addEventListener("hashchange", update);
        window.addEventListener(changeEvent, update);
        window.addEventListener(refreshEvent, update);
        window.addEventListener("storage", update);
        return () => {
            window.removeEventListener("popstate", update);
            window.removeEventListener("hashchange", update);
            window.removeEventListener(changeEvent, update);
            window.removeEventListener(refreshEvent, update);
            window.removeEventListener("storage", update);
        };
    }, []);

    useEffect(() => {
        let active = true;
        const query = new URLSearchParams(window.location.search);
        const selected = query.get("section") || window.location.hash.slice(1) || "dashboard";
        query.delete("section");
        setBusy(true);
        setError("");
        async function load() {
            if (selected === "login") {
                if (active) { setEmployee(null); setView(<Login/>); }
                return;
            }
            if (selected === "password/reset" || selected === "password/update") {
                if (selected.endsWith("update")) await pageEmployee();
                if (active) {
                    setEmployee(null);
                    setView(<Password updating={selected.endsWith("update")}/>);
                }
                return;
            }
            const currentEmployee = await pageEmployee();
            if (selected === "api/v1/export") {
                await downloadReport(query);
                router.replace("/reports");
                return;
            }
            const page = await SectionPage({
                params: Promise.resolve({ section: selected }),
                searchParams: Promise.resolve(Object.fromEntries(query)),
            });
            if (active) {
                setEmployee(currentEmployee);
                setView(page);
                const anchor = window.location.hash.slice(1);
                if (anchor && query.has("id")) requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView());
            }
        }
        load().catch(reason => {
            if (active && !reason.navigation) setError(reason.message || "Could not load this page.");
        }).finally(() => { if (active) setBusy(false); });
        return () => { active = false; };
    }, [revision]);

    useEffect(() => {
        function submit(event) {
            const form = event.target;
            const action = form.getAttribute("action");
            if (!action?.startsWith("/")) return;
            event.preventDefault();
            const query = new URLSearchParams(new FormData(form));
            router.push(action + "?" + query);
        }
        async function exportClick(event) {
            const link = event.target.closest("a");
            const href = link?.getAttribute("href");
            if (!href?.startsWith("/api/v1/export")) return;
            event.preventDefault();
            try { await downloadReport(new URL(href, window.location.origin).searchParams); }
            catch (reason) { setError(reason.message); }
        }
        document.addEventListener("submit", submit, true);
        document.addEventListener("click", exportClick, true);
        return () => {
            document.removeEventListener("submit", submit, true);
            document.removeEventListener("click", exportClick, true);
        };
    }, []);

    async function reset() {
        if (!window.confirm("Reset this public workspace to its starting fictional records?")) return;
        setBusy(true);
        try {
            await resetWorkspace();
            router.replace("/dashboard");
        } catch (reason) { setError(reason.message); }
        finally { setBusy(false); }
    }

    const page = error ? <section className="panel error-panel">
        <h1>Could not load this page</h1><p>{error}</p>
        <button className="button" type="button" onClick={() => router.refresh()}>Try again</button>
      </section> : view;
    return <>
      {employee ? <Workspace employee={employee}>{page}</Workspace> : page}
      {busy && !view && <main className="content"><section className="panel panel-body" role="status">Opening the shop workspace…</section></main>}
      {busy && view && <span className="sample-loading" role="status">Loading…</span>}
      <aside className="sample-toolbar no-print">
        <a href="index.html">Home</a>
        <span>Sample data · Saved in this browser</span>
        <button type="button" disabled={busy} onClick={reset}>Reset sample data</button>
      </aside>
    </>;
}

createRoot(document.getElementById("workspace-root")).render(<PublicWorkspace/>);
