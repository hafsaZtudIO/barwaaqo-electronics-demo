import Link from "next/link";
import { money } from "@/backend/contracts";
import { ShopForm } from "../action-form";
import { dateLabel, Field, Heading, Pager, Panel, Table } from "../ui";

export function Customers({ data, customer, query, search }) {
    return <>
      <Heading eyebrow="SELLING" title="Customers" subtitle="Manage customer details, credit balances, and repayments." action={
        <Link className="button button-secondary" href="/pos">Point of sale</Link>}/>
      {customer && <div id="take-payment">
        <Panel title="Take payment" subtitle={`${customer.name} · Outstanding credit ${money(customer.balance_minor)}`}>
          <div className="panel-body">
            {customer.balance_minor > 0 ? <ShopForm key={customer.id} command="record_customer_payment" label="Record ZAAD payment" reset>
              <input type="hidden" name="customer_id" value={customer.id}/>
              <div className="form-grid">
                <Field name="amount_minor" label="Amount received (USD)" type="number" min="0.01" max={Math.min(customer.balance_minor, 999999999) / 100} step="0.01" placeholder="0.00" required/>
                <Field name="note" label="ZAAD reference (optional)" maxLength={180}/>
              </div>
            </ShopForm> : <p>This customer has no outstanding credit.</p>}
          </div>
        </Panel>
      </div>}
      <Panel title={customer ? "Edit customer" : "New customer"}>
        <div className="panel-body">
          <ShopForm key={customer?.id ?? "new"} command="save_customer" label={customer ? "Save changes" : "Add customer"} reset={!customer}>
            <input type="hidden" name="customer_id" value={customer?.id ?? ""}/>
            <div className="form-grid">
              <Field name="name" label="Customer name" defaultValue={customer?.name} maxLength={180} required/>
              <Field name="phone" label="Phone (optional)" type="tel" defaultValue={customer?.phone} maxLength={180}/>
            </div>
          </ShopForm>
        </div>
      </Panel>
      {customer && <>
        <Panel title="Account activity">
          <Table columns={["Date", "Activity", "Amount", "Reference"]} rows={customer.activity.map(entry => [
              dateLabel(entry.created_at), entry.kind, money(entry.amount_minor), entry.note || "—",
          ])} empty="No customer activity yet."/>
        </Panel>
        <Link href="/customers" className="text-link">Back to customers</Link>
      </>}
      <Panel title="Customer directory">
        <form className="filter-bar" action="/customers">
          <Field name="q" label="Search name or phone" defaultValue={query.q} maxLength={150}/>
          <button type="submit" className="button button-secondary">Search</button>
        </form>
        <Table columns={["Customer", "Phone", "Outstanding credit", "Action"]} rows={data.rows.map(row => [
            <Link key={row.id} className="text-link" href={`/customers?id=${row.id}`}>{row.name}</Link>,
            row.phone || "—", money(row.balance_minor),
            row.balance_minor > 0 ? <Link key="payment" className="button button-secondary" href={`/customers?id=${row.id}#take-payment`}>Take payment</Link> : "—",
        ])} empty="No customers found."/>
        <Pager path="/customers" page={query.page} search={search} total={data.total}/>
      </Panel>
    </>;
}
