import Link from "next/link";
import { ArrowLeft, CalendarDays, CreditCard, ReceiptText } from "lucide-react";
import { money, payments } from "@/backend/contracts";
import { dateLabel, Field, Heading, Panel, Table } from "../ui";
export function Closeout({ data, finance, admin }) {
    const count = data.methods.reduce((sum, method) => sum + method.sales, 0);
    const returns = data.returns ?? [];
    const byMethod = payments.filter(payment => payment !== "Credit").map(payment => {
        const sales = data.methods.find(method => method.payment === payment);
        const refunds = returns.find(entry => entry.payment === payment);
        const collected = (sales?.total_minor ?? 0) + (payment === "ZAAD" ? data.zaad_repayments_minor ?? 0 : 0);
        const refunded = refunds?.refund_minor ?? 0;
        const outgoing = finance?.outgoing.find(row => row.payment === payment);
        const expenses = outgoing?.expenses_minor ?? 0;
        const supplierPayments = outgoing?.supplier_minor ?? 0;
        return { payment, sales: sales?.sales ?? 0, collected, refunded, expenses, supplierPayments,
            net: collected - refunded - expenses - supplierPayments };
    });
    const total = byMethod.reduce((sum, method) => sum + method.net, 0);
    const cash = byMethod.find(method => method.payment === "Cash").net;
    const returnCount = returns.reduce((sum, entry) => sum + entry.returns, 0);
    const creditReduction = returns.reduce((sum, entry) => sum + entry.credit_minor, 0);
    const creditSales = data.methods.find(method => method.payment === "Credit");
    return <>
    <Heading eyebrow="SELLING" title="End of day" subtitle={admin ? "Reconcile the shop’s sales, repayments, and refunds." : "Review the payments and refunds you recorded for the business day."} action={<Link className="button button-secondary" href="/pos"><ArrowLeft size={17}/> Point of sale</Link>}/>
    <Panel title={dateLabel(data.day)}>
      <form className="filter-bar" action="/closeout">
        <Field label="Business date" name="from" type="date" defaultValue={data.day} required/>
        <button className="button button-secondary" type="submit"><CalendarDays size={16}/> View day</button>
      </form>
    </Panel>
    <div className="closeout-totals">
      {[{ label: "Completed sales", value: String(count), Icon: ReceiptText }, { label: "Net payments received", value: money(total), Icon: CreditCard }, { label: "Net cash received", value: money(cash), Icon: CreditCard }].map(({ label, value, Icon }) => <article className="stat" key={label}><span className="stat-icon tone-green"><Icon size={19}/></span><span className="stat-label">{label}</span><strong>{value}</strong></article>)}
    </div>
    <Panel title="Payments by method">
      <Table columns={["Method", "Sales", "Received", "Refunded", ...(finance ? ["Expenses", "Supplier payments"] : []), "Net"]} rows={byMethod.map(method => [
        method.payment, method.sales, money(method.collected), money(method.refunded),
        ...(finance ? [money(method.expenses), money(method.supplierPayments)] : []), money(method.net),
      ])}/>
      <div className="panel-body">
        <p>ZAAD repayments received {money(data.zaad_repayments_minor ?? 0)}</p>
        <p>Credit sales {money(creditSales?.total_minor ?? 0)} · Credit reduced by returns {money(creditReduction)}</p>
        <p>Recorded returns {returnCount}</p>
        {finance && <p>Expenses paid {money(finance.expenses_minor)} · Supplier payments {money(finance.supplier_payments_minor)}</p>}
      </div>
      <div className="panel-body pos-more"><Link href={`/sales?from=${data.day}&to=${data.day}`} className="text-link">Open sales for this day</Link></div>
    </Panel>
  </>;
}
