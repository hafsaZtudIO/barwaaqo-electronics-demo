import assert from "node:assert/strict";
import test from "node:test";
import { readInvoices, removeRejectedInvoice, updateInvoice } from "../../frontend/components/invoice-storage.js";

function queue(entries) {
    let value = typeof entries === "string" ? entries : JSON.stringify(entries);
    return { getItem: () => value, setItem: (_key, next) => { value = next; } };
}
const invoice = id => ({ id, customerName: "Walk-in", createdAt: "2026-11-21T08:00:00Z", total: 1000,
    data: { payment: "ZAAD", items: [{ product_id: "product-a", quantity: 2 }] } });

test("unreadable invoice queues are preserved and rejected before use", () => {
    for (const entries of ["{broken", "null", "{}", "[null]", [invoice("a"), invoice("a")],
        [{ ...invoice("a"), data: { items: [{ quantity: -2 }] } }],
        [{ ...invoice("a"), total: "1000" }], [{ ...invoice("a"), error: {} }],
        [{ ...invoice("a"), receiptItems: [{}] }]]) {
        const storage = queue(entries);
        const original = storage.getItem();
        assert.throws(() => readInvoices(storage, "invoices"));
        assert.equal(storage.getItem(), original);
    }
});

test("sync completion preserves invoices added while the request was in flight", () => {
    const storage = queue([invoice("sent"), invoice("new")]);
    assert.deepEqual(updateInvoice(storage, "invoices", "sent", { ok: true }).map(entry => entry.id), ["new"]);
    assert.deepEqual(readInvoices(storage, "invoices").map(entry => entry.id), ["new"]);
});

test("definitive rejection keeps the original invoice and records a review message", () => {
    const original = invoice("rejected");
    const storage = queue([original, invoice("pending")]);
    const entries = updateInvoice(storage, "invoices", "rejected", { message: "Insufficient stock" });
    assert.deepEqual(entries[0], { ...original, error: "Insufficient stock" });
    assert.deepEqual(entries[1], invoice("pending"));
});

test("only definitively rejected invoices can be removed", () => {
    const storage = queue([{ ...invoice("rejected"), error: "Insufficient stock" }, invoice("pending")]);
    assert.equal(removeRejectedInvoice(storage, "invoices", "pending").length, 2);
    assert.deepEqual(removeRejectedInvoice(storage, "invoices", "rejected"), [invoice("pending")]);
});

test("storage failures propagate so checkout cannot claim an invoice was saved", () => {
    const storage = queue([invoice("a")]);
    storage.setItem = () => { throw new Error("Storage full"); };
    assert.throws(() => updateInvoice(storage, "invoices", "a", { ok: true }), /Storage full/);
});
