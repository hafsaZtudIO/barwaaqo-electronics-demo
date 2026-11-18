"use client";
import Link from "next/link";
import { useState } from "react";
import { money } from "@/backend/contracts";
import { ShopForm } from "../action-form";
import { Field, Heading, Panel, Table } from "../ui";

function refundForLine(item, quantity) {
    const net = BigInt(item.net_minor);
    const returned = BigInt(item.returned_quantity);
    const sold = BigInt(item.quantity);
    return Number(net * (returned + BigInt(quantity)) / sold - net * returned / sold);
}

export function SaleReturn({ receipt }) {
    const { sale, items } = receipt;
    const [quantities, setQuantities] = useState({});
    const [saved, setSaved] = useState(false);
    const returnable = items.filter(item => item.returned_quantity < item.quantity);
    const total = returnable.reduce((sum, item) => {
        const quantity = quantities[item.product_id] ?? 0;
        const max = item.quantity - item.returned_quantity;
        return sum + (Number.isInteger(quantity) && quantity >= 0 && quantity <= max ? refundForLine(item, quantity) : 0);
    }, 0);
    const credit = Math.min(total, Math.max(0, receipt.credit_balance_minor ?? 0));
    const refundMethod = sale.payment === "Credit" ? "ZAAD" : sale.payment;
    return <>
      <Heading title="Return items" subtitle={`Receipt #${sale.id.slice(0, 8).toUpperCase()}`}
        action={<Link href={`/sales?receipt=${sale.id}`} className="button button-secondary">View receipt</Link>}/>
      <Panel title="Customer return">
        <div className="panel-body">
          {saved ? <p role="status">Return recorded. Open the receipt to review its refund and stock details.</p>
            : !receipt.returns ? <p className="notice notice-error">The shop database needs the sales returns update.</p>
            : !returnable.length ? <p>All items on this receipt have been returned.</p>
            : <ShopForm command="return_sale" label="Record return" confirmation="Record this return and its refund and stock details?"
                onSuccess={() => setSaved(true)}>
                <input type="hidden" name="id" value={sale.id}/>
                <input type="hidden" name="revision" value={receipt.revision}/>
                <input type="hidden" name="quoted_total_minor" value={total}/>
                <input type="hidden" name="quoted_credit_minor" value={credit}/>
                <Table columns={["Product", "Available to return", "Return quantity", "Restock"]} rows={returnable.map(item => [
                    <span key={item.product_id}>{item.product_name} · {item.sku}<input type="hidden" name="product_id" value={item.product_id}/></span>,
                    `${item.quantity - item.returned_quantity} ${item.unit}`,
                    <Field key="quantity" label={`Quantity for ${item.sku}`} name={`quantity_${item.product_id}`} type="number" min={0}
                      max={item.quantity - item.returned_quantity} defaultValue={0}
                      onChange={event => setQuantities(previous => ({ ...previous, [item.product_id]: Number(event.target.value) }))}/>,
                    item.archived ? "Archived" : <label key="restock"><input type="checkbox" name={`restock_${item.product_id}`}/> Sellable</label>,
                ])}/>
                <Field name="reason" label="Reason for return" maxLength={180} required/>
                <p aria-live="polite">Refund via {refundMethod} <strong>{money(total - credit)}</strong>
                  {sale.payment === "Credit" && <> · Credit balance reduction <strong>{money(credit)}</strong></>}</p>
                <p>Record the return here and send any refund using the payment method shown.</p>
              </ShopForm>}
        </div>
      </Panel>
    </>;
}
