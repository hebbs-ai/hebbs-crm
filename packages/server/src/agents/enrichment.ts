/**
 * Enrichment Agent — re-exports contact and company dossier instructions.
 *
 * The old flat ENRICHMENT_INSTRUCTIONS is kept as a fallback export
 * but tenant provisioning now creates two separate agents.
 */
export { CONTACT_DOSSIER_INSTRUCTIONS } from "./enrichment-contact.js";
export { COMPANY_DOSSIER_INSTRUCTIONS } from "./enrichment-company.js";

/** @deprecated Use CONTACT_DOSSIER_INSTRUCTIONS or COMPANY_DOSSIER_INSTRUCTIONS */
export { CONTACT_DOSSIER_INSTRUCTIONS as ENRICHMENT_INSTRUCTIONS } from "./enrichment-contact.js";
