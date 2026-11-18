"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Barcode, ChevronDown, ClipboardList, CreditCard, Grid2X2, History, List, Minus, PackageOpen, Plus, Printer, RefreshCw, Save, Search, Trash2 } from "lucide-react";
import { Fragment, useEffect, useRef, useState, useTransition } from "react";
import { money, checkoutPayments, productUnits } from "@/backend/contracts";
import { ActionForm, ShopForm } from "../action-form";
import { useOfflineInvoices } from "../offline-invoices";
import { assetUrl } from "../../platform/image";
import { ProductPhoto } from "../product-photo";
import { Empty, Panel } from "../ui";
const pageSize = 40;
const maxLines = 50;
const maxQuantity = 1_000_000;
function dollarsToCents(value) {
    const trimmed = value.trim();
    return /^\d{1,7}(\.\d{1,2})?$/.test(trimmed) ? Math.round(Number(trimmed) * 100) : null;
}
export function PointOfSale({ products, customers, employeeId, lastReceiptId }) {
    const router = useRouter();
    const draftKey = `barwaaqo:pos-draft:v1:${employeeId}`;
    const searchBox = useRef(null);
    const scanBox = useRef(null);
    const paymentBox = useRef(null);
    const paymentDialog = useRef(null);
    const customerDialog = useRef(null);
    const saleSound = useRef(null);
    const [refreshing, refreshCatalog] = useTransition();
    const [query, setQuery] = useState("");
    const [barcode, setBarcode] = useState("");
    const [catalogView, setCatalogView] = useState("list");
    const [category, setCategory] = useState("");
    const [limit, setLimit] = useState(pageSize);
    const [cart, setCart] = useState([]);
    const [expandedItem, setExpandedItem] = useState(null);
    const [customer, setCustomer] = useState("");
    const [addedCustomer, setAddedCustomer] = useState(null);
    const [note, setNote] = useState("");
    const [payment, setPayment] = useState("");
    const [reviewing, setReviewing] = useState(false);
    const [paymentStatus, setPaymentStatus] = useState(null);
    const [message, setMessage] = useState("");
    const [drafts, setDrafts] = useState(null);
    const [printInvoice, setPrintInvoice] = useState(null);
    useEffect(() => {
        if (printInvoice) window.print();
    }, [printInvoice]);
    useEffect(() => {
        const sound = new Audio(assetUrl("/sale-submit.mp3"));
        sound.preload = "auto";
        sound.volume = 0.5;
        saleSound.current = sound;
    }, []);
    useEffect(() => {
        if (reviewing && !paymentDialog.current?.open) {
            paymentDialog.current?.showModal();
            paymentBox.current?.focus();
        }
    }, [reviewing]);
    const offlineInvoices = useOfflineInvoices(employeeId, router.refresh);
    const reserved = new Map();
    for (const invoice of offlineInvoices.invoices) {
        for (const item of invoice.data.items) {
            reserved.set(item.product_id, (reserved.get(item.product_id) ?? 0) + Number(item.quantity));
        }
    }
    const availableProducts = products.map(product => ({
        ...product, quantity: Math.max(0, product.quantity - (reserved.get(product.id) ?? 0)),
    }));
    const catalog = new Map(availableProducts.map(product => [product.id, product]));
    const categories = Array.from(new Set(products.map(product => product.category_name))).sort();
    const search = query.trim().toLowerCase();
    const matches = availableProducts.filter(product => (!category || product.category_name === category) &&
        (!search || [product.name, product.sku, product.barcode].some(value => value?.toLowerCase().includes(search))));
    const totalUnits = cart.reduce((sum, line) => sum + line.quantity, 0);
    const quantitySummary = productUnits.map(unit => ({
        unit,
        quantity: cart.reduce((sum, line) => sum + ((catalog.get(line.id)?.unit ?? "Pcs") === unit ? line.quantity : 0), 0),
    })).filter(row => row.quantity).map(row => `${row.quantity} ${row.unit}`).join(" + ");
    const saleLines = cart.map(line => {
        const product = catalog.get(line.id);
        const gross = line.quantity * (product?.sale_minor ?? 0);
        const percent = line.discountPercent?.trim();
        const rate = percent ? dollarsToCents(percent) : null;
        const discount = percent
            ? rate === null || rate > 10000 ? null : Number((BigInt(gross) * BigInt(rate) + 5000n) / 10000n)
            : line.discount?.trim() ? dollarsToCents(line.discount) : 0;
        const error = discount === null
            ? percent ? "Enter a percentage from 0 to 100 with up to two decimal places." : "Enter a dollar amount with up to two decimal places."
            : discount > gross ? "Discount cannot exceed this line’s amount." : "";
        return { ...line, product, gross, discountMinor: discount ?? 0, error };
    });
    const subtotal = saleLines.reduce((sum, line) => sum + line.gross, 0);
    const discountMinor = saleLines.reduce((sum, line) => sum + line.discountMinor, 0);
    const discountError = discountMinor > 999999999 ? "The combined product discounts exceed the supported limit." : "";
    const invalidDiscount = Boolean(discountError) || saleLines.some(line => line.error);
    const total = Math.max(0, subtotal - discountMinor);
    const isCredit = payment === "Credit";
    const customerOptions = addedCustomer && !customers.some(entry => entry.id === addedCustomer.id)
        ? [...customers, addedCustomer] : customers;
    const selectedCustomer = customerOptions.find(entry => entry.id === customer);
    const unavailable = cart.some(line => line.quantity > (catalog.get(line.id)?.quantity ?? 0));
    function clearCart() {
        setCart([]);
        setExpandedItem(null);
        setCustomer("");
        setNote("");
        setPayment("");
        setReviewing(false);
        setDrafts(null);
        setMessage("");
    }
    function updateQuantity(id, quantity) {
        setCart(lines => lines.map(line => line.id === id ? { ...line, quantity } : line));
    }
    function changeQuantity(line, input) {
        updateQuantity(line.id, Math.max(1, Math.min(Math.trunc(input.valueAsNumber || 1), line.product?.quantity ?? 1, maxQuantity)));
    }
    function updateDiscount(id, discount, discountPercent) {
        setCart(lines => lines.map(item => item.id === id ? { ...item, discount, discountPercent } : item));
    }
    function toggleItem(id) {
        setExpandedItem(current => current === id ? null : id);
    }
    function add(product, searchField) {
        const current = cart.find(line => line.id === product.id);
        if ((current?.quantity ?? 0) >= Math.min(product.quantity, maxQuantity)) {
            setMessage(`No more units available for ${product.name}.`);
            return;
        }
        if (!current && cart.length >= maxLines) {
            setMessage("Checkout supports up to 50 different products per sale.");
            return;
        }
        setCart(lines => current
            ? lines.map(line => line.id === product.id ? { ...line, quantity: line.quantity + 1 } : line)
            : [{ id: product.id, quantity: 1 }, ...lines]);
        if (searchField === scanBox) setBarcode("");
        if (searchField === searchBox) {
            setQuery("");
            setLimit(pageSize);
        }
        searchField?.current?.focus();
        setMessage(`Added ${product.name}.`);
    }
    function scan(value, searchField) {
        const term = value.trim().toLowerCase();
        if (!term)
            return;
        const exact = availableProducts.filter(product => product.barcode?.toLowerCase() === term || product.sku.toLowerCase() === term);
        const candidates = exact.length ? exact : availableProducts.filter(product => product.name.toLowerCase().includes(term));
        if (candidates.length === 1)
            add(candidates[0], searchField);
        else {
            if (candidates.length > 1) {
                setCategory("");
                setQuery(value);
                setLimit(pageSize);
                searchBox.current?.focus();
            }
            setMessage(candidates.length ? "Choose the matching product from the list." : "No matching product found.");
        }
    }
    function readDrafts() {
        const saved = JSON.parse(localStorage.getItem(draftKey) ?? "[]");
        if (Array.isArray(saved)) return saved;
        if (Array.isArray(saved?.lines)) return [{ ...saved, id: "original" }];
        throw new Error("Invalid saved sales");
    }
    function saveDraft() {
        try {
            const saved = readDrafts();
            const draft = { id: crypto.randomUUID(), savedAt: new Date().toISOString(), total, units: totalUnits,
                lines: cart, payment, customer, note };
            localStorage.setItem(draftKey, JSON.stringify([draft, ...saved]));
            clearCart();
            setMessage("Sale parked. You can start another sale now.");
            searchBox.current?.focus();
        }
        catch {
            setMessage("This browser could not save your draft.");
        }
    }
    function showDrafts() {
        try {
            setDrafts(drafts === null ? readDrafts() : null);
        } catch {
            setMessage("This browser could not open your parked sales.");
        }
    }
    function restoreDraft(id) {
        if (cart.length) return;
        try {
            const saved = readDrafts();
            const draft = saved.find(entry => entry.id === id);
            if (!Array.isArray(draft?.lines)) throw new Error("Missing draft");
            const restored = [];
            const seen = new Set();
            for (const line of draft.lines) {
                if (!line || typeof line.id !== "string" || seen.has(line.id) || !Number.isSafeInteger(line.quantity) || line.quantity < 1)
                    continue;
                seen.add(line.id);
                restored.push({ id: line.id, quantity: Math.min(line.quantity, maxQuantity),
                    discount: typeof line.discount === "string" ? line.discount.slice(0, 10) : "",
                    discountPercent: typeof line.discountPercent === "string" ? line.discountPercent.slice(0, 6) : "" });
                if (restored.length === maxLines)
                    break;
            }
            if (!restored.length) throw new Error("Empty draft");
            localStorage.setItem(draftKey, JSON.stringify(saved.filter(entry => entry.id !== id)));
            setCart(restored);
            setDrafts(null);
            setCustomer(customerOptions.some(entry => entry.id === draft.customer) ? draft.customer : "");
            setNote(typeof draft.note === "string" ? draft.note.slice(0, 180) : "");
            const savedPayment = draft.payment;
            setPayment(savedPayment && checkoutPayments.includes(savedPayment) ? savedPayment : "");
            setMessage(dollarsToCents(typeof draft.discount === "string" ? draft.discount : "") > 0
                ? "Parked sale resumed. Re-enter its previous sale discount on the applicable product lines."
                : "Parked sale resumed. Review the current prices and stock before paying.");
        }
        catch {
            setMessage("This browser could not load your draft.");
        }
    }
    const checkoutBlocked = refreshing || !cart.length || !payment || unavailable || invalidDiscount || (isCredit && !selectedCustomer);
    const customerSelect = () => <select value={customer} onChange={event => setCustomer(event.target.value)}>
      <option value="">Walk-in customer</option>
      {customerOptions.map(entry => <option key={entry.id} value={entry.id}>{entry.name}{entry.phone ? ` · ${entry.phone}` : ""}</option>)}
    </select>;
    async function saveInvoice(_state, form) {
        return offlineInvoices.submit({
            id: form.get("request_id"),
            createdAt: new Date().toISOString(),
            total,
            customerName: selectedCustomer?.name ?? "Walk-in customer",
            receiptItems: saleLines.map(line => ({
                name: line.product.name, quantity: line.quantity, unit: line.product.unit ?? "Pcs",
                total: line.gross - line.discountMinor,
            })),
            data: {
                payment, customer_id: selectedCustomer?.id ?? "", payment_note: note,
                quoted_subtotal_minor: subtotal,
                items: saleLines.map(line => ({
                    product_id: line.id, quantity: line.quantity,
                    discount_minor: line.discountMinor ? (line.discountMinor / 100).toFixed(2) : "",
                })),
            },
        });
    }
    return <div className="pos-page">
    <header className="pos-register-header"><h1>Point of sale</h1><div className="pos-toolbar">
        <Link className="button pos-blue" href="/sales"><History size={17}/> Sales history</Link>
        <Link className="button pos-violet" href="/closeout"><ClipboardList size={17}/> End of day</Link>
        {lastReceiptId && <Link className="button pos-teal" href={`/sales?receipt=${lastReceiptId}&print=1`}><Printer size={17}/> Print last receipt</Link>}
      </div></header>
    {(offlineInvoices.offline || offlineInvoices.invoices.length > 0 || offlineInvoices.storageError) && <Panel title="Offline invoices"
      subtitle={offlineInvoices.offline ? "Offline · sales are saved on this device" : `${offlineInvoices.invoices.length} invoice(s) waiting to sync`}
      action={<button type="button" className="button pos-blue" disabled={offlineInvoices.offline || offlineInvoices.syncing}
        onClick={() => void offlineInvoices.sync(true)}>{offlineInvoices.syncing ? "Syncing…" : "Sync now"}</button>}>
      <div className="panel-body">
        {offlineInvoices.storageError && <p role="alert">{offlineInvoices.storageError}</p>}
        {offlineInvoices.invoices.map(invoice => <p key={invoice.id}>
          <strong>#{invoice.id.slice(0, 8).toUpperCase()}</strong> · {invoice.customerName} · {money(invoice.total)}
          {invoice.error && <span className="pos-field-error"> · Needs attention: {invoice.error}</span>}
          {" "}<button type="button" className="text-link no-print" onClick={() => setPrintInvoice({ ...invoice })}>Print invoice</button>
        </p>)}
      </div>
    </Panel>}
    <ActionForm action={saveInvoice} submitDisabled={!reviewing || checkoutBlocked} statusContainer={paymentStatus} onSuccess={(result, form) => {
      const sound = saleSound.current;
      if (sound) {
        sound.currentTime = 0;
        void sound.play().catch(() => {});
      }
      clearCart();
      if (result.queued) {
        setMessage(`Invoice #${result.invoice.id.slice(0, 8).toUpperCase()} saved on this device. It will sync when connected.`);
        if (form.get("receipt_action") === "print") setPrintInvoice(result.invoice);
        return;
      }
      if (result.id) {
        const print = form.get("receipt_action") === "print" ? "&print=1" : "";
        router.push(`/sales?receipt=${result.id}${print}`);
      }
    }}>
      <div className="pos-grid">
        <Panel title="Product catalog" action={
          <button className="button pos-violet" type="button" disabled={refreshing} onClick={() => refreshCatalog(() => router.refresh())}>
            <RefreshCw size={16} className={refreshing ? "spin" : undefined}/> {refreshing ? "Reloading…" : "Reload stock"}
          </button>}>
          <div className="panel-body pos-filters">
            <label className="field">
              <span><Barcode size={16}/> Scan barcode or search</span>
              <div className="pos-search"><Search size={17}/>
                <input ref={searchBox} value={query} placeholder="Barcode, SKU or product name" autoComplete="off" onChange={event => { setQuery(event.target.value); setLimit(pageSize); }} onKeyDown={event => { if (event.key === "Enter") {
        event.preventDefault();
        scan(query, searchBox);
    } }}/>
              </div>
            </label>
          </div>
          <div className="pos-catalog table-scroll">
          {matches.length ? catalogView === "list" ? (
            <table><thead><tr><th>Product</th><th>Rate</th><th>Available</th><th>Unit</th><th><span className="sr-only">Add</span></th></tr></thead>
              <tbody>{matches.slice(0, limit).map(product => {
                const inCart = cart.find(line => line.id === product.id)?.quantity ?? 0;
                const canAdd = inCart < Math.min(product.quantity, maxQuantity);
                return <tr key={product.id} className="pos-catalog-row">
                  <td><span className="product-with-photo"><ProductPhoto product={product}/><span>
                    <strong>{product.name}</strong>
                    <small>{product.sku} · {product.category_name}</small>
                  </span></span></td>
                  <td>{money(product.sale_minor)}</td>
                  <td><span className={`pos-stock ${product.quantity ? "pos-green" : "pos-red"}`}>{product.quantity || "Out"}</span></td>
                  <td>{product.unit ?? "Pcs"}</td>
                  <td><button type="button" className="button pos-icon pos-green pos-add-row" disabled={!canAdd}
                    aria-label={`Add ${product.name} to cart`} onClick={() => add(product)}><Plus size={19}/></button></td>
                </tr>;
            })}</tbody>
            </table>) : <ul className="pos-product-cards">{matches.slice(0, limit).map(product => (
              <li key={product.id}><button type="button" className="pos-product-card" disabled={(cart.find(line => line.id === product.id)?.quantity ?? 0) >= Math.min(product.quantity, maxQuantity)} onClick={() => add(product)}>
                <ProductPhoto product={product} variant="card"/>
                <strong>{product.name}</strong><small>{product.sku} · {product.category_name}</small>
                <span><b>{money(product.sale_minor)}</b><small>{product.quantity} {product.unit ?? "Pcs"} available</small></span>
              </button></li>))}</ul>
            : <Empty>{products.length ? "No products match this search." : "Add a product and receive stock to start selling."}</Empty>}
          {limit < matches.length && <div className="panel-body pos-more">
            <button className="button pos-violet" type="button" onClick={() => setLimit(limit + pageSize)}>Show more products</button>
          </div>}
          </div>
          <div className="panel-body pos-catalog-footer">
            <label className="field"><span>Category</span>
              <select value={category} onChange={event => { setCategory(event.target.value); setLimit(pageSize); }}>
                <option value="">All categories</option>
                {categories.map(name => <option key={name}>{name}</option>)}
              </select>
            </label>
            <div className="pos-view-toggle" role="group" aria-label="Catalog view">
              <button className="button pos-blue" type="button" aria-pressed={catalogView === "list"} onClick={() => setCatalogView("list")}><List size={16}/> List</button>
              <button className="button pos-blue" type="button" aria-pressed={catalogView === "card"} onClick={() => setCatalogView("card")}><Grid2X2 size={16}/> Card</button>
            </div>
          </div>
        </Panel>
        <Panel title="Current sale">
          <div className="pos-customer-bar">
            <label className="field"><span>Customer</span>{customerSelect()}</label>
            <button type="button" onClick={() => customerDialog.current?.showModal()} className="button pos-blue"><Plus size={16}/> New customer</button>
          </div>
          <div className="panel-body pos-filters"><label className="field"><span><Barcode size={16}/> Add item by barcode</span>
            <div className="pos-search"><Search size={17}/><input ref={scanBox} value={barcode} autoComplete="off" placeholder="Scan or enter a SKU, then press Enter" onChange={event => setBarcode(event.target.value)} onKeyDown={event => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                scan(barcode, scanBox);
            }}/></div>
          </label></div>
          <div className="table-scroll pos-catalog pos-cart-table">
          {cart.length ? (
            <table><thead><tr><th>Product</th><th>Qty</th><th>Rate</th><th>Amount</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>{saleLines.map(line => {
                const { product } = line;
                const name = product?.name ?? "Unavailable product";
                const expanded = expandedItem === line.id;
                const detailId = `cart-item-${line.id}`;
                return <Fragment key={line.id}><tr className={expanded ? "pos-cart-expanded" : undefined}>
                  <td><button type="button" className="pos-product-name product-with-photo" aria-expanded={expanded} aria-controls={detailId}
                    onClick={() => toggleItem(line.id)}>
                    {product && <ProductPhoto product={product}/>}
                    <span>{name}</span>
                  </button>
                    {line.error ? <small className="pos-field-error">Check line discount</small> :
                      line.discountMinor > 0 && <small>Discount −{money(line.discountMinor)}</small>}
                    <input type="hidden" name="product_id" value={line.id}/></td>
                  <td><div className="pos-stepper">
                    <button type="button" className="button pos-amber" aria-label={`Decrease ${product?.name ?? "item"} quantity`} disabled={line.quantity <= 1} onClick={() => updateQuantity(line.id, line.quantity - 1)}><Minus size={15}/></button>
                    <input className="pos-quantity" name="quantity" type="number" min={1} max={Math.min(product?.quantity ?? 0, maxQuantity)} value={line.quantity} aria-label={`Quantity for ${name}`} required onChange={event => changeQuantity(line, event.target)}/>
                    <button type="button" className="button pos-green" aria-label={`Increase ${product?.name ?? "item"} quantity`} disabled={line.quantity >= Math.min(product?.quantity ?? 0, maxQuantity)} onClick={() => updateQuantity(line.id, line.quantity + 1)}><Plus size={15}/></button>
                  </div></td>
                  <td>{product ? money(product.sale_minor) : "—"}</td>
                  <td>{product && !line.error ? money(line.gross - line.discountMinor) : "—"}</td>
                  <td><div className="pos-item-actions">
                    <button type="button" className="button pos-icon pos-red" aria-label={`Remove ${name}`} onClick={() => {
                        setCart(lines => lines.filter(item => item.id !== line.id));
                        setExpandedItem(current => current === line.id ? null : current);
                    }}><Trash2 size={16}/></button>
                    <button type="button" className="button pos-icon pos-blue" aria-label={`Details for ${name}`} aria-expanded={expanded}
                      aria-controls={detailId} onClick={() => toggleItem(line.id)}><ChevronDown size={17}/></button>
                  </div></td>
                </tr>
                <tr className="pos-item-detail-row" id={detailId} hidden={!expanded}><td colSpan={5}>
                  <div className="pos-item-detail">
                    <section>
                      <h3>Basic information</h3>
                      {expanded && product && <ProductPhoto product={product} variant="detail" decorative={false}/>}
                      <dl><div><dt>Item code</dt><dd>{product?.sku ?? "—"}</dd></div>
                        <div><dt>Unit</dt><dd>{product?.unit ?? "Pcs"}</dd></div></dl>
                      <label className="field"><span>Quantity</span><input className="pos-quantity" type="number" min={1}
                        max={Math.min(product?.quantity ?? 0, maxQuantity)} value={line.quantity} disabled={!product?.quantity}
                        onChange={event => changeQuantity(line, event.target)}/></label>
                    </section>
                    <section>
                      <h3>Pricing &amp; discounts</h3>
                      <dl><div><dt>Unit rate</dt><dd>{product ? money(product.sale_minor) : "—"}</dd></div>
                        <div><dt>Line total</dt><dd>{line.error ? "—" : money(line.gross - line.discountMinor)}</dd></div></dl>
                      <div className="pos-discount-fields">
                        <label className="field"><span>Discount %</span>
                          <input type="text" inputMode="decimal" maxLength={6} placeholder="0.00"
                            value={line.discountPercent ?? ""}
                            aria-invalid={Boolean(line.discountPercent && line.error)}
                            onChange={event => updateDiscount(line.id, "", event.target.value)}/></label>
                        <label className="field"><span>Discount amount (USD)</span>
                          <input type="text" inputMode="decimal" maxLength={10} placeholder="0.00"
                            value={line.discountPercent ? (line.error ? "" : (line.discountMinor / 100).toFixed(2)) : line.discount ?? ""}
                            aria-invalid={Boolean(!line.discountPercent && line.error)}
                            onChange={event => updateDiscount(line.id, event.target.value, "")}/></label>
                      </div>
                      {line.error && <p className="pos-field-error" role="alert">{line.error}</p>}
                    </section>
                    <section>
                      <h3>Stock information</h3>
                      <dl><div><dt>Available quantity</dt><dd>{product ? `${product.quantity} ${product.unit ?? "Pcs"}` : "—"}</dd></div></dl>
                    </section>
                  </div>
                </td></tr></Fragment>;
            })}</tbody>
            </table>
          ) : <Empty>Your cart is empty. Scan an item or add one from the catalog.</Empty>}
          </div>
          <div className="panel-body pos-checkout">
            {unavailable && <p className="notice notice-error" role="alert">Stock changed. Update the quantities or remove unavailable items.</p>}
            {reviewing && <dialog ref={paymentDialog} className="pos-payment-dialog" aria-labelledby="pos-payment-title" onCancel={event => { event.preventDefault(); setReviewing(false); }}>
            <h2 id="pos-payment-title">Payment</h2>
            <div className="pos-payment-fields">
            <label className="field">
              <span><CreditCard size={16}/> Payment method</span>
              <select ref={paymentBox} name="payment" value={payment} required onChange={event => setPayment(event.target.value)}>
                <option value="">Choose payment method</option>
                {checkoutPayments.map(method => <option key={method} value={method}>{method}</option>)}
              </select>
            </label>
            </div>
            {isCredit && <div className="pos-credit-fields">
              <label className="field"><span>Customer for this credit sale</span>{customerSelect()}</label>
              {!selectedCustomer && <p className="pos-field-error">Select a customer to record credit.</p>}
            </div>}
            <label className="field pos-payment-note">
              <span>Payment note (optional)</span>
              <textarea name="payment_note" value={note} onChange={event => setNote(event.target.value)} rows={2} maxLength={180} placeholder="e.g. payment reference"/>
            </label>
            <dl className="pos-payment-summary">
              <div><dt>Subtotal</dt><dd>{money(subtotal)}</dd></div>
              <div><dt>Product discounts</dt><dd>{money(discountMinor)}</dd></div>
              <div><dt>{isCredit ? "Add to customer balance" : "Amount due"}</dt><dd>{money(total)}</dd></div>
            </dl>
            <div className="pos-submit-actions">
              <button type="button" className="button pos-blue" onClick={() => setReviewing(false)}>Cancel payment</button>
              <button type="submit" name="receipt_action" value="submit" className="button pos-green" disabled={checkoutBlocked}>Submit</button>
              <button type="submit" name="receipt_action" value="print" className="button pos-pay" disabled={checkoutBlocked}>
                <Printer size={17}/> Submit and print
              </button>
            </div>
            <div ref={setPaymentStatus}/>
            </dialog>}
            <div className="pos-register-footer">
            <div className="pos-totals">
              <div><span>Total quantity</span><strong>{quantitySummary || "0"}</strong></div>
              <div><span>Product discounts</span><strong>{money(discountMinor)}</strong></div>
              <div><span>Subtotal</span><strong>{money(subtotal)}</strong></div>
              <div className="pos-total"><span>Amount due</span><strong>{money(total)}</strong></div>
              {discountError && <p id="pos-discount-error" className="pos-field-error">{discountError}</p>}
            </div>
            <div className="pos-register-actions">
            <div className="pos-draft-actions">
              <button className="button pos-amber" type="button" disabled={!cart.length} onClick={saveDraft}><Save size={17}/> Save &amp; clear</button>
              <button className="button pos-blue" type="button" aria-expanded={drafts !== null} onClick={showDrafts}><PackageOpen size={17}/> Load drafts</button>
              <button className="button pos-red" type="button" disabled={!cart.length} onClick={() => { if (window.confirm("Cancel the current sale?"))
        clearCart(); }}><Trash2 size={17}/> Cancel sale</button>
              <Link className="button pos-teal" href="/sales"><History size={17}/> Receipts</Link>
            </div>
            <button className="button pos-pay" type="button" disabled={!cart.length || unavailable || refreshing || invalidDiscount} onClick={() => { setPrintInvoice(null); setDrafts(null); setReviewing(true); }}>
              <CreditCard size={17}/> Pay {money(total)}
            </button>
            </div></div>
            {drafts !== null && <section className="pos-drafts" aria-label="Parked sales on this device">
              <strong>Parked sales on this device</strong>
              {cart.length > 0 && <p>Park or cancel the current sale to resume another.</p>}
              {drafts.length ? <ul>{drafts.map(draft => <li key={draft.id}>
                <div><strong>{catalog.get(draft.lines?.[0]?.id)?.name ?? "Saved sale"}{draft.lines?.length > 1 ? ` +${draft.lines.length - 1} more` : ""}</strong>
                  {draft.savedAt && <small>{draft.units} units · {money(draft.total)} · {new Date(draft.savedAt).toLocaleString()}</small>}</div>
                <button type="button" className="button pos-green" disabled={Boolean(cart.length)} onClick={() => restoreDraft(draft.id)}>Resume</button>
              </li>)}</ul> : <p>No parked sales yet.</p>}
            </section>}
            <p className="pos-status" role="status">{message}</p>
          </div>
        </Panel>
      </div>
    </ActionForm>
    {printInvoice && <article className="offline-print-receipt sales-receipt" aria-hidden="true">
      <header className="receipt-header"><div><h2>Barwaaqo Electronics</h2>
        <p>Offline invoice #{printInvoice.id.slice(0, 8).toUpperCase()} · Pending sync</p></div></header>
      <dl className="receipt-details">
        <div><dt>Date and time</dt><dd>{new Date(printInvoice.createdAt).toLocaleString()}</dd></div>
        <div><dt>Payment method</dt><dd>{printInvoice.data.payment}</dd></div>
        <div><dt>Customer</dt><dd>{printInvoice.customerName}</dd></div>
      </dl>
      <table className="receipt-items"><thead><tr><th>Product</th><th>Qty</th><th>Amount</th></tr></thead>
        <tbody>{printInvoice.receiptItems?.map((item, index) => <tr key={index}>
          <td>{item.name}</td><td>{item.quantity} {item.unit}</td><td>{money(item.total)}</td>
        </tr>)}</tbody></table>
      <dl className="receipt-totals"><div className="receipt-amount-paid">
        <dt>{printInvoice.data.payment === "Credit" ? "Credit amount" : "Amount recorded"}</dt>
        <dd>{money(printInvoice.total)}</dd>
      </div></dl>
    </article>}
    <dialog ref={customerDialog} className="pos-payment-dialog" aria-labelledby="pos-customer-title">
      <h2 id="pos-customer-title">New customer</h2>
      <ShopForm command="save_customer" label="Add customer" reset onSuccess={(result, form) => {
          setAddedCustomer({ id: result.id, name: form.get("name").trim(), phone: form.get("phone").trim() });
          setCustomer(result.id);
          customerDialog.current?.close();
      }}>
        <input type="hidden" name="customer_id" value=""/>
        <label className="field"><span>Customer name</span><input name="name" required maxLength={180}/></label>
        <label className="field"><span>Phone (optional)</span><input name="phone" type="tel" maxLength={180}/></label>
        <button type="button" className="button pos-blue pos-customer-cancel" onClick={() => customerDialog.current?.close()}>Cancel</button>
      </ShopForm>
    </dialog>
  </div>;
}
