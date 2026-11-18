import { revalidatePath } from "next/cache";
import { router } from "../frontend/platform/navigation";
import { z } from "zod";
import { AccessError, ConnectionError, ShopError } from "./ports";
import { createShopEmployee, identityProvider, pageEmployee, signInEmployee, updateShopEmployeeLogin, writeShop } from "./shop";
import { email, employeeNumber, employeeUsername, parseCommand } from "./validation";
import { minimumPasswordLength } from "./contracts";
const password = z.string().min(minimumPasswordLength, `Choose a password with at least ${minimumPasswordLength} characters.`).max(128);
function failure(error) {
    if (error instanceof z.ZodError) {
        const issue = error.issues[0];
        const field = String(issue?.path[0] ?? "").replaceAll("_", " ");
        return { message: field ? `${field.charAt(0).toUpperCase()}${field.slice(1)}: ${issue.message}` : (issue?.message ?? "Check the form.") };
    }
    if (error instanceof ShopError || error instanceof AccessError)
        return { message: error.message };
    console.error("Inventory action failed", error instanceof Error ? error.name : "Unknown error");
    return { message: "Could not complete the request. Check the configuration or try again." };
}
export async function syncInvoice(employeeId, requestId, data) {
    try {
        const result = await writeShop(parseCommand("sale", data), z.uuid().parse(requestId), z.uuid().parse(employeeId));
        revalidatePath("/", "layout");
        return { ok: true, id: result.id };
    } catch (error) {
        if (error instanceof ConnectionError) return { retry: true };
        if (error instanceof AccessError) return { retry: true, message: "Sign in as the employee who saved this invoice to sync it." };
        if (!(error instanceof ShopError || error instanceof z.ZodError)) return { retry: true };
        return failure(error);
    }
}
export async function submitShop(name, _state, form) {
    try {
        const requestId = z.uuid().parse(form.get("request_id"));
        const data = Object.fromEntries(form);
        if (name === "create_purchase") {
            const quantities = form.getAll("quantity");
            const costs = form.getAll("cost_minor");
            data.items = form.getAll("product_id").map((product_id, index) => ({
                product_id, quantity: quantities[index], cost_minor: costs[index],
            }));
        }
        if (name === "sale") {
            const quantities = form.getAll("quantity");
            const discounts = form.getAll("item_discount");
            data.items = form.getAll("product_id").map((product_id, index) => ({
                product_id, quantity: quantities[index], discount_minor: discounts[index],
            }));
        }
        if (name === "correct_sale") {
            const quantities = form.getAll("quantity");
            data.items = form.getAll("sku").map((sku, index) => ({ sku, quantity: quantities[index] }));
        }
        if (name === "return_sale") {
            data.items = form.getAll("product_id").map(product_id => ({
                product_id,
                quantity: form.get(`quantity_${product_id}`),
                restock: form.has(`restock_${product_id}`),
            })).filter(item => Number(item.quantity) !== 0);
        }
        if (name === "update_employee")
            data.active = data.active === "true";
        const command = parseCommand(name, data);
        const result = await writeShop(command, requestId);
        revalidatePath("/", "layout");
        if (command.name === "invite_employee") {
            try {
                await identityProvider.invite(command.data.email);
            }
            catch (error) {
                return { message: `Employee profile saved. ${failure(error).message}`, id: result.id };
            }
        }
        const messages = {
            record_expense: "Expense recorded.",
            void_expense: "Expense voided. Its audit history has been retained.",
            create_purchase: "Purchase order created. Open it below to receive stock or record a supplier payment.",
            receive_purchase: "Purchase received and stock updated.",
            cancel_purchase: "Purchase order cancelled.",
            record_supplier_payment: "Supplier payment recorded and balance updated.",
            sale: "Sale recorded and inventory updated.",
            correct_sale: "Sale corrected. The receipt, stock and customer balance are up to date.",
            return_sale: "Return recorded. Open the receipt to review its refund and stock details.",
            record_customer_payment: "ZAAD payment recorded and customer balance updated.",
            stock_in: "Stock receipt recorded.",
            stock_out: "Stock issue recorded.",
            invite_employee: "Employee profile saved and invitation sent.",
            reverse_movement: "Correction recorded.",
            archive_product: "Product archived.",
        };
        return { message: messages[name] ?? "Changes saved.", ok: true, id: result.id };
    }
    catch (error) {
        if (name === "sale" && error instanceof ShopError)
            revalidatePath("/pos");
        return failure(error);
    }
}
export async function createEmployee(_state, form) {
    try {
        const requestId = z.uuid().parse(form.get("request_id"));
        const username = employeeUsername.parse(form.get("username"));
        const number = employeeNumber.parse(form.get("employee_number"));
        const name = z.string().trim().min(1, "Enter the employee name.").max(180).parse(form.get("full_name"));
        const starter = password.parse(form.get("password"));
        if (starter !== form.get("confirm"))
            throw new ShopError("The passwords must match.");
        await createShopEmployee({ username, number, name }, starter, requestId);
        revalidatePath("/employees");
        return { ok: true, message: "Employee account created. Share their username and password privately." };
    }
    catch (error) {
        return failure(error);
    }
}
export async function updateEmployeeLogin(_state, form) {
    try {
        const id = z.uuid().parse(form.get("id"));
        const username = employeeUsername.parse(form.get("username"));
        const number = employeeNumber.parse(form.get("employee_number"));
        await updateShopEmployeeLogin({ id, username, number });
        revalidatePath("/", "layout");
        return { ok: true, message: "Employee number and username saved." };
    }
    catch (error) {
        return failure(error);
    }
}
export async function login(_state, form) {
    try {
        const input = z.string().trim().max(254).parse(form.get("username") ?? form.get("email"));
        const login = input.includes("@") ? email.parse(input) : employeeUsername.parse(input);
        await signInEmployee(login, z.string().min(1).max(128).parse(form.get("password")));
    }
    catch (error) {
        return failure(error);
    }
    router.replace((await pageEmployee()).role === "admin" ? "/dashboard" : "/pos");
    return { ok: true, message: "Signed in." };
}
export async function logout() {
    await identityProvider.signOut();
    router.replace("/login");
}
export async function resetPassword(_state, form) {
    try {
        await identityProvider.reset(email.parse(form.get("email")));
        return { ok: true, message: "If the email is eligible, a reset link will arrive shortly." };
    }
    catch (error) {
        return failure(error);
    }
}
export async function confirmEmail(_state, form) {
    try {
        await identityProvider.confirm(z.string().min(8).max(512).parse(form.get("token")), z.enum(["invite", "recovery"]).parse(form.get("type")));
    }
    catch (error) {
        return failure(error);
    }
    router.replace("/password/update");
}
export async function finishAuthLink(_state, form) {
    try {
        const code = form.get("code");
        const link = code ? { code: z.string().min(8).max(512).parse(code) } : {
            access: z.string().min(8).max(8192).parse(form.get("access")),
            refresh: z.string().min(8).max(512).parse(form.get("refresh")),
        };
        await identityProvider.acceptLink(link);
    }
    catch (error) {
        return failure(error);
    }
    router.replace("/password/update");
}
export async function updatePassword(_state, form) {
    await pageEmployee();
    try {
        const value = password.parse(form.get("password"));
        if (value !== form.get("confirm"))
            throw new ShopError("The passwords must match.");
        await identityProvider.updatePassword(value);
    }
    catch (error) {
        return failure(error);
    }
    router.replace((await pageEmployee()).role === "admin" ? "/dashboard" : "/pos");
    return { ok: true, message: "Signed in." };
}
