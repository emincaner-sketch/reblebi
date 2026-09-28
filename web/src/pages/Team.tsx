import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut, Mail, Trash2, UserPlus } from "lucide-react";
import { api, errMsg, ROLES, type Invitation, type Member, type OrgInfo, type Role } from "../lib/api";
import { useI18n, useLabels } from "../lib/i18n";
import { useFmt, useSession } from "../lib/session";
import { Avatar, Can, Copyable, Loading, Modal, PageHead, UsageBar, useToast } from "../components/ui";

export default function TeamPage() {
  const { t } = useI18n();
  const L = useLabels();
  const f = useFmt();
  const s = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["members"], queryFn: () => api.get<{ members: Member[]; invitations: Invitation[] }>("/api/org/members") });
  const org = useQuery({ queryKey: ["org"], queryFn: () => api.get<OrgInfo>("/api/org") });
  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("editor");
  const [link, setLink] = useState<string | null>(null);
  const inv = () => {
    qc.invalidateQueries({ queryKey: ["members"] });
    qc.invalidateQueries({ queryKey: ["org"] });
  };
  const onError = (e: unknown) => toast(errMsg(e), "err");

  const invite = useMutation({
    mutationFn: () => api.post<{ inviteLink: string }>("/api/org/invitations", { email, role }),
    onSuccess: (r) => {
      setLink(r.inviteLink);
      setEmail("");
      inv();
    },
    onError,
  });
  const setMemberRole = useMutation({ mutationFn: ({ userId, role }: { userId: string; role: Role }) => api.patch(`/api/org/members/${userId}`, { role }), onSuccess: () => (toast(t("Rol güncellendi"), "ok"), inv()), onError });
  const remove = useMutation({ mutationFn: (userId: string) => api.del(`/api/org/members/${userId}`), onSuccess: inv, onError });
  const revoke = useMutation({ mutationFn: (id: string) => api.del(`/api/org/invitations/${id}`), onSuccess: inv, onError });
  const leave = useMutation({
    mutationFn: () => api.post("/api/org/leave"),
    onSuccess: async () => {
      qc.clear();
      window.location.href = "/app";
    },
    onError,
  });

  const quota = org.data?.usage.members;
  const full = quota && quota.limit !== null && quota.used + (q.data?.invitations.length ?? 0) >= quota.limit;
  const assignable = ROLES.filter((r) => r !== "owner" || s.can("owner"));

  return (
    <>
      <PageHead
        title={t("Ekip")}
        sub={t("{org} çalışma alanının üyeleri ve rolleri.", { org: s.org.name })}
        actions={
          <>
            <button className="btn" onClick={() => confirm(t("{org} çalışma alanından ayrılmak istediğine emin misin?", { org: s.org.name })) && leave.mutate()}>
              <LogOut /> {t("Ayrıl")}
            </button>
            <Can role="admin">
              <button
                className="btn btn-primary"
                onClick={() => {
                  setLink(null);
                  setInviting(true);
                }}
                disabled={Boolean(full)}
                title={full ? t("Plan sınırı doldu") : ""}
              >
                <UserPlus /> {t("Üye davet et")}
              </button>
            </Can>
          </>
        }
      />
      {quota && (
        <div className="card" style={{ maxWidth: 420, marginBottom: 16 }}>
          <UsageBar label={t("Ekip üyesi")} q={quota} />
        </div>
      )}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="grid grid-4 small">
          {ROLES.map((r) => (
            <div key={r}>
              <strong>{L.role(r)}</strong>
              <div className="muted">{L.roleHelp(r)}</div>
            </div>
          ))}
        </div>
      </div>
      {!q.data ? (
        <Loading />
      ) : (
        <>
          <div className="card">
            <div className="card-title">
              <h2>{t("Üyeler ({n})", { n: q.data.members.length })}</h2>
            </div>
            <table className="table">
              <tbody>
                {q.data.members.map((m) => {
                  const self = m.userId === s.user.id;
                  const canEdit = s.can("admin") && !self && (m.role !== "owner" || s.can("owner"));
                  return (
                    <tr key={m.userId}>
                      <td>
                        <span className="row">
                          <Avatar name={m.name || m.email} size={32} />
                          <span>
                            <div style={{ fontWeight: 600 }}>
                              {m.name || m.email} {self && <span className="badge">{t("sen")}</span>}
                            </div>
                            <div className="muted small">{m.email}</div>
                          </span>
                        </span>
                      </td>
                      <td className="small muted">{m.lastLoginAt ? t("son giriş {d}", { d: f.ago(m.lastLoginAt) }) : t("hiç giriş yapmadı")}</td>
                      <td style={{ width: 170 }}>
                        {canEdit ? (
                          <select className="select select-sm" value={m.role} onChange={(e) => setMemberRole.mutate({ userId: m.userId, role: e.target.value as Role })} aria-label={t("Rol")}>
                            {assignable.map((r) => (
                              <option key={r} value={r}>
                                {L.role(r)}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="badge">{L.role(m.role)}</span>
                        )}
                      </td>
                      <td style={{ textAlign: "right", width: 50 }}>
                        {canEdit && (
                          <button className="btn btn-ghost btn-sm" aria-label={t("Çıkar")} onClick={() => confirm(t("{name} ekipten çıkarılsın mı?", { name: m.name || m.email })) && remove.mutate(m.userId)}>
                            <Trash2 />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {q.data.invitations.length > 0 && (
            <div className="card">
              <div className="card-title">
                <h2>{t("Bekleyen davetler")}</h2>
              </div>
              <table className="table">
                <tbody>
                  {q.data.invitations.map((i) => (
                    <tr key={i.id}>
                      <td>
                        <Mail style={{ width: 14, verticalAlign: "middle", marginRight: 6 }} />
                        {i.email}
                      </td>
                      <td>
                        <span className="badge">{L.role(i.role)}</span>
                      </td>
                      <td className="small muted">{t("{d} tarihine kadar geçerli", { d: f.day(i.expiresAt) })}</td>
                      <td style={{ textAlign: "right" }}>
                        <Can role="admin">
                          <button className="btn btn-ghost btn-sm" onClick={() => revoke.mutate(i.id)}>
                            {t("İptal et")}
                          </button>
                        </Can>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {inviting && (
        <Modal
          title={t("Üye davet et")}
          onClose={() => setInviting(false)}
          footer={
            link ? (
              <button className="btn btn-primary" onClick={() => setInviting(false)}>
                {t("Tamam")}
              </button>
            ) : (
              <>
                <button className="btn" onClick={() => setInviting(false)}>
                  {t("Vazgeç")}
                </button>
                <button className="btn btn-primary" disabled={!/^\S+@\S+\.\S+$/.test(email) || invite.isPending} onClick={() => invite.mutate()}>
                  {t("Davet gönder")}
                </button>
              </>
            )
          }
        >
          {link ? (
            <div className="form">
              <div className="notice notice-ok">{t("Davet e-postası gönderildi. E-posta ulaşmazsa bu bağlantıyı doğrudan paylaşabilirsin (7 gün geçerli):")}</div>
              <Copyable text={link} />
            </div>
          ) : (
            <div className="form">
              <div className="field">
                <label>{t("E-posta")}</label>
                <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
              </div>
              <div className="field">
                <label>{t("Rol")}</label>
                <select className="select" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                  {assignable.map((r) => (
                    <option key={r} value={r}>
                      {L.role(r)} — {L.roleHelp(r)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
