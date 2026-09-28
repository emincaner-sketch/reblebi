import { useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Database, LogIn, Mail, Search } from "lucide-react";
import { api, errMsg, PROVIDER_NAME, type AdminOrg, type AdminStats, type AdminUser, type OutboxMail, type PlanInfo, type ProviderId } from "../lib/api";
import { useI18n, useLabels } from "../lib/i18n";
import { useFmt, useSession } from "../lib/session";
import { ConfirmTyped, Loading, Modal, PageHead, Stat, useToast } from "../components/ui";

function OrgEditor({ org, plans, onClose }: { org: AdminOrg; plans: PlanInfo[]; onClose: () => void }) {
  const { t, locale } = useI18n();
  const f = useFmt();
  const s = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [plan, setPlan] = useState(org.plan);
  const [expires, setExpires] = useState(org.planExpiresAt ? org.planExpiresAt.slice(0, 10) : "");
  const [billingRef, setBillingRef] = useState(org.billingRef ?? "");
  const [deleting, setDeleting] = useState(false);
  const inv = () => qc.invalidateQueries({ queryKey: ["admin"] });
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch(`/api/admin/orgs/${org.id}`, body),
    onSuccess: () => {
      inv();
      toast(t("Kaydedildi"), "ok");
      onClose();
    },
    onError: (e) => toast(errMsg(e), "err"),
  });
  const del = useMutation({
    mutationFn: () => api.del<{ ok: boolean; error?: string }>(`/api/admin/orgs/${org.id}`, { confirm: org.slug }),
    onSuccess: (r) => {
      if (!r.ok) return toast(r.error ?? "error", "err");
      inv();
      onClose();
    },
    onError: (e) => toast(errMsg(e), "err"),
  });
  return (
    <Modal
      title={org.name}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-danger" style={{ marginRight: "auto" }} onClick={() => setDeleting(true)}>
            {t("Sil")}
          </button>
          <button className="btn" onClick={() => s.switchOrg(org.id).then(() => (window.location.href = "/app"))}>
            <LogIn /> {t("Bu alana gir")}
          </button>
          <button className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate({ plan, planExpiresAt: expires ? new Date(`${expires}T23:59:59Z`).toISOString() : null, billingRef: billingRef || null })}>
            {t("Kaydet")}
          </button>
        </>
      }
    >
      <div className="form">
        <dl className="kv">
          <dt>{t("Sahip")}</dt>
          <dd>{org.ownerEmail ?? "-"}</dd>
          <dt>{t("Oluşturuldu")}</dt>
          <dd>{f.day(org.createdAt)}</dd>
          <dt>{t("Geçerli plan")}</dt>
          <dd>{org.effectivePlan}</dd>
          <dt>{t("Durum")}</dt>
          <dd>{org.disabled ? <span className="badge badge-err">{t("askıda")}</span> : <span className="badge badge-ok">{t("aktif")}</span>}</dd>
        </dl>
        <div className="grid grid-2">
          <div className="field">
            <label>{t("Plan")}</label>
            <select className="select" value={plan} onChange={(e) => setPlan(e.target.value)}>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name[locale]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>{t("Bitiş tarihi (boş = süresiz)")}</label>
            <input className="input" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
          </div>
        </div>
        <div className="row">
          {[30, 365].map((n) => (
            <button key={n} className="btn btn-sm" disabled={save.isPending} onClick={() => save.mutate({ plan, extendDays: n })}>
              {t("+{n} gün uzat", { n })}
            </button>
          ))}
          <button className="btn btn-sm" disabled={save.isPending} onClick={() => save.mutate({ disabled: !org.disabled })}>
            {org.disabled ? t("Askıyı kaldır") : t("Askıya al")}
          </button>
        </div>
        <div className="field">
          <label>{t("Fatura referansı")}</label>
          <input className="input" value={billingRef} onChange={(e) => setBillingRef(e.target.value)} placeholder={t("fatura no, ödeme kimliği…")} maxLength={200} />
        </div>
      </div>
      {deleting && (
        <ConfirmTyped
          title={t("Çalışma alanını sil")}
          text={t("{org} ve içindeki her şey kalıcı olarak silinecek.", { org: org.name })}
          expected={org.slug}
          danger={t("Kalıcı olarak sil")}
          busy={del.isPending}
          onConfirm={() => del.mutate()}
          onClose={() => setDeleting(false)}
        />
      )}
    </Modal>
  );
}

export default function AdminPage() {
  const { t, locale } = useI18n();
  const L = useLabels();
  const f = useFmt();
  const s = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") ?? "overview") as "overview" | "orgs" | "users" | "outbox";
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<AdminOrg | null>(null);
  const [mail, setMail] = useState<OutboxMail | null>(null);
  const enabled = s.user.isSuperadmin;
  const stats = useQuery({ queryKey: ["admin", "stats"], queryFn: () => api.get<AdminStats>("/api/admin/stats"), enabled });
  const plans = useQuery({ queryKey: ["admin", "plans"], queryFn: () => api.get<PlanInfo[]>("/api/admin/plans"), enabled });
  const orgs = useQuery({ queryKey: ["admin", "orgs", q], queryFn: () => api.get<AdminOrg[]>(`/api/admin/orgs?limit=300${q ? `&q=${encodeURIComponent(q)}` : ""}`), enabled: enabled && tab === "orgs" });
  const users = useQuery({ queryKey: ["admin", "users", q], queryFn: () => api.get<AdminUser[]>(`/api/admin/users?limit=300${q ? `&q=${encodeURIComponent(q)}` : ""}`), enabled: enabled && tab === "users" });
  const outbox = useQuery({ queryKey: ["admin", "outbox"], queryFn: () => api.get<OutboxMail[]>("/api/admin/outbox"), enabled: enabled && tab === "outbox" });
  const updUser = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, boolean> }) => api.patch<{ ok?: boolean; error?: string }>(`/api/admin/users/${id}`, body),
    onSuccess: (r) => {
      if (r && r.ok === false) toast(r.error === "self" ? t("Kendi hesabına bu işlemi yapamazsın") : String(r.error), "err");
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
    },
    onError: (e) => toast(errMsg(e), "err"),
  });
  const backup = useMutation({ mutationFn: () => api.post<{ file: string }>("/api/admin/backup"), onSuccess: (r) => toast(t("Yedek alındı: {f}", { f: r.file }), "ok"), onError: (e) => toast(errMsg(e), "err") });

  if (!enabled) return <Navigate to="/app" replace />;
  const st = stats.data;
  const planName = (id: string) => plans.data?.find((p) => p.id === id)?.name[locale] ?? id;

  return (
    <>
      <PageHead
        title={t("Süper admin")}
        sub={t("Platform geneli: çalışma alanları, kullanıcılar, planlar.")}
        actions={
          <button className="btn" onClick={() => backup.mutate()} disabled={backup.isPending}>
            <Database /> {t("Şimdi yedek al")}
          </button>
        }
      />
      <div className="tabs" role="tablist">
        {(["overview", "orgs", "users", "outbox"] as const).map((x) => (
          <button key={x} className={`tab ${tab === x ? "active" : ""}`} onClick={() => setParams({ tab: x }, { replace: true })}>
            {{ overview: t("Genel"), orgs: t("Çalışma alanları"), users: t("Kullanıcılar"), outbox: t("E-posta kutusu") }[x]}
          </button>
        ))}
      </div>

      {tab === "overview" &&
        (!st ? (
          <Loading />
        ) : (
          <>
            <div className="grid grid-4">
              <Stat label={t("Kullanıcı")} value={st.users} sub={t("+{n} son 30 gün · {a} aktif/7g", { n: st.usersLast30, a: st.activeLast7 })} />
              <Stat label={t("Çalışma alanı")} value={st.orgs} sub={Object.entries(st.byPlan).map(([k, v]) => `${planName(k)}: ${v}`).join(" · ")} />
              <Stat label={t("Kanal")} value={st.channels} sub={t("{n} MCP bağlantısı", { n: st.mcpConnections })} />
              <Stat label={t("Gönderi (30g)")} value={st.postsLast30} sub={<span>{t("{p} yayın · {f} hata", { p: st.publishedLast30, f: st.failedLast30 })}</span>} />
            </div>
            <div className="grid grid-2" style={{ marginTop: 16 }}>
              <div className="card">
                <div className="card-title">
                  <h2>{t("Platforma göre kanallar")}</h2>
                </div>
                <table className="table">
                  <tbody>
                    {Object.entries(st.byProvider).map(([p, n]) => (
                      <tr key={p}>
                        <td>{PROVIDER_NAME[p as ProviderId] ?? p}</td>
                        <td style={{ textAlign: "right" }}>{n}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="card">
                <div className="card-title">
                  <h2>{t("Yapılandırma")}</h2>
                </div>
                <dl className="kv">
                  <dt>{t("Kayıt modu")}</dt>
                  <dd>
                    <code>{st.signupMode}</code> <span className="muted small">(SIGNUP_MODE)</span>
                  </dd>
                  <dt>{t("Deneme")}</dt>
                  <dd>
                    {t("{d} gün · {p}", { d: st.trial.days, p: planName(st.trial.plan) })} <span className="muted small">(TRIAL_DAYS, TRIAL_PLAN)</span>
                  </dd>
                  <dt>SMTP</dt>
                  <dd>{st.mailConfigured ? <span className="badge badge-ok">{t("hazır")}</span> : <span className="badge badge-warn">{t("kurulmadı — e-postalar 'E-posta kutusu'nda")}</span>}</dd>
                </dl>
              </div>
            </div>
          </>
        ))}

      {(tab === "orgs" || tab === "users") && (
        <div className="row" style={{ marginBottom: 12 }}>
          <div className="input-icon">
            <Search />
            <input className="input" placeholder={tab === "orgs" ? t("Ad ya da kısa ad ara…") : t("E-posta ya da ad ara…")} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
      )}

      {tab === "orgs" && (
        <div className="card">
          {!orgs.data ? (
            <Loading />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t("Çalışma alanı")}</th>
                    <th>{t("Sahip")}</th>
                    <th>{t("Plan")}</th>
                    <th>{t("Bitiş")}</th>
                    <th>{t("Oluşturuldu")}</th>
                  </tr>
                </thead>
                <tbody>
                  {orgs.data.map((o) => (
                    <tr key={o.id} className="clickable" onClick={() => setEditing(o)}>
                      <td>
                        <strong>{o.name}</strong> {o.disabled ? <span className="badge badge-err">{t("askıda")}</span> : null}
                        <div className="muted small">{o.slug}</div>
                      </td>
                      <td className="small">{o.ownerEmail ?? "-"}</td>
                      <td>
                        <span className="badge">{planName(o.plan)}</span>
                        {o.effectivePlan !== o.plan && <span className="badge badge-err" style={{ marginLeft: 4 }}>→ {planName(o.effectivePlan)}</span>}
                      </td>
                      <td className="small muted">{o.planExpiresAt ? f.day(o.planExpiresAt) : "∞"}</td>
                      <td className="small muted">{f.day(o.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "users" && (
        <div className="card">
          {!users.data ? (
            <Loading />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t("Kullanıcı")}</th>
                    <th>{t("Çalışma alanları")}</th>
                    <th>{t("Son giriş")}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {users.data.map((u) => (
                    <tr key={u.id} style={{ opacity: u.disabled ? 0.55 : 1 }}>
                      <td>
                        <strong>{u.name || u.email}</strong> {u.isSuperadmin ? <span className="badge badge-accent">admin</span> : null} {!u.emailVerifiedAt && <span className="badge badge-warn">{t("doğrulanmadı")}</span>}
                        <div className="muted small">{u.email}</div>
                      </td>
                      <td className="small">{u.orgs.map((o) => `${o.name} (${L.role(o.role)})`).join(", ") || "-"}</td>
                      <td className="small muted">{u.lastLoginAt ? f.ago(u.lastLoginAt) : "-"}</td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        {!u.emailVerifiedAt && (
                          <button className="btn btn-ghost btn-sm" onClick={() => updUser.mutate({ id: u.id, body: { verify: true } })}>
                            {t("Doğrula")}
                          </button>
                        )}
                        <button className="btn btn-ghost btn-sm" disabled={u.id === s.user.id} onClick={() => confirm(u.isSuperadmin ? t("Süper admin yetkisi alınsın mı?") : t("Süper admin yapılsın mı?")) && updUser.mutate({ id: u.id, body: { isSuperadmin: !u.isSuperadmin } })}>
                          {u.isSuperadmin ? t("Admin yetkisini al") : t("Admin yap")}
                        </button>
                        <button className="btn btn-ghost btn-sm" disabled={u.id === s.user.id} onClick={() => updUser.mutate({ id: u.id, body: { disabled: !u.disabled } })}>
                          {u.disabled ? t("Etkinleştir") : t("Devre dışı bırak")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "outbox" && (
        <div className="card">
          <p className="muted small" style={{ marginBottom: 12 }}>{t("SMTP kurulmadığında gönderilen son 50 e-posta (doğrulama, davet, şifre sıfırlama bağlantıları) burada görünür. Sunucu yeniden başlayınca temizlenir.")}</p>
          {!outbox.data ? (
            <Loading />
          ) : outbox.data.length === 0 ? (
            <p className="muted">{t("E-posta yok.")}</p>
          ) : (
            <table className="table">
              <tbody>
                {outbox.data.map((m, i) => (
                  <tr key={i} className="clickable" onClick={() => setMail(m)}>
                    <td>
                      <Mail style={{ width: 14, verticalAlign: "middle", marginRight: 6 }} />
                      {m.to}
                    </td>
                    <td>{m.subject}</td>
                    <td className="small muted">{f.ago(m.at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {editing && plans.data && <OrgEditor org={editing} plans={plans.data} onClose={() => setEditing(null)} />}
      {mail && (
        <Modal title={mail.subject} onClose={() => setMail(null)}>
          <p className="muted small">→ {mail.to}</p>
          <p className="pre" style={{ marginTop: 10 }}>
            {mail.text}
          </p>
        </Modal>
      )}
    </>
  );
}
