import { notFound, redirect } from "next/navigation";
import { Dashboard } from "@/frontend/components/views/dashboard";
import { PointOfSale } from "@/frontend/components/views/point-of-sale";
import { Closeout } from "@/frontend/components/views/closeout";
import { Customers } from "@/frontend/components/views/customers";
import { Expenses } from "@/frontend/components/views/expenses";
import { Purchases } from "@/frontend/components/views/purchases";
import { ProductDetails, Products, Stock } from "@/frontend/components/views/inventory";
import { Receipt, SaleCorrection, Sales } from "@/frontend/components/views/sales";
import { SaleReturn } from "@/frontend/components/views/sale-return";
import { Employees, Reports, Settings, Suppliers } from "@/frontend/components/views/administration";
import { businessToday } from "@/frontend/components/ui";
import { pageEmployee, readShop } from "@/backend/shop";
import { DatabaseSchemaError, ShopError } from "@/backend/ports";
import { queryOptions } from "@/backend/validation";
const sections = {
    dashboard: "Shop overview", pos: "Point of sale", closeout: "End of day", products: "Products", "stock-in": "Stock In", "stock-out": "Stock Out",
    sales: "Sales", customers: "Customers", suppliers: "Suppliers", employees: "Employees", reports: "Reports", settings: "Settings",
    expenses: "Expenses", purchases: "Supplier purchases",
};
export async function generateMetadata({ params }) {
    const { section } = await params;
    return { title: Object.hasOwn(sections, section) ? sections[section] : "Workspace" };
}
export default async function SectionPage({ params, searchParams }) {
    const { section } = await params;
    if (!Object.hasOwn(sections, section))
        notFound();
    const search = Object.fromEntries(Object.entries(await searchParams)
        .filter((entry) => typeof entry[1] === "string"));
    const query = queryOptions.parse(search);
    const admin = ["suppliers", "employees", "reports", "settings", "expenses", "purchases"].includes(section);
    const employee = await pageEmployee(admin);
    switch (section) {
        case "dashboard":
            return <Dashboard data={await readShop("dashboard")} employee={employee}/>;
        case "pos": {
            const [products, customers, sales] = await Promise.all([
                readShop("pos_catalog"), readShop("customer_options"), readShop("sales", { employee: employee.id }),
            ]);
            return <PointOfSale products={products} customers={customers} employeeId={employee.id} lastReceiptId={sales.rows[0]?.id}/>;
        }
        case "customers": {
            const [data, customer] = await Promise.all([readShop("customers", query), query.id ? readShop("customer", query) : null]);
            if (query.id && !customer) notFound();
            return <Customers data={data} customer={customer} query={query} search={search}/>;
        }
        case "closeout": {
            const data = await readShop("closeout", query);
            const finance = employee.role === "admin" ? await readShop("finance_summary", { from: data.day, to: data.day }) : null;
            return <Closeout data={data} finance={finance} admin={employee.role === "admin"}/>;
        }
        case "expenses": {
            const [data, lookups] = await Promise.all([readShop("expenses", query), readShop("lookups")]);
            return <Expenses data={data} query={query} search={search} today={businessToday(lookups.timezone)}/>;
        }
        case "purchases": {
            const [data, lookups, purchase] = await Promise.all([
                readShop("purchases", query), readShop("lookups"), query.id ? readShop("purchase", { id: query.id }) : null,
            ]);
            if (query.id && !purchase) notFound();
            return <Purchases data={data} purchase={purchase} lookups={lookups} query={query} search={search} today={businessToday(lookups.timezone)}/>;
        }
        case "products": {
            if (query.id) {
                const [product, lookups, movements] = await Promise.all([
                    readShop("product", query), readShop("lookups"), readShop("movements", { product: query.id, page: query.page }),
                ]);
                if (!product)
                    notFound();
                return <ProductDetails key={product.id} product={product} lookups={lookups} movements={movements} employee={employee} page={query.page}/>;
            }
            const [data, lookups] = await Promise.all([readShop("products", query), readShop("lookups")]);
            return <Products data={data} lookups={lookups} employee={employee} query={query} search={search}/>;
        }
        case "stock-in":
        case "stock-out": {
            const incoming = section === "stock-in";
            const [data, lookups] = await Promise.all([
                readShop("movements", { ...query, type: incoming ? "in" : "outgoing" }), readShop("lookups"),
            ]);
            return <Stock incoming={incoming} data={data} lookups={lookups} employee={employee} query={query} search={search}/>;
        }
        case "sales": {
            if (search.receipt) {
                const id = queryOptions.parse({ id: search.receipt }).id;
                if (!id)
                    notFound();
                const receipt = await readShop("receipt", { id });
                if (!receipt)
                    notFound();
                const canEdit = employee.role === "admin" && !receipt.returns?.length;
                if (search.return === "1")
                    return <SaleReturn receipt={receipt}/>;
                if (canEdit && search.edit === "1") {
                    const revision = receipt.revision ?? await readShop("sale_revision", { id });
                    return <SaleCorrection receipt={receipt} revision={revision} customers={await readShop("customer_options")}/>;
                }
                return <Receipt receipt={receipt} canEdit={canEdit} autoPrint={search.print === "1"}/>;
            }
            if (search.new)
                redirect("/pos");
            const invalidDates = query.from && query.to && query.from > query.to;
            const history = invalidDates
                ? Promise.resolve({ error: "Choose a To date on or after the From date." })
                : readShop("sales_history", query).catch(error => {
                    if (error instanceof ShopError && error.message === "The shop database needs the sales history update.")
                        return { error: employee.role === "admin"
                            ? "Apply the sales history database update (202611210014_sales_history.sql) to enable search, filters, and sorting."
                            : "Sales history needs a database update. Ask your administrator to enable the updated list." };
                    throw error;
                });
            let result, lookups, customers;
            try {
                [result, lookups, customers] = await Promise.all([history, readShop("lookups"), readShop("customer_options")]);
            } catch (error) {
                if (!(error instanceof DatabaseSchemaError)) throw error;
                result = { error: employee.role === "admin"
                    ? `Database update required: ${error.relation ? `${error.relation} is missing` : "a required table or view is unavailable"}. Check the database and apply pending migrations in filename order.`
                    : "Sales history needs a database update. Ask your administrator to check pending migrations." };
                lookups = { products: [], timezone: "Africa/Nairobi" };
                customers = [];
            }
            const data = result.error ? { rows: [], total: 0, page: 1, page_size: query.page_size ?? 25, summary: { total_minor: 0, sales_count: 0 } } : result;
            return <Sales data={data} lookups={lookups} customers={customers} employees={data.employee_options ?? []}
                employee={employee} query={query} search={search} error={result.error}/>;
        }
        case "suppliers": {
            const historyPage = queryOptions.parse({ page: search.historyPage }).page;
            const [data, lookups, history] = await Promise.all([
                readShop("suppliers", query),
                query.id ? readShop("lookups") : null,
                query.id ? readShop("movements", { supplier: query.id, page: historyPage }) : undefined,
            ]);
            return <Suppliers data={data} selected={lookups?.suppliers.find(supplier => supplier.id === query.id)} history={history} query={query} historyPage={historyPage}/>;
        }
        case "employees": {
            const historyPage = queryOptions.parse({ page: search.historyPage }).page;
            const [data, activity] = await Promise.all([
                readShop("employees", query), query.employee ? readShop("movements", { employee: query.employee, page: historyPage }) : undefined,
            ]);
            return <Employees data={data} actor={employee} query={query} activity={activity} historyPage={historyPage}/>;
        }
        case "settings": {
            const [data, lookups] = await Promise.all([readShop("settings", query), readShop("lookups")]);
            return <Settings data={data} lookups={lookups} page={query.page}/>;
        }
        case "reports": {
            const { timezone } = await readShop("lookups");
            const today = businessToday(timezone);
            const defaultFrom = new Date(Date.parse(today) - 29 * 86_400_000).toISOString().slice(0, 10);
            const reportQuery = { ...query, from: query.from ?? defaultFrom, to: query.to ?? today };
            const days = (Date.parse(reportQuery.to) - Date.parse(reportQuery.from)) / 86_400_000;
            const invalid = days < 0 || days > 366;
            const [data, movements, finance] = invalid ? [null, { rows: [], total: 0 }, null] : await Promise.all([
                readShop("reports", reportQuery), readShop("movements", reportQuery), readShop("finance_summary", reportQuery),
            ]);
            return <Reports data={data} movements={movements} finance={finance} query={reportQuery} search={search} invalid={invalid}/>;
        }
        default:
            notFound();
    }
}
