export const payments = ["Cash", "EVC Plus", "ZAAD", "Bank Transfer", "Other", "Credit"];
export const checkoutPayments = ["ZAAD", "Credit"];
export const outgoingPayments = payments.filter(payment => payment !== "Credit");
export const expenseCategories = ["Rent", "Electricity", "Transport", "Internet", "Salaries", "Maintenance", "Other"];
export const minimumPasswordLength = 6;
export const productUnits = ["Pcs", "Doz"];
export const reasons = ["Damaged Product", "Supplier Return", "Authorized Adjustment", "Other"];
export function money(minor) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(minor / 100);
}
