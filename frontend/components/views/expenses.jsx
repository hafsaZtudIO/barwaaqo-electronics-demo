import Link from "next/link";
import { expenseCategories, money, outgoingPayments } from "@/backend/contracts";
import { ShopForm } from "../action-form";
import { dateLabel, Field, Heading, Notes, Pager, Panel, Select, Table } from "../ui";

export function Expenses({ data, query, search, today }) {
    return <>
      <Heading eyebrow="SHOP COSTS" title="Expenses" subtitle="Record paid shop costs and review where the money went."/>
      <Panel title="Record an expense">
        <div className="panel-body">
          <ShopForm command="record_expense" label="Record expense" reset>
            <div className="form-grid">
              <Select name="category" label="Category" options={expenseCategories.map(value => ({ value, label: value }))} required/>
              <Field name="description" label="Description" maxLength={180} placeholder="November shop rent" required/>
              <Field name="amount_minor" label="Amount (USD)" type="number" min="0.01" max="9999999.99" step="0.01" required/>
              <Select name="payment" label="Paid using" options={outgoingPayments.map(value => ({ value, label: value }))} required/>
              <Field name="occurred_on" label="Payment date" type="date" defaultValue={today} max={today} required/>
              <Field name="reference" label="Payment reference (optional)" maxLength={180}/>
              <Notes/>
            </div>
          </ShopForm>
        </div>
      </Panel>
      <Panel title="Expense history" subtitle={`${data.total} records · ${money(data.amount_minor)} paid in this view`}>
        <form action="/expenses" className="filter-bar">
          <Field name="q" label="Search" defaultValue={query.q} placeholder="Description, category, or reference"/>
          <Field name="from" label="From" type="date" defaultValue={query.from}/>
          <Field name="to" label="To" type="date" defaultValue={query.to}/>
          <button type="submit" className="button button-secondary">Filter expenses</button>
          <Link href="/expenses" className="text-link">Clear filters</Link>
        </form>
        <Table columns={["Date", "Category", "Description", "Amount", "Payment", "Recorded by", "Status"]} rows={data.rows.map(entry => [
            dateLabel(entry.occurred_on), entry.category,
            <span key="description">{entry.description}{entry.reference && <small> · {entry.reference}</small>}{entry.notes && <p>{entry.notes}</p>}</span>,
            money(entry.amount_minor), entry.payment, entry.employee_name,
            entry.void_reason ? <span key="voided">Voided · {entry.void_reason}</span> :
              <details key="void"><summary>Void expense</summary>
                <ShopForm command="void_expense" label="Void expense" confirmation="Void this expense and remove it from paid expense totals?">
                  <input type="hidden" name="id" value={entry.id}/>
                  <Field name="reason" label="Reason for voiding" maxLength={180} required/>
                </ShopForm>
              </details>,
        ])} empty="No expenses match this view."/>
        <Pager path="/expenses" search={search} page={query.page} total={data.total}/>
      </Panel>
    </>;
}
