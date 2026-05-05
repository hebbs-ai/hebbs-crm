// SPDX-License-Identifier: BUSL-1.1
//
// L4 — Pipeline page as a `slots.pages` contribution.
//
// Re-exports the existing PipelinePage as the slot component. The
// shell renders this inside its own Layout chrome when CRM is
// installed. No rewriting — the kanban implementation in
// pages/Pipeline.tsx stays canonical.

export { PipelinePage as PipelineSlot } from "../pages/Pipeline.js";
