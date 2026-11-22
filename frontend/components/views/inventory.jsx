import Link from "next/link";
import { ArrowDownToLine, ArrowUpFromLine, Plus, Search } from "lucide-react";
import { money, productUnits, reasons } from "@/backend/contracts";
import { ShopForm } from "../action-form";
import { ProductPhoto } from "../product-photo";
import { ProductPhotoField } from "../product-photo-field";
import { businessToday, dateLabel, Empty, Field, Heading, Notes, options, Pager, Panel, Select, Table } from "../ui";
const stockStatuses = [
    { value: "all", label: "All active products" }, { value: "in-stock", label: "Healthy stock" },
    { value: "low", label: "Low stock" }, { value: "out", label: "Out of stock" },
    { value: "archived", label: "Archived" },
];
function StockBadge({ product }) {
    if (product.archived)
        return <span className="badge badge-neutral">Archived</span>;
    if (product.quantity === 0)
        return <span className="badge badge-danger">Out of stock</span>;
    if (product.quantity <= product.minimum_stock)
        return <span className="badge badge-warn">Low stock</span>;
    return <span className="badge">Healthy</span>;
}
export function ProductForm({ data, product }) {
    return <Panel title={product ? "Edit product" : "Add product"} subtitle="Enter prices and stock quantities in the selected unit. Doz means 12 pieces.">
    <div className="panel-body"><ShopForm command="save_product" label={product ? "Save product" : "Add product"} reset={!product}>
      <input type="hidden" name="id" value={product?.id ?? ""}/>
      <div className="form-grid">
        <Field label="Product name" name="name" defaultValue={product?.name} maxLength={180} required/>
        <Field label="SKU" name="sku" defaultValue={product?.sku} maxLength={60} required/>
        <Select label="Unit of measure" name="unit" options={productUnits.map(unit => ({value: unit, label: unit === "Doz" ? "Doz (12 pieces)" : "Pcs (pieces)"}))} value={product?.unit ?? "Pcs"} required/>
        <Select label="Category" name="category_id" placeholder="Select category" options={options(data.categories)} value={product?.category_id} required/>
        <Select label="Supplier" name="supplier_id" placeholder="No supplier" options={options(data.suppliers)} value={product?.supplier_id ?? ""}/>
        <Field label="Brand" name="brand" defaultValue={product?.brand} maxLength={180}/>
        <Field label="Model" name="model" defaultValue={product?.model} maxLength={180}/>
        <Field label="Barcode" name="barcode" defaultValue={product?.barcode} maxLength={180}/>
        <Field label="Minimum stock" name="minimum_stock" type="number" min={0} max={1000000} defaultValue={product?.minimum_stock ?? 0} required/>
        <Field label="Purchase price (USD)" name="cost_minor" inputMode="decimal" defaultValue={((product?.cost_minor ?? 0) / 100).toFixed(2)} required/>
        <Field label="Selling price (USD)" name="sale_minor" inputMode="decimal" defaultValue={((product?.sale_minor ?? 0) / 100).toFixed(2)} required/>
        <ProductPhotoField imageUrl={product?.image_url}/>
        <Notes label="Description" name="description" value={product?.description}/>
      </div>
    </ShopForm></div>
  </Panel>;
}
export function MovementTable({ data, admin, corrections }) {
    return <Table columns={["Product", "Reason", "Units", "Employee", "Supplier", "Date", "Reference", ...(admin ? ["Unit cost"] : []), ...(corrections ? ["Correction"] : [])]} rows={data.rows.map(row => [
            <Link key={row.id} className="cell-link" href={`/products?id=${row.product_id}`}>{row.product_name}</Link>,
            <span key="reason">{row.reason}{row.notes && <small className="movement-notes">{row.notes}</small>}</span>,
            <span key="units" className={`badge ${row.delta < 0 ? "badge-warn" : ""}`}>{row.delta > 0 ? "+" : ""}{row.delta} {row.unit ?? "Pcs"}</span>,
            row.employee_name, row.supplier_name || "—", dateLabel(row.occurred_on), row.reference || "—",
            ...(admin ? [row.cost_minor == null ? "—" : money(row.cost_minor)] : []),
            ...(corrections ? [row.reversed_by ? "Reversed" : row.type === "in" || row.type === "out"
                    ? <Link key="reverse" className="text-link" href={`/stock-out?reverse=${row.id}`}>Reverse</Link> : "—"] : []),
        ])} empty="No matching stock movements."/>;
}
export function Products({ employee, data, lookups, query, search }) {
    const admin = employee.role === "admin";
    const shortages = query.status === "low" || query.status === "out";
    return <>
    <Heading eyebrow="INVENTORY" title="Products" subtitle="Search the catalog and check current stock." action={admin && <Link href={search.new ? "/products" : "/products?new=1"} className="button"><Plus size={17}/>{search.new ? "Back to catalog" : "Add product"}</Link>}/>
    {admin && search.new && <ProductForm data={lookups}/>}
    <Panel title={shortages ? "Stock shortages" : "Product catalog"} subtitle={`${data.total} matching products${shortages ? " · To minimum shows the units needed to reach the minimum stock level." : ""}`}>
      <form className="filter-bar" action="/products">
        <div className="filter-search"><Field label="Search" name="q" placeholder="Product, SKU, or barcode" defaultValue={query.q}/></div>
        <Select label="Category" name="category" placeholder="All categories" options={options(lookups.categories)} value={query.category}/>
        <Select label="Stock status" name="status" options={stockStatuses} value={query.status ?? "all"}/>
        <Select label="Sort by" name="sort" options={[
            { value: "name", label: "Product name" }, { value: "sku", label: "SKU" },
            { value: "quantity", label: "Highest quantity" }, { value: "newest", label: "Newest" },
        ]} value={query.sort ?? "name"}/>
        <button className="button button-secondary" type="submit"><Search size={16}/> Apply</button>
        {(query.q || query.category || (query.status && query.status !== "all") || (query.sort && query.sort !== "name")) &&
          <Link className="text-link" href="/products">Clear filters</Link>}
      </form>
      <Table columns={["Product", "SKU", "Category", "On hand", "Selling price", "Status", ...(shortages ? ["To minimum"] : []), ...(shortages && admin ? ["Replenish"] : [])]} rows={data.rows.map(product => [
            <span key={product.id} className="product-with-photo"><ProductPhoto product={product}/>
              <span><Link className="cell-link" href={`/products?id=${product.id}`}>{product.name}</Link>
                {(product.brand || product.model) && <small>{product.brand} {product.model}</small>}</span>
            </span>,
            product.sku, product.category_name, `${product.quantity} ${product.unit ?? "Pcs"}`, money(product.sale_minor), <StockBadge key="status" product={product}/>,
            ...(shortages ? [`${Math.max(0, product.minimum_stock - product.quantity)} ${product.unit ?? "Pcs"}`] : []),
            ...(shortages && admin ? [<Link key="receive" className="text-link" href={`/stock-in?product=${product.id}`}>Receive stock</Link>] : []),
        ])} empty="No products match these filters."/>
      <Pager path="/products" search={search} page={query.page} total={data.total}/>
    </Panel>
  </>;
}
export function ProductDetails({ product, lookups, movements, employee, page }) {
    const admin = employee.role === "admin";
    const details = [
        ["SKU", product.sku], ["Barcode", product.barcode || "—"], ["Category", product.category_name],
        ["Brand", product.brand || "—"], ["Model", product.model || "—"], ["Created", dateLabel(product.created_at, lookups.timezone)],
        ["Unit of measure", product.unit ?? "Pcs"], ["On hand", product.quantity], ["Minimum stock", product.minimum_stock], ["Selling price", money(product.sale_minor)],
        ["Supplier", lookups.suppliers.find(supplier => supplier.id === product.supplier_id)?.name ?? "—"],
        ...(product.cost_minor == null ? [] : [["Purchase price", money(product.cost_minor)]]),
    ];
    return <>
    <Heading eyebrow="PRODUCT DETAILS" title={product.name} subtitle={product.description || "Catalog details and stock history."} action={<Link className="button button-secondary" href="/products">Back to products</Link>}/>
    <div className="two-columns">
      <Panel title="Product information" action={<StockBadge product={product}/>}>
        <div className="panel-body">
          <ProductPhoto product={product} variant="detail" decorative={false}/>
          <dl className="detail-list">{details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
          <div className="form-actions" style={{ marginTop: 18 }}><Link className="button button-secondary" href={`/sales?product=${product.id}`}>{admin ? "Sales history" : "Your sales for this product"}</Link></div>
          {!product.archived && <div className="form-actions" style={{ marginTop: 18 }}>
            <Link className="button" href={`/stock-in?product=${product.id}`}><ArrowDownToLine size={16}/> Receive stock</Link>
            <Link className="button button-secondary" href={`/stock-out?product=${product.id}`}><ArrowUpFromLine size={16}/> Issue stock</Link>
          </div>}
          {admin && !product.archived && product.quantity === 0 && <ShopForm command="archive_product" label="Archive product" secondary confirmation="Archive this product? Its transaction history will stay available."><input type="hidden" name="id" value={product.id}/></ShopForm>}
        </div>
      </Panel>
      {admin && !product.archived && <ProductForm data={lookups} product={product}/>}
    </div>
    <Panel title={admin ? "Product movement history" : "Your movements for this product"}>
      <MovementTable data={movements} admin={admin} corrections={admin}/>
      <Pager path="/products" search={{ id: product.id }} page={page} total={movements.total}/>
    </Panel>
  </>;
}
export function Stock({ incoming, employee, data, lookups, query, search }) {
    const admin = employee.role === "admin";
    const products = lookups.products
        .filter(product => incoming || product.quantity > 0)
        .map(product => ({ value: product.id, label: `${product.name} · ${product.sku} (${product.quantity} ${product.unit ?? "Pcs"} on hand)` }));
    const reverse = !incoming && admin && search.reverse;
    const path = incoming ? "/stock-in" : "/stock-out";
    return <>
    <Heading eyebrow="INVENTORY" title={incoming ? "Stock In" : "Stock Out"} subtitle={incoming ? "Receive products and add to available stock." : "Record damage, supplier returns, and other stock adjustments."}/>
    <div className="two-columns">
      <Panel title={incoming ? "Receive stock" : "Issue stock"} subtitle="Your account and the time of submission are recorded automatically.">
        <div className="panel-body">
          <ShopForm command={incoming ? "stock_in" : "stock_out"} label={incoming ? "Confirm receipt" : "Confirm stock out"} reset confirmation={incoming ? undefined : "Confirm this stock issue?"} disabled={!products.length}>
            {products.length ? <div className="form-grid">
              <Select label="Product" name="product_id" options={products} value={query.product} placeholder="Select product" required/>
              <Field label="Quantity" name="quantity" type="number" min={1} max={1000000} defaultValue={1} required/>
              {incoming ? <>
                <Select label="Supplier" name="supplier_id" options={options(lookups.suppliers)} placeholder="Select supplier (optional)"/>
                <Field label="Purchase cost per unit (USD)" name="cost_minor" inputMode="decimal" defaultValue="0.00" required/>
                <Field label="Received date" name="occurred_on" type="date" defaultValue={businessToday(lookups.timezone)} max={businessToday(lookups.timezone)} required/>
                <Field label="Reference number" name="reference" maxLength={180}/>
              </> : <Select label="Reason" name="reason" options={reasons.map(reason => ({ value: reason, label: reason }))} placeholder="Select reason" required/>}
              <Notes />
            </div> : <Empty>{incoming ? "Add an active product before receiving stock." : "No active products have stock available to issue."}</Empty>}
          </ShopForm>
        </div>
      </Panel>
      {reverse ? <Panel title="Reverse stock movement" subtitle="A new movement will record the correction and link it to the original.">
        <div className="panel-body"><ShopForm command="reverse_movement" label="Record correction" confirmation="Confirm this stock correction?">
          <input type="hidden" name="id" value={reverse}/><Notes label="Reason for correction" required/>
        </ShopForm></div>
      </Panel> : <Panel title="Stock guidance"><div className="panel-body flow">
        <p className="muted">{incoming ? "Use a supplier delivery note or invoice number as the reference. To enter opening stock, create the product first and record a receipt here."
                : "Record sales on the Sales page. Confirmed sales create stock movements automatically."}</p>
        <Link className="text-link" href={incoming ? "/products" : "/sales"}>{incoming ? "Open product catalog" : "Open sales"}</Link>
      </div></Panel>}
    </div>
    <Panel title={admin ? "Movement history" : "Your movement history"}>
      <MovementTable data={data} admin={admin} corrections={admin}/>
      <Pager path={path} search={search} page={query.page} total={data.total}/>
    </Panel>
  </>;
}
