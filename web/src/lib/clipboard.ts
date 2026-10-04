/**
 * Panoya güvenli kopyalama: Clipboard API izni yoksa (eski tarayıcı, http, iframe, izin reddi) gizli bir metin
 * alanıyla eski yöntemi dener. Hata fırlatmaz; başarılıysa true döner.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* eski yönteme geç */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
