import { z } from "zod";
import { checkoutPayments, expenseCategories, outgoingPayments, payments, productUnits, reasons } from "./contracts.js";
const uuid = z.uuid();
const short = z.string().trim().max(180);
const notes = z.string().trim().max(2000);
const required = short.min(1, "Enter a value.");
const quantity = z.coerce.number().int().min(1).max(1_000_000);
const money = z.string().trim().regex(/^\d{1,7}(\.\d{1,2})?$/, "Enter an amount with up to two decimal places.")
    .transform((value) => {
    const [whole, cents = ""] = value.split(".");
    return Number(whole) * 100 + Number(cents.padEnd(2, "0"));
});
const optionalUuid = z.union([uuid, z.literal("")]).transform(value => value || null);
export const email = z.string().trim().pipe(z.email().max(254)).transform(value => value.toLowerCase());
export const employeeUsername = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9_.-]{2,39}$/, "Use 3–40 letters, numbers, dots, underscores, or hyphens. Start with a letter or number.");
export const employeeNumber = z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{0,29}$/, "Use up to 30 letters, numbers, or hyphens. Start with a letter or number.");
const image = z.union([z.literal(""), z.url({ protocol: /^https$/ }).max(1500)]);
const timezone = required.refine(value => {
    try {
        new Intl.DateTimeFormat("en", { timeZone: value });
        return true;
    }
    catch {
        return false;
    }
}, "Enter a valid IANA timezone.");
const fields = {
    record_expense: z.object({
        category: z.enum(expenseCategories), description: required,
        amount_minor: money.refine(value => value > 0, "Enter a positive amount."),
        payment: z.enum(outgoingPayments), occurred_on: z.iso.date(), reference: short, notes,
    }),
    void_expense: z.object({ id: uuid, reason: required }),
    create_purchase: z.object({
        supplier_id: uuid, ordered_on: z.iso.date(),
        due_on: z.union([z.iso.date(), z.literal("")]).transform(value => value || null),
        reference: short, notes,
        items: z.array(z.object({ product_id: uuid, quantity, cost_minor: money })).min(1).max(50)
            .refine(items => new Set(items.map(item => item.product_id)).size === items.length, "Include each product only once."),
    }).refine(order => !order.due_on || order.due_on >= order.ordered_on, {
        path: ["due_on"], message: "The due date must be on or after the order date.",
    }),
    receive_purchase: z.object({ id: uuid, occurred_on: z.iso.date() }),
    cancel_purchase: z.object({ id: uuid }),
    record_supplier_payment: z.object({
        id: uuid, amount_minor: money.refine(value => value > 0, "Enter a positive amount."),
        payment: z.enum(outgoingPayments), occurred_on: z.iso.date(), reference: short,
    }),
    save_product: z.object({
        unit: z.enum(productUnits).optional(),
        id: optionalUuid, sku: required.max(60).transform(value => value.toUpperCase()), barcode: short,
        name: required, category_id: uuid, brand: short, model: short, description: notes,
        supplier_id: optionalUuid, image_url: image, cost_minor: money, sale_minor: money,
        minimum_stock: z.coerce.number().int().min(0).max(1_000_000),
    }),
    archive_product: z.object({ id: uuid }),
    stock_in: z.object({
        product_id: uuid, quantity, supplier_id: optionalUuid,
        cost_minor: money, occurred_on: z.iso.date(), reference: short, notes,
    }),
    stock_out: z.object({ product_id: uuid, quantity, reason: z.enum(reasons), notes }),
    sale: z.object({
        payment: z.enum(checkoutPayments),
        customer_id: optionalUuid.optional(),
        payment_note: short.optional(),
        quoted_subtotal_minor: z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
        items: z.array(z.object({
            product_id: uuid, quantity,
            discount_minor: z.string().trim().pipe(z.union([z.literal("").transform(() => undefined), money.transform(value => value || undefined)])).optional(),
        })).min(1).max(50)
            .refine(items => new Set(items.map(item => item.product_id)).size === items.length, "Include each product only once.")
            .transform(items => items.sort((a, b) => a.product_id.localeCompare(b.product_id))),
    }).refine(sale => sale.payment !== "Credit" || sale.customer_id, {
        path: ["customer_id"], message: "Select a customer for this credit sale.",
    }),
    save_customer: z.object({ customer_id: optionalUuid, name: required, phone: short }),
    correct_sale: z.object({
        id: uuid, customer_id: optionalUuid, payment: z.enum(payments), payment_note: short,
        reason: required, revision: optionalUuid,
        items: z.array(z.object({ sku: required.max(60), quantity })).min(1).max(50),
    }),
    return_sale: z.object({
        id: uuid, revision: optionalUuid, reason: required,
        quoted_total_minor: z.coerce.number().int().nonnegative(),
        quoted_credit_minor: z.coerce.number().int().nonnegative(),
        items: z.array(z.object({ product_id: uuid, quantity, restock: z.boolean() }))
            .min(1, "Select at least one item to return.").max(50)
            .refine(items => new Set(items.map(item => item.product_id)).size === items.length, "Include each product only once."),
    }),
    record_customer_payment: z.object({ customer_id: uuid, amount_minor: money.refine(value => value > 0, "Enter a positive amount."), note: short }),
    save_supplier: z.object({ id: optionalUuid, name: required, phone: short, email: z.union([email, z.literal("")]), address: short, notes }),
    save_category: z.object({ id: optionalUuid, name: required }),
    invite_employee: z.object({ full_name: required, email }),
    update_employee: z.object({ id: uuid, role: z.enum(["admin", "employee"]), active: z.boolean() }),
    save_settings: z.object({ name: required, timezone }),
    reverse_movement: z.object({ id: uuid, notes: notes.min(1, "Enter the reason for this correction.") }),
};
export const employeeCommands = new Set(["stock_in", "stock_out", "sale", "save_customer", "record_customer_payment", "return_sale"]);
export function parseCommand(name, input) {
    return { name, data: fields[name].parse(input) };
}
export const queryOptions = z.object({
    kind: z.enum(["sales", "inventory", "movements"]).optional().catch(undefined),
    page: z.coerce.number().int().min(1).max(100_000).catch(1),
    q: z.string().trim().max(150).optional().catch(undefined),
    category: uuid.optional().catch(undefined),
    status: z.enum(["all", "in-stock", "low", "out", "archived"]).optional().catch(undefined),
    sort: z.enum(["name", "sku", "quantity", "newest"]).optional().catch(undefined),
    id: uuid.optional().catch(undefined),
    supplier: uuid.optional().catch(undefined),
    product: uuid.optional().catch(undefined),
    employee: uuid.optional().catch(undefined),
    type: z.enum(["in", "out", "sale", "reversal", "outgoing", "return"]).optional().catch(undefined),
    from: z.iso.date().optional().catch(undefined),
    to: z.iso.date().optional().catch(undefined),
});
