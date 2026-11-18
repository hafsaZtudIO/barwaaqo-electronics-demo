"use client";
import { useState } from "react";
import { money } from "@/backend/contracts";
import { ShopForm } from "./action-form";
import { Field, Notes, Select, Table } from "./ui";

function newLine() {
    return { key: crypto.randomUUID(), product_id: "", quantity: 1, cost: "" };
}

export function PurchaseForm({ products, suppliers, today }) {
    const [lines, setLines] = useState([{ key: "first", product_id: "", quantity: 1, cost: "" }]);
    const total = lines.reduce((sum, line) => {
        const amount = /^\d+(\.\d{1,2})?$/.test(line.cost) ? Math.round(Number(line.cost) * 100) : 0;
        return sum + amount * (Number(line.quantity) || 0);
    }, 0);
    function update(key, values) {
        setLines(previous => previous.map(line => line.key === key ? { ...line, ...values } : line));
    }
    return <ShopForm command="create_purchase" label="Create purchase order" reset
      onSuccess={() => setLines([newLine()])}>
      <div className="form-grid">
        <Select name="supplier_id" label="Supplier" placeholder="Choose supplier" options={suppliers.map(value => ({ value: value.id, label: value.name }))} required/>
        <Field name="reference" label="Supplier invoice / order reference" maxLength={180}/>
        <Field name="ordered_on" label="Order date" type="date" defaultValue={today} max={today} required/>
        <Field name="due_on" label="Payment due date (optional)" type="date"/>
        <Notes/>
      </div>
      <Table columns={["Product", "Quantity", "Unit cost (USD)", ""]} rows={lines.map(line => [
          <label key="product" className="field"><span className="sr-only">Product</span>
            <select name="product_id" value={line.product_id} required onChange={event => {
                const product = products.find(value => value.id === event.target.value);
                update(line.key, { product_id: event.target.value, cost: product?.cost_minor != null ? (product.cost_minor / 100).toFixed(2) : "" });
            }}>
              <option value="">Choose product</option>
              {products.map(product => <option key={product.id} value={product.id}
                disabled={lines.some(other => other.key !== line.key && other.product_id === product.id)}>
                {product.name} · {product.sku} · {product.unit ?? "Pcs"}
              </option>)}
            </select>
          </label>,
          <Field key="quantity" name="quantity" label="Units" type="number" min={1} max={1000000} step={1} value={line.quantity} required
            onChange={event => update(line.key, { quantity: event.target.value })}/>,
          <Field key="cost" name="cost_minor" label="Cost per unit" type="number" min={0} max="9999999.99" step="0.01" value={line.cost} required
            onChange={event => update(line.key, { cost: event.target.value })}/>,
          <button key="remove" className="button button-secondary button-small" type="button" disabled={lines.length === 1}
            onClick={() => setLines(previous => previous.filter(value => value.key !== line.key))}>Remove</button>,
      ])}/>
      <div className="form-actions">
        <button type="button" className="button button-secondary" disabled={lines.length >= 50} onClick={() => setLines(previous => [...previous, newLine()])}>Add product</button>
        <strong aria-live="polite">Order total {money(total)}</strong>
      </div>
    </ShopForm>;
}
