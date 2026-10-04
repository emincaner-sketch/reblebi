/** "{days} gün ücretsiz dene" gibi şablonları doldurur; bilinmeyen anahtar olduğu gibi kalır */
export function fill(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (vars[key] !== undefined ? String(vars[key]) : match));
}
