<div align="center">

<img src="frontend/public/logo.png" alt="Barwaaqo Electronics logo" width="112">

# Barwaaqo Electronics

### Inventory, sales, and shop management

[Home page](https://hafsaztudio.github.io/barwaaqo-electronics-demo/) · [Open workspace](https://hafsaztudio.github.io/barwaaqo-electronics-demo/frontend/demo.html) · [Run locally](#run-locally)

</div>

---

The public website uses the original Barwaaqo shop screens, styling, forms, and PostgreSQL business rules. Its home page uses DM Sans and Instrument Serif with a compact workspace preview.

The workspace starts with fictional products, suppliers, customers, staff accounts, and transactions. Records are saved in the visitor's browser. PGlite runs the shop's PostgreSQL migrations locally in WebAssembly.

## Shop workflows

| Screen | Available workflows |
| --- | --- |
| **Showroom** | Sales activity, stock levels, low-stock alerts, recent sales, and stock movements |
| **Point of Sale** | Product and barcode search, quantities, item discounts, parked sales, ZAAD and customer credit checkout |
| **Products** | Create and edit products, categories, prices, units, photos, minimum stock, and archived products |
| **Stock In / Stock Out** | Receive stock, record issues, review movement history, and reverse eligible stock adjustments |
| **Sales** | Find receipts, print them, edit completed sales, and record partial returns |
| **Customers** | Customer records, credit balances, repayments, and account activity |
| **Supplier Purchases** | Purchase orders, receipt into stock, partial payments, and supplier balances |
| **Expenses** | Categories, payment methods, dates, references, and voided entries |
| **Suppliers** | Supplier directory, delivery history, purchases, and balances |
| **Employees** | Create local sample accounts, update usernames, and change roles and access |
| **Reports** | Date filters, sales summaries, product and staff performance, expenses, and CSV exports |
| **End of Day** | Collections, refunds, expenses, and supplier payments by method |
| **Settings** | Shop name, timezone, product categories, and the audit trail |

### Recent improvements

The public workspace includes the updated shop overview and grouped navigation, register display preferences, product photo selection, and sales history search, date filters, return status, sorting, and pagination. Uploaded demo photos are stored with the fictional data in this browser. Large photos can exhaust browser storage; use small images for the demo.

## Sample accounts

The workspace opens as the sample owner on the first visit. **Sign out** opens the original sign-in screen.

| Role | Username | Password |
| --- | --- | --- |
| Administrator | owner | shop123 |
| Employee | cashier | shop123 |

New sample staff accounts work within the same browser. Passwords are hashed locally. Email invitation and recovery actions display sample-account guidance.

The floating **Reset sample data** control restores the starting records and accounts.

## Run locally

Use Node.js 22 or later.

```sh
git clone https://github.com/hafsaZtudIO/barwaaqo-electronics-demo.git
cd barwaaqo-electronics-demo
npm ci
npm run build
npm start
```

Open [localhost on port 4173](http://127.0.0.1:4173).

```sh
npm test
```

The tests apply the actual shop migrations to embedded PostgreSQL. They verify permissions, stock, rollback, retry protection, sales corrections, returns, credit, supplier payments, expenses, and complete snapshot restoration.

## Project layout

```text
frontend/
  index.html              Public home page
  styles.css              Original home page typography and layout
  demo.html               Workspace entry point
  workspace.jsx           Browser application shell
  section.jsx             Original shop page selection
  components/             Original shop screens and forms
  platform/               Browser navigation and image adapters
  workspace-source.css    Original shop stylesheet
  public/                 Logo, product images, and checkout audio
backend/
  database.js             Browser PostgreSQL and saved snapshots
  sample-shop.js          Fictional starting records and local sample accounts
  shop.js                 Local repository and account adapter
  actions.js              Original form actions adapted to the browser
  validation.js           Original input validation
  supabase/migrations/    Original schema and business rules
  tests/                  Database and public workspace tests
scripts/
  build.js                JavaScript, CSS, and static website build
dist/                     Generated website for GitHub Pages
```

## Public data and hosting

All starting records are fictional. The full workspace uses the browser storage key `barwaaqo-full-workspace-v2`; it keeps its state across reloads and synchronizes updates between tabs.

The build creates `dist/` with the home page, original workspace UI, PostgreSQL WebAssembly files, and bundled migrations. GitHub Pages serves the generated site from the `gh-pages` branch. Source code lives on `main`.

Product prices use USD integer cents. Business dates use the shop timezone, initially `Africa/Nairobi`.
