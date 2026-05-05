// SPDX-License-Identifier: BUSL-1.1
//
// L8 — EntityAction slot contributions for `crm_deal`.
//
// Each action is a typed `EntityAction<"crm_deal">` whose `invoke`
// receives the framework's `ActionContext` (db, log, emit). Wakes are
// performed via the framework's admin API rather than direct engine
// calls so the same handler runs from the shell, the copilot, or a
// programmatic tenant runtime.

import type { ActionContext, Entity, EntityAction } from "@boringos/app-sdk";

type Deal = Entity<"crm_deal">;

async function wakeAgent(ctx: ActionContext, agentRole: string, reason: string, taskTitle: string) {
  // Framework admin API: agents and tasks live at /api/admin/* on the
  // host. The ActionContext doesn't expose the callback URL, so we
  // emit an event instead and let a workflow on the host dispatch the
  // agent. This keeps the slot contribution side-effect free at the
  // browser layer.
  await ctx.emit("crm.deal.action_invoked", {
    agentRole,
    reason,
    taskTitle,
  });
}

export const sendFollowup: EntityAction<"crm_deal"> = {
  id: "send-followup",
  entity: "crm_deal",
  label: "Send follow-up",
  async invoke(deal: Deal, ctx: ActionContext) {
    ctx.log.info("crm.deal: send follow-up", { dealId: deal.id });
    await wakeAgent(
      ctx,
      "follow-up-writer",
      "User requested a follow-up draft from the Deal page",
      `Draft a follow-up for deal ${deal.id}`,
    );
  },
};

export const runAnalyst: EntityAction<"crm_deal"> = {
  id: "run-analyst",
  entity: "crm_deal",
  label: "Run analyst",
  async invoke(deal: Deal, ctx: ActionContext) {
    ctx.log.info("crm.deal: run analyst", { dealId: deal.id });
    await wakeAgent(
      ctx,
      "deal-analyst",
      "User requested a fresh analyst pass on this deal",
      `Analyze deal ${deal.id}`,
    );
  },
};

export const markWon: EntityAction<"crm_deal"> = {
  id: "mark-won",
  entity: "crm_deal",
  label: "Mark won",
  visible: (d) => (d.fields.stageType as string | undefined) !== "won",
  async invoke(deal: Deal, ctx: ActionContext) {
    ctx.log.info("crm.deal: mark won", { dealId: deal.id });
    await ctx.emit("crm.deal.stage_changed", {
      dealId: deal.id,
      newStageType: "won",
    });
  },
};

export const markLost: EntityAction<"crm_deal"> = {
  id: "mark-lost",
  entity: "crm_deal",
  label: "Mark lost",
  visible: (d) => (d.fields.stageType as string | undefined) !== "lost",
  async invoke(deal: Deal, ctx: ActionContext) {
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
