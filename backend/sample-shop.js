export const sampleOwner = "sample-owner";
export const sampleCashier = "sample-cashier";

export async function passwordHash(password, salt) {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({
        name: "PBKDF2", salt: encoder.encode(salt), iterations: 100000, hash: "SHA-256",
    }, key, 256);
    return Array.from(new Uint8Array(bits), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function createSampleSchema(db, migrations) {
    await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
    for (const migration of migrations) await db.exec(migration);
    await db.exec(`
        create table shop.sample_accounts (
            employee_id uuid primary key references shop.employee_profiles,
            salt text not null,
            password_hash text not null
        );
        alter table shop.sample_accounts enable row level security;
        revoke all on shop.sample_accounts from public, anon, authenticated, service_role;
    `);
}

export async function seedSampleShop(db) {
    const scalar = async (sql, parameters = []) => (await db.query(sql, parameters)).rows[0]?.value;
    const rpc = (name, parameters) => scalar(
        `select public.${name}(${parameters.map((_, index) => "$" + (index + 1)).join(",")}) as value`, parameters);
    const write = (command, data) => rpc("be_write", ["supabase", sampleOwner, command, data, crypto.randomUUID()]);
    const customerWrite = (command, data) => rpc("be_customer_write", ["supabase", sampleOwner, command, data, crypto.randomUUID()]);
    const financeWrite = (command, data) => rpc("be_finance_write", ["supabase", sampleOwner, command, data, crypto.randomUUID()]);
    const day = await scalar("select (now() at time zone 'Africa/Nairobi')::date::text as value");
    const employees = [
        { name: "Shop Owner", username: "owner", number: "EMP-001", role: "admin", subject: sampleOwner },
        { name: "Sales Assistant", username: "cashier", number: "EMP-002", role: "employee", subject: sampleCashier },
    ];
    for (const employee of employees) {
        const profile = await scalar(`insert into shop.employee_profiles(full_name, email, role, username, employee_number)
            values ($1,$2,$3,$4,$5) returning id as value`,
        [employee.name, employee.username + "@example.invalid", employee.role, employee.username, employee.number]);
        await db.query("insert into shop.employee_identities(provider, subject, employee_id) values ('supabase',$1,$2)",
            [employee.subject, profile]);
        const salt = crypto.randomUUID();
        await db.query("insert into shop.sample_accounts(employee_id,salt,password_hash) values ($1,$2,$3)",
            [profile, salt, await passwordHash("shop123", salt)]);
    }
    const supplier = await write("save_supplier", { id: null, name: "Electronics Supply Co.", phone: "", email: "", address: "", notes: "" });
    const accessories = await write("save_supplier", { id: null, name: "Accessories Wholesale", phone: "", email: "", address: "", notes: "" });
    const categories = (await db.query("select id, name from shop.categories")).rows;
    const products = [];
    const catalog = [
        ["DEMO-HEADSET", "Wireless headphones", "Headphones", 3600, 6500, 28, 5],
        ["DEMO-MONITOR", '24" desktop monitor', "Monitors", 12000, 18500, 20, 3],
        ["DEMO-MOUSE", "Wireless mouse", "Computer Accessories", 800, 1800, 40, 8],
        ["DEMO-USB-C", "USB-C cable", "Chargers", 300, 900, 4, 10],
        ["DEMO-WALL-20", "20W wall charger", "Chargers", 1200, 2500, 3, 6],
    ];
    for (const [sku, name, category, cost, price, quantity, minimum] of catalog) {
        const created = await write("save_product", {
            id: null, sku, barcode: sku, name, category_id: categories.find(item => item.name === category).id,
            brand: "", model: "", description: "", supplier_id: supplier.id, image_url: "",
            cost_minor: cost, sale_minor: price, minimum_stock: minimum,
        });
        await write("stock_in", { product_id: created.id, quantity, supplier_id: supplier.id, cost_minor: cost,
            occurred_on: day, reference: "Opening stock", notes: "" });
        products.push({ id: created.id, price });
    }
    const buyer = await customerWrite("save_customer", { customer_id: null, name: "Customer A", phone: "" });
    await customerWrite("save_customer", { customer_id: null, name: "Customer B", phone: "" });

    for (let offset = 6; offset >= 1; offset--) {
        const sale = await customerWrite("sale", { payment: "ZAAD", customer_id: null,
            items: [{ product_id: products[offset % 3].id, quantity: offset % 2 + 1 }] });
        await db.query("update shop.sales set created_at = ($2::date - $3::integer)::timestamp at time zone 'Africa/Nairobi' where id = $1",
            [sale.id, day, offset]);
        await db.query("update shop.stock_movements set occurred_on = $2::date - $3::integer where sale_id = $1",
            [sale.id, day, offset]);
    }
    await customerWrite("sale", { payment: "ZAAD", customer_id: null, items: [
        { product_id: products[0].id, quantity: 1 }, { product_id: products[2].id, quantity: 1 },
    ] });
    await write("sale", { payment: "Cash", items: [{ product_id: products[1].id, quantity: 1 }] });
    await customerWrite("sale", { payment: "Credit", customer_id: buyer.id, items: [{ product_id: products[0].id, quantity: 1 }] });
    await financeWrite("record_expense", { category: "Transport", description: "Delivery transport", amount_minor: 1500,
        payment: "Cash", occurred_on: day, reference: "", notes: "" });
    const order = await financeWrite("create_purchase", {
        supplier_id: accessories.id, ordered_on: day, due_on: null, reference: "PO-1001", notes: "",
        items: [{ product_id: products[3].id, quantity: 60, cost_minor: 300 }],
    });
    await financeWrite("record_supplier_payment", {
        id: order.id, amount_minor: 6000, payment: "ZAAD", occurred_on: day, reference: "",
    });
}

export const snapshotTables = [
    "employee_profiles", "employee_identities", "categories", "suppliers", "products", "customers",
    "sales", "sale_items", "customer_payments", "sale_returns", "sale_return_items",
    "expenses", "purchases", "purchase_items", "supplier_payments", "stock_movements",
    "audit_logs", "shop_settings", "command_requests", "sample_accounts",
];

export async function captureSnapshot(db) {
    const tables = {};
    for (const table of snapshotTables) tables[table] = (await db.query("select * from shop." + table)).rows;
    return { version: 2, revision: crypto.randomUUID(), tables };
}

export async function restoreSnapshot(db, snapshot) {
    if (snapshot.version !== 2 || !snapshotTables.every(table => Array.isArray(snapshot.tables[table]))) {
        throw new Error("Saved sample records are incompatible. Reset the workspace to continue.");
    }
    await db.transaction(async transaction => {
        await transaction.exec("truncate " + snapshotTables.map(table => "shop." + table).join(",") + " cascade");
        for (const table of snapshotTables) {
            if (snapshot.tables[table].length) {
                await transaction.query(`insert into shop.${table} select * from jsonb_populate_recordset(null::shop.${table}, $1::jsonb)`,
                    [JSON.stringify(snapshot.tables[table])]);
            }
        }
    });
}
