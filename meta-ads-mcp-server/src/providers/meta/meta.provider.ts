import type { AdProvider } from '../../types/provider.types.js';
import * as accountsService from './accounts.service.js';
import * as campaignsService from './campaigns.service.js';
import * as adSetsService from './adsets.service.js';
import * as adsService from './ads.service.js';
import * as mediaService from './media.service.js';
import * as insightsService from './insights.service.js';
import * as leadsService from './leads.service.js';
import * as pixelService from './pixel.service.js';

/** Concrete AdProvider implementation backed by the Meta Marketing API. */
export const metaProvider: AdProvider = {
  name: 'meta',

  listAdAccounts: accountsService.listAdAccounts,
  listBusinesses: accountsService.listBusinesses,

  listCampaigns: campaignsService.listCampaigns,
  createCampaign: campaignsService.createCampaign,
  duplicateCampaign: campaignsService.duplicateCampaign,
  pauseCampaign: campaignsService.pauseCampaign,
  resumeCampaign: campaignsService.resumeCampaign,
  deleteCampaign: campaignsService.deleteCampaign,
  updateCampaignBudget: campaignsService.updateCampaignBudget,

  listAdSets: adSetsService.listAdSets,
  createAdSet: adSetsService.createAdSet,
  updateAdSetTargeting: adSetsService.updateAdSetTargeting,

  listAds: adsService.listAds,
  createAd: adsService.createAd,

  uploadImage: mediaService.uploadImage,
  uploadVideo: mediaService.uploadVideo,
  listAssetLibrary: mediaService.listAssetLibrary,

  getInsights: insightsService.getInsights,

  listLeads: leadsService.listLeads,
  listLeadForms: leadsService.listLeadForms,

  listPixels: pixelService.listPixels,
  getPixelEvents: pixelService.getPixelEvents,
  getConversionApiDiagnostics: pixelService.getConversionApiDiagnostics,
};
