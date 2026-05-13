// Typed API client for the CRM web bundle.
//
// v2 dispatch: every CRM operation is a tool POST'd to
//   /api/tools/crm.<group>.<verb>
// with `{ ok, result }` / `{ ok, error }` envelope.
//
// To keep the 17+ hooks compiling without a per-file rewrite, the
// existing `api.get/post/put/patch/delete` surface is preserved.
// Path + method are translated to `(toolName, input)` here. New
// code should call `tool(name, input)` directly — it's typed and
// avoids the path-parsing fragility.

const TOOL_BASE = "/api/tools";

function getAuthHeaders(): Record<string, string> {
  // Read the shell's localStorage keys (boringos.token / boringos.tenantId).
  // Also fall back to the legacy keys so the CRM continues to work in
  // standalone-shell mode if anyone runs that.
  const token =
    localStorage.getItem("boringos.token") ?? localStorage.getItem("token");
  const tenantId =
    localStorage.getItem("boringos.tenantId") ?? localStorage.getItem("tenantId");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (tenantId) headers["X-Tenant-Id"] = tenantId;
  return headers;
}

interface ToolEnvelope<T> {
  ok: boolean;
  result?: T;
  error?: { code: string; message: string; retryable?: boolean };
}

/**
 * Direct v2 tool dispatch. Use this for new code.
 *
 * Example:
 *   await tool<{ data: Contact[] }>("crm.contacts.list", { search: "ada" })
 */
export async function tool<T>(name: string, input: unknown): Promise<T> {
  const res = await fetch(`${TOOL_BASE}/${name}`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(input ?? {}),
  });
  let body: ToolEnvelope<T>;
  try {
    body = await res.json();
  } catch {
    throw new Error(`Tool ${name} returned non-JSON (status ${res.status})`);
  }
  if (!res.ok || !body.ok) {
    const err = body.error;
    throw new Error(err?.message ?? `Tool ${name} failed: ${res.status}`);
  }
  return body.result as T;
}

// ─────────────────────────────────────────────────────────────────
// Backwards-compatible wrapper — maps a v1-style path + HTTP verb
// onto the v2 tool surface.
//
// Pattern table (every supported entrypoint):
//   GET    /<group>                  -> crm.<group>.list
//   GET    /<group>/<id>             -> crm.<group>.get          { id }
//   POST   /<group>                  -> crm.<group>.create       { ...body }
//   PUT    /<group>/<id>             -> crm.<group>.update       { id, ...body }
//   DELETE /<group>/<id>             -> crm.<group>.delete       { id }
//
// Plus a few special cases for nested resources:
//   GET    /pipelines/<id>/forecast       -> crm.pipelines.forecast      { id }
//   POST   /pipelines/<id>/stages         -> crm.pipelines.create_stage  { pipelineId: id, ...body }
//   PUT    /pipelines/<id>/stages/<sid>   -> crm.pipelines.update_stage  { pipelineId: id, id: sid, ...body }
//   DELETE /pipelines/<id>/stages/<sid>   -> crm.pipelines.delete_stage  { pipelineId: id, id: sid }
//   GET    /activities/timeline/<cid>     -> crm.activities.timeline     { contactId: cid }
//   GET    /inbox                          -> crm.inbox.list
//   GET    /inbox/<id>/thread              -> crm.inbox.get_thread       { id }
//   POST   /inbox/<id>/reply               -> crm.inbox.reply            { id, ...body }
//   POST   /inbox/<id>/archive-gmail       -> crm.inbox.archive          { id }
//   POST   /inbox/sync                     -> crm.inbox.sync             { ...body }
//   POST   /inbox/backfill-threads         -> crm.inbox.backfill_threads { ...body }
//   POST   /inbox/backfill-bodies          -> crm.inbox.backfill_bodies  { ...body }
//   GET    /actions                        -> crm.actions.list
//   GET    /actions/count                  -> crm.actions.count_pending
//   POST   /actions/<id>/dismiss           -> crm.actions.dismiss        { id }
//   POST   /actions/<id>/complete          -> crm.actions.complete       { id }
//   POST   /actions/<id>/execute           -> crm.actions.execute        { id, ...body }
//   GET    /actions/<id>/comments          -> crm.actions.list_comments  { id }
//   POST   /actions/<id>/comments          -> crm.actions.post_comment   { id, ...body }
//   GET/PUT /profile                       -> crm.profile.get / crm.profile.update
// ─────────────────────────────────────────────────────────────────

interface Translation {
  toolName: string;
  input: Record<string, unknown>;
}

function parseQuery(qs: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!qs) return out;
  for (const [k, v] of new URLSearchParams(qs).entries()) out[k] = v;
  return out;
}

function translate(method: string, fullPath: string, body?: unknown): Translation {
  const [pathOnly, queryString = ""] = fullPath.split("?");
  const query = parseQuery(queryString);
  const segments = pathOnly.split("/").filter(Boolean);
  const [group, ...rest] = segments;
  const m = method.toUpperCase();
  const bodyObj = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;

  // Special-case routers go first.
  switch (group) {
    case "pipelines": {
      // /pipelines/:id/forecast
      if (rest.length === 2 && rest[1] === "forecast" && m === "GET") {
        return { toolName: "crm.pipelines.forecast", input: { id: rest[0], ...query } };
      }
      // /pipelines/:id/stages
      if (rest.length === 2 && rest[1] === "stages" && m === "POST") {
        return { toolName: "crm.pipelines.create_stage", input: { pipelineId: rest[0], ...bodyObj } };
      }
      // /pipelines/:id/stages/:sid
      if (rest.length === 3 && rest[1] === "stages") {
        const pipelineId = rest[0];
        const id = rest[2];
        if (m === "PUT") return { toolName: "crm.pipelines.update_stage", input: { pipelineId, id, ...bodyObj } };
        if (m === "DELETE") return { toolName: "crm.pipelines.delete_stage", input: { pipelineId, id } };
      }
      break;
    }
    case "activities": {
      if (rest.length === 2 && rest[0] === "timeline" && m === "GET") {
        return { toolName: "crm.activities.timeline", input: { contactId: rest[1], ...query } };
      }
      break;
    }
    case "inbox": {
      if (rest.length === 0 && m === "GET") return { toolName: "crm.inbox.list", input: query };
      if (rest.length === 1 && rest[0] === "sync" && m === "POST")
        return { toolName: "crm.inbox.sync", input: bodyObj };
      if (rest.length === 1 && rest[0] === "backfill-threads" && m === "POST")
        return { toolName: "crm.inbox.backfill_threads", input: bodyObj };
      if (rest.length === 1 && rest[0] === "backfill-bodies" && m === "POST")
        return { toolName: "crm.inbox.backfill_bodies", input: bodyObj };
      if (rest.length === 2) {
        const id = rest[0];
        if (rest[1] === "thread" && m === "GET") return { toolName: "crm.inbox.get_thread", input: { id } };
        if (rest[1] === "reply" && m === "POST") return { toolName: "crm.inbox.reply", input: { id, ...bodyObj } };
        if (rest[1] === "archive-gmail" && m === "POST") return { toolName: "crm.inbox.archive", input: { id } };
      }
      break;
    }
    case "actions": {
      if (rest.length === 0 && m === "GET") return { toolName: "crm.actions.list", input: query };
      if (rest.length === 1 && rest[0] === "count" && m === "GET")
        return { toolName: "crm.actions.count_pending", input: query };
      if (rest.length === 2) {
        const id = rest[0];
        if (rest[1] === "dismiss" && m === "POST") return { toolName: "crm.actions.dismiss", input: { id } };
        if (rest[1] === "complete" && m === "POST") return { toolName: "crm.actions.complete", input: { id } };
        if (rest[1] === "execute" && m === "POST")
          return { toolName: "crm.actions.execute", input: { id, ...bodyObj } };
        if (rest[1] === "comments") {
          if (m === "GET") return { toolName: "crm.actions.list_comments", input: { id } };
          if (m === "POST") return { toolName: "crm.actions.post_comment", input: { id, ...bodyObj } };
        }
      }
      break;
    }
    case "profile": {
      if (rest.length === 0) {
        if (m === "GET") return { toolName: "crm.profile.get", input: {} };
        if (m === "PUT") return { toolName: "crm.profile.update", input: bodyObj };
      }
      break;
    }
  }

  // Generic CRUD fallback.
  if (group && rest.length === 0) {
    if (m === "GET") return { toolName: `crm.${group}.list`, input: query };
    if (m === "POST") return { toolName: `crm.${group}.create`, input: bodyObj };
  }
  if (group && rest.length === 1) {
    const id = rest[0];
    if (m === "GET") return { toolName: `crm.${group}.get`, input: { id } };
    if (m === "PUT") return { toolName: `crm.${group}.update`, input: { id, ...bodyObj } };
    if (m === "DELETE") return { toolName: `crm.${group}.delete`, input: { id } };
  }

  throw new Error(`api: no v2 tool mapping for ${m} ${fullPath}`);
}

async function dispatch<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { toolName, input } = translate(method, path, body);
  // The server returns `{ data: ... }` etc. inside `result`. Hooks
  // expect that shape directly (they were written against the v1
  // `c.json({ data, total, ... })` envelope). So we return result.
  return tool<T>(toolName, input);
}

export const api = {
  get: <T>(path: string) => dispatch<T>("GET", path),
  post: <T>(path: string, data: unknown) => dispatch<T>("POST", path, data),
  put: <T>(path: string, data: unknown) => dispatch<T>("PUT", path, data),
  patch: <T>(path: string, data: unknown) => dispatch<T>("PATCH", path, data),
  delete: <T>(path: string) => dispatch<T>("DELETE", path),
};
