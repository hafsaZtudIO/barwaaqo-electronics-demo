import Link from "next/link";
import { ArrowDownToLine, ArrowUpFromLine, BarChart3, Boxes, CalendarDays, CircleAlert, ClipboardList, Layers3, ReceiptText, ShoppingCart, TrendingUp, Truck, Users } from "lucide-react";
import { money } from "@/backend/contracts";
import { businessToday, dateLabel, Empty, Heading, number, Panel, Table } from "../ui";
export function Dashboard({ employee, data }) {
    const admin = employee.role === "admin";
    const stats = [
        { label: "Product types", value: number(data.product_types), icon: Boxes, context: "Active catalog", tone: "green", href: "/products" },
        { label: "Available stock", value: number(data.available), icon: Layers3, context: "Units on hand", tone: "green", href: "/products?sort=quantity" },
        { label: "Stock in today", value: number(data.received), icon: ArrowDownToLine, context: admin ? "All stock increases" : "Your stock increases", tone: "green" },
        { label: "Stock out today", value: number(data.issued), icon: ArrowUpFromLine, context: admin ? "Units issued" : "Units you issued", tone: "orange", href: "/stock-out" },
        { label: admin ? "Sales today" : "Your sales today", value: money(data.revenue_minor), icon: TrendingUp, context: "Recorded revenue", tone: "green", href: "/sales" },
        { label: "Low stock alerts", value: number(data.low_count), icon: CircleAlert, context: "At or below minimum", tone: "orange", href: "/products?status=low" },
    ];
    const max = Math.max(...data.chart.map(day => day.revenue_minor), 1);
    const timezone = data.settings.timezone;
    const today = businessToday(timezone);
    const dateQuery = new URLSearchParams({ from: today, to: today });
    stats[3].href += `?${dateQuery}`;
    stats[4].href += `?${dateQuery}`;
    const shortcuts = [
        { title: "Selling", subtitle: "From the counter to the customer", icon: ShoppingCart, links: [
            { label: "Point of sale", href: "/pos", icon: ShoppingCart, featured: true },
            { label: "Sales history", href: "/sales", icon: ReceiptText },
            { label: "Customer accounts", href: "/customers", icon: Users },
            { label: "End of day", href: "/closeout", icon: CalendarDays },
        ] },
        { title: admin ? "Purchases & stock" : "Inventory", subtitle: "Keep the shelves ready for your next sale", icon: Boxes, links: [
            { label: "Product catalog", href: "/products", icon: Boxes, count: data.product_types },
            { label: "Receive stock", href: "/stock-in", icon: ArrowDownToLine },
            ...(admin ? [
                { label: "Purchase orders", href: "/purchases", icon: ClipboardList },
                { label: "Suppliers", href: "/suppliers", icon: Truck },
            ] : [
                { label: "Stock out", href: "/stock-out", icon: ArrowUpFromLine },
                { label: "Stock shortages", href: "/products?status=low", icon: CircleAlert },
            ]),
        ] },
    ];
    const reports = [
        { title: "Sales & customers", icon: BarChart3, links: [
            ["Sales register", "/sales"], ["Customer credit balances", "/customers"],
            ...(admin ? [["Product sales", "/reports#product-sales"], ["Employee sales", "/reports#employee-sales"]] : []),
        ] },
        { title: "Stock & inventory", icon: Boxes, links: [
            ["Stock shortages", "/products?status=low"], ["Out of stock", "/products?status=out"],
            ["Stock receipts", "/stock-in"], ["Outgoing stock", "/stock-out"],
        ] },
        { title: "Day-to-day activities", icon: ClipboardList, links: [
            ["Daily collections", "/closeout"],
            ...(admin ? [["Shop expenses", "/expenses"], ["Supplier balances", "/purchases"], ["Stock movement report", "/reports#inventory-movements"]] : [["Customer accounts", "/customers"]]),
        ] },
    ];
    return <>
    <Heading eyebrow="BARWAAQO ELECTRONICS" title="Shop overview" subtitle={admin ? "Today's sales, stock priorities, and shop activity." : "Your sales, stock priorities, and daily activity."} action={<div className="heading-actions"><span className="date-chip"><CalendarDays size={16}/>{dateLabel(businessToday(timezone))}</span>
        <Link href="/pos" className="button"><ShoppingCart size={17}/> Open checkout</Link></div>}/>
    <div className="stats-grid">{stats.map(stat => {
      const Stat = stat.href ? Link : "article";
      return <Stat className={`stat${stat.href ? " stat-link" : ""}`} href={stat.href} key={stat.label}>
      <span className={`stat-icon tone-${stat.tone}`}><stat.icon size={19} strokeWidth={1.8}/></span>
      <div className="stat-label">{stat.label}</div><strong>{stat.value}</strong><small>{stat.context}</small>
    </Stat>;
    })}</div>
    {data.low_count > 0 && <section className="stock-priority" aria-label="Stock needing attention">
      <span className="stat-icon tone-orange"><CircleAlert size={21}/></span>
      <div><h2>Stock needs attention</h2><p>{number(data.out_count)} out of stock · {number(data.low_count - data.out_count)} running low</p></div>
      <Link className="button button-secondary" href="/products?status=low">Review stock</Link>
    </section>}
    <div className="workspace-modules">{shortcuts.map(group => <section className="workspace-module" key={group.title}>
      <header><span className="module-icon"><group.icon size={21}/></span><div><h2>{group.title}</h2><p>{group.subtitle}</p></div></header>
      <nav className="module-shortcuts" aria-label={group.title}>
        {group.links.map(link => <Link href={link.href} className={link.featured ? "module-shortcut featured" : "module-shortcut"} key={link.href}>
          <link.icon size={18}/><span>{link.label}</span>
          {link.count != null && <span className="module-count">{number(link.count)}</span>}
        </Link>)}
      </nav>
    </section>)}</div>
    <section className="workspace-reports" aria-labelledby="workspace-reports-title">
      <header><div><p className="eyebrow">FIND THE RIGHT RECORD</p><h2 id="workspace-reports-title">Reports & daily activities</h2></div>
        {admin && <Link className="text-link" href="/reports">All reports & exports</Link>}
      </header>
      <div className="workspace-report-grid">{reports.map(group => <nav className="workspace-report-card" aria-label={group.title} key={group.title}>
        <h3><group.icon size={18}/>{group.title}</h3>
        {group.links.map(([label, href]) => <Link href={href} key={href}>{label}</Link>)}
      </nav>)}</div>
    </section>
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
        <Link className="text-link" href="/products">View inventory</Link></div>
      </Panel>
      <Panel title="Recent sales" subtitle="Latest recorded transactions" action={<Link className="text-link" href="/sales">View sales</Link>}>
        <Table columns={["Receipt", "Payment", "Total"]} rows={data.sales.map(sale => [
            <Link key={sale.id} className="cell-link" href={`/sales?receipt=${sale.id}`}><ReceiptText size={15}/> {sale.id.slice(0, 8).toUpperCase()}</Link>,
            sale.payment, <strong key="amount">{money(sale.total_minor)}</strong>,
        ])} empty="No sales recorded yet."/>
      </Panel>
      <Panel title="Low stock alerts" subtitle="Items that may need replenishing" action={<Link className="text-link" href="/products?status=low">View low stock</Link>}>
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
