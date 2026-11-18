import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { createSampleSchema, seedSampleShop, captureSnapshot, restoreSnapshot, passwordHash, sampleOwner } from "../sample-shop.js";

test("the full public workspace seeds fictional records and restores every original shop relationship", async t => {
    const db = new PGlite();
    const restored = new PGlite();
    t.after(async () => { await db.close(); await restored.close(); });
    const directory = new URL("../supabase/migrations/", import.meta.url);
    const migrations = await Promise.all((await readdir(directory)).sort().map(name => readFile(new URL(name, directory), "utf8")));
    await createSampleSchema(db, migrations);
    await seedSampleShop(db);
    const employee = (await db.query("select public.be_employee('supabase',$1,null) as value", [sampleOwner])).rows[0].value;
    assert.equal(employee.role, "admin");
    const catalog = (await db.query("select public.be_read_product_units('supabase',$1,'pos_catalog','{}') as value", [sampleOwner])).rows[0].value;
    assert.equal(catalog.length, 5);
    const accounts = (await db.query("select * from shop.sample_accounts")).rows;
    assert.equal(accounts.length, 2);
    assert.equal(await passwordHash("shop123", accounts[0].salt), accounts[0].password_hash);
    const finance = (await db.query("select public.be_finance_read('supabase',$1,'finance_summary','{}') as value", [sampleOwner])).rows[0].value;
    assert.equal(finance.expenses_minor, 1500);
    assert.equal(finance.supplier_balance_minor, 12000);
    const snapshot = await captureSnapshot(db);
    assert.equal(snapshot.tables.sales.length, 9);
    assert.ok(snapshot.tables.employee_profiles.every(profile => profile.email.endsWith("@example.invalid")));

    await createSampleSchema(restored, migrations);
    await restoreSnapshot(restored, snapshot);
    const after = await captureSnapshot(restored);
    for (const table of Object.keys(snapshot.tables)) {
        const sortRows = rows => rows.map(row => JSON.stringify(row)).sort();
        assert.deepEqual(sortRows(after.tables[table]), sortRows(snapshot.tables[table]), table);
    }
});
