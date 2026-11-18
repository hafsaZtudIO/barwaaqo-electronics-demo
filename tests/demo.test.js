import assert from "node:assert/strict";
import test from "node:test";
import { initialState, today } from "../backend/demo-data.js";
import { transact, summary, balance } from "../backend/demo-store.js";

test("a sale captures original prices and reduces stock without changing the previous state", () => {
    const before = initialState();
    const after = transact(before, "sale", { payment: "Cash", items: [{ product: "headphones", quantity: 2 }] });
    assert.equal(before.products[0].stock, 18);
    assert.equal(after.products[0].stock, 16);
    assert.equal(after.sales[0].total, 13000);
    assert.equal(after.sales[0].items[0].price, 6500);
    assert.equal(after.sales[0].date, today());
});

test("a multi-item sale with insufficient stock leaves every quantity and customer balance unchanged", () => {
    const state = initialState();
    const snapshot = structuredClone(state);
    assert.throws(() => transact(state, "sale", { payment: "Credit", customer: "customer-1",
        items: [{ product: "headphones", quantity: 1 }, { product: "charger", quantity: 100 }] }), /insufficient stock/);
    assert.deepEqual(state, snapshot);
    assert.throws(() => transact(state, "sale", { payment: "Cash", items: [
        { product: "mouse", quantity: 1 }, { product: "mouse", quantity: 1 },
    ] }), /each product once/);
});

test("credit checkout and repayments update the customer balance and collections separately", () => {
    let state = initialState();
    const previous = summary(state);
    assert.throws(() => transact(state, "sale", { payment: "Credit", items: [{ product: "mouse", quantity: 1 }] }), /Choose a customer/);
    state = transact(state, "sale", { payment: "Credit", customer: "customer-2", items: [{ product: "mouse", quantity: 1 }] });
    assert.equal(state.customers[1].balance, 1800);
    assert.equal(summary(state).collected, previous.collected);
    state = transact(state, "repayment", { customer: "customer-2", amount: 800 });
    assert.equal(state.customers[1].balance, 1000);
    assert.equal(summary(state).collected, previous.collected + 800);
    assert.throws(() => transact(state, "repayment", { customer: "customer-2", amount: 1001 }), /exceeds/);
});

test("orders change stock only when received and cannot be received twice", () => {
    let state = initialState();
    const before = state.products.find(item => item.id === "cable").stock;
    state = transact(state, "receive", { id: "PO-DEMO-01" });
    assert.equal(state.products.find(item => item.id === "cable").stock, before + 60);
    assert.throws(() => transact(state, "receive", { id: "PO-DEMO-01" }), /already/);
    assert.equal(state.products.find(item => item.id === "cable").stock, before + 60);
});

test("supplier payments allow partial settlement and reject excess payments", () => {
    let state = initialState();
    assert.equal(balance(state.purchases[0]), 12000);
    state = transact(state, "supplierPayment", { id: "PO-DEMO-01", amount: 2000, payment: "Cash" });
    assert.equal(balance(state.purchases[0]), 10000);
    assert.equal(summary(state).supplierBalance, 10000);
    assert.throws(() => transact(state, "supplierPayment", { id: "PO-DEMO-01", amount: 10001, payment: "Cash" }), /exceeds/);
    assert.throws(() => transact(state, "cancelPurchase", { id: "PO-DEMO-01" }), /unpaid/);
});

test("unpaid orders can be cancelled and excluded from outstanding balances", () => {
    let state = transact(initialState(), "purchase", { supplier: "supplier-1",
        items: [{ product: "mouse", quantity: 10, cost: 800 }] });
    const order = state.purchases[0];
    assert.equal(order.total, 8000);
    assert.equal(summary(state).supplierBalance, 20000);
    state = transact(state, "cancelPurchase", { id: order.id });
    assert.equal(summary(state).supplierBalance, 12000);
    assert.throws(() => transact(state, "receive", { id: order.id }), /already/);
    assert.throws(() => transact(state, "supplierPayment", { id: order.id, amount: 100, payment: "Cash" }), /cancelled/);
});

test("expenses and supplier payments reduce net collections and voids restore expense totals", () => {
    let state = initialState();
    const original = summary(state).net;
    state = transact(state, "expense", { category: "Electricity", description: "Sample power bill", amount: 2500, payment: "Cash" });
    assert.equal(summary(state).net, original - 2500);
    const expense = state.expenses[0];
    state = transact(state, "voidExpense", { id: expense.id });
    assert.equal(summary(state).net, original);
    assert.throws(() => transact(state, "voidExpense", { id: expense.id }), /already/);
    assert.throws(() => transact(state, "expense", { category: "Rent", description: "Test", amount: -1, payment: "Cash" }), /valid/);
});
