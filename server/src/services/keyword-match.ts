/**
 * DM kuralları ve insana devretme için anahtar kelime eşleştirme.
 *
 * - Tam kelime: "dur" artık "durum" içinde, "site" "üniversite" içinde eşleşmez.
 * - Türkçe harfler: önce tr-TR küçük harfe çevrilir (İ→i, I→ı), sonra şapka/nokta
 *   işaretleri atılır (ı→i, ş→s, ğ→g, ü→u, ö→o, ç→c). Böylece "İNDİR", "INDIR",
 *   "indir" aynı; Türkçe klavyesi olmayan "ucret" yazan da "ücret" kuralına uyar.
 * - Ek alma: kelimenin sonuna * konursa ekli halleri de eşleşir ("fiyat*" → "fiyatı", "fiyatlar").
 * - Kelime grubu: "play store", "nereden başla*" gibi ifadeler yan yana geçen kelimelerle eşleşir.
 * - Kesme işareti ve noktalama kelime sınırıdır: "YDS'ye" içinde "yds" eşleşir.
 */

interface KeywordToken {
  word: string;
  prefix: boolean;
}

/** Karşılaştırma için metni sadeleştirir (Türkçe küçük harf + işaretsiz harfler) */
export function foldText(s: string): string {
  return s
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/ı/g, "i");
}

/** Metni kelimelere böler (harf ve rakam dışındaki her şey ayraçtır) */
export function tokenize(s: string): string[] {
  return foldText(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

function parseKeyword(raw: string): KeywordToken[] {
  return raw
    .trim()
    .split(/\s+/)
    .map((part) => {
      const prefix = part.endsWith("*");
      return tokenize(prefix ? part.replace(/\*+$/, "") : part).map((word, i, arr) => ({ word, prefix: prefix && i === arr.length - 1 }));
    })
    .flat();
}

/** Virgülle ayrılmış anahtar kelime listesini ayrıştırır; boş girdiler atlanır */
export function parseKeywordList(pattern: string | null | undefined): KeywordToken[][] {
  return (pattern ?? "")
    .split(",")
    .map(parseKeyword)
    .filter((k) => k.length > 0);
}

function phraseAt(words: string[], start: number, phrase: KeywordToken[]): boolean {
  for (let j = 0; j < phrase.length; j++) {
    const w = words[start + j];
    const k = phrase[j];
    if (w === undefined) return false;
    if (k.prefix ? !w.startsWith(k.word) : w !== k.word) return false;
  }
  return true;
}

/** Metinde listedeki anahtar kelimelerden biri tam kelime (ya da * ile ek almış) olarak geçiyor mu */
export function matchesKeywords(pattern: string | null | undefined, text: string): boolean {
  const keywords = parseKeywordList(pattern);
  if (!keywords.length) return false;
  const words = tokenize(text.slice(0, 2000));
  return keywords.some((phrase) => words.some((_, i) => phraseAt(words, i, phrase)));
}
