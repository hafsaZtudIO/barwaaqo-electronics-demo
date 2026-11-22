"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowDownToLine, ArrowUpFromLine, BarChart3, Boxes, ChevronDown, ClipboardList, LayoutDashboard, LogOut, Menu, PanelLeftClose, PanelLeftOpen, ReceiptText, Search, Settings, ShoppingCart, Truck, Users, WifiOff, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { logout } from "@/backend/actions";
import { Brand } from "./brand";
import { useOffline } from "./connection";
const groups = [
  { name: "Workspace", links: [{ path: "/dashboard", name: "Shop overview", icon: LayoutDashboard }] },
  { name: "Selling", links: [
    { path: "/pos", name: "Point of Sale", icon: ShoppingCart },
    { path: "/sales", name: "Sales History", icon: ReceiptText },
    { path: "/customers", name: "Customers", icon: Users },
    { path: "/closeout", name: "End of Day", icon: ClipboardList },
  ] },
  { name: "Stock", links: [
    { path: "/products", name: "Products", icon: Boxes },
    { path: "/stock-in", name: "Stock In", icon: ArrowDownToLine },
    { path: "/stock-out", name: "Stock Out", icon: ArrowUpFromLine },
  ] },
  { name: "Buying", links: [
    { path: "/purchases", name: "Supplier Purchases", icon: ClipboardList, admin: true },
    { path: "/suppliers", name: "Suppliers", icon: Truck, admin: true },
  ] },
  { name: "Administration", links: [
    { path: "/expenses", name: "Expenses", icon: ReceiptText, admin: true },
    { path: "/employees", name: "Employees", icon: Users, admin: true },
    { path: "/reports", name: "Reports", icon: BarChart3, admin: true },
    { path: "/settings", name: "Settings", icon: Settings, admin: true },
  ] },
];
export function Workspace({ employee, children }) {
    const pathname = usePathname();
    const router = useRouter();
    const offline = useOffline();
    const [open, setOpen] = useState(false);
    const [collapsed, setCollapsed] = useState(false);
    const [query, setQuery] = useState("");
    const searchDialog = useRef(null);
    const searchInput = useRef(null);
    const visibleGroups = groups.map(group => ({
        ...group, links: group.links.filter(link => !link.admin || employee.role === "admin"),
    })).filter(group => group.links.length);
    const links = visibleGroups.flatMap(group => group.links);
    const searchResults = links.filter(link => link.name.toLowerCase().includes(query.trim().toLowerCase()));
    const productSearch = `/products?${new URLSearchParams({ q: query.trim() })}`;
    const current = links.find(link => link.path === pathname)?.name ?? "Workspace";
    function openSearch() {
        setQuery("");
        if (!searchDialog.current?.open) searchDialog.current?.showModal();
        searchInput.current?.focus();
    }
    useEffect(() => {
        function shortcut(event) {
            if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "g" ||
                document.querySelector("dialog[open]")) return;
            event.preventDefault();
            openSearch();
        }
        window.addEventListener("keydown", shortcut);
        return () => window.removeEventListener("keydown", shortcut);
    }, []);
    const initials = employee.full_name.split(/\s+/).slice(0, 2).map(word => word[0]).join("").toUpperCase();
    const role = employee.role === "admin" ? "Administrator" : "Employee";
    return <div className={collapsed ? "workspace workspace-collapsed" : "workspace"}>
    <a className="skip-link" href="#content">Skip to content</a>
    {open && <button type="button" className="mobile-overlay" onClick={() => setOpen(false)} aria-label="Close navigation"/>}
    <aside id="workspace-menu" className={`sidebar ${open ? "sidebar-open" : ""}`}>
      <div className="sidebar-brand"><Brand /><button className="icon-button sidebar-close" onClick={() => setOpen(false)} aria-label="Close navigation"><X size={20}/></button></div>
      <nav aria-label="Workspace">
        {visibleGroups.map(group => <div className="workspace-nav-group" key={group.name}>
          <p>{group.name}</p>
          {group.links.map(link => <Link key={link.path} href={link.path} onClick={() => setOpen(false)} aria-current={pathname === link.path ? "page" : undefined}>
            <link.icon size={18} strokeWidth={1.75}/>{link.name}
          </Link>)}
        </div>)}
      </nav>
      <div className="sidebar-foot"><form action={logout}><button type="submit"><LogOut size={17}/>Sign out</button></form></div>
    </aside>
    <div className="workspace-main">
      <header className="topbar">
        <div className="top-title">
          <button className="icon-button mobile-toggle" onClick={() => setOpen(true)} aria-label="Open navigation" aria-controls="workspace-menu" aria-expanded={open}><Menu size={22}/></button>
          <button type="button" className="icon-button desktop-toggle" onClick={() => setCollapsed(value => !value)}
            aria-label={collapsed ? "Show sidebar" : "Hide sidebar"} aria-controls="workspace-menu" aria-expanded={!collapsed}>
            {collapsed ? <PanelLeftOpen size={20}/> : <PanelLeftClose size={20}/>}
          </button>
          <span className="breadcrumb">Workspace</span><span className="breadcrumb">/</span><strong>{current}</strong>
        </div>
        <div className="workspace-tools">
        {offline && <span className="connection-offline" role="status"><WifiOff size={16}/> Offline</span>}
        <button className="workspace-search-trigger" type="button" onClick={openSearch} aria-label="Search pages and products" aria-keyshortcuts="Control+G Meta+G"><Search size={16}/><span>Search</span><kbd>Ctrl G</kbd></button>
        <details className="profile"><summary aria-label="Account menu"><span className="avatar">{initials}</span><span className="profile-name"><strong>{employee.full_name}</strong><small>{role}</small></span><ChevronDown size={14}/></summary>
          <div className="profile-menu"><p>{employee.username ?? employee.full_name}{employee.employee_number && ` · ${employee.employee_number}`}</p>
            <form action={logout}><button type="submit"><LogOut size={15}/> Sign out</button></form>
          </div>
        </details>
        </div>
      </header>
      {offline && <div className="connection-banner" role="status">Connection lost. Keep the register open to save invoices on this device. Other changes need a connection.</div>}
      <main id="content" className={pathname === "/pos" ? "content content-wide" : "content"}>{children}</main>
    </div>
    <dialog className="workspace-search-dialog" ref={searchDialog} aria-labelledby="workspace-search-title">
      <div className="workspace-search-heading"><h2 id="workspace-search-title">Search workspace</h2><button className="icon-button" type="button" aria-label="Close search" onClick={() => searchDialog.current?.close()}><X size={18}/></button></div>
      <form onSubmit={event => {
          event.preventDefault();
          if (!searchResults[0] && !query.trim()) return;
          searchDialog.current?.close();
          setOpen(false);
          router.push(searchResults[0]?.path ?? productSearch);
      }}><label className="field"><span className="sr-only">Page, product name, SKU, or barcode</span><input ref={searchInput} value={query} maxLength={150} onChange={event => setQuery(event.target.value)} placeholder="Page, product, SKU, or barcode…" autoComplete="off"/></label></form>
      <div className="workspace-search-links">
        {query.trim() && <Link className="workspace-product-search" href={productSearch} onClick={() => { searchDialog.current?.close(); setOpen(false); }}><Boxes size={17}/> Search products for “{query.trim()}”</Link>}
        {!searchResults.length && <p className="muted">No matching pages. Search the product catalog above.</p>}
        {searchResults.map(link =>
          <Link key={link.path} href={link.path} onClick={() => { searchDialog.current?.close(); setOpen(false); }}><link.icon size={17}/>{link.name}</Link>)}
      </div>
    </dialog>
  </div>;
}
