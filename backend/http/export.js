import { AccessError, ShopError } from "../ports.js";
import { queryOptions } from "../validation.js";
const columns = {
    sales: ["sale_id", "date", "employee_id", "employee", "payment", "total_usd_cents"],
    inventory: ["product_id", "sku", "name", "category", "quantity", "minimum_stock", "unit_cost_usd_cents", "unit_price_usd_cents", "status"],
    movements: ["movement_id", "product_id", "product", "employee_id", "employee", "type", "signed_quantity", "business_date",
        "recorded_at", "supplier", "unit_cost_usd_cents", "sale_id", "reference", "reason", "notes", "reversed_by"],
};
function csvCell(cell) {
    if (typeof cell === "number")
        return String(cell);
    const value = cell ?? "";
    // Text cells must remain inert when opened in spreadsheet software.
    const safe = /^[\s\u0000-\u001f]*[=+\-@]|^[\t\r\n]/.test(value) ? "'" + value : value;
    return '"' + safe.replaceAll('"', '""') + '"';
}
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
export async function exportCsv(params, readShop) {
    const query = queryOptions.parse(Object.fromEntries(params));
    const { kind } = query;
    if (!kind)
        return Response.json({ error: "Choose sales, inventory, or movements." }, { status: 400, headers });
    if ((params.has("from") && !query.from) || (params.has("to") && !query.to) ||
        (query.from && query.to && query.from > query.to)) {
        return Response.json({ error: "Choose a valid date range." }, { status: 400, headers });
    }
    try {
        const rows = [columns[kind], ...await readShop("export", query)];
        return new Response("\ufeff" + rows.map(row => row.map(csvCell).join(",")).join("\r\n") + "\r\n", {
            headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="barwaaqo-${kind}.csv"` },
        });
    }
    catch (error) {
        if (error instanceof AccessError)
            return Response.json({ error: error.message }, { status: error.status, headers });
        return Response.json({ error: error instanceof ShopError ? error.message : "The export could not be generated." }, { status: 500, headers });
    }
}
