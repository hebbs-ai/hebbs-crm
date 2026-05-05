// SPDX-License-Identifier: BUSL-1.1
//
// L5 — Deal detail entity panel. The shell's entity detail surface
// for `crm_deal` mounts this component as the primary tab. Existing
// data flows (TanStack Query against /api/crm/deals/*) keep working
// because the shell forwards auth headers via BoringOSClient.

export { DealDetailPage as DealDetailSlot } from "../pages/DealDetail.js";
