import { Plus } from "lucide-react";
import type { FaqItem } from "../../../landing/faq-data";
import { SectionHead } from "../ui/primitives";

/**
 * İtiraz bölümü. Yerel <details>: klavyeyle açılır, JS olmadan çalışır, cevaplar ön-render HTML'inde.
 * Metin landing/faq-data.ts'ten gelir; JSON-LD FAQPage aynı diziden üretilir (birebir aynı metin).
 */
export function Faq({ items, eyebrow, title, id = "faq" }: { items: FaqItem[]; eyebrow: string; title: string; id?: string }) {
  return (
    <section id={id} className="s-section s-faq" aria-labelledby={`${id}-title`}>
      <div className="s-container s-faq__grid">
        <SectionHead eyebrow={eyebrow} title={title} id={`${id}-title`} />
        <div className="s-faq__list">
          {items.map((f) => (
            <details key={f.q} data-reveal>
              <summary>
                <h3>{f.q}</h3>
                <Plus aria-hidden="true" />
              </summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
