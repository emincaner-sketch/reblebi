import { config } from "../core/config.js";
import { AppError, notFound, t } from "../core/i18n.js";
import { activityRepo } from "../core/repos/misc.js";
import { oauthTokensRepo } from "../core/repos/oauth.js";
import { invitationsRepo, membershipsRepo, orgsRepo, sessionsRepo, userTokensRepo, usersRepo } from "../core/repos/orgs.js";
import type { Ctx, Locale, Organization, Role, User } from "../core/types.js";
import { requireRole } from "./access.js";
import { assertMemberQuota } from "./limits.js";
import { sendMail } from "./mailer.js";

function trialExpiry(): string | null {
  return config.saas.trialDays > 0 ? new Date(Date.now() + config.saas.trialDays * 86400_000).toISOString() : null;
}

export interface SignupInput {
  email: string;
  password: string;
  name?: string | null;
  orgName?: string | null;
  locale: Locale;
  timezone?: string;
  inviteToken?: string | null;
}

/** Yeni kullanıcı: davetle geldiyse davet edilen çalışma alanına katılır, değilse kendi çalışma alanını (deneme planıyla) açar */
export async function signup(input: SignupInput): Promise<{ user: User; orgId: string }> {
  const email = input.email.toLowerCase().trim();
  const isFirstUser = usersRepo.count() === 0;
  const invite = input.inviteToken ? invitationsRepo.findByToken(input.inviteToken) : null;
  if (input.inviteToken && !invite) throw new AppError(400, "auth.token_invalid");
  if (invite && invite.email !== email) throw new AppError(400, "auth.invite_email_mismatch");
  if (!isFirstUser && !invite) {
    if (config.saas.signupMode === "closed") throw new AppError(403, "auth.signup_closed");
    if (config.saas.signupMode === "invite") throw new AppError(403, "auth.signup_invite_only");
  }
  if (usersRepo.findByEmail(email)) throw new AppError(409, "auth.email_taken");

  const superadmin = isFirstUser || config.saas.superadminEmails.includes(email);
  const user = usersRepo.create({
    email,
    password: input.password,
    name: input.name ?? null,
    locale: input.locale,
    superadmin,
    // Davetle gelenin e-postası doğrulanmış sayılır; ilk kurulum kullanıcısı da
    verified: Boolean(invite) || isFirstUser || !config.saas.requireEmailVerification,
  });

  let orgId: string;
  if (invite) {
    assertMemberQuota(invite.orgId, 1);
    membershipsRepo.add(invite.orgId, user.id, invite.role);
    invitationsRepo.markAccepted(invite.id);
    orgId = invite.orgId;
  } else {
    const orgName = input.orgName?.trim() || (input.name?.trim() ? `${input.name.trim()}` : email.split("@")[0]);
    // İlk kullanıcı platform sahibidir: sınırsız plan
    const org = orgsRepo.create({
      name: orgName,
      plan: isFirstUser ? "unlimited" : config.saas.trialPlan,
      planExpiresAt: isFirstUser ? null : trialExpiry(),
      timezone: input.timezone || config.timezone,
      locale: input.locale,
      ownerId: user.id,
    });
    orgId = org.id;
  }
  if (!user.emailVerifiedAt) await sendVerification(user);
  activityRepo.add(orgId, "info", "auth", `signup ${email}`);
  return { user, orgId };
}

export async function sendVerification(user: User): Promise<void> {
  const token = userTokensRepo.create(user.id, "verify", 48 * 60);
  const link = `${config.appUrl}/verify?token=${encodeURIComponent(token)}`;
  await sendMail(user.email, t(user.locale, "mail.verify.subject", { app: config.appName }), t(user.locale, "mail.verify.body", { app: config.appName, link }));
}

export function verifyEmail(token: string): User {
  const userId = userTokensRepo.consume(token, "verify");
  if (!userId) throw new AppError(400, "auth.token_invalid");
  usersRepo.markVerified(userId);
  return usersRepo.get(userId)!;
}

export function login(email: string, password: string): { user: User; orgId: string | null } {
  const user = usersRepo.verifyPassword(email, password);
  if (!user) throw new AppError(401, "auth.invalid_credentials");
  if (user.disabled) throw new AppError(403, "auth.user_disabled");
  if (config.saas.requireEmailVerification && !user.emailVerifiedAt) throw new AppError(403, "auth.email_not_verified");
  usersRepo.touchLogin(user.id);
  const orgs = orgsRepo.listForUser(user.id);
  return { user, orgId: orgs[0]?.id ?? null };
}

export async function requestPasswordReset(email: string): Promise<void> {
  const user = usersRepo.findByEmail(email);
  // Kullanıcı yoksa da aynı yanıtı ver (hesap varlığı sızdırılmasın)
  if (!user || user.disabled) return;
  const token = userTokensRepo.create(user.id, "reset", 60);
  const link = `${config.appUrl}/reset-password?token=${encodeURIComponent(token)}`;
  await sendMail(user.email, t(user.locale, "mail.reset.subject", { app: config.appName }), t(user.locale, "mail.reset.body", { app: config.appName, link }));
}

export function resetPassword(token: string, password: string): User {
  const userId = userTokensRepo.consume(token, "reset");
  if (!userId) throw new AppError(400, "auth.token_invalid");
  usersRepo.setPassword(userId, password);
  usersRepo.markVerified(userId);
  sessionsRepo.removeAllForUser(userId);
  return usersRepo.get(userId)!;
}

export function changePassword(userId: string, current: string, next: string, keepSessionId?: string): void {
  if (!usersRepo.checkPassword(userId, current)) throw new AppError(400, "auth.password_wrong");
  usersRepo.setPassword(userId, next);
  sessionsRepo.removeAllForUser(userId, keepSessionId);
}

/* ---------------- Çalışma alanları ---------------- */

export function createWorkspace(userId: string, name: string, locale: Locale, timezone?: string): Organization {
  const user = usersRepo.get(userId);
  if (!user) throw notFound("user");
  return orgsRepo.create({
    name: name.trim().slice(0, 80),
    plan: user.isSuperadmin ? "unlimited" : config.saas.trialPlan,
    planExpiresAt: user.isSuperadmin ? null : trialExpiry(),
    timezone: timezone || config.timezone,
    locale,
    ownerId: userId,
  });
}

export function updateWorkspace(ctx: Ctx, patch: { name?: string; timezone?: string; locale?: Locale }): Organization {
  requireRole(ctx, "admin");
  if (patch.timezone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: patch.timezone });
    } catch {
      throw new AppError(400, "err.validation", { detail: "timezone" });
    }
  }
  return orgsRepo.update(ctx.orgId, { name: patch.name?.trim().slice(0, 80), timezone: patch.timezone, locale: patch.locale })!;
}

export function deleteWorkspace(ctx: Ctx): void {
  requireRole(ctx, "owner");
  orgsRepo.remove(ctx.orgId);
}

/* ---------------- Ekip ---------------- */

export async function inviteMember(ctx: Ctx, email: string, role: Role, inviterName: string): Promise<{ inviteLink: string }> {
  requireRole(ctx, "admin");
  if (role === "owner") requireRole(ctx, "owner");
  const clean = email.toLowerCase().trim();
  const existing = usersRepo.findByEmail(clean);
  if (existing && membershipsRepo.get(ctx.orgId, existing.id)) throw new AppError(409, "auth.email_taken");
  assertMemberQuota(ctx.orgId, 1);
  const org = orgsRepo.get(ctx.orgId)!;
  const { token } = invitationsRepo.create(ctx.orgId, clean, role, ctx.userId);
  const link = `${config.appUrl}/invite?token=${encodeURIComponent(token)}`;
  const locale = existing?.locale ?? org.locale;
  await sendMail(
    clean,
    t(locale, "mail.invite.subject", { inviter: inviterName, org: org.name }),
    t(locale, "mail.invite.body", { inviter: inviterName, org: org.name, app: config.appName, role: t(locale, `role.${role}`), link }),
  );
  return { inviteLink: link };
}

/** Oturum açmış mevcut kullanıcı daveti kabul eder */
export function acceptInvite(userId: string, token: string): string {
  const inv = invitationsRepo.findByToken(token);
  if (!inv) throw new AppError(400, "auth.token_invalid");
  const user = usersRepo.get(userId);
  if (!user) throw notFound("user");
  if (user.email !== inv.email) throw new AppError(400, "auth.invite_email_mismatch");
  if (!membershipsRepo.get(inv.orgId, userId)) {
    assertMemberQuota(inv.orgId, 1);
    membershipsRepo.add(inv.orgId, userId, inv.role);
  }
  invitationsRepo.markAccepted(inv.id);
  return inv.orgId;
}

export function inviteInfo(token: string): { email: string; orgName: string; role: Role; hasAccount: boolean } | null {
  const inv = invitationsRepo.findByToken(token);
  if (!inv) return null;
  const org = orgsRepo.get(inv.orgId);
  return { email: inv.email, orgName: org?.name ?? "", role: inv.role, hasAccount: Boolean(usersRepo.findByEmail(inv.email)) };
}

export function setMemberRole(ctx: Ctx, userId: string, role: Role): void {
  requireRole(ctx, "admin");
  const m = membershipsRepo.get(ctx.orgId, userId);
  if (!m) throw notFound("user");
  if (role === "owner" || m.role === "owner") requireRole(ctx, "owner");
  if (m.role === "owner" && role !== "owner" && membershipsRepo.countOwners(ctx.orgId) <= 1) throw new AppError(400, "auth.last_owner");
  membershipsRepo.setRole(ctx.orgId, userId, role);
}

export function removeMember(ctx: Ctx, userId: string): void {
  requireRole(ctx, "admin");
  if (userId === ctx.userId) throw new AppError(400, "auth.cannot_remove_self");
  const m = membershipsRepo.get(ctx.orgId, userId);
  if (!m) return;
  if (m.role === "owner") requireRole(ctx, "owner");
  membershipsRepo.remove(ctx.orgId, userId);
  // Bu kullanıcının bu çalışma alanı için verdiği AI bağlantılarını da kes
  for (const c of oauthTokensRepo.listConnections(ctx.orgId).filter((c) => c.userId === userId)) {
    oauthTokensRepo.revokeConnection(ctx.orgId, c.clientId, userId);
  }
}

export function leaveWorkspace(ctx: Ctx): void {
  if (!ctx.userId) throw new AppError(403, "err.forbidden");
  const m = membershipsRepo.get(ctx.orgId, ctx.userId);
  if (!m) return;
  if (m.role === "owner" && membershipsRepo.countOwners(ctx.orgId) <= 1) throw new AppError(400, "auth.last_owner");
  membershipsRepo.remove(ctx.orgId, ctx.userId);
}
