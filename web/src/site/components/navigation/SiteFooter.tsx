import { Link } from "react-router-dom";
import { Logo } from "../../../components/Logo";
import { useMeQuery } from "../../../lib/session";
import { useLinks, useSite } from "../../lib/useSite";
import { LangSwitch } from "../ui/primitives";

interface FooterLink {
  label: string;
  href: string;
  route?: boolean;
}

export function SiteFooter() {
  const { c, cfg, app } = useSite();
  const links = useLinks();
  const me = useMeQuery();
  const f = c.footer;
  const cols: Array<{ title: string; links: FooterLink[] }> = [
    {
      title: f.product,
      links: [
        { label: f.links.how, href: links.section("how") },
        { label: f.links.ai, href: links.section("ai") },
        { label: f.links.pricing, href: links.page("pricing"), route: true },
        { label: f.links.faq, href: links.section("faq") },
      ],
    },
    {
      title: f.resources,
      links: [
        { label: f.links.mcp, href: links.page("mcp"), route: true },
        { label: f.links.compare, href: links.page("pricing", "compare"), route: true },
      ],
    },
    {
      title: f.account,
      links: [
        ...(me.data?.user ? [] : [{ label: f.links.login, href: "/login", route: true }]),
        ...(cfg.signupMode === "open" && !me.data?.user ? [{ label: f.links.signup, href: "/signup", route: true }] : []),
        // İletişim yalnızca SUPPORT_EMAIL tanımlıysa (yer tutucu: site-content.ts PLACEHOLDERS.supportEmail)
        ...(cfg.supportEmail ? [{ label: f.links.contact, href: `mailto:${cfg.supportEmail}` }] : []),
      ],
    },
    {
      title: f.legal,
      links: [
        { label: f.links.privacy, href: links.page("privacy"), route: true },
        { label: f.links.terms, href: links.page("terms"), route: true },
        { label: f.links.deletion, href: links.page("deletion"), route: true },
      ],
    },
  ];
  return (
    <footer className="s-foot" data-cta-zone>
      <div className="s-container">
        <div className="s-foot__grid">
          <div className="s-foot__brand">
            <Logo className="s-logo" />
            <p>{f.tagline}</p>
          </div>
          {cols
            .filter((col) => col.links.length > 0)
            .map((col) => (
              <nav key={col.title} aria-label={col.title}>
                <h2>{col.title}</h2>
                <ul>
                  {col.links.map((l) => (
                    <li key={l.label}>
                      {l.route ? <Link to={l.href}>{l.label}</Link> : <a href={l.href}>{l.label}</a>}
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
        </div>
        <div className="s-foot__bottom">
          <span suppressHydrationWarning>
            © {new Date().getFullYear()} {cfg.companyName || app}
          </span>
          <LangSwitch />
        </div>
      </div>
    </footer>
  );
}
