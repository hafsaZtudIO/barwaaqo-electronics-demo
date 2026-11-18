"use client";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { startTransition, useActionState, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, CircleAlert, LoaderCircle } from "lucide-react";
import { submitShop } from "@/backend/actions";
export function ActionForm({ action, children, label, reset, confirmation, receipt, secondary, disabled, submitDisabled, onSuccess, statusContainer }) {
    const requestId = useRef(null);
    const working = useRef(false);
    const [version, setVersion] = useState(0);
    const [state, dispatch, pending] = useActionState(async (previous, form) => {
        try {
            requestId.current ??= crypto.randomUUID();
            form.set("request_id", requestId.current);
            const result = await action(previous, form);
            if (result.ok) {
                requestId.current = null;
                if (reset)
                    setVersion(value => value + 1);
                onSuccess?.(result, form);
            }
            return result;
        }
        catch (error) {
            unstable_rethrow(error);
            return { message: "The request was interrupted. Retry this form with the same values." };
        }
        finally {
            working.current = false;
        }
    }, { message: "" });
    function submit(event) {
        event.preventDefault();
        if (working.current || disabled || submitDisabled || (confirmation && !window.confirm(confirmation)))
            return;
        const form = new FormData(event.currentTarget, event.nativeEvent.submitter ?? null);
        working.current = true;
        startTransition(() => dispatch(form));
    }
    const notice = state.message && <p className={`notice ${state.ok ? "notice-success" : "notice-error"}`} role={state.ok ? "status" : "alert"}>
      {state.ok ? <CheckCircle2 size={17}/> : <CircleAlert size={17}/>}{state.message}
    </p>;
    return <form onSubmit={submit} className="action-form" aria-busy={pending}>
    <fieldset disabled={pending || disabled} key={version}>{children}</fieldset>
    {(label || (state.ok && receipt && state.id)) && <div className="form-actions">
      {label && <button className={secondary ? "button button-secondary" : "button"} type="submit" disabled={pending || disabled || submitDisabled}>
        {pending && <LoaderCircle size={16} className="spin"/>} {pending ? "Working…" : label}
      </button>}
      {state.ok && receipt && state.id && <Link className="button button-secondary" href={`/sales?receipt=${state.id}`}>View receipt</Link>}
    </div>}
    {statusContainer ? createPortal(notice, statusContainer) : notice}
  </form>;
}
export function ShopForm({ command, ...props }) {
    return <ActionForm action={submitShop.bind(null, command)} {...props}/>;
}
