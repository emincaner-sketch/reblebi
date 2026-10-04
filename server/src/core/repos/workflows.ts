import { bindable, defined, getDb, nowIso, parseJson } from "../db.js";
import { randomId } from "../crypto.js";
import type {
  Workflow,
  WorkflowRun,
  WorkflowStep,
  WorkflowStepExecution,
  WorkflowTriggerType,
} from "../types.js";

type Row = Record<string, unknown>;

const rowToWorkflow = (r: Row): Workflow => ({
  id: r.id as string,
  orgId: r.org_id as string,
  name: r.name as string,
  description: (r.description as string) || null,
  enabled: Number(r.enabled ?? 1),
  triggerType: r.trigger_type as WorkflowTriggerType,
  triggerConfig: parseJson<Record<string, any>>(r.trigger_config, {}),
  webhookSlug: (r.webhook_slug as string) || null,
  steps: parseJson<WorkflowStep[]>(r.steps, []),
  createdBy: (r.created_by as string) || null,
  runCount: Number(r.run_count ?? 0),
  lastRunAt: (r.last_run_at as string) || null,
  lastStatus: (r.last_status as "idle" | "success" | "failed" | "filtered" | null) || null,
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string,
});

const rowToWorkflowRun = (r: Row): WorkflowRun => ({
  id: r.id as string,
  workflowId: r.workflow_id as string,
  orgId: r.org_id as string,
  triggerType: r.trigger_type as WorkflowTriggerType,
  triggerPayload: parseJson<Record<string, any>>(r.trigger_payload, {}),
  status: r.status as "running" | "success" | "failed" | "filtered",
  error: (r.error as string) || null,
  stepsExecuted: parseJson<WorkflowStepExecution[]>(r.steps_executed, []),
  durationMs: Number(r.duration_ms ?? 0),
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string,
});

export const workflowsRepo = {
  list(orgId: string): Workflow[] {
    return (
      getDb()
        .prepare("SELECT * FROM workflows WHERE org_id = ? ORDER BY created_at DESC")
        .all(orgId) as Row[]
    ).map(rowToWorkflow);
  },

  get(orgId: string, id: string): Workflow | null {
    const r = getDb()
      .prepare("SELECT * FROM workflows WHERE id = ? AND org_id = ?")
      .get(id, orgId) as Row | undefined;
    return r ? rowToWorkflow(r) : null;
  },

  getById(id: string): Workflow | null {
    const r = getDb()
      .prepare("SELECT * FROM workflows WHERE id = ?")
      .get(id) as Row | undefined;
    return r ? rowToWorkflow(r) : null;
  },

  getBySlug(slug: string): Workflow | null {
    const r = getDb()
      .prepare("SELECT * FROM workflows WHERE webhook_slug = ? AND enabled = 1")
      .get(slug) as Row | undefined;
    return r ? rowToWorkflow(r) : null;
  },

  forTrigger(triggerType: string, orgId?: string): Workflow[] {
    if (orgId) {
      return (
        getDb()
          .prepare(
            "SELECT * FROM workflows WHERE org_id = ? AND trigger_type = ? AND enabled = 1 ORDER BY created_at ASC"
          )
          .all(orgId, triggerType) as Row[]
      ).map(rowToWorkflow);
    }
    return (
      getDb()
        .prepare(
          "SELECT * FROM workflows WHERE trigger_type = ? AND enabled = 1 ORDER BY created_at ASC"
        )
        .all(triggerType) as Row[]
    ).map(rowToWorkflow);
  },

  create(data: {
    orgId: string;
    name: string;
    description?: string | null;
    enabled?: number;
    triggerType: WorkflowTriggerType;
    triggerConfig?: Record<string, any>;
    webhookSlug?: string | null;
    steps?: WorkflowStep[];
    createdBy?: string | null;
  }): Workflow {
    const id = randomId("wf");
    const now = nowIso();
    const slug = data.webhookSlug || (data.triggerType === "webhook.inbound" ? randomId("hook") : null);

    getDb()
      .prepare(
        `INSERT INTO workflows (
          id, org_id, name, description, enabled, trigger_type, trigger_config,
          webhook_slug, steps, created_by, run_count, last_run_at, last_status,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, 'idle', ?, ?)`
      )
      .run(
        id,
        data.orgId,
        data.name,
        data.description ?? null,
        data.enabled ?? 1,
        data.triggerType,
        JSON.stringify(data.triggerConfig ?? {}),
        slug,
        JSON.stringify(data.steps ?? []),
        data.createdBy ?? null,
        now,
        now
      );

    return this.get(data.orgId, id)!;
  },

  update(orgId: string, id: string, patch: Partial<Workflow>): Workflow | null {
    const existing = this.get(orgId, id);
    if (!existing) return null;

    const merged = { ...existing, ...defined(patch), updatedAt: nowIso() };

    getDb()
      .prepare(
        `UPDATE workflows SET
          name = ?,
          description = ?,
          enabled = ?,
          trigger_type = ?,
          trigger_config = ?,
          webhook_slug = ?,
          steps = ?,
          updated_at = ?
        WHERE id = ? AND org_id = ?`
      )
      .run(
        merged.name,
        merged.description,
        merged.enabled,
        merged.triggerType,
        JSON.stringify(merged.triggerConfig),
        merged.webhookSlug,
        JSON.stringify(merged.steps),
        merged.updatedAt,
        id,
        orgId
      );

    return this.get(orgId, id);
  },

  toggle(orgId: string, id: string): Workflow | null {
    const wf = this.get(orgId, id);
    if (!wf) return null;
    return this.update(orgId, id, { enabled: wf.enabled ? 0 : 1 });
  },

  delete(orgId: string, id: string): boolean {
    const r = getDb()
      .prepare("DELETE FROM workflows WHERE id = ? AND org_id = ?")
      .run(id, orgId);
    return Number(r.changes) > 0;
  },

  recordRun(workflowId: string, status: "success" | "failed" | "filtered"): void {
    const now = nowIso();
    getDb()
      .prepare(
        `UPDATE workflows SET
          run_count = run_count + 1,
          last_run_at = ?,
          last_status = ?,
          updated_at = ?
        WHERE id = ?`
      )
      .run(now, status, now, workflowId);
  },
};

export const workflowRunsRepo = {
  create(data: {
    workflowId: string;
    orgId: string;
    triggerType: WorkflowTriggerType;
    triggerPayload: Record<string, any>;
    status: "running" | "success" | "failed" | "filtered";
    error?: string | null;
    stepsExecuted?: WorkflowStepExecution[];
    durationMs?: number;
  }): WorkflowRun {
    const id = randomId("run");
    const now = nowIso();

    getDb()
      .prepare(
        `INSERT INTO workflow_runs (
          id, workflow_id, org_id, trigger_type, trigger_payload,
          status, error, steps_executed, duration_ms, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        data.workflowId,
        data.orgId,
        data.triggerType,
        JSON.stringify(data.triggerPayload ?? {}),
        data.status,
        data.error ?? null,
        JSON.stringify(data.stepsExecuted ?? []),
        data.durationMs ?? 0,
        now,
        now
      );

    return this.get(data.orgId, id)!;
  },

  update(id: string, patch: Partial<WorkflowRun>): void {
    const current = getDb()
      .prepare("SELECT * FROM workflow_runs WHERE id = ?")
      .get(id) as Row | undefined;
    if (!current) return;

    const run = rowToWorkflowRun(current);
    const merged = { ...run, ...defined(patch), updatedAt: nowIso() };

    getDb()
      .prepare(
        `UPDATE workflow_runs SET
          status = ?,
          error = ?,
          steps_executed = ?,
          duration_ms = ?,
          updated_at = ?
        WHERE id = ?`
      )
      .run(
        merged.status,
        merged.error,
        JSON.stringify(merged.stepsExecuted),
        merged.durationMs,
        merged.updatedAt,
        id
      );
  },

  list(orgId: string, workflowId?: string, limit = 50): WorkflowRun[] {
    if (workflowId) {
      return (
        getDb()
          .prepare(
            `SELECT * FROM workflow_runs
            WHERE org_id = ? AND workflow_id = ?
            ORDER BY created_at DESC LIMIT ?`
          )
          .all(orgId, workflowId, limit) as Row[]
      ).map(rowToWorkflowRun);
    }
    return (
      getDb()
        .prepare(
          `SELECT * FROM workflow_runs
          WHERE org_id = ?
          ORDER BY created_at DESC LIMIT ?`
        )
        .all(orgId, limit) as Row[]
    ).map(rowToWorkflowRun);
  },

  get(orgId: string, id: string): WorkflowRun | null {
    const r = getDb()
      .prepare("SELECT * FROM workflow_runs WHERE id = ? AND org_id = ?")
      .get(id, orgId) as Row | undefined;
    return r ? rowToWorkflowRun(r) : null;
  },

  getById(id: string): WorkflowRun | null {
    const r = getDb()
      .prepare("SELECT * FROM workflow_runs WHERE id = ?")
      .get(id) as Row | undefined;
    return r ? rowToWorkflowRun(r) : null;
  },
};
