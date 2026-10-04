import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Columns3, Download, Search } from "lucide-react";
import { useI18n } from "../../lib/i18n";
import { downloadText, toCsv } from "./format";

export interface Column<T> {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  sort?: (row: T) => number | string | null;
  csv?: (row: T) => string | number | null;
  align?: "left" | "right";
  /** Varsayılan olarak gizli (sütun seçiciden açılır) */
  hidden?: boolean;
  /** Gizlenemez (ör. içerik sütunu) */
  locked?: boolean;
  width?: number | string;
}

interface Props<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  search?: (row: T, q: string) => boolean;
  csvName?: string;
  initialSort?: { key: string; dir: "asc" | "desc" };
  pageSizes?: number[];
  empty?: ReactNode;
  caption: string;
}

/**
 * Metricool'daki "List of posts" karşılığı: arama, sıralama (başlığa tıkla), sütun seçici, sayfalama, CSV.
 * CSV görünür sütunları ve süzülmüş satırların tamamını verir.
 */
export function DataTable<T>({ rows, columns, rowKey, search, csvName, initialSort, pageSizes = [10, 25, 50], empty, caption }: Props<T>) {
  const { t, locale } = useI18n();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState(initialSort ?? null);
  const [visible, setVisible] = useState(() => new Set(columns.filter((c) => !c.hidden).map((c) => c.key)));
  const [size, setSize] = useState(pageSizes[0]);
  const [page, setPage] = useState(0);
  const [picker, setPicker] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!picker) return;
    const onDoc = (e: MouseEvent) => !pickerRef.current?.contains(e.target as Node) && setPicker(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPicker(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [picker]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLocaleLowerCase(locale);
    const base = qq && search ? rows.filter((r) => search(r, qq)) : rows;
    if (!sort) return base;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sort) return base;
    const get = col.sort;
    return [...base].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      // Boş değerler her iki yönde de sonda
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      const r = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), locale);
      return sort.dir === "asc" ? r : -r;
    });
  }, [rows, q, sort, columns, search, locale]);

  useEffect(() => setPage(0), [q, sort, size]);

  const shown = columns.filter((c) => visible.has(c.key));
  const pages = Math.max(1, Math.ceil(filtered.length / size));
  const slice = filtered.slice(page * size, page * size + size);

  const exportCsv = () => {
    const head = shown.map((c) => c.label);
    const body = filtered.map((r) => shown.map((c) => (c.csv ? c.csv(r) : (c.sort?.(r) ?? null))));
    downloadText(`${csvName ?? "reblebi"}.csv`, toCsv([head, ...body], locale));
  };

  const toggleSort = (key: string) => setSort((s) => (s?.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }));

  return (
    <div className="dt">
      <div className="dt-bar">
        {search && (
          <label className="dt-search">
            <Search aria-hidden="true" />
            <span className="sr-only">{t("Ara")}</span>
            <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Ara")} />
          </label>
        )}
        <div className="dt-actions">
          <div className="dt-picker" ref={pickerRef}>
            <button type="button" className="btn btn-sm" aria-expanded={picker} onClick={() => setPicker(!picker)}>
              <Columns3 aria-hidden="true" /> {t("Sütunlar")}
            </button>
            {picker && (
              <div className="menu dt-menu" role="group" aria-label={t("Sütunlar")}>
                {columns.map((c) => (
                  <label key={c.key} className="dt-check">
                    <input
                      type="checkbox"
                      checked={visible.has(c.key)}
                      disabled={c.locked}
                      onChange={(e) => {
                        const next = new Set(visible);
                        if (e.target.checked) next.add(c.key);
                        else next.delete(c.key);
                        setVisible(next);
                      }}
                    />
                    {c.label}
                  </label>
                ))}
              </div>
            )}
          </div>
          {csvName && (
            <button type="button" className="btn btn-sm" onClick={exportCsv} disabled={!filtered.length}>
              <Download aria-hidden="true" /> CSV
            </button>
          )}
        </div>
      </div>
      <div className="table-wrap">
        <table className="table dt-table">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {shown.map((c) => (
                <th key={c.key} style={{ width: c.width, textAlign: c.align ?? "left" }} aria-sort={sort?.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}>
                  {c.sort ? (
                    <button type="button" className="dt-sort" onClick={() => toggleSort(c.key)} style={{ justifyContent: c.align === "right" ? "flex-end" : "flex-start" }}>
                      {c.label}
                      {sort?.key === c.key && (sort.dir === "asc" ? <ArrowUp aria-hidden="true" /> : <ArrowDown aria-hidden="true" />)}
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slice.map((r) => (
              <tr key={rowKey(r)}>
                {shown.map((c) => (
                  <td key={c.key} style={{ textAlign: c.align ?? "left" }} className={c.align === "right" ? "num" : undefined}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))}
            {!slice.length && (
              <tr>
                <td colSpan={shown.length} className="dt-empty">
                  {empty ?? t("Sonuç yok")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {filtered.length > pageSizes[0] && (
        <div className="dt-pager">
          <label className="row small">
            {t("Sayfa başına")}
            <select className="select" value={size} onChange={(e) => setSize(Number(e.target.value))}>
              {pageSizes.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <span className="small muted">
            {page * size + 1}–{Math.min(filtered.length, page * size + size)} / {filtered.length}
          </span>
          <div className="row" style={{ gap: 4 }}>
            <button type="button" className="btn btn-sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
              {t("Önceki")}
            </button>
            <button type="button" className="btn btn-sm" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
              {t("Sonraki")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
