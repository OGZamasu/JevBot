import { ArrowUpRight, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';

export function Logo({ small = false }: { small?: boolean }) {
  return <a className={`logo ${small ? 'small' : ''}`} href="/" aria-label="JevBot home"><span className="logo-mark"><svg viewBox="0 0 40 40" aria-hidden="true"><path d="M9 8h23v17c0 9-5 14-15 14H9V29h8c4 0 5-2 5-6v-5H9z"/><circle cx="13" cy="24" r="2.5"/></svg></span>jev<span className="logo-light">bot</span><span className="logo-dot">.</span></a>;
}
export function Pill({ children, tone = '' }: { children: ReactNode; tone?: string }) { return <span className={`pill ${tone}`}>{children}</span>; }
export function Empty({ title, children }: { title: string; children: ReactNode }) { return <div className="empty"><ShieldCheck size={36} strokeWidth={1.3}/><h3>{title}</h3><p>{children}</p></div>; }
export function Footer({ sourceUrl }: { sourceUrl?: string }) { return <footer className="footer"><Logo small/><p>Built for communities. Open for everyone.</p><div><a href="/docs">Documentation <ArrowUpRight size={14}/></a><a href="/privacy">Privacy</a>{sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer">Source <ArrowUpRight size={14}/></a>}<span>© {new Date().getFullYear()} JevBot</span></div></footer>; }
