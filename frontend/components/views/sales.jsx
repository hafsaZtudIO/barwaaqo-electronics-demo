import Link from "next/link";
import Image from "next/image";
import { CalendarDays, ReceiptText, Search, ShoppingCart, X } from "lucide-react";
import { checkoutPayments, money, payments } from "@/backend/contracts";
import { ShopForm } from "../action-form";
import { PrintReceipt } from "../sale-fields";
import { businessToday, dateLabel, Field, Heading, number, Panel, Select, Table } from "../ui";

const saleStatuses = [
    { value: "all", label: "All sales" }, { value: "completed", label: "No returns" },
    { value: "part-returned", label: "Partly returned" }, { value: "returned", label: "Fully returned" },
];
const saleSorts = [
    { value: "newest", label: "Newest first" }, { value: "oldest", label: "Oldest first" },
    { value: "total-high", label: "Highest amount" }, { value: "total-low", label: "Lowest amount" },
    { value: "customer", label: "Customer name" },
];

export function Sales({ data, lookups, employee, query, customers = [], employees = [], error }) {
    const admin = employee.role === "admin";
    const product = query.product ? lookups.products.find(item => item.id === query.product) : null;
    const employeeOptions = employees.map(item => ({ value: item.id, label: item.full_name ?? item.name ?? item.username }));
    if (query.employee && !employeeOptions.some(item => item.value === query.employee)) employeeOptions.push({ value: query.employee, label: "Selected employee" });
    const customerOptions = customers.map(item => ({ value: item.id, label: item.name }));
    if (query.customer && !customerOptions.some(item => item.value === query.customer)) customerOptions.push({ value: query.customer, label: "Selected customer" });
    const active = Object.fromEntries(["q", "customer", "product", "payment", "sale_status", "from", "to", "sales_sort", "page_size", ...(admin ? ["employee"] : [])]
        .map(key => [key, query[key]])
        .filter(([key, value]) => value != null && value !== "" && !(key === "sale_status" && value === "all")));
    function href(changes = {}) {
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries({ ...active, ...changes }))
            if (value != null && value !== "") params.set(key, String(value));
        return params.size ? `/sales?${params}` : "/sales";
    }
    const timezone = lookups.timezone ?? "Africa/Nairobi";
    const today = businessToday(timezone);
    const weekStart = new Date(`${today}T12:00:00Z`);
    weekStart.setUTCDate(weekStart.getUTCDate() - 6);
    const dateRanges = [
        { label: "Today", from: today, to: today },
        { label: "Last 7 days", from: weekStart.toISOString().slice(0, 10), to: today },
        { label: "This month", from: `${today.slice(0, 8)}01`, to: today },
        { label: "All time", from: undefined, to: undefined },
    ];
    const filters = [
        query.q && { key: "q", label: `Search: ${query.q}` },
        query.customer && { key: "customer", label: `Customer: ${customers.find(item => item.id === query.customer)?.name ?? "Selected customer"}` },
        query.product && { key: "product", label: `Product: ${product?.name ?? "Selected product"}` },
        query.payment && { key: "payment", label: `Payment: ${query.payment}` },
        query.sale_status && query.sale_status !== "all" && { key: "sale_status", label: saleStatuses.find(item => item.value === query.sale_status)?.label ?? "Return status" },
        query.from && { key: "from", label: `From: ${dateLabel(query.from)}` },
        query.to && { key: "to", label: `To: ${dateLabel(query.to)}` },
        admin && query.employee && { key: "employee", label: `Employee: ${employees.find(item => item.id === query.employee)?.full_name ?? employees.find(item => item.id === query.employee)?.name ?? "Selected employee"}` },
    ].filter(Boolean);
    const pageSize = data.page_size ?? query.page_size ?? 25;
    const page = data.page ?? query.page ?? 1;
    const pages = Math.max(1, Math.ceil(data.total / pageSize));
    const first = data.rows.length ? (page - 1) * pageSize + 1 : 0;
    const last = data.rows.length ? first + data.rows.length - 1 : 0;
    const time = new Intl.DateTimeFormat("en-GB", { timeStyle: "short", timeZone: timezone });
    return <>
    <Heading eyebrow="TRANSACTIONS" title={query.product ? "Product sales history" : "Sales history"}
      subtitle={product ? `Recorded sales containing ${product.name}.` : admin ? "Find a sale, review returns, and reopen its receipt." : "Find your sales, review returns, and reopen a receipt."}
      action={<Link href="/pos" className="button"><ShoppingCart size={17}/> Open checkout</Link>}/>
    <Panel title="Find a sale" subtitle="Search receipts or narrow the list using the filters below.">
      <div className="panel-body">
        <form className="sales-history-filters" action="/sales" key={JSON.stringify(active)}>
          {query.product && <input type="hidden" name="product" value={query.product}/>}
          <input type="hidden" name="sales_sort" value={query.sales_sort ?? "newest"}/>
          <input type="hidden" name="page_size" value={pageSize}/>
          <div className="sales-filter-search"><Field name="q" label="Receipt, customer, or reference" type="search" placeholder="Search sales…" defaultValue={query.q} maxLength={150}/></div>
          <Select name="customer" label="Customer" value={query.customer} placeholder="All customers" options={customerOptions}/>
          <Select name="payment" label="Payment method" value={query.payment} placeholder="All payment methods" options={payments.map(value => ({ value, label: value }))}/>
          <Select name="sale_status" label="Return status" value={query.sale_status ?? "all"} options={saleStatuses}/>
          <Field name="from" label="From date" type="date" defaultValue={query.from}/>
          <Field name="to" label="To date" type="date" defaultValue={query.to}/>
          {admin && <Select name="employee" label="Employee" value={query.employee} placeholder="All employees" options={employeeOptions}/>}
          <div className="sales-filter-actions"><button type="submit" className="button"><Search size={16}/> Apply filters</button>{filters.length > 0 && <Link className="text-link" href="/sales">Clear filters</Link>}</div>
        </form>
        <nav className="sales-date-shortcuts" aria-label="Sales date ranges"><span><CalendarDays size={15}/> Date range</span>{dateRanges.map(range => <Link key={range.label}
          href={href({ from: range.from, to: range.to })} aria-current={(query.from ?? undefined) === range.from && (query.to ?? undefined) === range.to ? "true" : undefined}>{range.label}</Link>)}</nav>
        {filters.length > 0 && <nav className="sales-filter-chips" aria-label="Active sales filters"><span>{filters.length} active {filters.length === 1 ? "filter" : "filters"}</span>{filters.map(filter => <Link className="sales-filter-chip" key={filter.key} href={href({ [filter.key]: undefined })} aria-label={`Remove filter: ${filter.label}`}>{filter.label}<X size={13} aria-hidden="true"/></Link>)}</nav>}
      </div>
    </Panel>
    <Panel title={admin ? "Recorded sales" : "Your recorded sales"}>
      {error && <div className="panel-body"><p className="notice notice-error" role="alert">{error}</p></div>}
      <div className="sales-list-toolbar">
        <div className="sales-list-summary">{error ? <p>Sales list unavailable</p> : <><p>Showing <strong>{number(first)}–{number(last)}</strong> of <strong>{number(data.total)}</strong> sales</p>
          {data.summary && <p>Receipt value <strong>{money(data.summary.total_minor)}</strong><small>All matching sales, before return adjustments</small></p>}</>}
        </div>
        <form className="sales-list-options" action="/sales" key={`sort-${JSON.stringify(active)}`}>
          {Object.entries(active).filter(([key]) => key !== "sales_sort" && key !== "page_size").map(([key, value]) => <input key={key} type="hidden" name={key} value={value}/>)}
          <Select name="sales_sort" label="Sort by" value={query.sales_sort ?? "newest"} options={saleSorts}/>
          <Select name="page_size" label="Rows per page" value={pageSize} options={[25, 50, 100].map(value => ({ value, label: String(value) }))}/>
          <button className="button button-secondary" type="submit">Update list</button>
        </form>
      </div>
      {error ? null : data.rows.length ? <div className="table-scroll sales-history-table" role="region" aria-label="Sales history" tabIndex={0}><table>
        <thead><tr><th scope="col">Receipt</th><th scope="col">Customer</th><th scope="col">Employee</th><th scope="col">Payment</th><th scope="col">Return status</th><th scope="col">Date</th><th scope="col" className="sales-numeric">Total</th></tr></thead>
        <tbody>{data.rows.map(sale => {
            const status = sale.sale_status ?? "completed";
            return <tr key={sale.id}>
              <td className="sales-receipt-cell"><Link className="cell-link" href={`/sales?receipt=${sale.id}`}><ReceiptText size={15}/>{sale.id.slice(0, 8).toUpperCase()}</Link><small>View receipt</small></td>
              <td>{sale.customer_name || "Walk-in customer"}</td><td>{sale.employee_name}</td>
              <td><span className={`badge sales-payment-badge${sale.payment === "Credit" ? " badge-warn" : " badge-neutral"}`}>{sale.payment}</span></td>
              <td><span className={`badge sales-state-${status}`}>{saleStatuses.find(item => item.value === status)?.label ?? "No returns"}</span></td>
              <td><span>{dateLabel(sale.created_at, timezone)}</span><small>{time.format(new Date(sale.created_at))}</small></td>
              <td className="sales-numeric"><strong>{money(sale.total_minor)}</strong></td>
            </tr>;
        })}</tbody>
      </table></div> : <div className="sales-list-empty"><ReceiptText size={28}/><h3>No sales match this view</h3><p>{filters.length ? "Try a different date range or remove a filter to find the receipt." : "Recorded sales will appear here after checkout."}</p><div className="form-actions">{filters.length > 0 && <Link className="button button-secondary" href="/sales">Clear filters</Link>}<Link className="button" href="/pos">Open checkout</Link></div></div>}
      {!error && <nav className="sales-list-pagination pager" aria-label="Sales history pagination"><span>Page {number(page)} of {number(pages)} · {number(data.total)} sales</span><div>
        {page > 1 ? <Link className="button button-secondary button-small" href={href({ page: page - 1 })}>Previous</Link> : <span className="button button-secondary button-small" aria-disabled="true">Previous</span>}
        {page < pages ? <Link className="button button-secondary button-small" href={href({ page: page + 1 })}>Next</Link> : <span className="button button-secondary button-small" aria-disabled="true">Next</span>}
      </div></nav>}
    </Panel>
  </>;
}
export function SaleCorrection({ receipt, customers, revision }) {
    const { sale, items } = receipt;
    const receiptPath = `/sales?receipt=${sale.id}`;
    const methods = [...new Set([...checkoutPayments, sale.payment])];
    return <>
      <Heading title="Edit completed sale" eyebrow={`Receipt #${sale.id.slice(0, 8).toUpperCase()}`} action={<Link href={receiptPath} className="button button-secondary">View receipt</Link>}/>
      <Panel title="Sale correction">
        <div className="panel-body">
          {revision === null ? <p className="notice notice-error">The shop database needs the sale corrections update.</p> :
            <ShopForm key={sale.id} command="correct_sale" label="Save correction" receipt>
              <input type="hidden" name="id" value={sale.id}/>
              <input type="hidden" name="revision" value={revision}/>
              <div className="form-grid">
                <Select label="Payment method" name="payment" value={sale.payment} options={methods.map(value => ({ value, label: value }))} required/>
                <Select label="Customer" name="customer_id" placeholder="Walk-in customer" value={sale.customer_id ?? ""}
                  options={customers.map(customer => ({ value: customer.id, label: customer.phone ? `${customer.name} · ${customer.phone}` : customer.name }))}/>
                <Field label="Payment note" name="payment_note" defaultValue={sale.payment_note} maxLength={180}/>
                <Field label="Reason for correction" name="reason" maxLength={180} required/>
              </div>
              <Table columns={["Product", "Unit price", "Quantity"]} rows={items.map(item => [
                <span key={item.sku}>{item.product_name} · {item.sku}<input type="hidden" name="sku" value={item.sku}/></span>,
                money(item.unit_minor),
                <Field key="qty" label={`Quantity in ${item.unit ?? "Pcs"}`} name="quantity" type="number" min={1} max={1000000} defaultValue={item.quantity} required/>,
              ])}/>
            </ShopForm>}
        </div>
      </Panel>
    </>;
}
export function Receipt({ receipt, autoPrint, canEdit }) {
    const { sale, items, settings, returns = [] } = receipt;
    const discount = sale.discount_minor ?? 0;
    const hasProductDiscount = items.some(item => item.discount_minor > 0);
    const date = new Intl.DateTimeFormat("en-GB", {
        dateStyle: "medium", timeStyle: "short", timeZone: settings.timezone,
    }).format(new Date(sale.created_at));
    return <>
    <Heading eyebrow="TRANSACTIONS" title="Sales receipt" action={<div className="heading-actions">
        <Link href="/sales" className="button button-secondary">Sales history</Link>
        {canEdit && <Link href={`/sales?receipt=${sale.id}&edit=1`} className="button button-secondary">Edit sale</Link>}
        {receipt.returns && items.some(item => item.returned_quantity < item.quantity) &&
          <Link href={`/sales?receipt=${sale.id}&return=1`} className="button button-secondary">Return items</Link>}
        <Link href="/pos" className="button"><ShoppingCart size={17}/> New sale</Link>
        <PrintReceipt autoPrint={autoPrint}/>
      </div>}/>
    <article className="printable sales-receipt" aria-label="Printable sales receipt">
      <header className="receipt-header">
        <Image id="receipt-logo" src="/logo.png" alt="" width={64} height={64} unoptimized loading="eager"/>
        <div><h2>{settings.name}</h2><p>Sales receipt <strong>#{sale.id.slice(0, 8).toUpperCase()}</strong></p></div>
      </header>
      <dl className="receipt-details">
        <div><dt>Date and time</dt><dd>{date}</dd></div>
        <div><dt>Payment method</dt><dd>{sale.payment === "Cash" ? "Cash (USD)" : sale.payment}</dd></div>
        <div><dt>Customer</dt><dd>{sale.customer_name || "Walk-in"}</dd></div>
        <div><dt>Served by</dt><dd>{sale.employee_name}</dd></div>
        {sale.payment_note && <div className="receipt-note"><dt>Payment note</dt><dd>{sale.payment_note}</dd></div>}
      </dl>
      <table className="receipt-items">
        <thead><tr><th scope="col">Product</th><th scope="col">Qty</th><th scope="col">Amount</th></tr></thead>
        <tbody>{items.map(item => <tr key={item.sku}>
          <td><strong>{item.product_name}</strong><small>{item.sku} · {money(item.unit_minor)} / {item.unit ?? "Pcs"}</small>
            {item.discount_minor > 0 && <small>Line discount −{money(item.discount_minor)}</small>}</td>
          <td>{item.quantity} {item.unit ?? "Pcs"}</td>
          <td>{money(item.quantity * item.unit_minor - (item.discount_minor ?? 0))}</td>
        </tr>)}</tbody>
      </table>
      <dl className="receipt-totals">
        {discount > 0 && <>
          <div><dt>Subtotal</dt><dd>{money(sale.total_minor + discount)}</dd></div>
          <div><dt>{hasProductDiscount ? "Product discounts" : "Discount"}</dt><dd>−{money(discount)}</dd></div>
        </>}
        <div className="receipt-amount-paid"><dt>{sale.payment === "Credit" ? "Charged to customer account" : "Amount paid"}</dt><dd>{money(sale.total_minor)}</dd></div>
        {sale.cash_received_minor != null && <>
          <div><dt>Cash received</dt><dd>{money(sale.cash_received_minor)}</dd></div>
          <div><dt>Change</dt><dd>{money(sale.cash_received_minor - sale.total_minor)}</dd></div>
        </>}
      </dl>
      <footer className="receipt-footer">Thank you for shopping with us.</footer>
    </article>
    {returns.length > 0 && <Panel title="Returns">
      <Table columns={["Date", "Items", "Refund", "Credit reduction", "Reason", "Recorded by"]} rows={returns.map(entry => [
        dateLabel(entry.created_at, settings.timezone),
        entry.items.map(item => `${item.quantity} × ${item.product_name}${item.restocked ? " (restocked)" : ""}`).join(", "),
        entry.refund_minor ? `${money(entry.refund_minor)} · ${entry.refund_method}` : "—",
        entry.credit_minor ? money(entry.credit_minor) : "—", entry.reason, entry.employee_name,
      ])}/>
    </Panel>}
  </>;
}
