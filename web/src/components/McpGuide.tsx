import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { useI18n } from "../lib/i18n";

/**
 * AI asistanlarını (Claude, ChatGPT, Gemini, Grok, Cursor...) uzak MCP sunucusuna bağlama rehberi.
 * Hem panelde (Ayarlar > API & MCP) hem herkese açık /docs/mcp sayfasında kullanılır.
 */

const CURL = (url: string) =>
  `curl -X POST ${url} \\\n  -H "Authorization: Bearer sp_..." \\\n  -H "Content-Type: application/json" \\\n  -H "Accept: application/json, text/event-stream" \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'`;

type ClientId = "claude" | "chatgpt" | "gemini" | "grok" | "claudecode" | "cursor" | "other";

function CodeBlock({ code }: { code: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <div className="code-block">
      <pre>{code}</pre>
      <button
        className="btn btn-ghost btn-sm code-copy"
        aria-label={t("Kopyala")}
        onClick={() => {
          void navigator.clipboard?.writeText(code).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? <Check /> : <Copy />}
      </button>
    </div>
  );
}

export function McpGuide({ mcpUrl, appName, showKeyHint = true }: { mcpUrl: string; appName: string; showKeyHint?: boolean }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<ClientId>("claude");
  const name = appName.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "sosyalpilot";

  const clients: Array<{ id: ClientId; label: string }> = [
    { id: "claude", label: "Claude" },
    { id: "chatgpt", label: "ChatGPT" },
    { id: "gemini", label: "Gemini" },
    { id: "grok", label: "Grok" },
    { id: "claudecode", label: "Claude Code" },
    { id: "cursor", label: "Cursor" },
    { id: "other", label: t("Diğer") },
  ];

  return (
    <div className="mcp-guide">
      <div className="field">
        <label>{t("MCP sunucu adresi")}</label>
        <CodeBlock code={mcpUrl} />
        <span className="help">
          {t("Bu adresi AI uygulamana eklediğinde bir giriş ve onay ekranı açılır. Hangi çalışma alanına erişim vereceğini sen seçersin; şifre ya da anahtar paylaşmazsın.")}
        </span>
      </div>

      <div className="tabs tabs-wrap" role="tablist">
        {clients.map((c) => (
          <button key={c.id} role="tab" aria-selected={tab === c.id} className={`tab ${tab === c.id ? "active" : ""}`} onClick={() => setTab(c.id)}>
            {c.label}
          </button>
        ))}
      </div>

      {tab === "claude" && (
        <ol className="steps">
          <li>{t("claude.ai'de (web ya da masaüstü uygulaması) Ayarlar > Connectors bölümünü aç.")}</li>
          <li>{t("\"Add custom connector\" düğmesine tıkla, ad olarak {app} yaz ve sunucu adresini yapıştır:", { app: appName })}
            <CodeBlock code={mcpUrl} />
          </li>
          <li>{t("\"Connect\" deyince {app} giriş ekranı açılır. Giriş yap, çalışma alanını seç ve izin ver.", { app: appName })}</li>
          <li>{t("Sohbette araç menüsünden bağlayıcının açık olduğundan emin ol ve isteğini yaz.")}
            <p className="muted small">{t("Özel bağlayıcı ekleme yetkisi Claude hesabının planına ve kuruluş ayarlarına bağlı olabilir.")}</p>
          </li>
        </ol>
      )}

      {tab === "chatgpt" && (
        <ol className="steps">
          <li>{t("ChatGPT'de Ayarlar > Apps & Connectors (Bağlayıcılar) bölümünü aç; gerekiyorsa Gelişmiş ayarlardan geliştirici modunu etkinleştir.")}</li>
          <li>{t("\"Create\" ile yeni bağlayıcı ekle, kimlik doğrulama türü olarak OAuth seç ve sunucu adresini gir:")}
            <CodeBlock code={mcpUrl} />
          </li>
          <li>{t("Bağlanırken açılan {app} ekranında giriş yapıp izin ver.", { app: appName })}
            <p className="muted small">{t("Menü adları ChatGPT sürümüne göre değişebilir; aradığın ayar \"MCP sunucusu\" ya da \"custom connector\" olarak geçer.")}</p>
          </li>
        </ol>
      )}

      {tab === "gemini" && (
        <ol className="steps">
          <li>{t("Gemini CLI'nin ayar dosyasına ({file}) sunucuyu ekle:", { file: "~/.gemini/settings.json" })}
            <CodeBlock code={JSON.stringify({ mcpServers: { [name]: { httpUrl: mcpUrl } } }, null, 2)} />
          </li>
          <li>{t("Gemini CLI'de şu komutla giriş yap; tarayıcıda onay ekranı açılır:")}
            <CodeBlock code={`/mcp auth ${name}`} />
          </li>
          <li>{t("Tarayıcı açamayan sunucu ortamlarında OAuth yerine API anahtarı kullan:")}
            <CodeBlock code={JSON.stringify({ mcpServers: { [name]: { httpUrl: mcpUrl, headers: { Authorization: "Bearer sp_..." } } } }, null, 2)} />
          </li>
        </ol>
      )}

      {tab === "grok" && (
        <ol className="steps">
          <li>{t("Grok Build ya da uzak MCP araçlarını destekleyen xAI API ile bağlanabilirsin.")}</li>
          <li>{t("Grok Build'de MCP sunucusu olarak adresi ekle; ilk bağlantıda {app} onay ekranı açılır:", { app: appName })}
            <CodeBlock code={JSON.stringify({ mcpServers: { [name]: { url: mcpUrl } } }, null, 2)} />
          </li>
          <li>{t("xAI API'den (kendi uygulaman ya da otomasyonun) kullanırken sunucu adresini ve API anahtarını başlık olarak ver:")}
            <CodeBlock code={JSON.stringify({ type: "mcp", server_label: name, server_url: mcpUrl, authorization: "sp_..." }, null, 2)} />
          
            <p className="muted small">{t("Alan adları xAI API sürümüne göre değişebilir; güncel adları xAI dokümantasyonunun \"Remote MCP\" bölümünden kontrol et.")}</p>
          </li>
        </ol>
      )}

      {tab === "claudecode" && (
        <ol className="steps">
          <li>{t("Terminalde sunucuyu ekle:")}
            <CodeBlock code={`claude mcp add --transport http ${name} ${mcpUrl}`} />
          </li>
          <li>{t("Claude Code içinde /mcp yazıp sunucuyu seç ve \"Authenticate\" ile giriş yap.")}</li>
          <li>{t("Ya da API anahtarıyla (tarayıcısız):")}
            <CodeBlock code={`claude mcp add --transport http ${name} ${mcpUrl} --header "Authorization: Bearer sp_..."`} />
          </li>
        </ol>
      )}

      {tab === "cursor" && (
        <ol className="steps">
          <li>{t("Cursor ayarlarında MCP bölümünden yeni sunucu ekle ya da {file} dosyasına yaz:", { file: "~/.cursor/mcp.json" })}
            <CodeBlock code={JSON.stringify({ mcpServers: { [name]: { url: mcpUrl } } }, null, 2)} />
          </li>
          <li>{t("İlk kullanımda giriş ekranı açılır. API anahtarı tercih edersen:")}
            <CodeBlock code={JSON.stringify({ mcpServers: { [name]: { url: mcpUrl, headers: { Authorization: "Bearer sp_..." } } } }, null, 2)} />
          </li>
        </ol>
      )}

      {tab === "other" && (
        <ol className="steps">
          <li>{t("Uzak MCP (Streamable HTTP) destekleyen her istemci doğrudan adrese bağlanabilir. OAuth 2.1 keşfi ve dinamik istemci kaydı desteklenir.")}</li>
          <li>{t("Sadece yerel (stdio) MCP destekleyen uygulamalarda mcp-remote köprüsünü kullan (Node.js gerekir):")}
            <CodeBlock code={JSON.stringify({ mcpServers: { [name]: { command: "npx", args: ["-y", "mcp-remote", mcpUrl] } } }, null, 2)} />
          </li>
          <li>{t("Doğrudan HTTP ile (otomasyon, kendi kodun):")}
            <CodeBlock code={CURL(mcpUrl)} />
          </li>
        </ol>
      )}

      {showKeyHint && <p className="muted small">{t("sp_... ile başlayan API anahtarını Ayarlar > API & MCP bölümünden oluşturabilirsin. OAuth ile bağlanırken anahtar gerekmez.")}</p>}

      <div className="divider" />
      <h3 style={{ marginBottom: 8 }}>{t("Neler isteyebilirsin?")}</h3>
      <ul className="bullets">
        <li>{t("\"Önümüzdeki iki hafta için Instagram ve LinkedIn'e haftada üç gönderilik bir plan hazırla, boş saatlere yerleştir.\"")}</li>
        <li>{t("\"Yarın 10:00'da Telegram kanalına şu duyuruyu paylaş: ...\"")}</li>
        <li>{t("\"Son 30 günde en çok etkileşim alan gönderilerime bak ve benzer beş gönderi planla.\"")}</li>
        <li>{t("\"Gelen kutusunda dikkat bekleyen konuşmaları özetle ve yanıt taslakları hazırla.\"")}</li>
        <li>{t("\"Fiyat soranlara otomatik yanıt veren bir kural ekle.\"")}</li>
      </ul>

      <div className="notice" style={{ marginTop: 14 }}>
        <strong>{t("Güvenlik")}</strong>
        <ul className="bullets small" style={{ marginTop: 6 }}>
          <li>{t("AI yalnızca izin verdiğin çalışma alanını ve senin rolünün yapabildiklerini yapabilir.")}</li>
          <li>{t("Onay modu açıksa AI'nın hazırladığı gönderiler yayından önce senin onayına düşer (Ayarlar > Yayın).")}</li>
          <li>{t("Bağlantıyı istediğin an Ayarlar > Bağlantılar sekmesinden kaldırabilirsin.")}</li>
        </ul>
      </div>
    </div>
  );
}
