import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const key = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("sales history filters, pagination, and employee access", async t => {
    const db = new PGlite();
    t.after(() => db.close());
    await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
    const migrations = new URL("../supabase/migrations/", import.meta.url);
    for (const name of (await readdir(migrations)).sort())
        await db.exec(await readFile(new URL(name, migrations), "utf8"));
    const scalar = async (sql, values = []) => (await db.query(sql, values)).rows[0]?.value;
    const history = (subject, options = {}) => scalar(
        "select public.be_sales_history('supabase', $1, $2::jsonb) as value", [subject, options]);
    const ids = result => result.rows.map(row => row.id);
    const [owner, cashier, other, inactive] = [1, 2, 3, 4].map(key);
    for (const [id, subject, role, active] of [
        [owner, "owner", "admin", true], [cashier, "cashier", "employee", true],
        [other, "other", "employee", true], [inactive, "inactive", "employee", false],
    ]) {
        await db.query("insert into shop.employee_profiles(id,full_name,email,role,active) values ($1,$2,$3,$4,$5)",
            [id, `Employee ${subject}`, `${subject}@example.test`, role, active]);
        await db.query("insert into shop.employee_identities(provider,subject,employee_id) values ('supabase',$1,$2)", [subject, id]);
    }
    const [amina, bilan, literal] = [11, 12, 13].map(key);
    for (const [id, name] of [[amina, "Amina Axmed"], [bilan, "Bilan Ali"], [literal, "Literal _100%"]])
        await db.query("insert into shop.customers(id,name) values ($1,$2)", [id, name]);
    const category = await scalar("select id as value from shop.categories limit 1");
    const [firstProduct, secondProduct] = [21, 22].map(key);
    for (const [id, sku] of [[firstProduct, "FIRST"], [secondProduct, "SECOND"]])
        await db.query("insert into shop.products(id,sku,name,category_id,cost_minor,sale_minor,minimum_stock) values ($1,$2,$2,$3,10,1000,1)", [id, sku, category]);
    async function sale(id, employee, customer, payment, total, date, note, lines = [[firstProduct, 2]]) {
        await db.query("insert into shop.sales(id,employee_id,customer_id,payment,total_minor,created_at,payment_note) values ($1,$2,$3,$4,$5,$6,$7)",
            [id, employee, customer, payment, total, date, note]);
        for (const [product, quantity] of lines)
            await db.query("insert into shop.sale_items(sale_id,product_id,product_name,sku,quantity,unit_minor,cost_minor) values ($1,$2,'Product','SKU',$3,1000,10)", [id, product, quantity]);
    }
    async function returned(id, saleId, lines) {
        await db.query("insert into shop.sale_returns(id,sale_id,employee_id,reason,refund_method) values ($1,$2,$3,'Sample return','ZAAD')", [id, saleId, owner]);
        for (const [product, quantity] of lines)
            await db.query("insert into shop.sale_return_items(return_id,sale_id,product_id,quantity,restocked,amount_minor) values ($1,$2,$3,$4,false,0)", [id, saleId, product, quantity]);
    }
    const [s1, s2, s3, s4, s5] = [101, 102, 103, 104, 105].map(key);
    await sale(s1, cashier, amina, "ZAAD", 12345, "2026-11-20T20:59:59Z", "precise transfer _% reference");
    await sale(s2, cashier, bilan, "Credit", 2109, "2026-11-20T21:00:00Z", "precise credit", [[firstProduct, 2], [secondProduct, 1]]);
    await sale(s3, other, amina, "Cash", 1000, "2026-11-21T20:59:59Z", "precise cash", [[firstProduct, 2], [secondProduct, 1]]);
    await sale(s4, owner, null, "ZAAD", 500, "2026-11-21T21:00:00Z", "Walk-in receipt");
    await sale(s5, inactive, literal, "Other", 705, "2026-11-19T08:00:00Z", "Legacy employee receipt");
    await returned(key(201), s2, [[firstProduct, 2]]);
    await returned(key(202), s3, [[firstProduct, 1]]);
    await returned(key(203), s3, [[firstProduct, 1], [secondProduct, 1]]);

    await t.test("RPC privileges and active identities protect receipt data", async () => {
        for (const role of ["anon", "authenticated"]) {
            await db.exec(`set role ${role}`);
            try { await assert.rejects(() => history("owner"), { code: "42501" }); }
            finally { await db.exec("reset role"); }
        }
        await db.exec("set role service_role");
        try {
            await assert.rejects(() => db.query("select * from shop.sales"), { code: "42501" });
            assert.equal((await history("owner")).total, 5);
            await assert.rejects(() => history("outsider"), { code: "42501" });
            await assert.rejects(() => history("inactive"), { code: "42501" });
            const own = await history("cashier", { employee: other });
            assert.deepEqual(ids(own), [s2, s1]);
            assert.equal(own.summary.total_minor, 14454);
            assert.deepEqual(own.employee_options, []);
            const admin = await history("owner");
            assert.ok(admin.employee_options.some(option => option.id === inactive));
            assert.ok(admin.employee_options.every(option => Object.keys(option).sort().join(",") === "full_name,id"));
        } finally { await db.exec("reset role"); }
        await db.query("update shop.employee_profiles set active=false where id=$1", [cashier]);
        await assert.rejects(() => history("cashier"), { code: "42501" });
        await db.query("update shop.employee_profiles set active=true where id=$1", [cashier]);
    });

    await t.test("literal searches combine with customer, payment, employee, and product filters", async () => {
        assert.deepEqual(ids(await history("owner", { q: "aMiNa" })), [s3, s1]);
        assert.deepEqual(ids(await history("owner", { q: "walk-IN" })), [s4]);
        assert.deepEqual(ids(await history("owner", { q: s2.slice(-8) })), [s2]);
        assert.deepEqual(ids(await history("owner", { q: "_%" })), [s1]);
        assert.deepEqual(ids(await history("owner", { q: "%" })), [s1, s5]);
        assert.deepEqual(ids(await history("owner", { q: "precise", customer: amina, employee: cashier, payment: "ZAAD", product: firstProduct })), [s1]);
        assert.deepEqual(ids(await history("owner", { product: secondProduct })), [s3, s2]);
        assert.deepEqual(ids(await history("owner", { customer: bilan, payment: "Credit" })), [s2]);
        assert.equal((await history("owner", { q: "' or true --" })).total, 0);
        assert.equal((await history("cashier", { customer: literal })).total, 0);
    });

    await t.test("return statuses count every original line across repeated partial returns", async () => {
        assert.deepEqual(ids(await history("owner", { sale_status: "part-returned" })), [s2]);
        assert.deepEqual(ids(await history("owner", { sale_status: "returned" })), [s3]);
        assert.deepEqual(ids(await history("owner", { sale_status: "completed" })), [s4, s1, s5]);
        const statuses = new Map((await history("owner")).rows.map(row => [row.id, row.sale_status]));
        assert.equal(statuses.get(s2), "part-returned");
        assert.equal(statuses.get(s3), "returned");
        const exact = await history("owner", { q: "precise" });
        assert.deepEqual(exact.summary, { sales_count: 3, total_minor: 15454 });
    });

    await t.test("date filters use inclusive shop dates and exclusive next-day midnight", async () => {
        assert.deepEqual(ids(await history("owner", { from: "2026-11-21", to: "2026-11-21" })), [s3, s2]);
        assert.deepEqual(ids(await history("owner", { from: "2026-11-22", to: "2026-11-22" })), [s4]);
        await assert.rejects(() => history("owner", { from: "2026-11-22", to: "2026-11-21" }), /From must be on or before To/);
        await assert.rejects(() => history("owner", { from: "2026-02-30" }), /valid sales dates/);
        await assert.rejects(() => history("owner", { to: "infinity" }), /valid sales dates/);
    });

    await t.test("all sort modes have deterministic receipt order", async () => {
        assert.deepEqual(ids(await history("owner", { sales_sort: "oldest" })), [s5, s1, s2, s3, s4]);
        assert.deepEqual(ids(await history("owner", { sales_sort: "total-high" })), [s1, s2, s3, s5, s4]);
        assert.deepEqual(ids(await history("owner", { sales_sort: "total-low" })), [s4, s5, s3, s2, s1]);
        assert.deepEqual(ids(await history("owner", { sales_sort: "customer" })), [s1, s3, s2, s5, s4]);
    });

    for (let n = 0; n < 57; n++)
        await sale(key(1000 + n), owner, null, "ZAAD", 101, "2026-11-01T08:00:00Z", "PAGE TEST");
    await t.test("page sizes clamp out-of-range pages and totals cover the complete filtered result", async () => {
        const first = await history("owner", { q: "PAGE TEST", page_size: 50, page: 1 });
        const last = await history("owner", { q: "PAGE TEST", page_size: 50, page: 999 });
        assert.equal(first.page_size, 50);
        assert.equal(first.page, 1);
        assert.equal(first.rows.length, 50);
        assert.equal(last.page, 2);
        assert.equal(last.rows.length, 7);
        assert.equal(first.total, 57);
        assert.deepEqual(first.summary, { sales_count: 57, total_minor: 5757 });
        assert.deepEqual(first.summary, last.summary);
        assert.equal(new Set([...ids(first), ...ids(last)]).size, 57);
        assert.deepEqual(ids(first).slice(0, 2), [key(1000), key(1001)]);
        assert.equal((await history("owner", { q: "PAGE TEST", page_size: 100 })).rows.length, 57);
        const defaults = await history("owner", { q: "PAGE TEST", page_size: "1;drop", sales_sort: "nonsense", page: "999999999999999999999" });
        assert.equal(defaults.page_size, 25);
        assert.equal(defaults.page, 1);
        const empty = await history("owner", { q: "no matching receipt", page: 99 });
        assert.deepEqual(empty.rows, []);
        assert.equal(empty.page, 1);
        assert.deepEqual(empty.summary, { sales_count: 0, total_minor: 0 });
        await assert.rejects(() => history("owner", { payment: "unsupported" }), /valid payment/);
        await assert.rejects(() => history("owner", { customer: "not-a-uuid" }), /valid customer/);
        await assert.rejects(() => history("owner", { sale_status: "Cancelled" }), /valid sales return status/);
    });
});
