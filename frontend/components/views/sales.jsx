import Link from "next/link";
import Image from "next/image";
import { ReceiptText, ShoppingCart } from "lucide-react";
import { checkoutPayments, money } from "@/backend/contracts";
import { ShopForm } from "../action-form";
import { PrintReceipt } from "../sale-fields";
import { dateLabel, Field, Heading, Pager, Panel, Select, Table } from "../ui";
export function Sales({ data, lookups, employee, query, search }) {
    return <>
    <Heading eyebrow="TRANSACTIONS" title="Sales history" subtitle="Find completed sales and reopen receipts." action={<Link href="/pos" className="button"><ShoppingCart size={17}/> Open checkout</Link>}/>
    <Panel title={employee.role === "admin" ? "Sales history" : "Your sales history"} subtitle={`${data.total} recorded sales`}>
      <form className="filter-bar" action="/sales">
        <Field name="from" label="From" type="date" defaultValue={query.from}/>
        <Field name="to" label="To" type="date" defaultValue={query.to}/>
        <button type="submit" className="button button-secondary">Filter sales</button>
        {(query.from || query.to) && <Link className="button button-secondary" href="/sales">Clear filters</Link>}
      </form>
      <Table columns={["Receipt", "Customer", "Employee", "Payment", "Date", "Total"]} rows={data.rows.map(sale => [
            <Link key={sale.id} className="cell-link" href={`/sales?receipt=${sale.id}`}><ReceiptText size={15}/>{sale.id.slice(0, 8).toUpperCase()}</Link>,
            sale.customer_name || "Walk-in", sale.employee_name, sale.payment, dateLabel(sale.created_at, lookups.timezone), money(sale.total_minor),
        ])} empty="No sales match this view."/>
      <Pager path="/sales" search={search} page={query.page} total={data.total}/>
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
