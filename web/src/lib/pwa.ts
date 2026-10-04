import { useSyncExternalStore } from "react";

/**
 * Yüklenebilir uygulama (PWA): servis çalışanı kaydı ve "Uygulamayı yükle" istemi.
 * Servis çalışanı yalnızca üretim derlemesinde kaydedilir (geliştirmede Vite'in HMR'ını bozmasın).
 */

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    emit();
  });
}

export function registerServiceWorker(): void {
  if (typeof window === "undefined" || !import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  const go = () => void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => undefined);
  if (document.readyState === "complete") go();
  else window.addEventListener("load", go, { once: true });
}

/* ---------------- Anlık bildirim (Web Push) ---------------- */

export type PushState = "unsupported" | "needs-install" | "denied" | "off" | "on";

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const standalone = () => window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration("/")) ?? null;
}

/** Bu cihazın bildirim durumu (iOS'ta yalnızca ana ekrana eklenmiş uygulama bildirim alabilir) */
export async function pushState(): Promise<PushState> {
  if (typeof window === "undefined" || !("PushManager" in window) || !("Notification" in window)) return isIos() && !standalone() ? "needs-install" : "unsupported";
  const reg = await registration();
  if (!reg) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  return (await reg.pushManager.getSubscription()) ? "on" : "off";
}

export async function enablePush(api: { get: <T>(u: string) => Promise<T>; post: <T>(u: string, b?: unknown) => Promise<T> }): Promise<PushState> {
  const reg = await registration();
  if (!reg) return "unsupported";
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return perm === "denied" ? "denied" : "off";
  const { publicKey } = await api.get<{ publicKey: string }>("/api/push/key");
  const key = Uint8Array.from(atob(publicKey.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await api.post("/api/push/subscriptions", { endpoint: json.endpoint, keys: json.keys });
  await api.post("/api/push/test").catch(() => undefined);
  return "on";
}

export async function disablePush(api: { del: <T>(u: string, b?: unknown) => Promise<T> }): Promise<PushState> {
  const reg = await registration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (sub) {
    await api.del("/api/push/subscriptions", { endpoint: sub.endpoint }).catch(() => undefined);
    await sub.unsubscribe().catch(() => undefined);
  }
  return "off";
}

/** Tarayıcı yükleme istemi sunduysa true; yükledikten ya da uygulama içinden açıldıysa false */
export function useInstallPrompt(): { canInstall: boolean; install: () => Promise<boolean> } {
  const canInstall = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => Boolean(deferred),
    () => false,
  );
  return {
    canInstall,
    install: async () => {
      if (!deferred) return false;
      const ev = deferred;
      await ev.prompt();
      const choice = await ev.userChoice.catch(() => ({ outcome: "dismissed" as const }));
      deferred = null;
      emit();
      return choice.outcome === "accepted";
    },
  };
}
