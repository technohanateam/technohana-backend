import type {
  AssetValidationResult,
  AudienceEstimate,
  CreateCampaignGroupInput,
  CreateCampaignInput,
  CreateCarouselAdInput,
  CreateSingleImageAdInput,
  CreateVideoAdInput,
  LinkedInAdAccount,
  LinkedInAudienceTargeting,
  LinkedInCampaign,
  LinkedInCampaignGroup,
  LinkedInCreative,
  LinkedInInsightsQueryInput,
  LinkedInInsightsRow,
  LinkedInLead,
  LinkedInLeadGenForm,
  LinkedInLeadStatistics,
  LinkedInMediaAsset,
  LinkedInOrganization,
  UpdateCampaignGroupInput,
  UpdateCampaignInput,
  UpdateCreativeInput,
} from './linkedin.types.js';

/**
 * LinkedIn Marketing API contract. LinkedIn's domain model (Organization → Ad
 * Account → Campaign Group → Campaign → Creative, plus native Lead Gen Forms)
 * doesn't map onto the Meta-shaped `AdProvider` in `provider.types.ts`, so it
 * gets its own interface rather than distorting that one to fit two platforms.
 * `linkedin.provider.ts` is the only implementation; `tools/linkedin/*` import
 * it directly, mirroring how `tools/campaigns.tools.ts` imports `metaProvider`
 * directly today.
 *
 * Every method takes `connectionKey` first: it identifies which stored,
 * per-organization LinkedIn token to use, since a deployment can be connected
 * to multiple organizations at once (see auth/linkedinTokenManager.ts).
 */
export interface LinkedInAdProvider {
  readonly name: 'linkedin';

  listOrganizations(connectionKey: string): Promise<LinkedInOrganization[]>;
  getOrganization(connectionKey: string, organizationUrn: string): Promise<LinkedInOrganization>;

  listAdAccounts(connectionKey: string, organizationUrn?: string): Promise<LinkedInAdAccount[]>;
  getAdAccount(connectionKey: string, accountUrn: string): Promise<LinkedInAdAccount>;

  listCampaignGroups(connectionKey: string, accountUrn: string): Promise<LinkedInCampaignGroup[]>;
  createCampaignGroup(connectionKey: string, input: CreateCampaignGroupInput): Promise<LinkedInCampaignGroup>;
  updateCampaignGroup(
    connectionKey: string,
    campaignGroupUrn: string,
    input: UpdateCampaignGroupInput,
  ): Promise<LinkedInCampaignGroup>;
  archiveCampaignGroup(connectionKey: string, campaignGroupUrn: string): Promise<LinkedInCampaignGroup>;

  listCampaigns(connectionKey: string, accountUrn: string, campaignGroupUrn?: string): Promise<LinkedInCampaign[]>;
  createCampaign(connectionKey: string, input: CreateCampaignInput): Promise<LinkedInCampaign>;
  duplicateCampaign(connectionKey: string, campaignUrn: string, newName: string): Promise<LinkedInCampaign>;
  pauseCampaign(connectionKey: string, campaignUrn: string): Promise<LinkedInCampaign>;
  resumeCampaign(connectionKey: string, campaignUrn: string): Promise<LinkedInCampaign>;
  archiveCampaign(connectionKey: string, campaignUrn: string): Promise<LinkedInCampaign>;
  updateCampaign(connectionKey: string, campaignUrn: string, input: UpdateCampaignInput): Promise<LinkedInCampaign>;

  listCreatives(connectionKey: string, campaignUrn: string): Promise<LinkedInCreative[]>;
  createSingleImageAd(connectionKey: string, input: CreateSingleImageAdInput): Promise<LinkedInCreative>;
  createVideoAd(connectionKey: string, input: CreateVideoAdInput): Promise<LinkedInCreative>;
  createCarouselAd(connectionKey: string, input: CreateCarouselAdInput): Promise<LinkedInCreative>;
  updateCreative(connectionKey: string, creativeUrn: string, input: UpdateCreativeInput): Promise<LinkedInCreative>;

  estimateAudience(connectionKey: string, accountUrn: string, targeting: LinkedInAudienceTargeting): Promise<AudienceEstimate>;
  updateTargeting(connectionKey: string, campaignUrn: string, targeting: LinkedInAudienceTargeting): Promise<LinkedInCampaign>;

  updateBudget(
    connectionKey: string,
    campaignUrn: string,
    budget: { dailyBudgetAmount?: number; totalBudgetAmount?: number },
  ): Promise<LinkedInCampaign>;
  updateBid(connectionKey: string, campaignUrn: string, unitCostAmount: number): Promise<LinkedInCampaign>;

  uploadImage(connectionKey: string, accountUrn: string, filePathOrUrl: string, name: string): Promise<LinkedInMediaAsset>;
  uploadVideo(connectionKey: string, accountUrn: string, filePathOrUrl: string, name: string): Promise<LinkedInMediaAsset>;
  listMediaLibrary(connectionKey: string, accountUrn: string): Promise<LinkedInMediaAsset[]>;
  validateAsset(connectionKey: string, assetUrn: string, intendedType: 'image' | 'video'): Promise<AssetValidationResult>;

  getInsights(connectionKey: string, query: LinkedInInsightsQueryInput): Promise<LinkedInInsightsRow[]>;

  listLeadGenForms(connectionKey: string, accountUrn: string): Promise<LinkedInLeadGenForm[]>;
  listLeads(connectionKey: string, formUrn: string, limit?: number): Promise<LinkedInLead[]>;
  downloadLeads(connectionKey: string, formUrn: string): Promise<LinkedInLead[]>;
  getLeadStatistics(connectionKey: string, formUrn: string): Promise<LinkedInLeadStatistics>;
}
