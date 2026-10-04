import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Menu, X } from "lucide-react";
import { Logo } from "../../../components/Logo";
import { useMeQuery } from "../../../lib/session";
import { fill } from "../../lib/fill";
import { useLinks, useSite } from "../../lib/useSite";
import { LangSwitch, PrimaryCta } from "../ui/primitives";

function useNavItems() {
  const { c } = useSite();
  const links = useLinks();
  // Fiyatlar ana sayfada bölüme, diğer sayfalarda fiyat sayfasına gider
  return c.nav.items.map((item) => ({
    ...item,
    href: item.id === "pricing" && !links.onHome ? links.page("pricing") : links.section(item.id),
    route: item.id === "pricing" && !links.onHome,
  }));
}

function NavItemLink({ href, route, children, onClick }: { href: string; route: boolean; children: React.ReactNode; onClick?: () => void }) {
  return route ? (
    <Link to={href} onClick={onClick}>
      {children}
    </Link>
  ) : (
    <a href={href} onClick={onClick}>
      {children}
    </a>
  );
}

function LoginLink({ className }: { className: string }) {
  const { c } = useSite();
  const me = useMeQuery();
  if (me.data?.user) return null;
  return (
    <Link to="/login" className={className}>
      {c.nav.login}
    </Link>
  );
}

/** Menü penceresi içinde Tab/Shift+Tab döngüsü */
function trapFocus(e: ReactKeyboardEvent<HTMLDivElement>) {
  if (e.key !== "Tab") return;
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'));
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

export function SiteNav() {
  const { c, app } = useSite();
  const links = useLinks();
  const items = useNavItems();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const burger = useRef<HTMLButtonElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.dataset.menu = "open";
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    const opener = burger.current;
    return () => {
      document.body.style.overflow = prev;
      delete document.documentElement.dataset.menu;
      window.removeEventListener("keydown", onKey);
      opener?.focus();
    };
  }, [open]);

  return (
    <header className="s-nav" data-scrolled={scrolled}>
      <div className="s-container s-nav__inner">
        <Link to={links.page("home")} className="s-nav__logo" aria-label={fill(c.nav.homeAria, { app })}>
          <Logo className="s-logo" />
        </Link>
        <nav className="s-nav__links" aria-label={c.nav.mainNav}>
          <ul>
            {items.map((l) => (
              <li key={l.id}>
                <NavItemLink href={l.href} route={l.route}>
                  {l.label}
                </NavItemLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="s-nav__actions">
          <LangSwitch />
          <LoginLink className="s-btn s-btn--ghost" />
          <PrimaryCta size="md" />
        </div>
        <div className="s-nav__compact">
          <PrimaryCta size="md" className="s-nav__cta-tablet" />
          <button ref={burger} type="button" className="s-burger" aria-label={c.nav.menuOpen} aria-expanded={open} aria-controls="s-menu" onClick={() => setOpen(true)}>
            <Menu aria-hidden="true" />
          </button>
        </div>
      </div>

      {open && (
        <div id="s-menu" className="s-menu" role="dialog" aria-modal="true" aria-label={c.nav.menu} onKeyDown={trapFocus}>
          <div className="s-menu__top">
            <Logo className="s-logo" />
            <button ref={closeBtn} type="button" className="s-burger" aria-label={c.nav.menuClose} onClick={() => setOpen(false)}>
              <X aria-hidden="true" />
            </button>
          </div>
          <nav aria-label={c.nav.mainNav}>
            <ul>
              {items.map((l) => (
                <li key={l.id}>
                  <NavItemLink href={l.href} route={l.route} onClick={() => setOpen(false)}>
                    {l.label}
                    <ArrowRight aria-hidden="true" />
                  </NavItemLink>
                </li>
              ))}
            </ul>
          </nav>
          <div className="s-menu__foot">
            <LangSwitch />
            <LoginLink className="s-btn s-btn--secondary s-btn--lg s-btn--block" />
            <PrimaryCta block />
          </div>
        </div>
      )}
    </header>
  );
}
