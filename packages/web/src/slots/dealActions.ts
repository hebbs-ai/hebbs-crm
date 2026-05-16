// SPDX-License-Identifier: GPL-3.0-or-later
//
// EntityAction slot contributions for `crm_deal`. Mounted into the
// shell's per-entity action menu via `crmUI.entityActions` in ui.ts.
//
// Each action is invoked by the shell with the focused entity and a
// minimal `ActionContext` (logger + emit). We keep these
// browser-side and side-effect-free at the network layer: actions
// emit framework events via `ctx.emit`, and a host-side workflow
// dispatches the actual agent wake. That keeps the shell from
// needing to know which agent to wake for which action.

interface DealEntity {
  id: string;
  fields: Record<string, unknown>;
}

interface ActionContext {
  log: { info: (msg: string, data?: Record<string, unknown>) => void };
  emit: (eventType: string, data: Record<string, unknown>) => Promise<void> | void;
}

export interface EntityActionDef {
  id: string;
  entity: string;
  label: string;
  visible?: (entity: DealEntity) => boolean;
  invoke: (entity: DealEntity, ctx: ActionContext) => Promise<void>;
}

async function wakeAgent(
  ctx: ActionContext,
  agentRole: string,
  reason: string,
  taskTitle: string,
) {
  await ctx.emit("crm.deal.action_invoked", {
    agentRole,
    reason,
    taskTitle,
  });
}

export const sendFollowup: EntityActionDef = {
  id: "send-followup",
  entity: "crm_deal",
  label: "Send follow-up",
  async invoke(deal, ctx) {
    ctx.log.info("crm.deal: send follow-up", { dealId: deal.id });
    await wakeAgent(
      ctx,
      "follow-up-writer",
      "User requested a follow-up draft from the Deal page",
      `Draft a follow-up for deal ${deal.id}`,
    );
  },
};

export const runAnalyst: EntityActionDef = {
  id: "run-analyst",
  entity: "crm_deal",
  label: "Run analyst",
  async invoke(deal, ctx) {
    ctx.log.info("crm.deal: run analyst", { dealId: deal.id });
    await wakeAgent(
      ctx,
      "deal-analyst",
      "User requested a fresh analyst pass on this deal",
      `Analyze deal ${deal.id}`,
    );
  },
};

export const markWon: EntityActionDef = {
  id: "mark-won",
  entity: "crm_deal",
  label: "Mark won",
  visible: (d) => (d.fields.stageType as string | undefined) !== "won",
  async invoke(deal, ctx) {
    ctx.log.info("crm.deal: mark won", { dealId: deal.id });
    await ctx.emit("crm.deal.stage_changed", {
      dealId: deal.id,
      newStageType: "won",
    });
  },
};

export const markLost: EntityActionDef = {
  id: "mark-lost",
  entity: "crm_deal",
  label: "Mark lost",
  visible: (d) => (d.fields.stageType as string | undefined) !== "lost",
  async invoke(deal, ctx) {
    ctx.log.info("crm.deal: mark lost", { dealId: deal.id });
    await ctx.emit("crm.deal.stage_changed", {
      dealId: deal.id,
      newStageType: "lost",
    });
  },
};

export const dealActions = {
  sendFollowup,
  runAnalyst,
  markWon,
  markLost,
};
