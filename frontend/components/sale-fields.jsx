"use client";
import { useEffect, useRef } from "react";

export function PrintReceipt({ autoPrint }) {
    const printed = useRef(false);
    useEffect(() => {
        if (!autoPrint || printed.current) return;
        let active = true;
        const logo = document.getElementById("receipt-logo");
        async function print() {
            await logo?.decode().catch(() => {});
            if (!active) return;
            printed.current = true;
            const url = new URL(window.location.href);
            url.searchParams.delete("print");
            window.history.replaceState(window.history.state, "", url);
            window.print();
        }
        void print();
        return () => { active = false; };
    }, [autoPrint]);
    return <button className="button button-secondary no-print" type="button" onClick={() => window.print()}>Print receipt</button>;
}
