import { Hono } from "hono";
import { createAuthMiddleware } from "@boringos/core";
import { createContactRoutes } from "./contacts.js";
import { createCompanyRoutes } from "./companies.js";
import { createDealRoutes } from "./deals.js";
import { createPipelineRoutes } from "./pipelines.js";
import { createActivityRoutes } from "./activities.js";
import { createMemoryRoutes } from "./memory.js";
import { createProfileRoutes } from "./profile.js";
import { createInboxRoutes } from "./inbox.js";
import type { CrmContext } from "../context.js";

export function createCrmRoutes(ctx: CrmContext) {
  const app = new Hono();

  // Use framework's auth middleware — resolves session → tenantId + userId + role
  app.use("/*", createAuthMiddleware(ctx.db as any));

  app.route("/contacts", createContactRoutes(ctx));
  app.route("/companies", createCompanyRoutes(ctx));
  app.route("/deals", createDealRoutes(ctx));
  app.route("/pipelines", createPipelineRoutes(ctx));
  app.route("/activities", createActivityRoutes(ctx));
  app.route("/memory", createMemoryRoutes(ctx));
  app.route("/profile", createProfileRoutes(ctx));
  app.route("/inbox", createInboxRoutes(ctx));

  return app;
}
