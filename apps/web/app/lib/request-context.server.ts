import { AsyncLocalStorage } from "node:async_hooks";

import type { CampaignId, CampaignConfig } from "./campaign.server";
import { resolveCampaignFromHost } from "./campaign.server";

export type RequestContext = {
  museums: string[] | null;
  campaignId: CampaignId;
};

export const requestContext = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
  return requestContext.getStore();
}

/**
 * Ensure the request context is populated for the current async scope.
 * Call at the top of any loader/action that needs campaign-aware filtering.
 *
 * Uses AsyncLocalStorage.enterWith() to set context for the remainder of
 * this synchronous execution + any awaited promises — which covers the
 * entire loader execution since React Router awaits loader results.
 *
 * Returns the resolved campaign config.
 */
export function ensureRequestContext(request: Request): CampaignConfig {
  const existing = requestContext.getStore();
  if (existing) {
    return resolveCampaignFromHost(request.headers.get("host"));
  }

  const campaign = resolveCampaignFromHost(request.headers.get("host"));
  requestContext.enterWith({
    museums: campaign.museums,
    campaignId: campaign.id,
  });
  return campaign;
}
