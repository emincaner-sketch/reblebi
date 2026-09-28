import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, type OrgInfo } from "../lib/api";
import { useI18n, useLabels } from "../lib/i18n";
import { useFmt, useSession } from "../lib/session";
import { Loading, PageHead, UsageBar } from "../components/ui";
import { usePublicConfig } from "./public/AuthPages";
import { PlanCard } from "./public/PublicPages";

export default function BillingPage() {
  const { t } = useI18n();
  const L = useLabels();
  const f = useFmt();
  const s = useSession();
  const org = useQuery({ queryKey: ["org"], queryFn: () => api.get<OrgInfo>("/api/org") });
  const cfg = usePublicConfig();
  if (!org.data) return <Loading />;
  const u = org.data.usage;
  const support = cfg.data?.supportEmail;
  const request = (planName: string) =>
    support
      ? `mailto:${support}?subject=${encodeURIComponent(`${t("Plan talebi")}: ${planName}`)}&body=${encodeURIComponent(`${t("Çalışma alanı")}: ${s.org.name} (${s.org.slug})\n${t("İstenen plan")}: ${planName}\n${t("Kullanıcı")}: ${s.user.email}`)}`
      : null;

  return (
    <>
      <PageHead title={t("Plan & kullanım")} sub={t("{org} çalışma alanının planı ve bu ayki kullanımı ({p}).", { org: s.org.name, p: u.period })} />
      <div className="grid grid-2" style={{ alignItems: "start" }}>
        <div className="card">
          <div className="card-title">
            <h2>{L.plan(u.plan.name, u.plan.id)}</h2>
            {u.expired ? <span className="badge badge-err">{t("Süresi doldu")}</span> : u.planExpiresAt ? <span className="badge badge-warn">{t("{d} tarihine kadar", { d: f.day(u.planExpiresAt) })}</span> : <span className="badge badge-ok">{t("Süresiz")}</span>}
          </div>
          {u.expired && <div className="notice notice-err small" style={{ marginBottom: 12 }}>{t("Atanan plan ({p}) sona erdi; Ücretsiz plan limitleri uygulanıyor. Verilerin silinmedi.", { p: u.assignedPlan })}</div>}
          <div className="form">
            <UsageBar label={t("Gönderi (bu ay)")} q={u.posts} />
            <UsageBar label={t("AI üretimi (bu ay)")} q={u.ai} />
            <UsageBar label={t("Kanal")} q={u.channels} />
            <UsageBar label={t("Ekip üyesi")} q={u.members} />
            <UsageBar label={t("Depolama")} q={u.storageMb} unit=" MB" />
          </div>
          <p className="muted small" style={{ marginTop: 12 }}>{t("AI kotası yalnızca platformun AI anahtarı kullanıldığında düşer; Ayarlar > AI'dan kendi anahtarını eklersen sınırsız kullanırsın (plan destekliyorsa).")}</p>
        </div>
        <div className="card">
          <div className="card-title">
            <h2>{t("Plan değiştir")}</h2>
          </div>
          <p className="small">{t("Plan yükseltme ve fatura işlemleri için bizimle iletişime geç; talebin aynı gün işlenir.")}</p>
          {support ? (
            <a className="btn btn-primary" style={{ marginTop: 12 }} href={request(t("yükseltme"))!}>
              {t("Destek ile iletişime geç")}
            </a>
          ) : (
            <p className="muted small" style={{ marginTop: 8 }}>{t("Platform yöneticisi henüz destek e-postası tanımlamadı (SUPPORT_EMAIL).")}</p>
          )}
          {s.user.isSuperadmin && (
            <p className="muted small" style={{ marginTop: 12 }}>
              {t("Süper admin olarak planı")} <Link to="/app/admin">{t("admin panelinden")}</Link> {t("doğrudan atayabilirsin.")}
            </p>
          )}
        </div>
      </div>
      <h2 style={{ margin: "24px 0 12px" }}>{t("Planlar")}</h2>
      <div className="plan-grid">
        {org.data.plans.map((p) => (
          <PlanCard
            key={p.id}
            p={p}
            highlight={p.id === u.plan.id}
            cta={
              p.id === u.plan.id ? (
                <button className="btn btn-block" disabled>
                  {t("Mevcut plan")}
                </button>
              ) : request(p.name.tr) ? (
                <a className="btn btn-block" href={request(`${p.name.tr} / ${p.name.en}`)!}>
                  {t("Bu planı iste")}
                </a>
              ) : null
            }
          />
        ))}
      </div>
    </>
  );
}
