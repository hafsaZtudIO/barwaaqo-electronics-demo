import Link from "next/link";
import { Download, Search } from "lucide-react";
import { minimumPasswordLength, money } from "@/backend/contracts";
import { ActionForm, ShopForm } from "../action-form";
import { createEmployee, updateEmployeeLogin } from "@/backend/actions";
import { dateLabel, Field, Heading, Notes, options, Pager, Panel, Select, Table } from "../ui";
import { MovementTable } from "./inventory";
import { publicUrl } from "../../platform/navigation";
export function Suppliers({ data, selected, history, query, historyPage }) {
    return <>
    <Heading eyebrow="ADMINISTRATION" title="Suppliers" subtitle="Manage supplier details and review delivery history."
      action={<Link href="/purchases" className="button button-secondary">Purchases and balances</Link>}/>
    <div className="two-columns">
      <Panel title="Supplier directory" subtitle={`${data.total} suppliers`}>
        <Table columns={["Supplier", "Phone", "Email"]} rows={data.rows.map(supplier => [
            <Link key={supplier.id} className="cell-link" href={`/suppliers?id=${supplier.id}&page=${query.page}`}>{supplier.name}</Link>,
            supplier.phone || "—", supplier.email || "—",
        ])} empty="No suppliers added yet."/>
        <Pager path="/suppliers" search={{}} page={query.page} total={data.total}/>
      </Panel>
      <Panel title={selected ? `Edit ${selected.name}` : "Add supplier"} action={selected && <Link href="/suppliers" className="text-link">Add new supplier</Link>}>
        <div className="panel-body"><ShopForm key={selected?.id} command="save_supplier" label={selected ? "Save supplier" : "Add supplier"} reset={!selected}>
          <input type="hidden" name="id" value={selected?.id ?? ""}/>
          <div className="form-grid">
            <Field label="Supplier name" name="name" defaultValue={selected?.name} maxLength={180} required/>
            <Field label="Phone" name="phone" type="tel" defaultValue={selected?.phone} maxLength={180}/>
            <Field label="Email" name="email" type="email" defaultValue={selected?.email} maxLength={254}/>
            <Field label="Address" name="address" defaultValue={selected?.address} maxLength={180}/>
            <Notes value={selected?.notes}/>
          </div>
        </ShopForm></div>
      </Panel>
    </div>
    {selected && history && <Panel title={`Supply history · ${selected.name}`}>
      <MovementTable data={history} admin/>
      <Pager path="/suppliers" search={{ id: selected.id, page: String(query.page) }} page={historyPage} pageParam="historyPage" total={history.total}/>
    </Panel>}
  </>;
}
export function Employees({ data, actor, query, activity, historyPage }) {
    return <>
    <Heading eyebrow="ADMINISTRATION" title="Employees" subtitle="Create staff logins and manage access to the workspace."/>
      <Panel title="Create employee account">
        <div className="panel-body"><ActionForm action={createEmployee} label="Create account" reset>
          <div className="form-grid">
            <Field label="Full name" name="full_name" autoComplete="off" maxLength={180} required/>
            <Field label="Employee number" name="employee_number" placeholder="e.g. EMP-001" autoComplete="off" maxLength={30} required/>
            <Field label="Username" name="username" autoComplete="off" autoCapitalize="none" minLength={3} maxLength={40} required/>
            <Field label="Password" name="password" type="password" autoComplete="new-password" minLength={minimumPasswordLength} maxLength={128} required/>
            <Field label="Confirm password" name="confirm" type="password" autoComplete="new-password" minLength={minimumPasswordLength} maxLength={128} required/>
          </div>
        </ActionForm></div>
      </Panel>
    <Panel title="Team directory" subtitle={`${data.total} employee records`}>
      <Table columns={["Employee", "Sign-in details", "Status", "Created", "Permissions", "Activity"]} rows={data.rows.map(employee => [
            <strong key="employee">{employee.full_name}</strong>,
            <details key="login">
              <summary>{employee.username ? `${employee.employee_number} · ${employee.username}` : "Set number and username"}</summary>
              <ActionForm action={updateEmployeeLogin} label="Save sign-in details" secondary>
                <input type="hidden" name="id" value={employee.id}/>
                <div className="inline-fields">
                  <Field label="Employee number" name="employee_number" defaultValue={employee.employee_number ?? ""} maxLength={30} required/>
                  <Field label="Username" name="username" defaultValue={employee.username ?? ""} minLength={3} maxLength={40} required/>
                </div>
              </ActionForm>
            </details>,
            <span key="status" className={`badge ${employee.active ? "" : "badge-neutral"}`}>{employee.active ? "Active" : "Inactive"}</span>,
            dateLabel(employee.created_at),
            employee.id === actor.id ? "Administrator (you)" :
                <ShopForm key="permissions" command="update_employee" label="Save access" secondary confirmation={`Save access for ${employee.full_name}?`}>
            <input type="hidden" name="id" value={employee.id}/>
            <div className="inline-fields">
              <Select label="Role" name="role" value={employee.role} options={[{ value: "employee", label: "Employee" }, { value: "admin", label: "Admin" }]}/>
              <Select label="Access" name="active" value={String(employee.active)} options={[{ value: "true", label: "Active" }, { value: "false", label: "Inactive" }]}/>
            </div>
          </ShopForm>,
            <div key="activity" className="flow"><Link className="text-link" href={`/employees?employee=${employee.id}#activity`}>Stock</Link>
          <Link className="text-link" href={`/sales?employee=${employee.id}`}>Sales</Link></div>,
        ])}/>
      <Pager path="/employees" search={query.employee ? { employee: query.employee } : {}} page={query.page} total={data.total}/>
    </Panel>
    {activity && <div id="activity"><Panel title="Employee stock activity"><MovementTable data={activity} admin/>
      <Pager path="/employees" search={{ employee: query.employee, page: String(query.page) }} page={historyPage} pageParam="historyPage" total={activity.total}/>
    </Panel></div>}
  </>;
}
export function Settings({ data, lookups, page }) {
    return <>
    <Heading eyebrow="ADMINISTRATION" title="Settings" subtitle="Manage store preferences, product categories, and the audit trail."/>
    <div className="two-columns">
      <Panel title="Shop details" subtitle="The business timezone controls dashboard and report dates.">
        <div className="panel-body"><ShopForm command="save_settings" label="Save settings">
          <div className="form-grid">
            <Field label="Shop name" name="name" defaultValue={data.settings.name} required/>
            <Field label="Business timezone" name="timezone" defaultValue={data.settings.timezone} placeholder="Africa/Nairobi" required/>
          </div>
        </ShopForm></div>
      </Panel>
      <Panel title="Product categories"><div className="panel-body flow">
        <ShopForm command="save_category" label="Add category" reset>
          <input type="hidden" name="id" value=""/><Field label="New category name" name="name" maxLength={180} required/>
        </ShopForm>
        <ShopForm command="save_category" label="Rename category" secondary>
          <div className="form-grid">
            <Select label="Existing category" name="id" options={options(lookups.categories)} placeholder="Select category" required/>
            <Field label="New name" name="name" maxLength={180} required/>
          </div>
        </ShopForm>
      </div></Panel>
    </div>
    <Panel title="Audit log" subtitle="Administrative changes are recorded with the employee and time.">
      <Table columns={["Date", "Employee", "Action", "Record"]} rows={data.audit.rows.map(row => [
            dateLabel(row.created_at, data.settings.timezone), row.employee_name, row.action.replaceAll("_", " "), row.target_id || "—",
        ])} empty="No administrative changes recorded yet."/>
      <Pager path="/settings" search={{}} page={page} total={data.audit.total}/>
    </Panel>
  </>;
}
export function Reports({ data, movements, finance, query, search, invalid }) {
    const exportHref = (kind) => publicUrl(`/api/v1/export?${new URLSearchParams({
        kind, ...(query.from ? { from: query.from } : {}), ...(query.to ? { to: query.to } : {}), ...(query.type ? { type: query.type } : {}),
    })}`);
    return <>
    <Heading eyebrow="ANALYTICS" title="Reports" subtitle="Review sales performance and inventory activity."/>
    <Panel title="Report filters" subtitle="Sales default to the last 30 business days.">
      <form action="/reports" className="filter-bar">
        <Field label="From" name="from" type="date" defaultValue={query.from}/>
        <Field label="To" name="to" type="date" defaultValue={query.to}/>
        <Select label="Movement type" name="type" value={query.type} placeholder="All movements" options={[
            { value: "in", label: "Stock receipts" }, { value: "outgoing", label: "All outgoing" },
            { value: "sale", label: "Sales" }, { value: "out", label: "Non-sale issues" },
            { value: "return", label: "Customer returns" }, { value: "reversal", label: "Corrections" },
        ]}/>
        <button type="submit" className="button button-secondary"><Search size={16}/> Apply filters</button>
      </form>
      <div className="panel-body form-actions">
        {data && <a className="button button-secondary button-small" href={exportHref("sales")}><Download size={15}/> Sales CSV</a>}
        {!invalid && <a className="button button-secondary button-small" href={exportHref("movements")}><Download size={15}/> Movements CSV</a>}
        <a className="button button-secondary button-small" href={exportHref("inventory")}><Download size={15}/> Inventory CSV</a>
        <Link className="text-link" href="/products?status=low">Low-stock products</Link>
        <Link className="text-link" href="/products?status=out">Out-of-stock products</Link>
      </div>
      {invalid && <div className="panel-body"><p className="notice notice-error">Choose dates in order with at most 367 days in the range.</p></div>}
    </Panel>
    {data && <>
      {finance && <Panel title="Shop costs and supplier payments">
        <div className="panel-body">
          <p>Expenses paid in this period <strong>{money(finance.expenses_minor)}</strong></p>
          <p>Supplier payments in this period <strong>{money(finance.supplier_payments_minor)}</strong></p>
          <p>Current amount owed to suppliers across all dates <strong>{money(finance.supplier_balance_minor)}</strong></p>
          <div className="form-actions">
            <Link href={`/expenses?from=${query.from}&to=${query.to}`} className="text-link">Review expenses</Link>
            <Link href="/purchases" className="text-link">Review supplier purchases</Link>
          </div>
        </div>
      </Panel>}
      <div className="stats-grid">{[
                ["Sales revenue", money(data.revenue_minor)], ["Net received cost", money(data.received_cost_minor)],
                ["Estimated gross profit", money(data.revenue_minor - data.cost_of_goods_minor)],
                ["Stock received", data.received], ["Stock issued", data.issued],
            ].map(([label, value]) => <article className="stat" key={label}><div className="stat-label">{label}</div><strong>{value}</strong></article>)}</div>
      <div className="two-columns">
        {[["Daily sales", data.daily], ["Weekly sales", data.weekly], ["Monthly sales", data.monthly]].map(([title, rows]) => <Panel key={title} title={title}><Table columns={["Period starting", "Sales", "Revenue"]} rows={rows.map(row => [dateLabel(row.period), row.sales, money(row.revenue_minor)])} empty="No sales in this range."/></Panel>)}
        <Panel title="Best-selling products"><Table columns={["Product", "Units sold", "Sales before discounts"]} rows={data.products.map(row => [row.name, row.units, money(row.revenue_minor)])} empty="No products sold in this range."/></Panel>
        <Panel title="Sales by employee"><Table columns={["Employee", "Sales", "Revenue"]} rows={data.employees.map(row => [row.name, row.sales, money(row.revenue_minor)])} empty="No sales in this range."/></Panel>
      </div>
    </>}
    {!invalid && <Panel title="Inventory movement report"><MovementTable data={movements} admin corrections/>
      <Pager path="/reports" search={search} page={query.page} total={movements.total}/>
    </Panel>}
  </>;
}
