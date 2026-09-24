import { AppError } from "../core/i18n.js";
import { ROLE_RANK, type Ctx, type Role } from "../core/types.js";

export function requireRole(ctx: Ctx, min: Role): void {
  if (ROLE_RANK[ctx.role] < ROLE_RANK[min]) throw new AppError(403, "err.forbidden");
}

export function canApprove(ctx: Ctx): boolean {
  return ROLE_RANK[ctx.role] >= ROLE_RANK.admin && ctx.via === "session";
}

/** Sistem görevleri için bağlam (zamanlayıcı, webhook işleme) */
export function systemCtx(orgId: string, locale: Ctx["locale"] = "tr"): Ctx {
  return { orgId, userId: null, role: "owner", via: "system", locale };
}
