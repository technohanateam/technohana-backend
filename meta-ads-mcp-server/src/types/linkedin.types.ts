import type {
  LinkedInCampaignCostType,
  LinkedInCampaignObjective,
  LinkedInCampaignType,
} from '../config/constants.js';

export type LinkedInCampaignGroupStatus = 'ACTIVE' | 'PAUSED' | 'ARCHIVED' | 'DRAFT';
export type LinkedInCampaignStatus = 'ACTIVE' | 'PAUSED' | 'ARCHIVED' | 'COMPLETED' | 'DRAFT' | 'CANCELED';
export type LinkedInCreativeStatus = 'ACTIVE' | 'PAUSED' | 'ARCHIVED' | 'DRAFT';

export interface LinkedInOrganization {
  /** Organization URN, e.g. "urn:li:organization:12345". */
  urn: string;
  id: string;
  name: string;
  vanityName?: string;
  logoUrl?: string;
}

export interface LinkedInAdAccount {
  /** Ad account URN, e.g. "urn:li:sponsoredAccount:509...". */
  urn: string;
  id: string;
  name: string;
  organizationUrn?: string;
  currency: string;
  status: 'ACTIVE' | 'DRAFT' | 'CANCELED' | 'PENDING_DELETION' | 'REMOVED';
  type: 'BUSINESS' | 'ENTERPRISE';
}

export interface LinkedInCampaignGroup {
  urn: string;
  id: string;
  accountUrn: string;
  name: string;
  status: LinkedInCampaignGroupStatus;
  totalBudgetAmount?: number;
  totalBudgetCurrency?: string;
  runSchedule?: { start: string; end?: string };
}

export interface CreateCampaignGroupInput {
  accountUrn: string;
  name: string;
  status?: Extract<LinkedInCampaignGroupStatus, 'ACTIVE' | 'PAUSED' | 'DRAFT'>;
  totalBudgetAmount?: number;
  totalBudgetCurrency?: string;
  runSchedule?: { start: string; end?: string };
}

export interface UpdateCampaignGroupInput {
  name?: string;
  status?: Extract<LinkedInCampaignGroupStatus, 'ACTIVE' | 'PAUSED'>;
  totalBudgetAmount?: number;
  runSchedule?: { start: string; end?: string };
}

export interface LinkedInGeoTargeting {
  /** Geo location URNs, e.g. "urn:li:geo:103644278" for the US. */
  included?: string[];
  excluded?: string[];
}

export interface LinkedInAudienceTargeting {
  locations?: LinkedInGeoTargeting;
  industries?: string[];
  jobFunctions?: string[];
  jobTitles?: string[];
  jobSeniorities?: string[];
  companySizes?: string[];
  companies?: string[];
  skills?: string[];
  degrees?: string[];
  fieldsOfStudy?: string[];
  interests?: string[];
  ageRanges?: string[];
  genders?: Array<'MALE' | 'FEMALE'>;
  audienceExpansionEnabled?: boolean;
  excludedAudienceSegments?: string[];
}

export interface LinkedInCampaign {
  urn: string;
  id: string;
  accountUrn: string;
  campaignGroupUrn: string;
  name: string;
  objectiveType: LinkedInCampaignObjective;
  type: LinkedInCampaignType;
  status: LinkedInCampaignStatus;
  costType: LinkedInCampaignCostType;
  dailyBudgetAmount?: number;
  totalBudgetAmount?: number;
  unitCostAmount?: number;
  currency: string;
  targeting?: LinkedInAudienceTargeting;
  runSchedule?: { start: string; end?: string };
  createdAt: string;
  lastModifiedAt: string;
}

export interface CreateCampaignInput {
  accountUrn: string;
  campaignGroupUrn: string;
  name: string;
  objectiveType: LinkedInCampaignObjective;
  type: LinkedInCampaignType;
  costType: LinkedInCampaignCostType;
  status?: Extract<LinkedInCampaignStatus, 'ACTIVE' | 'PAUSED' | 'DRAFT'>;
  dailyBudgetAmount?: number;
  totalBudgetAmount?: number;
  unitCostAmount?: number;
  currency: string;
  targeting?: LinkedInAudienceTargeting;
  runSchedule?: { start: string; end?: string };
}

export interface UpdateCampaignInput {
  name?: string;
  status?: Extract<LinkedInCampaignStatus, 'ACTIVE' | 'PAUSED'>;
  dailyBudgetAmount?: number;
  totalBudgetAmount?: number;
  unitCostAmount?: number;
  targeting?: LinkedInAudienceTargeting;
  runSchedule?: { start: string; end?: string };
}

export type LinkedInCreativeType = 'SINGLE_IMAGE' | 'VIDEO' | 'CAROUSEL' | 'TEXT_AD' | 'SPOTLIGHT' | 'DOCUMENT';

export interface LinkedInCarouselCardInput {
  imageAssetUrn: string;
  headline: string;
  landingPageUrl: string;
}

export interface LinkedInCreative {
  urn: string;
  id: string;
  accountUrn: string;
  campaignUrn: string;
  type: LinkedInCreativeType;
  status: LinkedInCreativeStatus;
  headline?: string;
  commentary?: string;
  landingPageUrl?: string;
  imageAssetUrn?: string;
  videoAssetUrn?: string;
  carouselCards?: LinkedInCarouselCardInput[];
  callToActionLabel?: string;
  createdAt: string;
  lastModifiedAt: string;
}

export interface CreateSingleImageAdInput {
  accountUrn: string;
  campaignUrn: string;
  name: string;
  imageAssetUrn: string;
  commentary: string;
  headline?: string;
  landingPageUrl: string;
  callToActionLabel?: string;
  status?: Extract<LinkedInCreativeStatus, 'ACTIVE' | 'PAUSED' | 'DRAFT'>;
}

export interface CreateVideoAdInput {
  accountUrn: string;
  campaignUrn: string;
  name: string;
  videoAssetUrn: string;
  commentary: string;
  headline?: string;
  landingPageUrl: string;
  callToActionLabel?: string;
  status?: Extract<LinkedInCreativeStatus, 'ACTIVE' | 'PAUSED' | 'DRAFT'>;
}

export interface CreateCarouselAdInput {
  accountUrn: string;
  campaignUrn: string;
  name: string;
  commentary: string;
  cards: LinkedInCarouselCardInput[];
  status?: Extract<LinkedInCreativeStatus, 'ACTIVE' | 'PAUSED' | 'DRAFT'>;
}

export interface UpdateCreativeInput {
  headline?: string;
  commentary?: string;
  landingPageUrl?: string;
  callToActionLabel?: string;
  status?: Extract<LinkedInCreativeStatus, 'ACTIVE' | 'PAUSED'>;
}

export interface LinkedInMediaAsset {
  urn: string;
  type: 'image' | 'video';
  status: 'AVAILABLE' | 'PROCESSING_FAILED' | 'PENDING' | 'WAITING_UPLOAD';
  name: string;
  downloadUrl?: string;
  fileSizeBytes?: number;
  createdAt: string;
}

export interface AssetValidationResult {
  valid: boolean;
  issues: string[];
  type: 'image' | 'video';
  fileSizeBytes: number;
  dimensions?: { width: number; height: number };
}

export interface AudienceEstimate {
  targeting: LinkedInAudienceTargeting;
  audienceCountLow: number;
  audienceCountHigh: number;
}

export interface LinkedInInsightsRow {
  dateRangeStart: string;
  dateRangeEnd: string;
  accountUrn: string;
  campaignUrn?: string;
  campaignGroupUrn?: string;
  creativeUrn?: string;
  impressions: number;
  clicks: number;
  costInLocalCurrency: number;
  currency: string;
  ctr: number;
  cpc: number;
  cpm: number;
  externalWebsiteConversions?: number;
  leadGenerationMailInterestedClicks?: number;
  oneClickLeads?: number;
  cpl?: number;
  videoViews?: number;
  videoCompletions?: number;
  conversionValueInLocalCurrency?: number;
  roas?: number;
}

export type LinkedInInsightsTimeGranularity = 'DAILY' | 'MONTHLY' | 'YEARLY' | 'ALL';

export interface LinkedInInsightsQueryInput {
  accountUrn: string;
  pivot: 'ACCOUNT' | 'CAMPAIGN' | 'CAMPAIGN_GROUP' | 'CREATIVE';
  campaignUrns?: string[];
  campaignGroupUrns?: string[];
  since: string;
  until: string;
  timeGranularity?: LinkedInInsightsTimeGranularity;
}

export interface LinkedInLeadGenForm {
  urn: string;
  id: string;
  accountUrn: string;
  name: string;
  status: 'ACTIVE' | 'DRAFT' | 'ARCHIVED';
  leadsCount: number;
}

export interface LinkedInLeadFormField {
  name: string;
  value: string;
}

export interface LinkedInLead {
  id: string;
  formUrn: string;
  campaignUrn?: string;
  creativeUrn?: string;
  submittedAt: string;
  fields: LinkedInLeadFormField[];
}

export interface LinkedInLeadStatistics {
  formUrn: string;
  totalLeads: number;
  leadsLast7Days: number;
  leadsLast30Days: number;
  conversionRate?: number;
}

export interface LinkedInApiErrorPayload {
  message: string;
  status: number;
  serviceErrorCode?: number;
  requestId?: string;
}
