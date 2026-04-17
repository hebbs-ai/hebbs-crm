// ── Core CRM entity types ──

export interface Contact {
  id: string;
  tenantId: string;
  ownerId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  companyId: string | null;
  title: string | null;
  linkedIn: string | null;
  source: string | null;
  tags: string[];
  customFields: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Company {
  id: string;
  tenantId: string;
  ownerId: string;
  name: string;
  domain: string | null;
  industry: string | null;
  size: string | null;
  website: string | null;
  address: string | null;
  customFields: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Deal {
  id: string;
  tenantId: string;
  ownerId: string;
  title: string;
  value: number;
  currency: string;
  pipelineId: string;
  stageId: string;
  probability: number | null;
  expectedCloseDate: string | null;
  contactId: string | null;
  companyId: string | null;
  lostReason: string | null;
  customFields: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Pipeline {
  id: string;
  tenantId: string;
  name: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export type PipelineStageType = "open" | "won" | "lost";

export interface PipelineStage {
  id: string;
  pipelineId: string;
  name: string;
  sortOrder: number;
  probability: number;
  type: PipelineStageType;
  createdAt: string;
  updatedAt: string;
}

export type ActivityType = "call" | "email" | "meeting" | "note" | "task";

export interface Activity {
  id: string;
  tenantId: string;
  type: ActivityType;
  subject: string;
  body: string | null;
  contactId: string | null;
  dealId: string | null;
  companyId: string | null;
  userId: string;
  occurredAt: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// ── API types ──

export interface ListParams {
  limit?: number;
  offset?: number;
  ownerId?: string;
}

export interface ContactListParams extends ListParams {
  companyId?: string;
  search?: string;
}

export interface DealListParams extends ListParams {
  pipelineId?: string;
  stageId?: string;
  search?: string;
}

export interface ActivityListParams extends ListParams {
  contactId?: string;
  dealId?: string;
  companyId?: string;
  type?: ActivityType;
}

export interface ListResponse<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface ForecastEntry {
  stageId: string;
  stageName: string;
  dealCount: number;
  totalValue: number;
  weightedValue: number;
  probability: number;
}

export interface Forecast {
  pipelineId: string;
  pipelineName: string;
  totalWeightedValue: number;
  stages: ForecastEntry[];
}

export interface TimelineEntry {
  activity: Activity;
  agentNote: string | null;
}

// ── Dossier types (deep enrichment) ──

export interface DossierTag { label: string; accent?: boolean; }
export interface DossierMetric { label: string; value: string; unit?: string; subtitle?: string; }
export interface DossierField { label: string; value: string; source?: string; confidence?: "high" | "medium" | "low"; }
export interface DossierContactEntry { label: string; value: string; note?: string; verified?: boolean; }
export interface DossierDigitalChannel {
  platform: string;
  handle?: string;
  url?: string;
  status: "active" | "inactive" | "archive";
  description: string;
  tone?: string;
  postFrequency?: string;
}
export interface DossierQuote { text: string; source: string; date?: string; }
export interface DossierTimelineEntry { yearRange: string; title: string; body: string; sources?: string[]; }
export interface DossierTableRow { metric: string; value: string; sourceNote?: string; }
export interface DossierVertical { name: string; description: string; status: "active" | "dormant" | "exited"; highlights?: string[]; }
export interface DossierRecognition { year?: string; title: string; description?: string; source?: string; }
export interface DossierAlert { hook: string; detail: string; }
export interface DossierSource { id: string; title: string; url?: string; tier: "verified" | "public" | "database" | "inferred"; contribution: string; }
export interface DossierNewsItem { date?: string; headline: string; detail?: string; source?: string; }
export interface CompanyLeader { name: string; role: string; background?: string; contactId?: string; }

export interface ContactDossier {
  version: number;
  enrichedAt: string;
  model: string;
  sourceCount: number;

  header: {
    monogram: string;
    positioning: string;
    headline: string;
    tags: DossierTag[];
    quickStats?: {
      primaryEmail?: string;
      location?: string;
      activeCompanies?: string;
      listingStatus?: string;
    };
  };

  metrics: DossierMetric[];

  profile?: {
    fullName: string;
    knownAs?: string;
    ageApprox?: string;
    baseCities?: string[];
    nationality?: string;
    education?: DossierField[];
    familyCircle?: string;
    affiliations?: string[];
    dietaryOrLifestyle?: string;
  };

  contactDirectory?: DossierContactEntry[];

  digital?: DossierDigitalChannel[];

  persona?: {
    decisionStyle?: string;
    philosophy?: string;
    influences?: string[];
    whatTheyRespect?: string;
    whatTheyDismiss?: string;
    communicationStyle?: string;
    emotionalTemperature?: string;
    innerCircle?: string;
    quotes?: DossierQuote[];
  };

  journey?: DossierTimelineEntry[];

  financial?: {
    disclaimer?: string;
    rows: DossierTableRow[];
  };

  verticals?: DossierVertical[];

  geography?: string[];

  market?: {
    keyClients?: string[];
    competition?: string;
    positioning?: string;
    proprietaryTech?: string[];
    certifications?: string[];
  };

  recognition?: DossierRecognition[];

  alerts: DossierAlert[];

  sources: DossierSource[];
}

export interface CompanyDossier {
  version: number;
  enrichedAt: string;
  model: string;
  sourceCount: number;

  header: {
    monogram: string;
    positioning: string;
    tagline?: string;
    founded?: string;
    hq?: string;
    tags: DossierTag[];
  };

  metrics: DossierMetric[];

  overview?: {
    legalName?: string;
    type?: string;
    sector?: string;
    hqAddress?: string;
    businessModel?: string;
    description?: string;
  };

  leadership?: CompanyLeader[];

  verticals?: DossierVertical[];

  technology?: {
    proprietaryStack?: string[];
    infrastructure?: string[];
    compliance?: string[];
  };

  clients?: {
    segments?: string[];
    keyNames?: string[];
    totalCount?: string;
    geographicReach?: string;
  };

  financial?: {
    disclaimer?: string;
    rows: DossierTableRow[];
  };

  geography?: string[];

  competition?: {
    competitors?: string[];
    positioning?: string;
    moat?: string;
  };

  recentNews?: DossierNewsItem[];

  recognition?: DossierRecognition[];

  alerts: DossierAlert[];

  sources: DossierSource[];
}

export function isContactDossier(obj: unknown): obj is ContactDossier {
  if (!obj || typeof obj !== "object") return false;
  const d = obj as Record<string, unknown>;
  return typeof d.version === "number" && typeof d.enrichedAt === "string" && !!d.header && Array.isArray(d.alerts) && Array.isArray(d.sources) && !!(d.header as Record<string, unknown>).monogram;
}

export function isCompanyDossier(obj: unknown): obj is CompanyDossier {
  if (!obj || typeof obj !== "object") return false;
  const d = obj as Record<string, unknown>;
  return typeof d.version === "number" && typeof d.enrichedAt === "string" && !!d.header && Array.isArray(d.alerts) && Array.isArray(d.sources);
}
