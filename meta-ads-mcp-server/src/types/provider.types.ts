import type {
  ConversionApiDiagnostic,
  CreateAdInput,
  CreateAdSetInput,
  CreateCampaignInput,
  InsightsQueryInput,
  MetaAd,
  MetaAdAccount,
  MetaAdSet,
  MetaBusiness,
  MetaCampaign,
  MetaInsightsRow,
  MetaLead,
  MetaLeadForm,
  MetaMediaAsset,
  MetaPixel,
  MetaPixelEvent,
  MetaTargeting,
} from './meta.types.js';

/**
 * Provider-agnostic ad-platform contract. `MetaProvider` is the only implementation
 * shipped today; a future Google/LinkedIn/TikTok provider would implement this same
 * interface and register itself in `providers/provider.registry.ts` with no changes
 * required to the MCP tool layer.
 *
 * Every method takes `connectionKey` first: it identifies which stored, per-business
 * (or per-personal-account) Meta token to use, since a single deployment can be
 * connected to multiple Business Managers at once (see auth/tokenManager.ts).
 */
export interface AdProvider {
  readonly name: string;

  listAdAccounts(connectionKey: string, businessId?: string): Promise<MetaAdAccount[]>;
  listBusinesses(connectionKey: string): Promise<MetaBusiness[]>;

  listCampaigns(connectionKey: string, accountId: string): Promise<MetaCampaign[]>;
  createCampaign(connectionKey: string, input: CreateCampaignInput): Promise<MetaCampaign>;
  duplicateCampaign(connectionKey: string, campaignId: string, newName: string): Promise<MetaCampaign>;
  pauseCampaign(connectionKey: string, campaignId: string): Promise<MetaCampaign>;
  resumeCampaign(connectionKey: string, campaignId: string): Promise<MetaCampaign>;
  deleteCampaign(connectionKey: string, campaignId: string): Promise<void>;
  updateCampaignBudget(
    connectionKey: string,
    campaignId: string,
    budget: { dailyBudgetCents?: number; lifetimeBudgetCents?: number },
  ): Promise<MetaCampaign>;

  listAdSets(connectionKey: string, campaignId: string): Promise<MetaAdSet[]>;
  createAdSet(connectionKey: string, input: CreateAdSetInput): Promise<MetaAdSet>;
  updateAdSetTargeting(connectionKey: string, adSetId: string, targeting: MetaTargeting): Promise<MetaAdSet>;

  listAds(connectionKey: string, adSetId: string): Promise<MetaAd[]>;
  createAd(connectionKey: string, input: CreateAdInput): Promise<MetaAd>;

  uploadImage(connectionKey: string, accountId: string, filePathOrUrl: string, name: string): Promise<MetaMediaAsset>;
  uploadVideo(connectionKey: string, accountId: string, filePathOrUrl: string, name: string): Promise<MetaMediaAsset>;
  listAssetLibrary(connectionKey: string, accountId: string): Promise<MetaMediaAsset[]>;

  getInsights(connectionKey: string, query: InsightsQueryInput): Promise<MetaInsightsRow[]>;

  listLeads(connectionKey: string, formId: string, limit?: number): Promise<MetaLead[]>;
  listLeadForms(connectionKey: string, accountId: string): Promise<MetaLeadForm[]>;

  listPixels(connectionKey: string, accountId: string): Promise<MetaPixel[]>;
  getPixelEvents(connectionKey: string, pixelId: string, since?: string, until?: string): Promise<MetaPixelEvent[]>;
  getConversionApiDiagnostics(connectionKey: string, pixelId: string): Promise<ConversionApiDiagnostic>;
}
