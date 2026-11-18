import Link from "next/link";
import { Inbox } from "lucide-react";
export function Panel({ title, subtitle, action, children }) {
    return <section className="panel">
    <div className="panel-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</div>
    {children}
  </section>;
}
export function Heading({ eyebrow, title, subtitle, action }) {
    return <header className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{subtitle}</p></div>{action}</header>;
}
export function Field({ label, ...props }) {
    return <label className="field"><span>{label}</span><input {...props}/></label>;
}
export function Select({ label, name, options, value, placeholder, required }) {
    return <label className="field"><span>{label}</span><select name={name} defaultValue={value ?? ""} required={required}>
    {placeholder && <option value="">{placeholder}</option>}
    {options.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}
  </select></label>;
}
export function Notes({ label = "Notes", name = "notes", value, required }) {
    return <label className="field field-wide"><span>{label}</span><textarea name={name} rows={3} defaultValue={value} maxLength={2000} required={required}/></label>;
}
export function Empty({ children }) {
    return <div className="empty"><span><Inbox size={21}/></span><p>{children}</p></div>;
}
export function Table({ columns, rows, empty = "No records found." }) {
    if (!rows.length)
        return <Empty>{empty}</Empty>;
    return <div className="table-scroll"><table><thead><tr>{columns.map(column => <th key={column} scope="col">{column}</th>)}</tr></thead>
    <tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, column) => <td key={column}>{cell}</td>)}</tr>)}</tbody></table></div>;
}
export function Pager({ path, search, page, total, pageParam = "page" }) {
    const pages = Math.max(1, Math.ceil(total / 25));
    if (pages === 1 && page === 1)
        return null;
    function href(next) {
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(search))
            if (value)
                params.set(key, value);
        params.set(pageParam, String(next));
        return `${path}?${params}`;
    }
    return <div className="pager"><span>Page {page} of {pages} · {total} records</span><div>
    {page > 1 && <Link className="button button-secondary button-small" href={href(page - 1)}>Previous</Link>}
    {page < pages && <Link className="button button-secondary button-small" href={href(page + 1)}>Next</Link>}
  </div></div>;
}
export function dateLabel(value, timezone = "Africa/Nairobi") {
    const timeZone = value.length === 10 ? "UTC" : timezone;
    return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone }).format(new Date(value));
}
export function businessToday(timeZone) {
    return new Intl.DateTimeFormat("sv-SE", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
export function number(value) {
    return new Intl.NumberFormat("en-US").format(value);
}
export const options = (rows) => rows.map(row => ({ value: row.id, label: row.name }));
