import { initialState, storageKey, money, today } from "../backend/demo-data.js";
import { transact, summary, balance } from "../backend/demo-store.js";

const content = document.querySelector("#content");
const pages = { dashboard: "Overview", pos: "Point of sale", inventory: "Inventory", sales: "Sales history",
    customers: "Customer credit", purchases: "Supplier purchases", expenses: "Expenses", closeout: "End of day" };
const escape = value => String(value ?? "").replace(/[&<>"']/g, character =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const date = value => new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(value));
const option = (value, label) => `<option value="${escape(value)}">${escape(label)}</option>`;
const methods = () => ["Cash", "ZAAD", "Bank Transfer"].map(value => option(value, value)).join("");
const badge = (label, tone = "") => `<span class="badge ${tone}">${escape(label)}</span>`;
const cart = new Map();
let storageWarning = "";
let state = load();
let toastTimer;

function load() {
    try {
        const saved = localStorage.getItem(storageKey);
        if (!saved) return initialState();
        const data = JSON.parse(saved);
        if (data.version !== 1 || !["products", "sales", "customers", "suppliers", "purchases", "expenses", "repayments"]
            .every(key => Array.isArray(data[key]))) throw new Error("Invalid saved workspace.");
        return data;
    } catch {
        storageWarning = "Saved records could not be opened. Reset the workspace to start again.";
        return initialState();
    }
}

function toast(message, error = false) {
    const element = document.querySelector("#toast");
    clearTimeout(toastTimer);
    element.textContent = message;
    element.classList.toggle("error", error);
    element.hidden = false;
    toastTimer = setTimeout(() => { element.hidden = true; }, 5500);
}

async function save(operation, data) {
    async function write() {
        const updated = transact(load(), operation, data);
        try { localStorage.setItem(storageKey, JSON.stringify(updated)); }
        catch { throw new Error("Your browser could not save these changes. Allow browser storage and try again."); }
        state = updated;
        storageWarning = "";
    }
    if (navigator.locks) await navigator.locks.request(storageKey, write);
    else await write();
}

function amount(value) {
    if (!/^\d{1,7}(\.\d{1,2})?$/.test(value)) throw new Error("Enter an amount with up to two decimal places.");
    const [whole, cents = ""] = value.split(".");
    return Number(whole) * 100 + Number(cents.padEnd(2, "0"));
}

function page() {
    const value = location.hash.slice(1);
    return Object.hasOwn(pages, value) ? value : "dashboard";
}

function heading(title, action = "") {
    return `<header class="page-heading"><h1>${title}</h1>${action}</header>`;
}

function panel(title, body, link = "") {
    return `<section class="panel"><div class="panel-head"><h2>${title}</h2>${link}</div>${body}</section>`;
}

function table(columns, rows, empty = "No records yet.") {
    if (!rows.length) return `<p class="empty">${empty}</p>`;
    return `<div class="table-scroll"><table><thead><tr>${columns.map(column => `<th scope="col">${column}</th>`).join("")}</tr></thead><tbody>${rows.map(row =>
        `<tr>${row.map(cell => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function stats(values) {
    return `<div class="stats">${values.map(([label, value], index) =>
        `<article class="stat ${index === 0 ? "featured" : ""}"><span>${label}</span><strong>${value}</strong></article>`).join("")}</div>`;
}

function productCell(product) {
    return `<div class="product-cell"><img src="assets/${escape(product.image)}" alt="" width="37" height="37"><div>${escape(product.name)}<small>${escape(product.sku)}</small></div></div>`;
}

function salesTable(sales) {
    return table(["Receipt", "Payment", "Amount", ""], sales.map(sale => [
        escape(sale.id.replace("DEMO-", "INV-")), badge(sale.payment, sale.payment === "Credit" ? "warn" : ""),
        money(sale.total), `<button type="button" class="inline-button" data-receipt="${escape(sale.id)}">Receipt ↗</button>`,
    ]), "No sales recorded yet.");
}

function dashboard() {
    const totals = summary(state);
    const days = Array.from({ length: 7 }, (_, index) => {
        const day = new Date(today());
        day.setUTCDate(day.getUTCDate() - 6 + index);
        const key = day.toISOString().slice(0, 10);
        return { label: day.toLocaleDateString("en", { weekday: "short", timeZone: "UTC" }),
            total: state.sales.filter(sale => sale.date === key).reduce((sum, sale) => sum + sale.total, 0) };
    });
    const max = Math.max(1, ...days.map(day => day.total));
    return heading("Overview",
        '<a class="button dark small" href="#pos">New sale ↗</a>')
        + stats([["Sales today", money(totals.revenue)], ["Units in stock", state.products.reduce((sum, item) => sum + item.stock, 0)],
            ["Low-stock products", totals.low], ["Supplier balances", money(totals.supplierBalance)]])
        + '<div class="two-col">'
        + panel("Sales this week", `<div class="chart">${days.map(day =>
            `<div class="chart-column"><div style="height:${Math.max(3, day.total / max * 100)}%" title="${day.label} · ${money(day.total)}"></div><span>${day.label}</span></div>`).join("")}</div>`)
        + panel("Time to restock", table(["Product", "On hand", "Minimum"], state.products.filter(item => item.stock <= item.minimum).map(item =>
            [productCell(item), badge(item.stock + " units", "warn"), item.minimum])),
            '<a href="#inventory">View inventory →</a>') + "</div>"
        + panel("Recent sales", salesTable(state.sales.slice(0, 5)), '<a href="#sales">View all sales →</a>');
}

function pos() {
    return heading("Point of sale")
        + '<div class="checkout-layout"><section><div class="product-grid">'
        + state.products.map(item => `<button type="button" class="product-card" data-add="${item.id}" ${item.stock ? "" : "disabled"}>
            <img src="assets/${item.image}" alt="" width="160" height="100"><strong>${escape(item.name)}</strong>
            <small>${item.stock} available · ${escape(item.sku)}</small><span>${money(item.price)}<i class="add-sign" aria-hidden="true">+</i></span>
          </button>`).join("") + '</div></section>'
        + panel("Current sale", `<div class="cart">${cart.size ? [...cart].map(([key, quantity]) => {
            const item = state.products.find(value => value.id === key);
            return `<div class="cart-line"><div>${escape(item.name)}<small>${money(item.price)} each</small></div>
                <div class="quantity-control"><button type="button" data-decrease="${key}" aria-label="Remove one ${escape(item.name)}">−</button>
                <span>${quantity}</span><button type="button" data-add="${key}" aria-label="Add one ${escape(item.name)}">+</button></div></div>`;
        }).join("") : '<p class="empty">Choose a product to start a sale.</p>'}
          <div class="cart-total"><span>Total</span><strong>${money([...cart].reduce((sum, [key, quantity]) => sum + state.products.find(value => value.id === key).price * quantity, 0))}</strong></div>
          <form id="sale-form">
            <label class="field">Payment method<select name="payment">${methods()}${option("Credit", "Customer credit")}</select></label>
            <label class="field">Customer<select name="customer"><option value="">Walk-in customer</option>${state.customers.map(customer => option(customer.id, customer.name.replace(/^Demo /, ""))).join("")}</select></label>
            <button type="submit" class="button dark" ${cart.size ? "" : "disabled"}>Complete sale ↗</button>
          </form></div>`) + "</div>";
}

function inventory() {
    return heading("Inventory",
        '<a href="#purchases" class="button dark small">Receive a delivery ↗</a>')
        + panel("Product catalog", '<div class="panel-body"><label class="field filter">Find a product<input id="inventory-search" type="search" placeholder="Search name, SKU, or category"></label></div>'
            + '<div id="inventory-table">' + inventoryTable(state.products) + "</div>");
}

function inventoryTable(products) {
    return table(["Product", "Category", "Unit price", "Available", "Stock status"], products.map(item => [
        productCell(item), escape(item.category), money(item.price), item.stock,
        item.stock <= item.minimum ? badge("Low stock", "warn") : badge("In stock"),
    ]), "No products match your search.");
}

function sales() {
    return heading("Sales history")
        + panel("Recorded sales", salesTable(state.sales));
}

function customers() {
    return heading("Customer credit")
        + panel("Customers", table(["Customer", "Outstanding", "Record a ZAAD repayment"], state.customers.map(customer => [
            escape(customer.name.replace(/^Demo /, "")), money(customer.balance),
            customer.balance ? `<form class="payment-form" data-repayment="${customer.id}"><label class="field">Amount (USD)<input name="amount" type="number" min="0.01" max="${customer.balance / 100}" step="0.01" required></label><button class="button outline small" type="submit">Record</button></form>` : badge("Settled"),
        ])));
}

function purchases() {
    const totals = summary(state);
    const orderCards = state.purchases.map(order => {
        const supplier = state.suppliers.find(value => value.id === order.supplier);
        const paid = order.total - balance(order);
        return `<article class="order-item"><header><h3>${escape(order.id.replace("PO-DEMO-", "PO-"))}</h3>${badge(order.status, order.status === "ordered" ? "warn" : "gray")}</header>
          <p><strong>${escape(supplier.name)}</strong> · ${date(order.date)}</p><p>${order.items.map(line => `${line.quantity} × ${escape(line.name)}`).join(" · ")}</p>
          <div class="order-amounts"><span>Order total<strong>${money(order.total)}</strong></span><span>Paid<strong>${money(paid)}</strong></span><span>Outstanding<strong>${order.status === "cancelled" ? "—" : money(balance(order))}</strong></span></div>
          <div class="form-actions">${order.status === "ordered" ? `<button class="button dark small" type="button" data-receive="${order.id}">Receive into stock</button>` : ""}
          ${order.status === "ordered" && !paid ? `<button type="button" class="inline-button" data-cancel-order="${order.id}">Cancel order</button>` : ""}</div>
          ${balance(order) > 0 && order.status !== "cancelled" ? `<form class="payment-form" data-supplier-payment="${order.id}">
            <label class="field">Amount paid (USD)<input name="amount" type="number" min="0.01" max="${Math.min(balance(order), 999999999) / 100}" step="0.01" required></label>
            <label class="field">Method<select name="payment">${methods()}</select></label><button class="button outline" type="submit">Record payment</button></form>` : ""}
          ${order.payments.length ? `<p style="margin-top:14px">${order.payments.map(payment => `${date(payment.date)} · ${money(payment.amount)} via ${escape(payment.method)}`).join("<br>")}</p>` : ""}
        </article>`;
    }).join("");
    return heading("Supplier purchases")
        + stats([["Supplier balances", money(totals.supplierBalance)],
            ["Purchase orders", state.purchases.length],
            ["Awaiting delivery", state.purchases.filter(order => order.status === "ordered").length],
            ["Paid today", money(totals.supplierPayments)]])
        + '<div class="two-col">' + panel("New purchase order", `<div class="panel-body"><form id="purchase-form">
          <div class="form-grid">
            <label class="field wide">Supplier<select name="supplier">${state.suppliers.map(value => option(value.id, value.name)).join("")}</select></label>
            <label class="field wide">Product<select name="product">${state.products.map(value => option(value.id, value.name)).join("")}</select></label>
            <label class="field">Quantity<input name="quantity" type="number" min="1" max="1000000" value="10" required></label>
            <label class="field">Unit cost (USD)<input name="cost" type="number" min="0" max="9999999.99" step="0.01" value="36.00" required></label>
          </div><div class="form-actions"><button type="submit" class="button dark">Create order ↗</button></div>
        </form></div>`) + `<section><div class="order-list">${orderCards || '<p class="empty">No purchase orders yet.</p>'}</div></section></div>`;
}

function expenses() {
    const totals = summary(state);
    return heading("Expenses")
        + stats([["Expenses today", money(totals.expenses)],
            ["Recorded expenses", state.expenses.filter(row => !row.voided).length],
            ["Collections today", money(totals.collected)],
            ["Net collections", money(totals.net)]])
        + panel("Record an expense", `<div class="panel-body"><form id="expense-form"><div class="form-grid">
          <label class="field">Category<select name="category">${["Rent", "Electricity", "Transport", "Internet", "Salaries", "Maintenance", "Other"].map(value => option(value, value)).join("")}</select></label>
          <label class="field">Description<input name="description" maxlength="180" placeholder="Delivery transport" required></label>
          <label class="field">Amount (USD)<input name="amount" type="number" min="0.01" max="9999999.99" step="0.01" required></label>
          <label class="field">Paid using<select name="payment">${methods()}</select></label>
        </div><div class="form-actions"><button type="submit" class="button dark">Record expense ↗</button></div></form></div>`)
        + panel("Expense history", table(["Description", "Category", "Date", "Amount", "Method", ""], state.expenses.map(row => [
            escape(row.description), escape(row.category), date(row.date), money(row.amount), escape(row.payment),
            row.voided ? badge("Voided", "gray") : `<button type="button" data-void="${row.id}" class="inline-button">Void</button>`,
        ])));
}

function closeout() {
    const totals = summary(state);
    const rows = ["Cash", "ZAAD", "Bank Transfer"].map(payment => {
        const collections = state.sales.filter(row => row.date === today() && row.payment === payment).reduce((sum, row) => sum + row.total, 0)
            + state.repayments.filter(row => row.date === today() && row.payment === payment).reduce((sum, row) => sum + row.amount, 0);
        const expenses = state.expenses.filter(row => row.date === today() && !row.voided && row.payment === payment).reduce((sum, row) => sum + row.amount, 0);
        const suppliers = state.purchases.flatMap(order => order.payments).filter(row => row.date === today() && row.method === payment).reduce((sum, row) => sum + row.amount, 0);
        return [payment, money(collections), money(expenses), money(suppliers), `<strong>${money(collections - expenses - suppliers)}</strong>`];
    });
    return heading("End of day")
        + stats([["Net collections", money(totals.net)],
            ["Money collected", money(totals.collected)],
            ["Expenses paid", money(totals.expenses)],
            ["Suppliers paid", money(totals.supplierPayments)]])
        + panel("Payment reconciliation", table(["Method", "Collected", "Expenses", "Supplier payments", "Net"], rows));
}

function render() {
    const selected = page();
    document.title = pages[selected] + " · Barwaaqo Electronics";
    document.querySelector("#breadcrumb").textContent = pages[selected];
    document.querySelectorAll("[data-page]").forEach(link => {
        const active = link.dataset.page === selected;
        link.classList.toggle("active", active);
        if (active) link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
    });
    const views = { dashboard, pos, inventory, sales, customers, purchases, expenses, closeout };
    content.innerHTML = (storageWarning ? `<p class="notice" role="alert">${escape(storageWarning)}</p>` : "") + views[selected]();
}

function receipt(key) {
    const sale = state.sales.find(value => value.id === key);
    if (!sale) return;
    document.querySelector("#receipt-content").innerHTML = `<div class="receipt-heading"><img class="brand-logo" src="assets/logo.png" alt="Barwaaqo Electronics logo" width="44" height="44"><p>BARWAAQO ELECTRONICS</p><h2>Sales receipt</h2>
      <p>${escape(sale.id.replace("DEMO-", "INV-"))} · ${date(sale.date)}<br>Payment method · ${escape(sale.payment)}</p></div>`
      + table(["Product", "Qty", "Total"], sale.items.map(item => [escape(item.name), item.quantity, money(item.quantity * item.price)]))
      + `<div class="receipt-total"><span>Total</span><strong>${money(sale.total)}</strong></div><p>Sample data · Payments are simulated.</p>`;
    document.querySelector("#receipt-dialog").showModal();
}

content.addEventListener("click", async event => {
    const target = event.target.closest("button");
    if (!target) return;
    try {
        if (target.dataset.add) {
            const item = state.products.find(value => value.id === target.dataset.add);
            const quantity = (cart.get(item.id) || 0) + 1;
            if (quantity > item.stock) throw new Error("All available units are already in the cart.");
            cart.set(item.id, quantity);
            render();
        } else if (target.dataset.decrease) {
            const key = target.dataset.decrease;
            const quantity = cart.get(key) - 1;
            if (quantity) cart.set(key, quantity);
            else cart.delete(key);
            render();
        } else if (target.dataset.receipt) receipt(target.dataset.receipt);
        else {
            const operation = target.dataset.receive ? "receive" : target.dataset.cancelOrder ? "cancelPurchase" : target.dataset.void ? "voidExpense" : null;
            if (!operation) return;
            target.disabled = true;
            await save(operation, { id: target.dataset.receive || target.dataset.cancelOrder || target.dataset.void });
            render();
            toast(operation === "receive" ? "Delivery received. Stock updated." : operation === "voidExpense" ? "Expense voided." : "Purchase order cancelled.");
        }
    } catch (error) {
        target.disabled = false;
        toast(error.message, true);
    }
});

content.addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.target;
    const button = form.querySelector('button[type="submit"]');
    if (button.disabled) return;
    button.disabled = true;
    try {
        const data = Object.fromEntries(new FormData(form));
        if (form.id === "sale-form") {
            await save("sale", { ...data, items: [...cart].map(([product, quantity]) => ({ product, quantity })) });
            cart.clear();
            render();
            receipt(state.sales[0].id);
            toast("Sale recorded and stock updated.");
        } else {
            let operation;
            if (form.id === "expense-form") {
                operation = "expense";
                data.amount = amount(data.amount);
            } else if (form.id === "purchase-form") {
                operation = "purchase";
                data.items = [{ product: data.product, quantity: Number(data.quantity), cost: amount(data.cost) }];
            } else if (form.dataset.supplierPayment) {
                operation = "supplierPayment";
                data.id = form.dataset.supplierPayment;
                data.amount = amount(data.amount);
            } else if (form.dataset.repayment) {
                operation = "repayment";
                data.customer = form.dataset.repayment;
                data.amount = amount(data.amount);
            }
            await save(operation, data);
            render();
            toast(operation === "purchase" ? "Purchase order created." : operation === "expense" ? "Expense recorded." : "Payment recorded.");
        }
    } catch (error) {
        button.disabled = false;
        toast(error.message, true);
    }
});

content.addEventListener("input", event => {
    if (event.target.id === "inventory-search") {
        const value = event.target.value.toLowerCase().trim();
        document.querySelector("#inventory-table").innerHTML = inventoryTable(state.products.filter(item =>
            (item.name + " " + item.sku + " " + item.category).toLowerCase().includes(value)));
    }
});

content.addEventListener("change", event => {
    if (event.target.matches('#purchase-form select[name="product"]')) {
        const item = state.products.find(value => value.id === event.target.value);
        document.querySelector('#purchase-form input[name="cost"]').value = (item.cost / 100).toFixed(2);
    }
});

document.querySelector("#reset").addEventListener("click", async () => {
    if (!confirm("Reset this workspace to its starting sample records?")) return;
    try {
        const reset = async () => localStorage.setItem(storageKey, JSON.stringify(initialState()));
        if (navigator.locks) await navigator.locks.request(storageKey, reset);
        else await reset();
        storageWarning = "";
        state = load();
        cart.clear();
        render();
        toast("Workspace reset.");
    } catch { toast("Your browser could not reset the workspace.", true); }
});
document.querySelector("#close-receipt").addEventListener("click", () => document.querySelector("#receipt-dialog").close());
document.querySelector("#print-receipt").addEventListener("click", () => window.print());
window.addEventListener("hashchange", () => { render(); content.focus(); });
window.addEventListener("storage", event => {
    if (event.key === storageKey) { state = load(); render(); }
});
document.querySelector("#today").textContent = date(today());
render();
