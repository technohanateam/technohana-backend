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
 */
export interface AdProvider {
  readonly name: string;

  listAdAccounts(businessId?: string): Promise<MetaAdAccount[]>;
  listBusinesses(): Promise<MetaBusiness[]>;

  listCampaigns(accountId: string): Promise<MetaCampaign[]>;
  createCampaign(input: CreateCampaignInput): Promise<MetaCampaign>;
  duplicateCampaign(campaignId: string, newName: string): Promise<MetaCampaign>;
  pauseCampaign(campaignId: string): Promise<MetaCampaign>;
  resumeCampaign(campaignId: string): Promise<MetaCampaign>;
  deleteCampaign(campaignId: string): Promise<void>;
  updateCampaignBudget(
    campaignId: string,
    budget: { dailyBudgetCents?: number; lifetimeBudgetCents?: number },
  ): Promise<MetaCampaign>;

  listAdSets(campaignId: string): Promise<MetaAdSet[]>;
  createAdSet(input: CreateAdSetInput): Promise<MetaAdSet>;
  updateAdSetTargeting(adSetId: string, targeting: MetaTargeting): Promise<MetaAdSet>;

  listAds(adSetId: string): Promise<MetaAd[]>;
  createAd(input: CreateAdInput): Promise<MetaAd>;

  uploadImage(accountId: string, filePathOrUrl: string, name: string): Promise<MetaMediaAsset>;
  uploadVideo(accountId: string, filePathOrUrl: string, name: string): Promise<MetaMediaAsset>;
  listAssetLibrary(accountId: string): Promise<MetaMediaAsset[]>;

  getInsights(query: InsightsQueryInput): Promise<MetaInsightsRow[]>;

  listLeads(formId: string, limit?: number): Promise<MetaLead[]>;
  listLeadForms(accountId: string): Promise<MetaLeadForm[]>;

  listPixels(accountId: string): Promise<MetaPixel[]>;
  getPixelEvents(pixelId: string, since?: string, until?: string): Promise<MetaPixelEvent[]>;
  getConversionApiDiagnostics(pixelId: string): Promise<ConversionApiDiagnostic>;
}
