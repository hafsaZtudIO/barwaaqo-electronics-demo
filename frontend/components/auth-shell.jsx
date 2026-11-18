import { Boxes, CircleCheck, LockKeyhole } from "lucide-react";
import { Brand } from "./brand";
export function AuthShell({ title, subtitle, children }) {
    return <main className="auth-layout">
    <aside className="auth-story">
      <Brand />
      <div className="auth-story-inner">
        <span className="auth-icon"><Boxes size={29} strokeWidth={1.5}/></span>
        <p className="eyebrow">THE SHOP WORKSPACE</p>
        <h2>Inventory and sales,<br />in one place.</h2>
        <p>Track stock, record sales, and review daily activity at Barwaaqo Electronics.</p>
        <div className="auth-check"><CircleCheck size={18}/> Private employee access</div>
      </div>
      <span className="auth-footer">BARWAAQO ELECTRONICS</span>
    </aside>
    <section className="auth-main"><div className="auth-card">
      <div className="auth-mobile-brand"><Brand /></div>
      <span className="auth-lock"><LockKeyhole size={22}/></span>
      <h1>{title}</h1><p className="auth-subtitle">{subtitle}</p>
      {children}
    </div><p className="auth-private"><LockKeyhole size={13}/> Authorized employees only</p></section>
  </main>;
}
