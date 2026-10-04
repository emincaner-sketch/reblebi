/**
 * Markalı rapor → PowerPoint (.pptx). pptxgenjs yalnızca bu dışa aktarmada, tıklanınca yüklenir.
 * Grafikler PowerPoint'in kendi grafikleridir (verisi düzenlenebilir); renkler panelin doğrulanmış kategorik paletinden.
 */

export interface DeckTable {
  title: string;
  lead?: string;
  head: string[];
  rows: Array<Array<string>>;
  /** Sağa hizalanacak sütunlar (sayılar) */
  numeric?: number[];
}

export interface DeckChart {
  title: string;
  lead?: string;
  kind: "line" | "bar";
  labels: string[];
  series: Array<{ name: string; values: Array<number | null> }>;
}

export interface DeckModel {
  fileName: string;
  brand: string;
  color: string;
  logo: string | null;
  kicker: string;
  title: string;
  period: string;
  compare: string;
  prepared: string;
  intro: string;
  kpis: Array<{ label: string; value: string; delta: string | null; good: boolean | null }>;
  highlightsTitle: string;
  highlights: string[];
  summaryTitle: string;
  blocks: Array<{ type: "chart"; chart: DeckChart } | { type: "table"; table: DeckTable } | { type: "charts2"; charts: [DeckChart, DeckChart] }>;
  footer: string;
}

const PALETTE = ["5B49F2", "EB6834", "1BAF7A", "EDA100", "E87BA4", "008300", "2A78D6", "E34948"];
const INK = "1A1726";
const MUTED = "5E5970";
const LINE = "E6E1D8";

const hex = (c: string) => c.replace(/^#/, "").toUpperCase();
/** Vurgu rengi üzerinde okunur yazı (WCAG 4.5:1) */
function onColor(c: string): string {
  const v = [0, 2, 4].map((i) => parseInt(hex(c).slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  const l = 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  return 1.05 / (l + 0.05) >= 4.5 ? "FFFFFF" : INK;
}

/** Logo (aynı köken ya da CORS izinli) → data URL; olmazsa logo atlanır */
async function logoData(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith("image/")) return null;
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(typeof r.result === "string" ? r.result : null);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export async function exportPptx(m: DeckModel): Promise<void> {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.33 × 7.5 in
  pptx.author = m.brand;
  pptx.company = m.brand;
  pptx.title = `${m.brand} · ${m.title}`;
  const accent = hex(m.color);
  const ink = onColor(m.color);
  const font = "Calibri";
  const logo = await logoData(m.logo);

  pptx.defineSlideMaster({
    title: "RB",
    background: { color: "FFFFFF" },
    objects: [
      { rect: { x: 0, y: 0, w: 0.12, h: 7.5, fill: { color: accent } } },
      { text: { text: m.footer, options: { x: 0.5, y: 7.05, w: 9, h: 0.3, fontFace: font, fontSize: 9, color: MUTED } } },
    ],
    slideNumber: { x: 12.4, y: 7.05, fontFace: font, fontSize: 9, color: MUTED },
  });

  /* ---- Kapak ---- */
  const cover = pptx.addSlide();
  cover.background = { color: accent };
  if (logo) cover.addImage({ data: logo, x: 0.8, y: 0.8, w: 0.9, h: 0.9, sizing: { type: "contain", w: 0.9, h: 0.9 } });
  cover.addText(m.brand, { x: logo ? 1.9 : 0.8, y: 0.8, w: 9, h: 0.45, fontFace: font, fontSize: 18, bold: true, color: ink });
  cover.addText(m.kicker.toLocaleUpperCase(), { x: logo ? 1.9 : 0.8, y: 1.25, w: 9, h: 0.35, fontFace: font, fontSize: 11, color: ink, charSpacing: 2 });
  cover.addText(m.title, { x: 0.8, y: 2.8, w: 11.5, h: 1.2, fontFace: font, fontSize: 40, bold: true, color: ink });
  cover.addText(m.period, { x: 0.8, y: 4.05, w: 11.5, h: 0.5, fontFace: font, fontSize: 18, bold: true, color: ink });
  cover.addText(m.compare, { x: 0.8, y: 4.55, w: 11.5, h: 0.4, fontFace: font, fontSize: 13, color: ink });
  cover.addText(m.prepared, { x: 0.8, y: 6.3, w: 11.5, h: 0.4, fontFace: font, fontSize: 11, color: ink });

  const heading = (s: ReturnType<typeof pptx.addSlide>, title: string, lead?: string) => {
    s.addText(title, { x: 0.5, y: 0.35, w: 12.3, h: 0.6, fontFace: font, fontSize: 24, bold: true, color: INK });
    if (lead) s.addText(lead, { x: 0.5, y: 0.92, w: 12.3, h: 0.35, fontFace: font, fontSize: 12, color: MUTED });
  };

  /* ---- Özet ---- */
  if (m.kpis.length) {
    const s = pptx.addSlide({ masterName: "RB" });
    heading(s, m.summaryTitle, m.intro || undefined);
    const cols = 3;
    m.kpis.slice(0, 6).forEach((k, i) => {
      const x = 0.5 + (i % cols) * 4.15;
      const y = (m.intro ? 1.5 : 1.3) + Math.floor(i / cols) * 1.55;
      s.addShape(pptx.ShapeType.roundRect, { x, y, w: 3.95, h: 1.4, fill: { color: "FFFFFF" }, line: { color: LINE, width: 1 }, rectRadius: 0.12 });
      s.addText(k.label, { x: x + 0.2, y: y + 0.12, w: 3.6, h: 0.35, fontFace: font, fontSize: 12, bold: true, color: MUTED });
      s.addText(k.value, { x: x + 0.2, y: y + 0.45, w: 3.6, h: 0.55, fontFace: font, fontSize: 26, bold: true, color: INK });
      if (k.delta) s.addText(k.delta, { x: x + 0.2, y: y + 0.98, w: 3.6, h: 0.3, fontFace: font, fontSize: 11, color: k.good === null ? MUTED : k.good ? "1F7A45" : "B42318" });
    });
    if (m.highlights.length) {
      const y = (m.intro ? 1.5 : 1.3) + Math.ceil(Math.min(6, m.kpis.length) / cols) * 1.55 + 0.1;
      s.addText(m.highlightsTitle, { x: 0.5, y, w: 12.3, h: 0.35, fontFace: font, fontSize: 13, bold: true, color: INK });
      s.addText(
        m.highlights.map((h) => ({ text: h, options: { bullet: true, breakLine: true } })),
        { x: 0.5, y: y + 0.38, w: 12.3, h: Math.max(0.6, 6.8 - y - 0.4), fontFace: font, fontSize: 12, color: INK, valign: "top", paraSpaceAfter: 4 },
      );
    }
  }

  const chart = (s: ReturnType<typeof pptx.addSlide>, c: DeckChart, box: { x: number; y: number; w: number; h: number }) => {
    const data = c.series.map((se) => ({ name: se.name, labels: c.labels, values: se.values.map((v) => (v === null ? 0 : v)) }));
    s.addChart(c.kind === "bar" ? pptx.ChartType.bar : pptx.ChartType.line, data, {
      ...box,
      barDir: "col",
      chartColors: PALETTE.slice(0, Math.max(1, c.series.length)),
      lineSize: 2,
      lineDataSymbol: "none",
      showLegend: c.series.length > 1,
      legendPos: "t",
      legendFontSize: 10,
      catAxisLabelFontSize: 9,
      valAxisLabelFontSize: 9,
      catAxisLabelColor: MUTED,
      valAxisLabelColor: MUTED,
      valGridLine: { color: LINE, size: 1 },
      catGridLine: { style: "none" },
      catAxisLineShow: false,
      valAxisLineShow: false,
      showValue: false,
    });
  };

  /* ---- Bölümler ---- */
  for (const b of m.blocks) {
    const s = pptx.addSlide({ masterName: "RB" });
    if (b.type === "chart") {
      heading(s, b.chart.title, b.chart.lead);
      chart(s, b.chart, { x: 0.5, y: 1.4, w: 12.3, h: 5.4 });
    } else if (b.type === "charts2") {
      heading(s, b.charts[0].title, b.charts[0].lead);
      chart(s, b.charts[0], { x: 0.5, y: 1.4, w: 6.05, h: 5.3 });
      s.addText(b.charts[1].title, { x: 6.75, y: 1.0, w: 6, h: 0.35, fontFace: font, fontSize: 13, bold: true, color: INK });
      chart(s, b.charts[1], { x: 6.75, y: 1.4, w: 6.05, h: 5.3 });
    } else {
      const tb = b.table;
      heading(s, tb.title, tb.lead);
      const numeric = new Set(tb.numeric ?? []);
      const head = tb.head.map((h, i) => ({ text: h, options: { bold: true, color: MUTED, fontSize: 10, align: numeric.has(i) ? ("right" as const) : ("left" as const), fill: { color: "F6F4F0" } } }));
      const rows = tb.rows.slice(0, 14).map((r) => r.map((c, i) => ({ text: c, options: { fontSize: 11, color: INK, align: numeric.has(i) ? ("right" as const) : ("left" as const) } })));
      s.addTable([head, ...rows], { x: 0.5, y: 1.4, w: 12.3, fontFace: font, border: { type: "solid", pt: 0.5, color: LINE }, autoPage: false, rowH: 0.36, valign: "middle" });
    }
  }

  await pptx.writeFile({ fileName: m.fileName });
}
