import { today } from "./demo-data.js";

const payments = ["Cash", "ZAAD", "Bank Transfer"];
const id = prefix => prefix + "-" + crypto.randomUUID().slice(0, 8).toUpperCase();

function integer(value, minimum = 1, maximum = 999999999) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error("Enter a valid amount or quantity.");
    return value;
}

function method(value) {
    if (!payments.includes(value)) throw new Error("Choose a payment method.");
    return value;
}

function text(value) {
    if (typeof value !== "string" || !value.trim() || value.length > 180) throw new Error("Enter a description of up to 180 characters.");
    return value.trim();
}

function product(state, key) {
    const item = state.products.find(value => value.id === key);
    if (!item) throw new Error("Choose a product.");
    return item;
}

function purchase(state, key) {
    const order = state.purchases.find(value => value.id === key);
    if (!order) throw new Error("Choose a purchase order.");
    return order;
}

export const balance = order => order.total - order.payments.reduce((sum, payment) => sum + payment.amount, 0);

export function summary(state) {
    const day = today();
    const sales = state.sales.filter(sale => sale.date === day);
    const revenue = sales.reduce((sum, sale) => sum + sale.total, 0);
    const collected = sales.filter(sale => sale.payment !== "Credit").reduce((sum, sale) => sum + sale.total, 0)
        + state.repayments.filter(row => row.date === day).reduce((sum, row) => sum + row.amount, 0);
    const expenses = state.expenses.filter(row => row.date === day && !row.voided).reduce((sum, row) => sum + row.amount, 0);
    const supplierPayments = state.purchases.flatMap(order => order.payments).filter(row => row.date === day)
        .reduce((sum, row) => sum + row.amount, 0);
    return { revenue, collected, expenses, supplierPayments, net: collected - expenses - supplierPayments,
        low: state.products.filter(item => item.stock <= item.minimum).length,
        supplierBalance: state.purchases.filter(order => order.status !== "cancelled").reduce((sum, order) => sum + balance(order), 0) };
}

// Each operation works on a copy. A failed operation never changes the stored state.
export function transact(current, operation, data) {
    const state = structuredClone(current);
    switch (operation) {
        case "sale": {
            if (!Array.isArray(data.items) || !data.items.length) throw new Error("Add an item to the sale.");
            if (new Set(data.items.map(item => item.product)).size !== data.items.length) throw new Error("Include each product once.");
            const items = data.items.map(line => {
                const item = product(state, line.product);
                integer(line.quantity, 1, 1000000);
                if (item.stock < line.quantity) throw new Error("There is insufficient stock for " + item.name + ".");
                return { product: item.id, name: item.name, price: item.price, quantity: line.quantity };
            });
            if (data.payment === "Credit") {
                const customer = state.customers.find(value => value.id === data.customer);
                if (!customer) throw new Error("Choose a customer for credit.");
                customer.balance += items.reduce((sum, line) => sum + line.price * line.quantity, 0);
            } else method(data.payment);
            const total = items.reduce((sum, line) => sum + line.price * line.quantity, 0);
            for (const line of items) product(state, line.product).stock -= line.quantity;
            state.sales.unshift({ id: id("DEMO"), date: today(), payment: data.payment, customer: data.customer || "", items, total });
            break;
        }
        case "expense":
            state.expenses.unshift({ id: id("EXP"), date: today(), category: text(data.category),
                description: text(data.description), amount: integer(data.amount), payment: method(data.payment) });
            break;
        case "voidExpense": {
            const expense = state.expenses.find(value => value.id === data.id);
            if (!expense || expense.voided) throw new Error("This expense has already been voided.");
            expense.voided = true;
            break;
        }
        case "purchase": {
            if (!state.suppliers.some(value => value.id === data.supplier)) throw new Error("Choose a supplier.");
            if (!Array.isArray(data.items) || !data.items.length) throw new Error("Add an ordered product.");
            if (new Set(data.items.map(item => item.product)).size !== data.items.length) throw new Error("Include each product once.");
            const items = data.items.map(line => ({ product: product(state, line.product).id,
                name: product(state, line.product).name, quantity: integer(line.quantity, 1, 1000000), cost: integer(line.cost, 0) }));
            const total = items.reduce((sum, line) => sum + line.quantity * line.cost, 0);
            integer(total, 0, Number.MAX_SAFE_INTEGER);
            state.purchases.unshift({ id: id("PO"), date: today(), supplier: data.supplier, status: "ordered", items, total, payments: [] });
            break;
        }
        case "receive": {
            const order = purchase(state, data.id);
            if (order.status !== "ordered") throw new Error("This purchase has already been received or cancelled.");
            for (const line of order.items) product(state, line.product).stock += line.quantity;
            order.status = "received";
            break;
        }
        case "supplierPayment": {
            const order = purchase(state, data.id);
            if (order.status === "cancelled") throw new Error("This order was cancelled.");
            integer(data.amount);
            if (data.amount > balance(order)) throw new Error("The payment exceeds the outstanding order balance.");
            order.payments.push({ date: today(), amount: data.amount, method: method(data.payment) });
            break;
        }
        case "cancelPurchase": {
            const order = purchase(state, data.id);
            if (order.status !== "ordered" || order.payments.length) throw new Error("Only an unpaid, unreceived order can be cancelled.");
            order.status = "cancelled";
            break;
        }
        case "repayment": {
            const customer = state.customers.find(value => value.id === data.customer);
            if (!customer) throw new Error("Choose a customer.");
            integer(data.amount);
            if (data.amount > customer.balance) throw new Error("The payment exceeds the customer balance.");
            customer.balance -= data.amount;
            state.repayments.push({ id: id("PAY"), date: today(), amount: data.amount, payment: "ZAAD", customer: customer.id });
            break;
        }
        default: throw new Error("Choose a supported demo action.");
    }
    return state;
}
