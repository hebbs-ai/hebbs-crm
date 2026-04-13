export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 200;

export const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const DEFAULT_PIPELINE_STAGES = [
  { name: "Discovery", sortOrder: 0, probability: 10, type: "open" as const },
  { name: "Qualified", sortOrder: 1, probability: 25, type: "open" as const },
  { name: "Proposal", sortOrder: 2, probability: 50, type: "open" as const },
  { name: "Negotiation", sortOrder: 3, probability: 75, type: "open" as const },
  { name: "Closing", sortOrder: 4, probability: 90, type: "open" as const },
  { name: "Won", sortOrder: 5, probability: 100, type: "won" as const },
  { name: "Lost", sortOrder: 6, probability: 0, type: "lost" as const },
] as const;
