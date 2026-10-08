import type { Sentiment } from "../core/repos/listening.js";

/**
 * Sözlük tabanlı hızlı duygu tahmini (Türkçe + İngilizce). Her bahsetmeye ücretsiz ve anında etiket verir;
 * AI açıksa sorgu ayarıyla daha doğru sınıflandırma üstüne yazılır, kullanıcı da elle düzeltebilir.
 * Türkçe ekler için kelime başı (kök) eşleşmesi kullanılır: "lezzetli" → "lezzetliydi", "lezzetlisi".
 */

const POS_TR = [
  "harika", "mükemmel", "muhteşem", "süper", "şahane", "efsane", "bayıl", "güzel", "lezzetli", "nefis", "enfes", "leziz",
  "teşekkür", "tavsiye eder", "öneririm", "tavsiyem", "memnun", "beğendim", "beğendik", "sevdim", "sevdik", "bayıldım", "kaliteli",
  "başarılı", "hızlı", "taze", "favori", "mutlu", "keyif", "harikulade", "çok iyi", "iyi ki", "bravo", "tebrik", "helal", "kusursuz",
];
const NEG_TR = [
  "kötü", "berbat", "rezalet", "rezil", "şikayet", "şikâyet", "iade", "bozuk", "pahalı", "kazık", "yavaş", "gelmedi", "ulaşmadı",
  "beğenmedim", "beğenmedik", "sevmedim", "hayal kırıklığı", "sahte", "dolandır", "bayat", "küflü", "çürük", "geç geldi", "gecikti",
  "iptal", "sorun", "maalesef", "mağdur", "ilgilenmiyor", "cevap vermiyor", "yanıt vermiyor", "saygısız", "pişman",
  "zehirlen", "kusurlu", "eksik geldi", "yanlış ürün", "tavsiye etmem", "almayın", "uzak durun",
];
const POS_EN = [
  "great", "love", "loved", "loving", "excellent", "amazing", "awesome", "recommend", "delicious", "best", "thanks", "thank you",
  "happy", "perfect", "fast", "fresh", "fantastic", "wonderful", "brilliant", "favorite", "favourite", "impressed", "enjoy", "nice", "good",
];
const NEG_EN = [
  "bad", "terrible", "awful", "worst", "scam", "broken", "refund", "disappointed", "disappointing", "slow", "expensive", "never again",
  "hate", "complaint", "problem", "issue", "fake", "rude", "late", "missing", "poor", "horrible", "useless", "waste", "avoid", "stale",
];

// Türkçede olumsuzluk ekle (beğen-me-dim) ya da "değil" ile kurulur; "hiç" pekiştirir, çevirmez
const NEGATORS_BEFORE = new Set(["not", "no", "never", "isn't", "wasn't", "don't", "didn't", "doesn't"]);
/** "sorun-suz", "kusur-suz": olumsuz kök + -sız/-siz/-suz/-süz eki anlamı tersine çevirir */
const WITHOUT = /^s[ıiuü]z/;
const NEGATORS_AFTER = /^(değil|degil)/;

const fold = (s: string) => s.toLocaleLowerCase("tr").normalize("NFC");
const tokenize = (s: string) => fold(s).split(/[^\p{L}\p{N}']+/u).filter(Boolean);

/** Kelime dizisinde bir ifadenin geçtiği yerler (çok kelimeli ifadeler dahil, son kelime kök eşleşmesi); [konum, ek] */
function hits(tokens: string[], phrase: string, prefix: boolean): Array<[number, string]> {
  const parts = phrase.split(" ");
  const out: Array<[number, string]> = [];
  for (let i = 0; i + parts.length <= tokens.length; i++) {
    let ok = true;
    for (let k = 0; k < parts.length; k++) {
      const tok = tokens[i + k];
      const last = k === parts.length - 1;
      if (!(tok === parts[k] || (prefix && last && tok.startsWith(parts[k])))) {
        ok = false;
        break;
      }
    }
    if (ok) out.push([i + parts.length - 1, tokens[i + parts.length - 1].slice(parts[parts.length - 1].length)]);
  }
  return out;
}

function negated(tokens: string[], i: number): boolean {
  for (let k = Math.max(0, i - 2); k < i; k++) if (NEGATORS_BEFORE.has(tokens[k]) || tokens[k].endsWith("n't")) return true;
  for (let k = i + 1; k <= Math.min(tokens.length - 1, i + 2); k++) if (NEGATORS_AFTER.test(tokens[k])) return true;
  return false;
}

export function scoreSentiment(text: string): number {
  const tokens = tokenize(text);
  if (!tokens.length) return 0;
  let score = 0;
  const lists: Array<[string[], number, boolean]> = [
    [POS_TR, 1, true],
    [NEG_TR, -1, true],
    [POS_EN, 1, false],
    [NEG_EN, -1, false],
  ];
  for (const [list, sign, prefix] of lists) {
    for (const w of list) {
      for (const [i, suffix] of hits(tokens, w, prefix)) {
        const flip = negated(tokens, i) !== (prefix && WITHOUT.test(suffix));
        score += flip ? -sign : sign;
      }
    }
  }
  return score;
}

export function lexiconSentiment(text: string): Sentiment {
  const s = scoreSentiment(text);
  return s > 0 ? "positive" : s < 0 ? "negative" : "neutral";
}
