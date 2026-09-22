import type { Channel } from "../../core/types.js";
import { ProviderError, type Provider } from "../types.js";
import { graph } from "./common.js";

/**
 * WhatsApp Cloud API: gönderi yok, sadece mesajlaşma.
 * Bağlantı: Meta Business > WhatsApp > API Setup ekranındaki Phone Number ID + kalıcı sistem kullanıcı token'ı.
 */
export const whatsappProvider: Provider = {
  id: "whatsapp",
  label: "WhatsApp Business",
  color: "#25D366",
  connectMode: "form",
  capabilities: {
    post: false,
    story: false,
    reel: false,
    video: false,
    thread: false,
    dm: true,
    inbound: "webhook",
    analytics: false,
    maxTextLength: 4096,
  },
  settingFields: [],
  connectFields: [
    { key: "phoneNumberId", label: "Phone Number ID", type: "text", help: "Meta App > WhatsApp > API Setup" },
    { key: "wabaId", label: "WhatsApp Business Account ID", type: "text" },
    { key: "accessToken", label: "Kalıcı erişim token'ı (System User)", type: "text", help: "Business Settings > System Users > Generate token (whatsapp_business_messaging)" },
    { key: "displayName", label: "Görünen ad", type: "text", help: "Panelde görünecek isim" },
  ],
  isConfigured: () => true,

  async connectWithForm(values) {
    const phoneNumberId = values.phoneNumberId?.trim();
    const token = values.accessToken?.trim();
    if (!phoneNumberId || !token) throw new ProviderError("Phone Number ID ve token zorunlu");
    const info = await graph<{ display_phone_number?: string; verified_name?: string; quality_rating?: string }>(`/${phoneNumberId}`, token, {
      params: { fields: "display_phone_number,verified_name,quality_rating" },
    });
    return [
      {
        externalId: phoneNumberId,
        name: values.displayName?.trim() || info.verified_name || `WhatsApp ${info.display_phone_number ?? phoneNumberId}`,
        username: info.display_phone_number ?? null,
        accessToken: token,
        tokenExpiresAt: null,
        metadata: { wabaId: values.wabaId?.trim() ?? null, phone: info.display_phone_number ?? null, quality: info.quality_rating ?? null },
      },
    ];
  },

  async publish() {
    throw new ProviderError("WhatsApp gönderi paylaşımını desteklemez; yalnızca mesajlaşma");
  },

  async sendMessage({ channel, participantId, text }) {
    const r = await graph<{ messages?: Array<{ id: string }> }>(`/${channel.externalId}/messages`, channel.accessToken, {
      method: "POST",
      params: { messaging_product: "whatsapp", recipient_type: "individual", to: participantId, type: "text", text: { body: text, preview_url: false } },
    });
    return { externalId: r.messages?.[0]?.id ?? null };
  },

  async healthCheck(channel: Channel) {
    try {
      await graph(`/${channel.externalId}`, channel.accessToken, { params: { fields: "id" } });
      return { ok: true };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  },
};
