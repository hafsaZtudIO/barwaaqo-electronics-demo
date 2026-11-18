import Link from "next/link";
import { ArrowDownToLine, ArrowRight, ArrowUpFromLine, Boxes, CalendarDays, CircleAlert, Layers3, ReceiptText, ShoppingCart, TrendingUp } from "lucide-react";
import { money } from "@/backend/contracts";
import { businessToday, dateLabel, Empty, Heading, number, Panel, Table } from "../ui";
export function Dashboard({ employee, data }) {
    const admin = employee.role === "admin";
    const stats = [
        { label: "Product types", value: number(data.product_types), icon: Boxes, context: "Active catalog", tone: "green" },
        { label: "Available stock", value: number(data.available), icon: Layers3, context: "Units on hand", tone: "green" },
        { label: "Stock in today", value: number(data.received), icon: ArrowDownToLine, context: admin ? "Units received" : "Units you received", tone: "green" },
        { label: "Stock out today", value: number(data.issued), icon: ArrowUpFromLine, context: admin ? "Units issued" : "Units you issued", tone: "orange" },
        { label: admin ? "Sales today" : "Your sales today", value: money(data.revenue_minor), icon: TrendingUp, context: "Recorded revenue", tone: "green" },
        { label: "Low stock alerts", value: number(data.low_count), icon: CircleAlert, context: "At or below minimum", tone: "orange" },
    ];
    const max = Math.max(...data.chart.map(day => day.revenue_minor), 1);
    const timezone = data.settings.timezone;
    const shortcuts = [
        { title: "Point of sale", links: [
            ["Point of sale", "/pos"], ["Sales history", "/sales"], ["Customers", "/customers"], ["End of day", "/closeout"],
        ] },
        { title: "Stock and buying", links: [
            ["Item list", "/products", data.product_types], ["Receive stock", "/stock-in"], ["Stock out", "/stock-out"],
            ...(admin ? [["Suppliers", "/suppliers"]] : []),
        ] },
    ];
    const reports = [
        { title: "Sales and customers", links: [["Sales register", "/sales"], ["Customer balances", "/customers"], ["End of day", "/closeout"]] },
        { title: "Stock", links: [["Stock shortages", "/products?status=low"], ["Stock receipts", "/stock-in"], ["Stock issues", "/stock-out"]] },
        ...(admin ? [{ title: "Administration", links: [["Reports and exports", "/reports"], ["Employee accounts", "/employees"], ["Shop settings", "/settings"]] }] : []),
    ];
    return <>
    <Heading eyebrow="BARWAAQO ELECTRONICS" title="Showroom" action={<div className="heading-actions"><span className="date-chip"><CalendarDays size={16}/>{dateLabel(businessToday(timezone))}</span>
        <Link href="/pos" className="button"><ShoppingCart size={17}/> Open checkout</Link></div>}/>
    <div className="showroom">
      {shortcuts.map(group => <section key={group.title}>
        <h2>{group.title}</h2>
        <nav className="showroom-shortcuts" aria-label={group.title}>
          {group.links.map(([label, href, count]) => <Link href={href} key={href}>{label}
            {count != null && <span className="showroom-count">{number(count)}</span>}
            <ArrowRight size={14} aria-hidden="true"/>
          </Link>)}
        </nav>
      </section>)}
      <section><h2>Reports and records</h2>
        <div className="showroom-reports">{reports.map(group => <nav aria-label={group.title} key={group.title}>
          <h3>{group.title}</h3>
          {group.links.map(([label, href]) => <Link href={href} key={href}>{label}<ArrowRight size={13} aria-hidden="true"/></Link>)}
        </nav>)}</div>
      </section>
    </div>
    <div className="stats-grid">{stats.map(stat => <article className="stat" key={stat.label}>
      <span className={`stat-icon tone-${stat.tone}`}><stat.icon size={19} strokeWidth={1.8}/></span>
      <div className="stat-label">{stat.label}</div><strong>{stat.value}</strong><small>{stat.context}</small>
    </article>)}</div>
    <div className="dashboard-grid">
      <Panel title={admin ? "Sales activity" : "Your sales activity"} subtitle="Recorded revenue over the past 7 days" action={<span className="date-chip"><span className="legend-dot"/> USD</span>}>
        {!data.chart.some(day => day.revenue_minor) ? <Empty>No revenue recorded in this period.</Empty> :
            <div className="chart" aria-label="Daily sales revenue">
            {data.chart.map(day => <div key={day.day} className="chart-day">
              <span className="chart-amount">{money(day.revenue_minor)}</span>
              <div className="chart-track"><div className="chart-bar" style={{ height: `${day.revenue_minor / max * 100}%` }}/></div>
              <small>{new Intl.DateTimeFormat("en", { weekday: "short", timeZone: "UTC" }).format(new Date(day.day))}</small>
            </div>)}
          </div>}
      </Panel>
      <Panel title="Inventory overview" subtitle="Stock status across active products" action={<span className="stat-icon tone-green"><Boxes size={18}/></span>}>
        <div className="inventory-breakdown">{[
            { label: "Healthy stock", value: data.product_types - data.low_count, className: "good" },
            { label: "Running low", value: data.low_count - data.out_count, className: "low" },
            { label: "Out of stock", value: data.out_count, className: "out" },
        ].map(item => <div key={item.label}><span><i className={`legend-dot ${item.className}`}/>{item.label}</span><strong>{item.value}</strong></div>)}
        <Link className="text-link" href="/products">View inventory <ArrowRight size={15}/></Link></div>
      </Panel>
      <Panel title="Recent sales" subtitle="Latest recorded transactions" action={<Link className="text-link" href="/sales">View sales <ArrowRight size={14}/></Link>}>
        <Table columns={["Receipt", "Payment", "Total"]} rows={data.sales.map(sale => [
            <Link key={sale.id} className="cell-link" href={`/sales?receipt=${sale.id}`}><ReceiptText size={15}/> {sale.id.slice(0, 8).toUpperCase()}</Link>,
            sale.payment, <strong key="amount">{money(sale.total_minor)}</strong>,
        ])} empty="No sales recorded yet."/>
      </Panel>
      <Panel title="Low stock alerts" subtitle="Items that may need replenishing" action={<Link className="text-link" href="/products?status=low">View low stock <ArrowRight size={14}/></Link>}>
        <Table columns={["Product", "On hand", "Minimum"]} rows={data.low.map(product => [
            <Link key={product.id} className="cell-link" href={`/products?id=${product.id}`}>{product.name}</Link>,
            <span key="quantity" className={`badge ${product.quantity ? "badge-warn" : "badge-danger"}`}>{product.quantity}</span>,
            product.minimum_stock,
        ])} empty="All active products are above their minimum level."/>
      </Panel>
    </div>
    <Panel title="Recent stock movements" subtitle="Latest changes to inventory">
      <Table columns={["Product", "Movement", "Units", "Employee", "Date"]} rows={data.movements.map(row => [
            row.product_name, row.reason, row.delta > 0 ? `+${row.delta}` : row.delta, row.employee_name, dateLabel(row.occurred_on, timezone),
        ])} empty="No stock movements recorded yet."/>
    </Panel>
  </>;
}
