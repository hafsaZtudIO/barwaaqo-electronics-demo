import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("PostgreSQL shop contract", async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
  const migrations = new URL("../supabase/migrations/", import.meta.url);
  for (const file of (await readdir(migrations)).sort()) {
    await db.exec(await readFile(new URL(file, migrations), "utf8"));
  }

  const scalar = async (sql, params = []) => (await db.query(sql, params)).rows[0]?.value;
  const identity = (subject, email = null) => scalar("select public.be_employee('supabase', $1, $2) as value", [subject, email]);
  const read = (subject, query, options = {}) => scalar("select public.be_read('supabase', $1, $2, $3::jsonb) as value", [subject, query, options]);
  const write = (subject, command, data, id = randomUUID()) => scalar(
    "select public.be_write('supabase', $1, $2, $3::jsonb, $4) as value", [subject, command, data, id]
  );
  const counter = (subject, query, options = {}) => scalar("select public.be_counter_read('supabase', $1, $2, $3::jsonb) as value", [subject, query, options]);
  const register = (subject, newSubject) => scalar(
    "select public.be_register_employee('supabase', $1, 'new@example.test', 'New Employee', $2) as value", [subject, newSubject]
  );
  const checkout = (subject, data, id) => scalar("select public.be_checkout_sale('supabase', $1, $2::jsonb, $3) as value", [subject, data, id]);
  const today = await scalar("select (now() at time zone 'Africa/Nairobi')::date::text as value");
  const category = await scalar("select id as value from shop.categories where name = 'Laptops'");
  const productInput = (sku, price) => ({
    id: null, sku, barcode: "", name: `Laptop ${sku}`, category_id: category, brand: "", model: "",
    description: "", supplier_id: null, image_url: "", cost_minor: 2000, sale_minor: price, minimum_stock: 2,
  });

  await db.exec("insert into shop.employee_profiles(full_name,email,role) values ('Owner','owner@example.test','admin')");
  await db.exec(`insert into shop.employee_identities (provider,subject,employee_id)
    select 'supabase','owner',id from shop.employee_profiles where email='owner@example.test'`);

  await t.test("restricted database entry points and active employee lookup", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await assert.rejects(() => read("owner", "dashboard"), { code: "42501" });
      await assert.rejects(() => counter("owner", "pos_catalog"), { code: "42501" });
      await assert.rejects(() => register("owner", "new"), { code: "42501" });
      await assert.rejects(() => checkout("owner", {}, randomUUID()), { code: "42501" });
      await assert.rejects(() => identity("owner"), { code: "42501" });
      await assert.rejects(() => write("owner", "save_product", productInput("NO", 3000)), { code: "42501" });
      await assert.rejects(() => db.query("select * from shop.products"), { code: "42501" });
      await db.exec("reset role");
    }
    await db.exec("set role service_role");
    await assert.rejects(() => db.query("select * from shop.products"), { code: "42501" });
    assert.equal(await identity("outsider", "outsider@example.test"), null);
    await assert.rejects(() => read("outsider", "dashboard"), { code: "42501" });
    assert.equal((await identity("owner")).role, "admin");
    assert.equal((await read("owner", "dashboard")).product_types, 0);
  });

  const invite = email => write("owner", "invite_employee", { full_name: email.split("@")[0], email });
  const cashier = await invite("cashier@example.test");
  await invite("other@example.test");

  await t.test("verified first binding and employee restrictions", async () => {
    assert.equal(await identity("cashier"), null);
    assert.equal((await identity("cashier", "cashier@example.test")).id, cashier.id);
    assert.equal(await identity("impostor", "cashier@example.test"), null);
    await identity("other", "other@example.test");
    await assert.rejects(() => write("cashier", "save_product", productInput("NO", 4000)), { code: "42501" });
    await assert.rejects(() => read("cashier", "reports"), { code: "42501" });
    await assert.rejects(() => read("cashier", "export", { kind: "inventory" }), { code: "42501" });
    const owner = await identity("owner");
    await assert.rejects(() => write("owner", "update_employee", { id: owner.id, role: "employee", active: false }), /another administrator/);
  });

  await t.test("direct provisioning binds only the approved Auth subject and is idempotent", async () => {
    await assert.rejects(() => register("cashier", "new"), { code: "42501" });
    const id = await register("owner", "new");
    assert.equal(await register("owner", "new"), id);
    await assert.rejects(() => register("owner", "different"), /already belongs/);
    assert.equal(await identity("different", "new@example.test"), null);
    assert.equal((await identity("new")).role, "employee");
    const audit = (await read("owner", "settings")).audit.rows;
    assert.equal(audit.filter(row => row.action === "create_employee_account" && row.target_id === id).length, 1);
  });

  const first = await write("owner", "save_product", { ...productInput("A", 5500), barcode: "12345678" });
  const second = await write("owner", "save_product", productInput("B", 7500));
  const [available, unavailable] = [first.id, second.id].sort();
  const stockIn = product_id => ({ product_id, quantity: 10, supplier_id: null, cost_minor: 2100, occurred_on: today, reference: "PO-1", notes: "" });
  const stockOut = (product_id, quantity) => ({ product_id, quantity, reason: "Other", notes: "" });
  const purchase = (product_id, quantity) => ({ product_id, quantity });
  const qty = async id => (await read("owner", "product", { id })).quantity;
  let stockIssue;

  await t.test("ledger-first inventory, duplicate receipt, and insufficient stock", async () => {
    assert.equal(await qty(available), 0);
    assert.equal((await read("owner", "products", { status: "low" })).total, 2);
    assert.equal((await read("cashier", "product", { id: available })).cost_minor, undefined);
    const key = randomUUID();
    const receipt = await write("cashier", "stock_in", stockIn(available), key);
    assert.deepEqual(await write("cashier", "stock_in", stockIn(available), key), receipt);
    await assert.rejects(() => write("cashier", "stock_in", { ...stockIn(available), quantity: 11 }, key), /already used/);
    assert.equal(await qty(available), 10);
    await assert.rejects(() => write("cashier", "stock_out", stockOut(available, 11)), /insufficient stock/);
    assert.equal(await qty(available), 10);
    stockIssue = await write("cashier", "stock_out", stockOut(available, 2));
    assert.equal(await qty(available), 8);
    assert.equal((await read("other", "movements")).total, 0);
    assert.equal((await read("cashier", "movements")).rows[0].cost_minor, undefined);
  });

  await t.test("multi-item sale rolls back on failure and replays exactly once", async () => {
    const key = randomUUID();
    const sale = { payment: "Cash", items: [purchase(available, 1), purchase(unavailable, 1)] };
    await assert.rejects(() => write("cashier", "sale", sale, key), /insufficient stock/);
    assert.equal(await qty(available), 8);
    assert.equal((await read("owner", "sales")).total, 0);
    await write("cashier", "stock_in", stockIn(unavailable));
    const result = await write("cashier", "sale", sale, key);
    assert.deepEqual(await write("cashier", "sale", sale, key), result);
    assert.equal(await qty(available), 7);
    assert.equal(await qty(unavailable), 9);
    assert.equal((await read("owner", "sales")).total, 1);
    assert.equal((await read("owner", "movements", { type: "sale" })).total, 2);
    assert.equal(await read("other", "receipt", { id: result.id }), null);
    const receipt = await read("cashier", "receipt", { id: result.id });
    assert.equal(receipt.sale.total_minor, 13000);
    assert.deepEqual(receipt.items.map(item => item.unit_minor), [5500, 7500]);
    assert.equal(receipt.items[0].cost_minor, undefined);
    assert.equal((await read("owner", "reports")).cost_of_goods_minor, 4000);
    assert.equal((await read("owner", "dashboard")).revenue_minor, 13000);
    assert.equal((await read("other", "dashboard")).revenue_minor, 0);
    const summary = { day: today, methods: [{ payment: "Cash", sales: 1, total_minor: 13000 }] };
    assert.deepEqual(await counter("owner", "closeout"), summary);
    assert.deepEqual(await counter("cashier", "closeout", { from: today }), summary);
    assert.deepEqual((await counter("other", "closeout")).methods, []);
    const counterProduct = (await counter("cashier", "pos_catalog")).find(product => product.id === first.id);
    assert.equal(counterProduct.barcode, "12345678");
    assert.equal(counterProduct.cost_minor, undefined);
    assert.deepEqual((await read("owner", "export", { kind: "sales", from: today, to: today }))[0].slice(4), ["Cash", 13000]);
    assert.equal((await read("owner", "export", { kind: "movements", type: "sale" })).length, 2);
    assert.equal((await read("owner", "export", { kind: "inventory" })).length, 2);
  });

  await t.test("reversals, deactivation, audit, and retained history", async () => {
    const correction = await write("owner", "reverse_movement", { id: stockIssue.id, notes: "Wrong reason" });
    assert.equal(await qty(available), 9);
    await assert.rejects(() => write("owner", "reverse_movement", { id: stockIssue.id, notes: "Repeated" }), /already been reversed/);
    const movements = await read("owner", "movements");
    assert.equal(movements.rows.find(row => row.id === stockIssue.id).reversed_by, correction.id);
    await write("owner", "update_employee", { id: cashier.id, role: "employee", active: false });
    assert.equal(await identity("cashier", "cashier@example.test"), null);
    await assert.rejects(() => read("cashier", "dashboard"), { code: "42501" });
    await assert.rejects(() => write("cashier", "stock_in", stockIn(available)), { code: "42501" });
    assert.equal((await read("owner", "sales")).rows[0].employee_id, cashier.id);
    assert.ok((await read("owner", "settings")).audit.rows.some(row => row.action === "update_employee" && row.target_id === cashier.id));
  });

  await t.test("checkout rejects stale prices and excessive discounts and records the net amount once", async () => {
    const key = randomUUID();
    const sale = { payment: "EVC Plus", items: [purchase(first.id, 1)], quoted_subtotal_minor: 5500, discount_minor: 500 };
    const before = await qty(first.id);
    await assert.rejects(() => checkout("other", { ...sale, quoted_subtotal_minor: 5000 }, key), /Prices changed/);
    await assert.rejects(() => checkout("other", { ...sale, discount_minor: 5501 }, key), /Discount cannot exceed/);
    assert.equal(await qty(first.id), before);
    const result = await checkout("other", sale, key);
    assert.deepEqual(await checkout("other", sale, key), result);
    assert.equal(await qty(first.id), before - 1);
    const receipt = await read("other", "receipt", { id: result.id });
    assert.equal(receipt.sale.total_minor, 5000);
    assert.equal(receipt.sale.discount_minor, 500);
    assert.equal(receipt.items[0].unit_minor, 5500);
    assert.equal((await counter("other", "closeout")).methods[0].total_minor, 5000);

    const cash = { ...sale, payment: "Cash", payment_note: "Counter 1" };
    const cashKey = randomUUID();
    await assert.rejects(() => checkout("other", cash, cashKey), /Cash received must cover/);
    await assert.rejects(() => checkout("other", { ...cash, cash_received_minor: 4999 }, cashKey), /Cash received must cover/);
    await assert.rejects(() => checkout("other", { ...sale, cash_received_minor: 6000 }, cashKey), /only available for cash/);
    assert.equal(await qty(first.id), before - 1);
    const cashSale = await checkout("other", { ...cash, cash_received_minor: 6000 }, cashKey);
    const cashReceipt = await read("other", "receipt", { id: cashSale.id });
    assert.equal(cashReceipt.sale.cash_received_minor - cashReceipt.sale.total_minor, 1000);
    assert.equal(cashReceipt.sale.payment_note, "Counter 1");
    assert.equal((await counter("other", "closeout")).methods.find(row => row.payment === "Cash").total_minor, 5000);
  });

  await t.test("customer credit checkout and repayments are atomic and idempotent", async () => {
    const customerWrite = (command, data, key = randomUUID(), subject = "other") =>
      scalar("select public.be_customer_write('supabase', $1, $2, $3::jsonb, $4) as value", [subject, command, data, key]);
    const customerRead = (query, options) =>
      scalar("select public.be_customers('supabase', 'other', $1, $2::jsonb) as value", [query, options]);
    const customer = await customerWrite("save_customer", { name: "Test Buyer", phone: "5550100" });
    const credit = { payment: "Credit", items: [purchase(available, 1)] };
    const before = await qty(available);
    await assert.rejects(() => customerWrite("sale", credit), /Select a customer/);
    await assert.rejects(() => customerWrite("sale", { ...credit, payment: "Cash" }), /Choose ZAAD or Credit/);
    assert.equal(await qty(available), before);
    const key = randomUUID();
    let sale;
    await db.exec("set role service_role");
    try {
      sale = await customerWrite("sale", { ...credit, customer_id: customer.id }, key);
    } finally {
      await db.exec("reset role");
    }
    assert.deepEqual(await customerWrite("sale", { ...credit, customer_id: customer.id }, key), sale);
    assert.equal(await qty(available), before - 1);
    const receipt = (await read("other", "receipt", { id: sale.id })).sale;
    assert.equal(receipt.customer_name, "Test Buyer");
    const account = () => customerRead("customer", { id: customer.id });
    assert.equal((await account()).balance_minor, receipt.total_minor);
    assert.equal((await customerRead("customers", { q: "5550100" })).rows[0].id, customer.id);
    const repayment = { customer_id: customer.id, amount_minor: receipt.total_minor - 1, note: "Test repayment" };
    const repaymentKey = randomUUID();
    assert.deepEqual(await customerWrite("record_customer_payment", repayment, repaymentKey),
      await customerWrite("record_customer_payment", repayment, repaymentKey));
    await assert.rejects(() => customerWrite("record_customer_payment", { ...repayment, amount_minor: 2 }), /outstanding balance/);
    await assert.rejects(() => customerWrite("record_customer_payment", { ...repayment, amount_minor: 1 }, randomUUID(), "cashier"), { code: "42501" });
    assert.equal((await account()).balance_minor, 1);
  });

  await t.test("a product discount affects only its line and rolls back when it exceeds that line", async () => {
    const customer = (await scalar("select id as value from shop.customers where name = 'Test Buyer'"));
    const key = randomUUID();
    const buy = discount => scalar("select public.be_item_checkout('supabase', 'other', $1::jsonb, $2) as value", [{
      payment: "Credit", customer_id: customer, quoted_subtotal_minor: 13000,
      items: [{ ...purchase(first.id, 1), discount_minor: discount }, purchase(second.id, 1)],
    }, key]);
    const before = await qty(first.id);
    let sale;
    await db.exec("set role service_role");
    try {
      await assert.rejects(() => buy(5501), /exceeds its line amount/);
      sale = await buy(500);
      assert.deepEqual(await buy(500), sale);
    } finally {
      await db.exec("reset role");
    }
    assert.equal(await qty(first.id), before - 1);
    const receipt = await scalar("select public.be_item_receipt('supabase', 'other', $1::jsonb) as value", [{ id: sale.id }]);
    assert.equal(receipt.sale.total_minor, 12500);
    assert.deepEqual(receipt.items.map(item => item.discount_minor), [500, 0]);
    const account = await scalar("select public.be_customers('supabase', 'other', 'customer', $1::jsonb) as value", [{ id: customer }]);
    assert.equal(account.balance_minor, 12501);
  });

  await t.test("dozen products keep their unit through checkout and stock history", async () => {
    const save = (product, key = randomUUID()) => scalar(
      "select public.be_save_product_unit('supabase', 'owner', $1::jsonb, $2) as value", [product, key]);
    const readUnits = (query, options) => scalar(
      "select public.be_read_product_units('supabase', 'owner', $1, $2::jsonb) as value", [query, options]);
    const input = { ...productInput("DOZ", 12000), unit: "Doz" };
    const key = randomUUID();
    const product = await save(input, key);
    assert.deepEqual(await save(input, key), product);
    assert.equal((await readUnits("product", { id: first.id })).unit, "Pcs");
    await write("owner", "stock_in", stockIn(product.id));
    await assert.rejects(() => save({ ...input, id: product.id, unit: "Pcs" }), /already has stock history/);
    const sale = await write("owner", "sale", { payment: "ZAAD", items: [purchase(product.id, 2)] });
    const receipt = await readUnits("receipt", { id: sale.id });
    assert.equal(receipt.items[0].unit, "Doz");
    assert.equal(receipt.sale.total_minor, 24000);
    assert.equal((await readUnits("pos_catalog", {})).find(row => row.id === product.id).quantity, 8);
  });

  await t.test("sale corrections update stock and totals and reject stale edits", async () => {
    const sale = await write("owner", "sale", { payment: "ZAAD", items: [purchase(first.id, 1)] });
    const before = await qty(first.id);
    const input = { id: sale.id, payment: "ZAAD", payment_note: "Corrected", reason: "Quantity entered twice",
      items: [{ sku: "A", quantity: 2 }] };
    const correct = (subject, data, key = randomUUID()) => scalar(
      "select public.be_correct_sale('supabase', $1, $2::jsonb, $3) as value", [subject, data, key]);
    await assert.rejects(() => correct("other", input), { code: "42501" });
    await assert.rejects(() => correct("owner", { ...input, items: [{ sku: "A", quantity: 10000 }] }), /insufficient stock/);
    assert.equal(await qty(first.id), before);
    const key = randomUUID();
    assert.equal((await correct("owner", input, key)).id, sale.id);
    assert.equal((await correct("owner", input, key)).id, sale.id);
    await assert.rejects(() => correct("owner", input), /already edited/);
    const receipt = await read("owner", "receipt", { id: sale.id });
    assert.equal(receipt.sale.total_minor, 11000);
    assert.equal(receipt.items[0].quantity, 2);
    assert.equal(await qty(first.id), before - 1);
    const movement = await scalar("select delta as value from shop.stock_movements where sale_id = $1", [sale.id]);
    assert.equal(movement, -2);
  });

  await t.test("administrators assign unique employee logins without changing existing identity links", async () => {
    const setLogin = (actor, id, username, number, email = null) => scalar(
      "select public.be_set_employee_login('supabase', $1, $2, $3, $4, $5, 'Test Staff') as value",
      [actor, id, username, number, email]);
    const login = username => scalar("select public.be_employee_login($1) as value", [username]);
    const owner = await identity("owner");
    await setLogin("owner", owner.id, "shop.owner", "EMP-001");
    assert.equal(await login("SHOP.OWNER"), "owner@example.test");
    assert.equal((await identity("owner")).id, owner.id);
    await assert.rejects(() => setLogin("other", owner.id, "new.owner", "EMP-001"), { code: "42501" });
    const email = `staff-${randomUUID()}@barwaaqo.invalid`;
    assert.equal(await setLogin("owner", null, "shop.staff", "EMP-002", email), email);
    assert.equal(await setLogin("owner", null, "shop.staff", "EMP-002", `staff-${randomUUID()}@barwaaqo.invalid`), email);
    await assert.rejects(() => setLogin("owner", owner.id, "shop.staff", "EMP-001"), /username is already in use/);
    await assert.rejects(() => setLogin("owner", owner.id, "shop.owner", "EMP-002"), /employee number is already in use/);
    await db.exec("set role anon");
    try {
      await assert.rejects(() => login("shop.owner"), { code: "42501" });
    } finally {
      await db.exec("reset role");
    }
  });

  await t.test("partial returns preserve receipt discounts, stock, access, and closeout", async () => {
    const receipt = (subject, id) => scalar("select public.be_receipt_with_returns('supabase', $1, $2::jsonb) as value", [subject, { id }]);
    const record = (subject, data, key = randomUUID()) =>
      scalar("select public.be_return_sale('supabase', $1, $2::jsonb, $3) as value", [subject, data, key]);
    const sold = await checkout("other", { payment: "Cash", cash_received_minor: 11000, discount_minor: 1,
      items: [purchase(first.id, 2)] }, randomUUID());
    const before = await qty(first.id);
    const input = { id: sold.id, reason: "Customer return", quoted_total_minor: 5499, quoted_credit_minor: 0,
      items: [{ product_id: first.id, quantity: 1, restock: true }] };
    assert.equal(await receipt("new", sold.id), null);
    await assert.rejects(() => record("new", input), { code: "42501" });
    await assert.rejects(() => record("cashier", input), { code: "42501" });
    await assert.rejects(() => record("other", { ...input, quoted_total_minor: 5500 }), /amount changed/);
    assert.equal(await qty(first.id), before);
    assert.equal((await receipt("other", sold.id)).returns.length, 0);
    const key = randomUUID();
    const result = await record("other", input, key);
    assert.deepEqual(await record("other", input, key), result);
    assert.equal(await qty(first.id), before + 1);
    await record("other", { ...input, quoted_total_minor: 5500, items: [{ ...input.items[0], restock: false }] });
    await assert.rejects(() => record("other", input), /exceeds the remaining quantity/);
    assert.equal(await qty(first.id), before + 1);
    const updated = await receipt("owner", sold.id);
    assert.equal(updated.sale.total_minor, 10999);
    assert.equal(updated.items[0].returned_quantity, 2);
    assert.deepEqual(updated.returns.map(row => row.refund_minor).sort(), [5499, 5500]);
    const movements = await read("owner", "movements", { type: "return", product: first.id });
    assert.equal(movements.total, 1);
    assert.equal(movements.rows[0].delta, 1);
    await assert.rejects(() => scalar("select public.be_correct_sale('supabase', 'owner', $1::jsonb, $2) as value",
      [{ id: sold.id, payment: "Cash", reason: "Test correction", items: [{ sku: "A", quantity: 2 }] }, randomUUID()]),
    /recorded return/);
    const closeout = await scalar("select public.be_closeout_with_returns('supabase', 'other', $1::jsonb) as value", [{ from: today }]);
    assert.deepEqual(closeout.returns, [{ payment: "Cash", refund_minor: 10999, credit_minor: 0, returns: 2 }]);
  });

  await t.test("credit returns reduce outstanding credit and record excess as a ZAAD refund", async () => {
    const writeCustomer = (command, data) => scalar(
      "select public.be_customer_write('supabase', 'other', $1, $2::jsonb, $3) as value", [command, data, randomUUID()]);
    const account = (query, options) => scalar(
      "select public.be_customers_with_returns('supabase', 'other', $1, $2::jsonb) as value", [query, options]);
    const { id: customer } = await writeCustomer("save_customer", { name: "Returns Buyer" });
    const saleData = { payment: "Credit", customer_id: customer };
    const { id: sale } = await scalar("select public.be_item_checkout('supabase', 'other', $1::jsonb, $2) as value", [{
      ...saleData, items: [{ ...purchase(second.id, 1), discount_minor: 500 }],
    }, randomUUID()]);
    await writeCustomer("record_customer_payment", { customer_id: customer, amount_minor: 2000 });
    const input = { id: sale, reason: "Defective item", quoted_total_minor: 7000, quoted_credit_minor: 5000,
      items: [{ product_id: second.id, quantity: 1, restock: false }] };
    await db.exec("set role service_role");
    try {
      await scalar("select public.be_return_sale('supabase', 'owner', $1::jsonb, $2) as value", [input, randomUUID()]);
    } finally {
      await db.exec("reset role");
    }
    const customerDetail = await account("customer", { id: customer });
    assert.equal(customerDetail.balance_minor, 0);
    assert.equal(customerDetail.activity.find(row => row.kind === "Credit return").amount_minor, 5000);
    assert.equal((await account("customers", { q: "Returns Buyer" })).rows[0].balance_minor, 0);
    await assert.rejects(() => writeCustomer("record_customer_payment", { customer_id: customer, amount_minor: 1 }), /outstanding balance/);
    const closeout = (subject, from) => scalar("select public.be_closeout_with_returns('supabase', $1, $2::jsonb) as value", [subject, { from }]);
    assert.deepEqual((await closeout("owner", today)).returns.find(row => row.payment === "ZAAD"),
      { payment: "ZAAD", refund_minor: 2000, credit_minor: 5000, returns: 1 });
    assert.equal((await closeout("other", today)).returns.some(row => row.payment === "ZAAD"), false);
    assert.deepEqual((await closeout("owner", "2000-01-01")).returns, []);
  });
  await t.test("expenses enforce administrator access, positive amounts, dates, voids, and replay protection", async () => {
    const financeWrite = (subject, command, data, key = randomUUID()) => scalar(
      "select public.be_finance_write('supabase', $1, $2, $3::jsonb, $4) as value", [subject, command, data, key]);
    const financeRead = (subject, query, options = {}) => scalar(
      "select public.be_finance_read('supabase', $1, $2, $3::jsonb) as value", [subject, query, options]);
    const expense = { category: "Rent", description: "Monthly shop rent", amount_minor: 45000,
      payment: "Cash", occurred_on: today, reference: "RENT-01", notes: "Test" };
    for (const subject of ["new", "other", "cashier", "unknown"]) {
      await assert.rejects(() => financeWrite(subject, "record_expense", expense), { code: "42501" });
      await assert.rejects(() => financeRead(subject, "expenses"), { code: "42501" });
      await assert.rejects(() => financeRead(subject, "finance_summary"), { code: "42501" });
    }
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      try {
        await assert.rejects(() => financeRead("owner", "expenses"), { code: "42501" });
        await assert.rejects(() => financeWrite("owner", "record_expense", expense), { code: "42501" });
      } finally { await db.exec("reset role"); }
    }
    await assert.rejects(() => financeWrite("owner", "record_expense", { ...expense, amount_minor: 0 }), { code: "23514" });
    await assert.rejects(() => financeWrite("owner", "record_expense", { ...expense, occurred_on: "2999-01-01" }), /on or before today/);
    const key = randomUUID();
    const saved = await financeWrite("owner", "record_expense", expense, key);
    assert.deepEqual(await financeWrite("owner", "record_expense", expense, key), saved);
    await assert.rejects(() => financeWrite("owner", "record_expense", { ...expense, amount_minor: 1 }, key), /different details/);
    const listed = await financeRead("owner", "expenses", { q: "rent" });
    assert.equal(listed.total, 1);
    assert.equal(listed.amount_minor, 45000);
    assert.equal((await financeRead("owner", "finance_summary", { from: today, to: today })).expenses_minor, 45000);
    assert.equal((await financeRead("owner", "expenses", { to: "2000-01-01" })).total, 0);
    const voidKey = randomUUID();
    const voided = { id: saved.id, reason: "Entered twice" };
    await financeWrite("owner", "void_expense", voided, voidKey);
    await financeWrite("owner", "void_expense", voided, voidKey);
    await assert.rejects(() => financeWrite("owner", "void_expense", voided), /already voided/);
    assert.equal((await financeRead("owner", "expenses")).amount_minor, 0);
    assert.equal((await financeRead("owner", "expenses")).rows[0].void_reason, voided.reason);
    assert.equal(await scalar("select count(*)::int as value from shop.audit_logs where action = 'void_expense' and target_id = $1", [saved.id]), 1);
    await financeWrite("owner", "record_expense", {
      ...expense, category: "Transport", description: "Delivery transport", amount_minor: 1500,
    });
    assert.deepEqual((await financeRead("owner", "finance_summary", { from: today, to: today })).outgoing,
      [{ payment: "Cash", expenses_minor: 1500, supplier_minor: 0 }]);
  });

  await t.test("supplier purchases preserve item costs, allow partial payments, and receive stock exactly once", async () => {
    const financeWrite = (subject, command, data, key = randomUUID()) => scalar(
      "select public.be_finance_write('supabase', $1, $2, $3::jsonb, $4) as value", [subject, command, data, key]);
    const financeRead = (query, options = {}) => scalar(
      "select public.be_finance_read('supabase', 'owner', $1, $2::jsonb) as value", [query, options]);
    const supplier = await write("owner", "save_supplier", {
      id: null, name: "Purchase Test Supplier", phone: "", email: "", address: "", notes: "",
    });
    const order = { supplier_id: supplier.id, ordered_on: today, due_on: today, reference: "PO-TEST", notes: "Test order",
      items: [{ product_id: first.id, quantity: 2, cost_minor: 1700 }, { product_id: second.id, quantity: 1, cost_minor: 2600 }] };
    const stock = [await qty(first.id), await qty(second.id)];
    await assert.rejects(() => financeWrite("other", "create_purchase", order), { code: "42501" });
    await assert.rejects(() => financeWrite("owner", "create_purchase", { ...order, items: [order.items[0], order.items[0]] }), /each once/);
    const key = randomUUID();
    const created = await financeWrite("owner", "create_purchase", order, key);
    assert.deepEqual(await financeWrite("owner", "create_purchase", order, key), created);
    assert.equal((await financeRead("purchase", { id: created.id })).total_minor, 6000);
    assert.deepEqual([await qty(first.id), await qty(second.id)], stock);
    const payment = { id: created.id, amount_minor: 2000, payment: "ZAAD", occurred_on: today, reference: "ZAAD-TEST" };
    const paymentKey = randomUUID();
    await financeWrite("owner", "record_supplier_payment", payment, paymentKey);
    await financeWrite("owner", "record_supplier_payment", payment, paymentKey);
    await assert.rejects(() => financeWrite("owner", "cancel_purchase", { id: created.id }), /Only an unpaid/);
    await assert.rejects(() => financeWrite("owner", "record_supplier_payment", { ...payment, amount_minor: 4001 }), /outstanding purchase balance/);
    await assert.rejects(() => financeWrite("owner", "record_supplier_payment", { ...payment, occurred_on: "2000-01-01" }), /on or after/);
    assert.equal((await financeRead("purchase", { id: created.id })).balance_minor, 4000);
    const receipt = { id: created.id, occurred_on: today };
    const receiptKey = randomUUID();
    await db.exec("set role service_role");
    try {
      await financeWrite("owner", "receive_purchase", receipt, receiptKey);
      await financeWrite("owner", "receive_purchase", receipt, receiptKey);
    } finally { await db.exec("reset role"); }
    await assert.rejects(() => financeWrite("owner", "receive_purchase", receipt), /already received/);
    assert.deepEqual([await qty(first.id), await qty(second.id)], [stock[0] + 2, stock[1] + 1]);
    const received = await financeRead("purchase", { id: created.id });
    assert.equal(received.status, "received");
    assert.equal(received.items.find(item => item.product_id === first.id).cost_minor, 1700);
    const movement = await scalar("select id as value from shop.stock_movements where purchase_id = $1 limit 1", [created.id]);
    await assert.rejects(() => write("owner", "reverse_movement", { id: movement, notes: "Test" }), /cannot be reversed/);
    await financeWrite("owner", "record_supplier_payment", { ...payment, amount_minor: 4000 });
    const paid = await financeRead("purchase", { id: created.id });
    assert.equal(paid.balance_minor, 0);
    assert.equal(paid.payments.length, 2);
    await assert.rejects(() => financeWrite("owner", "record_supplier_payment", { ...payment, amount_minor: 1 }), /outstanding purchase balance/);
    assert.equal((await financeRead("purchases", { supplier: supplier.id })).total, 1);
    const summary = await financeRead("finance_summary", { from: today, to: today });
    assert.equal(summary.supplier_payments_minor, 6000);
    assert.equal(summary.outgoing.find(row => row.payment === "ZAAD").supplier_minor, 6000);
    assert.equal((await financeRead("finance_summary", { to: "2000-01-01" })).supplier_payments_minor, 0);
    const cancelled = await financeWrite("owner", "create_purchase", order);
    await financeWrite("owner", "cancel_purchase", { id: cancelled.id });
    await assert.rejects(() => financeWrite("owner", "record_supplier_payment", { ...payment, id: cancelled.id }), /cancelled/);
    await assert.rejects(() => financeWrite("owner", "receive_purchase", { ...receipt, id: cancelled.id }), /cancelled/);
    assert.equal((await financeRead("purchases")).suppliers.find(row => row.id === supplier.id).balance_minor, 0);
    assert.equal(await financeRead("purchase", { id: randomUUID() }), null);
  });

  await t.test("a purchase receipt rolls back every stock change when an ordered item becomes unavailable", async () => {
    const financeWrite = (command, data, key = randomUUID()) => scalar(
      "select public.be_finance_write('supabase', 'owner', $1, $2::jsonb, $3) as value", [command, data, key]);
    const supplier = await scalar("select id as value from shop.suppliers where name = 'Purchase Test Supplier'");
    const product = await write("owner", "save_product", productInput("UNAVAILABLE-ORDER", 1000));
    const order = await financeWrite("create_purchase", {
      supplier_id: supplier, ordered_on: today, items: [
        { product_id: first.id, quantity: 1, cost_minor: 1000 },
        { product_id: product.id, quantity: 1, cost_minor: 1000 },
      ],
    });
    await write("owner", "archive_product", { id: product.id });
    const before = await qty(first.id);
    await assert.rejects(() => financeWrite("receive_purchase", { id: order.id, occurred_on: today }), /archived/);
    assert.equal(await qty(first.id), before);
    assert.equal(await scalar("select count(*)::int as value from shop.stock_movements where purchase_id = $1", [order.id]), 0);
    assert.equal(await scalar("select status as value from shop.purchases where id = $1", [order.id]), "ordered");
  });

  await t.test("portable verification reconciles inventory, returns, purchases, and supplier payments", async () => {
    const script = await readFile(new URL("../scripts/verify-data.sql", import.meta.url), "utf8");
    const sql = script.split("\n").filter(line => !line.startsWith("\\")).join("\n");
    for (const result of await db.exec(sql)) assert.deepEqual(result.rows, []);
  });
});
