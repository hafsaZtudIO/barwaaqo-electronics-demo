import Link from "next/link";
import { money, outgoingPayments } from "@/backend/contracts";
import { PurchaseForm } from "../purchase-form";
import { ShopForm } from "../action-form";
import { dateLabel, Field, Heading, Pager, Panel, Select, Table } from "../ui";

export function Purchases({ data, purchase, lookups, query, search, today }) {
    const options = data.suppliers.map(supplier => ({ value: supplier.id, label: supplier.name }));
    return <>
      <Heading eyebrow="BUYING" title="Supplier purchases" subtitle="Create orders, receive deliveries, and track supplier payments."
        action={<Link className="button button-secondary" href="/suppliers">Manage suppliers</Link>}/>
      {purchase ? <>
        <Panel title={`Order #${purchase.id.slice(0, 8).toUpperCase()} · ${purchase.supplier_name}`}
          subtitle={`${purchase.status} · Ordered ${dateLabel(purchase.ordered_on)}`}
          action={<Link className="text-link" href="/purchases">New purchase order</Link>}>
          <div className="panel-body">
            <p>{purchase.reference && <>Reference {purchase.reference} · </>}Total <strong>{money(purchase.total_minor)}</strong> · Paid <strong>{money(purchase.paid_minor)}</strong>
              {purchase.status !== "cancelled" && <> · Outstanding <strong>{money(purchase.balance_minor)}</strong></>}</p>
            {purchase.due_on && <p>Payment due {dateLabel(purchase.due_on)}</p>}
            {purchase.received_on && <p>Stock received {dateLabel(purchase.received_on)}</p>}
            {purchase.notes && <p>{purchase.notes}</p>}
          </div>
          <Table columns={["Product", "Quantity", "Unit cost", "Line total"]} rows={purchase.items.map(item => [
              `${item.product_name} · ${item.sku}`, `${item.quantity} ${item.unit}`, money(item.cost_minor), money(item.quantity * item.cost_minor),
          ])}/>
        </Panel>
        <div className="two-columns">
          {purchase.status === "ordered" && <Panel title="Receive delivery" subtitle="Receive the complete order once the products arrive.">
            <div className="panel-body">
              <ShopForm key={purchase.id} command="receive_purchase" label="Receive into stock"
                confirmation="Receive every item on this order into available stock?">
                <input type="hidden" name="id" value={purchase.id}/>
                <Field name="occurred_on" label="Receipt date" type="date" defaultValue={today} min={purchase.ordered_on} max={today} required/>
              </ShopForm>
              {purchase.paid_minor === 0 && <ShopForm command="cancel_purchase" label="Cancel order" secondary confirmation="Cancel this unpaid purchase order?">
                <input type="hidden" name="id" value={purchase.id}/>
              </ShopForm>}
            </div>
          </Panel>}
          {purchase.status !== "cancelled" && purchase.balance_minor > 0 && <Panel title="Pay supplier" subtitle={`Outstanding ${money(purchase.balance_minor)}`}>
            <div className="panel-body"><ShopForm key={purchase.id} command="record_supplier_payment" label="Record supplier payment" reset>
              <input type="hidden" name="id" value={purchase.id}/>
              <div className="form-grid">
                <Field name="amount_minor" label="Amount paid (USD)" type="number" min="0.01" max={Math.min(purchase.balance_minor, 999999999) / 100} step="0.01" required/>
                <Select name="payment" label="Paid using" options={outgoingPayments.map(value => ({ value, label: value }))} required/>
                <Field name="occurred_on" label="Payment date" type="date" defaultValue={today} min={purchase.ordered_on} max={today} required/>
                <Field name="reference" label="Payment reference" maxLength={180}/>
              </div>
            </ShopForm></div>
          </Panel>}
        </div>
        <Panel title="Supplier payments">
          <Table columns={["Date", "Amount", "Method", "Reference"]} rows={purchase.payments.map(entry => [
              dateLabel(entry.occurred_on), money(entry.amount_minor), entry.payment, entry.reference || "—",
          ])} empty="No payments recorded for this order."/>
        </Panel>
      </> : <Panel title="New purchase order" subtitle="Receiving the order adds its products to stock.">
        <div className="panel-body">
          {data.suppliers.length && lookups.products.length
            ? <PurchaseForm suppliers={data.suppliers} products={lookups.products.filter(product => !product.archived)} today={today}/>
            : <p>Add a supplier and active products before creating a purchase order.</p>}
        </div>
      </Panel>}
      <Panel title="Purchase history">
        <form className="filter-bar" action="/purchases">
          <Field name="q" label="Search" defaultValue={query.q} placeholder="Supplier or reference"/>
          <Select name="supplier" label="Supplier" placeholder="All suppliers" options={options} value={query.supplier}/>
          <Field name="from" label="From" type="date" defaultValue={query.from}/>
          <Field name="to" label="To" type="date" defaultValue={query.to}/>
          <button type="submit" className="button button-secondary">Filter orders</button>
        </form>
        <Table columns={["Order", "Supplier", "Date", "Status", "Total", "Paid", "Outstanding"]} rows={data.rows.map(order => [
            <Link key={order.id} className="text-link" href={`/purchases?id=${order.id}`}>{order.reference || order.id.slice(0, 8).toUpperCase()}</Link>,
            order.supplier_name, dateLabel(order.ordered_on), order.status, money(order.total_minor), money(order.paid_minor),
            order.status === "cancelled" ? "—" : money(order.balance_minor),
        ])} empty="No purchase orders match this view."/>
        <Pager path="/purchases" search={search} page={query.page} total={data.total}/>
      </Panel>
      <Panel title="Supplier balances" subtitle="Outstanding orders and received purchases across all dates.">
        <Table columns={["Supplier", "Amount owed", "Orders"]} rows={data.suppliers.map(supplier => [
            supplier.name, money(supplier.balance_minor),
            <Link key="orders" href={`/purchases?supplier=${supplier.id}`} className="text-link">View orders</Link>,
        ])} empty="No suppliers yet."/>
      </Panel>
    </>;
}
