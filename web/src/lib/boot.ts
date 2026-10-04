import type { PublicConfig } from "./api";
import snapshot from "../generated/public-config.json";

/**
 * true: sayfa ön-render edilmiş HTML ile geldi (ya da sunucuda ön-render ediliyor).
 * Modül ilk yüklendiğinde, React #root'a dokunmadan önce hesaplanır.
 */
export const PRERENDERED = typeof document === "undefined" || Boolean(document.getElementById("root")?.firstElementChild);

/** Derleme anındaki genel yapılandırma; ön-render HTML'i ile ilk tarayıcı çizimi aynı veriyi kullanır */
export const PUBLIC_SNAPSHOT = snapshot as PublicConfig;
