import { readAuthorizedShop } from "./access";
import { withDatabase, rpc, currentSubject, setSubject } from "./database";
import { passwordHash } from "./sample-shop";
import { AccessError, ShopError } from "./ports";
import { employeeCommands } from "./validation";
import { redirect } from "../frontend/platform/navigation";

async function employeeContext(db) {
    const subject = currentSubject();
    if (!subject) throw new AccessError(401);
    const employee = await rpc(db, "be_employee", ["supabase", subject, null]);
    if (!employee) throw new AccessError(403);
    return { identity: { provider: "supabase", subject }, employee };
}

const repository = {
    async read(identity, key, options) {
        return withDatabase(db => readDatabase(db, identity, key, options));
    },
};

export async function readDatabase(db, identity, key, options = {}) {
    const credentials = ["supabase", identity.subject];
    if (key === "sales_history") return rpc(db, "be_sales_history", [...credentials, options]);
    if (["expenses", "purchases", "purchase", "finance_summary"].includes(key))
        return rpc(db, "be_finance_read", [...credentials, key, options]);
    if (key === "sale_revision") return rpc(db, "be_sale_revision", [...credentials, options.id]);
    if (key === "receipt") return rpc(db, "be_receipt_with_returns", [...credentials, options]);
    if (key === "closeout") return rpc(db, "be_closeout_with_returns", [...credentials, options]);
    if (["customers", "customer"].includes(key)) return rpc(db, "be_customers_with_returns", [...credentials, key, options]);
    if (key === "customer_options") return rpc(db, "be_customers", [...credentials, key, options]);
    if (["pos_catalog", "products", "product", "lookups", "movements"].includes(key)) {
        const result = await rpc(db, "be_read_product_units", [...credentials, key, options]);
        if (key !== "pos_catalog") return result;
        const photos = new Map((await db.query("select id, image_url from shop.products where not archived")).rows
            .map(product => [product.id, product.image_url]));
        return result.map(product => ({ ...product, image_url: photos.get(product.id) || "" }));
    }
    return rpc(db, "be_read", [...credentials, key, options]);
}

export async function readShop(key, options = {}) {
    const context = await withDatabase(employeeContext);
    return readAuthorizedShop(repository, context, key, options);
}

export async function pageEmployee(admin = false) {
    try {
        const { employee } = await withDatabase(employeeContext);
        if (admin && employee.role !== "admin") redirect("/pos");
        return employee;
    } catch (error) {
        if (error instanceof AccessError) redirect("/login");
        throw error;
    }
}

export async function writeDatabase(db, subject, command, requestId) {
    const credentials = ["supabase", subject];
    const data = command.data;
    if (["record_expense", "void_expense", "create_purchase", "receive_purchase", "cancel_purchase", "record_supplier_payment"].includes(command.name))
        return rpc(db, "be_finance_write", [...credentials, command.name, data, requestId]);
    if (command.name === "return_sale") return rpc(db, "be_return_sale", [...credentials, data, requestId]);
    if (command.name === "correct_sale") return rpc(db, "be_correct_sale", [...credentials, data, requestId]);
    if (command.name === "save_product" && data.unit) return rpc(db, "be_save_product_unit", [...credentials, data, requestId]);
    if (command.name === "sale" && data.items.some(item => item.discount_minor > 0))
        return rpc(db, "be_item_checkout", [...credentials, data, requestId]);
    if (["sale", "save_customer", "record_customer_payment"].includes(command.name))
        return rpc(db, "be_customer_write", [...credentials, command.name, data, requestId]);
    return rpc(db, "be_write", [...credentials, command.name, data, requestId]);
}

export async function writeShop(command, requestId, expectedEmployeeId) {
    return withDatabase(async db => {
        const { employee, identity } = await employeeContext(db);
        if (expectedEmployeeId && employee.id !== expectedEmployeeId) throw new AccessError(403);
        if (employee.role !== "admin" && !employeeCommands.has(command.name)) throw new AccessError(403);
        return writeDatabase(db, identity.subject, command, requestId);
    }, { write: true });
}

export async function saveProductPhoto(file) {
    await pageEmployee(true);
    if (!file?.size || file.size > 5 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.type))
        throw new ShopError("Choose a JPG, PNG, or WebP photo up to 5 MB.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const valid = file.type === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : file.type === "image/png" ? [137,80,78,71,13,10,26,10].every((value,index) => bytes[index] === value)
        : String.fromCharCode(...bytes.slice(0,4)) === "RIFF" && String.fromCharCode(...bytes.slice(8,12)) === "WEBP";
    if (!valid) throw new ShopError("This file is not a valid JPG, PNG, or WebP photo.");
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const id = crypto.randomUUID();
                localStorage.setItem("barwaaqo-demo-photo-" + id, reader.result);
                resolve("https://barwaaqo-demo.invalid/photos/" + id);
            } catch {
                reject(new ShopError("Browser storage is full. Choose a smaller photo or remove unused demo data."));
            }
        };
        reader.onerror = () => reject(new ShopError("Could not read the selected photo."));
        reader.readAsDataURL(file);
    });
}

export async function signInEmployee(login, password) {
    const account = await withDatabase(async db => {
        const result = await db.query(`select a.*, i.subject, e.active from shop.sample_accounts a
            join shop.employee_profiles e on e.id = a.employee_id
            join shop.employee_identities i on i.employee_id = e.id
            where e.username = lower($1) or e.email = lower($1)`, [login]);
        return result.rows[0];
    });
    if (!account?.active || await passwordHash(password, account.salt) !== account.password_hash)
        throw new ShopError("Sign-in failed. Check your username and password and try again.");
    setSubject(account.subject);
}

export async function createShopEmployee(details, password, requestId) {
    const salt = crypto.randomUUID();
    const hash = await passwordHash(password, salt);
    return withDatabase(async db => {
        const { identity, employee } = await employeeContext(db);
        if (employee.role !== "admin") throw new AccessError(403);
        const email = await rpc(db, "be_set_employee_login", ["supabase", identity.subject, null, details.username,
            details.number, "staff-" + requestId + "@example.invalid", details.name]);
        const employeeId = await rpc(db, "be_register_employee", ["supabase", identity.subject, email, details.name, "sample-" + requestId]);
        await db.query("insert into shop.sample_accounts(employee_id,salt,password_hash) values ($1,$2,$3) on conflict do nothing",
            [employeeId, salt, hash]);
    }, { write: true });
}

export async function updateShopEmployeeLogin(details) {
    return withDatabase(async db => {
        const { identity, employee } = await employeeContext(db);
        if (employee.role !== "admin") throw new AccessError(403);
        await rpc(db, "be_set_employee_login", ["supabase", identity.subject, details.id, details.username, details.number, null, null]);
    }, { write: true });
}

export const identityProvider = {
    async signOut() { setSubject(""); },
    async invite() { throw new ShopError("The profile is saved in this browser. Public sample accounts use Create employee account."); },
    async reset() { throw new ShopError("Use owner / shop123 or cashier / shop123 to open a sample account."); },
    async confirm() { throw new ShopError("Email verification is available in the connected shop."); },
    async acceptLink() { throw new ShopError("Email verification is available in the connected shop."); },
    async updatePassword(password) {
        const salt = crypto.randomUUID();
        const hash = await passwordHash(password, salt);
        return withDatabase(async db => {
            const { employee } = await employeeContext(db);
            await db.query("update shop.sample_accounts set salt=$2,password_hash=$3 where employee_id=$1", [employee.id, salt, hash]);
        }, { write: true });
    },
};
