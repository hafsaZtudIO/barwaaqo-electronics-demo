export const storageKey = "barwaaqo-public-demo-v1";
export const money = value => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value / 100);
export const today = () => new Date().toISOString().slice(0, 10);

export function initialState() {
    const day = today();
    return {
        version: 1,
        products: [
            { id: "headphones", name: "Wireless headphones", category: "Audio", sku: "AUD-001", price: 6500, cost: 3600, stock: 18, minimum: 5, image: "headphones.webp" },
            { id: "monitor", name: '24" desktop monitor', category: "Displays", sku: "DSP-002", price: 18500, cost: 12000, stock: 7, minimum: 3, image: "monitor.webp" },
            { id: "mouse", name: "Wireless mouse", category: "Accessories", sku: "ACC-003", price: 1800, cost: 800, stock: 24, minimum: 8, image: "mouse.webp" },
            { id: "cable", name: "USB-C cable", category: "Accessories", sku: "ACC-004", price: 900, cost: 300, stock: 4, minimum: 10, image: "usb-c-cable.webp" },
            { id: "charger", name: "20W wall charger", category: "Power", sku: "PWR-005", price: 2500, cost: 1200, stock: 3, minimum: 6, image: "wall-charger.webp" },
        ],
        customers: [
            { id: "customer-1", name: "Demo Customer A", balance: 6500 },
            { id: "customer-2", name: "Demo Customer B", balance: 0 },
        ],
        suppliers: [
            { id: "supplier-1", name: "Sample Electronics Supply" },
            { id: "supplier-2", name: "Example Accessories Co." },
        ],
        sales: [
            { id: "DEMO-1042", date: day, payment: "ZAAD", customer: "", total: 8300, items: [
                { product: "headphones", name: "Wireless headphones", quantity: 1, price: 6500 },
                { product: "mouse", name: "Wireless mouse", quantity: 1, price: 1800 },
            ] },
            { id: "DEMO-1041", date: day, payment: "Cash", customer: "", total: 18500, items: [
                { product: "monitor", name: '24" desktop monitor', quantity: 1, price: 18500 },
            ] },
            { id: "DEMO-1040", date: day, payment: "Credit", customer: "customer-1", total: 6500, items: [
                { product: "headphones", name: "Wireless headphones", quantity: 1, price: 6500 },
            ] },
        ],
        expenses: [
            { id: "expense-1", date: day, category: "Transport", description: "Sample delivery transport", amount: 1500, payment: "Cash" },
        ],
        purchases: [
            { id: "PO-DEMO-01", date: day, supplier: "supplier-2", status: "ordered", total: 18000,
                items: [{ product: "cable", name: "USB-C cable", quantity: 60, cost: 300 }],
                payments: [{ date: day, amount: 6000, method: "ZAAD" }] },
        ],
        repayments: [],
    };
}
