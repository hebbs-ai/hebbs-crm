import { sql } from "drizzle-orm";
import type { ContextProvider, ContextBuildEvent } from "@boringos/agent";

/**
 * Provides agents with Hebbs memory configuration and usage instructions.
 * Only injects if memory is configured for the tenant.
 */
export function createCrmMemoryProvider(getDb: () => unknown): ContextProvider {
  return {
    name: "crm-memory",
    phase: "system",
    priority: 42,

    async provide(event: ContextBuildEvent): Promise<string | null> {
      const db = getDb() as any;
      if (!db) return null;

      try {
        const result = await db.execute(sql`
          SELECT key, value FROM tenant_settings
          WHERE tenant_id = ${event.tenantId} AND key LIKE 'hebbs_%'
        `);
        const config: Record<string, string> = {};
        for (const r of result as unknown as Array<{ key: string; value: string }>) {
          config[r.key] = r.value;
        }

        if (!config.hebbs_endpoint || !config.hebbs_api_key) return null;

        const endpoint = config.hebbs_endpoint;
        const apiKey = config.hebbs_api_key;
        const workspace = event.tenantId;

        return `## Memory (Hebbs Cognitive Engine)

You have access to Hebbs, a cognitive memory engine. Use it to remember important findings, recall past context, and prime before acting.

### Connection
- Endpoint: ${endpoint}
- API Key: ${apiKey}
- Workspace (tenant): ${workspace}

All \`hebbs\` commands require: \`--endpoint ${endpoint} --api-key ${apiKey}\`

### Remember — store important findings

\`\`\`bash
hebbs remember "content to store" \\
  --importance 0.7 \\
  --entity-id contact-UUID \\
  --endpoint ${endpoint} --api-key ${apiKey} \\
  --format json
\`\`\`

**Importance guide:**
- 0.9: Deal outcomes, critical decisions, user corrections
- 0.7: Key findings from research, important email insights, meeting action items
- 0.5: General observations, routine updates
- 0.3: Minor details, background context

**Entity scoping** — always scope memories to the right entity:
- \`contact-{uuid}\` for contact-specific memories
- \`company-{uuid}\` for company-specific memories
- \`deal-{uuid}\` for deal-specific memories
- \`org\` for organization-wide knowledge

### Recall — retrieve past context

\`\`\`bash
hebbs recall "query" \\
  --top-k 10 \\
  --entity-id contact-UUID \\
  --weights R:T:I:F \\
  --endpoint ${endpoint} --api-key ${apiKey} \\
  --format json
\`\`\`

**Weights format: R:T:I:F** (Relevance:Recency:Importance:Frequency)

| Goal | Weights | When to use |
|---|---|---|
| Recent context | \`0.3:0.5:0.1:0.1\` | "What happened recently with this contact?" |
| Important facts | \`0.3:0.1:0.5:0.1\` | "What are the key decisions about this deal?" |
| Semantic match | \`0.7:0.1:0.1:0.1\` | "Find memories about pricing discussions" |
| Balanced | \`0.5:0.2:0.2:0.1\` | General recall (default) |

**Examples:**

\`\`\`bash
# Before analyzing a deal — recall past signals and patterns
hebbs recall "risk signals and deal patterns" --entity-id deal-UUID --weights 0.5:0.2:0.2:0.1 --top-k 10 --endpoint ${endpoint} --api-key ${apiKey} --format json

# Before prepping for a meeting — recall recent interactions with the contact
hebbs recall "recent interactions and preferences" --entity-id contact-UUID --weights 0.3:0.5:0.1:0.1 --top-k 15 --endpoint ${endpoint} --api-key ${apiKey} --format json

# Recall org-wide product knowledge
hebbs recall "enterprise pricing tiers" --entity-id org --weights 0.7:0.1:0.1:0.1 --top-k 5 --endpoint ${endpoint} --api-key ${apiKey} --format json
\`\`\`

### Prime — load all context for an entity before acting

\`\`\`bash
hebbs prime contact-UUID --max-memories 20 --endpoint ${endpoint} --api-key ${apiKey} --format json
\`\`\`

Use \`prime\` when you need comprehensive context about an entity (before a meeting, before writing a follow-up, before analyzing a deal). It returns all memories for that entity sorted by relevance.

### Insights — read consolidated patterns

\`\`\`bash
hebbs insights --entity-id org --min-confidence 0.7 --max-results 5 --endpoint ${endpoint} --api-key ${apiKey} --format json
\`\`\`

Hebbs automatically consolidates memories into insights. Read them for patterns like "deals with tech stakeholders close faster."

### When to use memory

**Always recall before acting** — check what you already know before researching, analyzing, or drafting.

**Remember important findings** — after scoring an email, researching a contact, analyzing a deal, or prepping for a meeting, store the key takeaways. Not everything — just what's worth knowing next time.

**Don't remember:**
- Raw data dumps (full email bodies, API responses)
- Routine status updates
- Things already stored in CRM fields
- Temporary debug info

**Do remember:**
- "Sarah prefers email over calls, responds fastest Mon/Tue AM"
- "Stripe is evaluating us vs Adyen, budget approved $150k"
- "This deal slipped because CFO was not looped in early enough"
- "Rep's writing style: casual professional, short paragraphs"
`;
      } catch {
        return null;
      }
    },
  };
}
