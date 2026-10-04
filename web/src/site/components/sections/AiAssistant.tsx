import { Link } from "react-router-dom";
import { ArrowRight, Bot, Check } from "lucide-react";
import { fill } from "../../lib/fill";
import { useLinks, useSite } from "../../lib/useSite";
import { Dot, SectionHead, delay } from "../ui/primitives";

const COMPAT = ["Claude", "ChatGPT", "Gemini", "Grok", "Cursor"];

/** En güçlü fark: AI asistanı MCP ile panele bağlanır. Sohbet temsilî; araç adları gerçek MCP araçları. */
export function AiAssistant() {
  const { c, cfg, app } = useSite();
  const links = useLinks();
  const a = c.ai;
  const everyPlan = cfg.plans.length > 0 && cfg.plans.every((p) => p.features.mcp);
  return (
    <section id="ai" className="s-section s-ai" aria-labelledby="ai-title">
      <div className="s-container s-ai__grid">
        <div className="s-ai__copy">
          <SectionHead eyebrow={a.eyebrow} title={a.title} id="ai-title" lead={a.lead}>
            {everyPlan && <p className="s-ai__all">{a.allPlans}</p>}
          </SectionHead>
          <ul className="s-checks" data-reveal>
            {a.points.map((p) => (
              <li key={p}>
                <Check aria-hidden="true" />
                {p}
              </li>
            ))}
          </ul>
          <div className="s-ai__compat" data-reveal>
            <span>{a.compat}</span>
            <ul>
              {COMPAT.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
          <Link to={links.page("mcp")} className="s-link" data-reveal>
            {a.guide}
            <ArrowRight aria-hidden="true" />
          </Link>
        </div>

        <figure className="s-chat" data-reveal style={delay(80)} aria-label={a.chat.aria}>
          <div className="s-chat__head">
            <Bot aria-hidden="true" />
            {a.chat.head}
            <span className="s-chip s-chip--ok">{fill(a.chat.badge, { app })}</span>
          </div>
          <div className="s-chat__body">
            <p className="s-bubble s-bubble--user">{a.chat.user}</p>
            {a.chat.tools.map((tool) => (
              <p key={tool.name} className="s-tool">
                <Check aria-hidden="true" />
                <span className="s-mono">{tool.name}</span>
                <span className="s-tool__res">{tool.result}</span>
              </p>
            ))}
            <div className="s-bubble s-bubble--bot">
              <p>
                <strong>{a.chat.reply}</strong> {a.chat.replyNote}
              </p>
              <ul className="s-chat__week" aria-hidden="true">
                {a.chat.days.map((d) => (
                  <li key={d}>
                    {d}
                    <b>19:00</b>
                    <Dot />
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <figcaption className="s-caption">{a.chat.caption}</figcaption>
        </figure>
      </div>
    </section>
  );
}
