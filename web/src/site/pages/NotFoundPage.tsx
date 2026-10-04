import { Link } from "react-router-dom";
import { Seo } from "../../seo/Seo";
import { useLinks, useSite } from "../lib/useSite";
import { SiteShell } from "../components/SiteShell";
import { DotTitle } from "../components/ui/primitives";

/** Bilinmeyen adresler. Sunucu bu sayfayı 404 durum koduyla verir (dist/404.html), meta robots noindex. */
export default function NotFoundPage() {
  const { c } = useSite();
  const links = useLinks();
  const n = c.notFound;
  return (
    <SiteShell>
      <Seo page="404" />
      <section className="s-404" aria-labelledby="nf-title">
        <div className="s-container">
          <p className="s-404__code" aria-hidden="true">
            {n.code}
          </p>
          <h1 id="nf-title" className="s-h1 s-h1--page">
            <DotTitle text={n.title} />
          </h1>
          <p className="s-lead">{n.lead}</p>
          <div className="s-404__ctas" data-cta-zone>
            <Link to={links.page("home")} className="s-btn s-btn--primary s-btn--lg">
              {n.home}
            </Link>
            <Link to={links.page("pricing")} className="s-btn s-btn--secondary s-btn--lg">
              {n.pricing}
            </Link>
          </div>
        </div>
      </section>
    </SiteShell>
  );
}
