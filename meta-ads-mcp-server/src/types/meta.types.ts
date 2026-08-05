import type { MetaCampaignObjective } from '../config/constants.js';

export type MetaCampaignStatus = 'ACTIVE' | 'PAUSED' | 'DELETED' | 'ARCHIVED';

export type MetaBidStrategy =
  | 'LOWEST_COST_WITHOUT_CAP'
  | 'LOWEST_COST_WITH_BID_CAP'
  | 'COST_CAP'
  | 'LOWEST_COST_WITH_MIN_ROAS';

export interface MetaAdAccount {
  id: string;
  accountId: string;
  name: string;
  businessId?: string;
  businessName?: string;
  currency: string;
  timezoneName: string;
  accountStatus: number;
}

export interface MetaBusiness {
  id: string;
  name: string;
  verificationStatus?: string;
}

export interface MetaCampaign {
  id: string;
  accountId: string;
  name: string;
  objective: MetaCampaignObjective;
  status: MetaCampaignStatus;
  dailyBudgetCents?: number;
  lifetimeBudgetCents?: number;
  bidStrategy?: MetaBidStrategy;
  createdTime: string;
  updatedTime: string;
}

export interface CreateCampaignInput {
  accountId: string;
  name: string;
  objective: MetaCampaignObjective;
  status?: Extract<MetaCampaignStatus, 'ACTIVE' | 'PAUSED'>;
  dailyBudgetCents?: number;
  lifetimeBudgetCents?: number;
  bidStrategy?: MetaBidStrategy;
  specialAdCategories?: string[];
}

export interface MetaGeoLocation {
  countries?: string[];
  regions?: Array<{ key: string }>;
  cities?: Array<{ key: string; radius?: number; distanceUnit?: 'mile' | 'kilometer' }>;
}

export interface MetaTargeting {
  geoLocations?: MetaGeoLocation;
  ageMin?: number;
  ageMax?: number;
  genders?: Array<1 | 2>;
  interests?: Array<{ id: string; name?: string }>;
  behaviors?: Array<{ id: string; name?: string }>;
  customAudiences?: Array<{ id: string }>;
  excludedCustomAudiences?: Array<{ id: string }>;
  languages?: Array<{ key: string }>;
  publisherPlatforms?: Array<'facebook' | 'instagram' | 'audience_network' | 'messenger'>;
}

export interface MetaAdSet {
  id: string;
  campaignId: string;
  accountId: string;
  name: string;
  status: MetaCampaignStatus;
  dailyBudgetCents?: number;
  lifetimeBudgetCents?: number;
  billingEvent: string;
  optimizationGoal: string;
  targeting: MetaTargeting;
  startTime?: string;
  endTime?: string;
}

export interface CreateAdSetInput {
  accountId: string;
  campaignId: string;
  name: string;
  billingEvent: string;
  optimizationGoal: string;
  targeting: MetaTargeting;
  dailyBudgetCents?: number;
  lifetimeBudgetCents?: number;
  bidAmountCents?: number;
  status?: Extract<MetaCampaignStatus, 'ACTIVE' | 'PAUSED'>;
  startTime?: string;
  endTime?: string;
}

export type MetaAdCreativeType = 'SINGLE_IMAGE' | 'CAROUSEL' | 'VIDEO' | 'COLLECTION' | 'REELS' | 'STORIES';

export interface CarouselCardInput {
  imageHash?: string;
  videoId?: string;
  link: string;
  name: string;
  description?: string;
}

export interface CreateAdCreativeInput {
  accountId: string;
  name: string;
  type: MetaAdCreativeType;
  pageId: string;
  message: string;
  headline?: string;
  description?: string;
  link: string;
  callToActionType?: string;
  imageHash?: string;
  videoId?: string;
  thumbnailUrl?: string;
  carouselCards?: CarouselCardInput[];
}

export interface MetaAd {
  id: string;
  accountId: string;
  adSetId: string;
  campaignId: string;
  name: string;
  status: MetaCampaignStatus;
  creativeId: string;
  createdTime: string;
  updatedTime: string;
}

export interface CreateAdInput {
  accountId: string;
  adSetId: string;
  name: string;
  creative: CreateAdCreativeInput;
  status?: Extract<MetaCampaignStatus, 'ACTIVE' | 'PAUSED'>;
}

export interface MetaInsightsRow {
  dateStart: string;
  dateStop: string;
  accountId: string;
  campaignId?: string;
  adSetId?: string;
  adId?: string;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  cpa?: number;
  roas?: number;
  frequency: number;
  purchases?: number;
  conversions?: number;
  costPerResult?: number;
  breakdown?: Record<string, string>;
}

export type MetaInsightsDatePreset =
  | 'today'
  | 'yesterday'
  | 'last_7d'
  | 'last_14d'
  | 'last_30d'
  | 'last_90d'
  | 'this_month'
  | 'last_month'
  | 'this_quarter'
  | 'maximum';

export interface InsightsQueryInput {
  accountId: string;
  level: 'account' | 'campaign' | 'adset' | 'ad';
  campaignIds?: string[];
  adSetIds?: string[];
  adIds?: string[];
  datePreset?: MetaInsightsDatePreset;
  since?: string;
  until?: string;
  breakdowns?: string[];
  fields?: string[];
}

export interface MetaLeadField {
  name: string;
  values: string[];
}

export interface MetaLead {
  id: string;
  formId: string;
  campaignId?: string;
  adId?: string;
  createdTime: string;
  fieldData: MetaLeadField[];
}

export interface MetaLeadForm {
  id: string;
  name: string;
  status: string;
  leadsCount: number;
}

export interface MetaPixelEvent {
  eventName: string;
  count: number;
  matchedCount?: number;
}

export interface MetaPixel {
  id: string;
  name: string;
  lastFiredTime?: string;
}

export interface ConversionApiDiagnostic {
  pixelId: string;
  eventsReceivedViaBrowser: number;
  eventsReceivedViaServer: number;
  deduplicationRate: number;
  eventMatchQuality?: number;
  issues: string[];
}

export interface MetaMediaAsset {
  id: string;
  type: 'image' | 'video';
  hash?: string;
  url?: string;
  name: string;
  createdTime: string;
}

export interface MetaApiErrorPayload {
  message: string;
  type: string;
  code: number;
  errorSubcode?: number;
  fbtraceId?: string;
}
