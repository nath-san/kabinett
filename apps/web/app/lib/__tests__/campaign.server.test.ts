import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getCampaignConfig, resolveCampaignFromHost } from "../campaign.server";
import { clearRequestContext, ensureRequestContext } from "../request-context.server";

const originalCampaign = process.env.KABINETT_CAMPAIGN;

describe("campaign.server", () => {
  beforeEach(() => {
    delete process.env.KABINETT_CAMPAIGN;
  });

  afterEach(() => {
    clearRequestContext();
    if (typeof originalCampaign === "string") {
      process.env.KABINETT_CAMPAIGN = originalCampaign;
      return;
    }
    delete process.env.KABINETT_CAMPAIGN;
  });

  it("falls back to default campaign", () => {
    const campaign = getCampaignConfig();
    expect(campaign.id).toBe("default");
    expect(campaign.museums).toBeNull();
    expect(campaign.museumId).toBeNull();
    expect(campaign.noindex).toBe(false);
  });

  it("accepts campaign aliases", () => {
    process.env.KABINETT_CAMPAIGN = "nm";
    const campaign = getCampaignConfig();
    expect(campaign.id).toBe("nationalmuseum");
    expect(campaign.museums).toEqual(["nationalmuseum"]);
    expect(campaign.museumId).toBe("nationalmuseum");
  });

  it("accepts the Europeana campaign alias", () => {
    process.env.KABINETT_CAMPAIGN = "europeana";
    const campaign = getCampaignConfig();
    expect(campaign.id).toBe("europeana");
    expect(campaign.museums).toEqual(["europeana"]);
    expect(campaign.museumId).toBe("europeana");
    expect(campaign.noindex).toBe(true);
  });

  it("enables noindex in museum campaign mode", () => {
    process.env.KABINETT_CAMPAIGN = "nordiska";
    const campaign = getCampaignConfig();
    expect(campaign.id).toBe("nordiska");
    expect(campaign.noindex).toBe(true);
  });

  it("uses default for unknown values", () => {
    process.env.KABINETT_CAMPAIGN = "foo";
    const campaign = getCampaignConfig();
    expect(campaign.id).toBe("default");
  });

  it("resolves campaign from hostnames", () => {
    expect(resolveCampaignFromHost("europeana.norrava.com").id).toBe("europeana");
    expect(resolveCampaignFromHost("nm.norrava.com").id).toBe("nationalmuseum");
    expect(resolveCampaignFromHost("nationalmuseum.norrava.com").id).toBe("nationalmuseum");
    expect(resolveCampaignFromHost("nordiska.norrava.com").id).toBe("nordiska");
    expect(resolveCampaignFromHost("shm.norrava.com").id).toBe("shm");
  });

  it("normalizes host values with port", () => {
    const campaign = resolveCampaignFromHost("NM.NORRAVA.COM:443");
    expect(campaign.id).toBe("nationalmuseum");
    expect(campaign.museums).toEqual(["nationalmuseum"]);
  });

  it("falls back to default for unknown hostnames", () => {
    const campaign = resolveCampaignFromHost("kabinett.norrava.com");
    expect(campaign.id).toBe("default");
    expect(campaign.museums).toBeNull();
  });

  it("prefers request context over env campaign", () => {
    process.env.KABINETT_CAMPAIGN = "nordiska";

    // Simulate root loader setting context from Host header
    const fakeRequest = new Request("http://shm.norrava.com/", {
      headers: { host: "shm.norrava.com" },
    });
    ensureRequestContext(fakeRequest);
    const campaign = getCampaignConfig();

    expect(campaign.id).toBe("shm");
    expect(campaign.museums).toEqual(["shm"]);
  });
});
