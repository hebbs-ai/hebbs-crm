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
