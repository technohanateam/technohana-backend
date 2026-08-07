import { getFreshAccessToken } from '../../auth/linkedinTokenManager.js';
import { linkedinClient } from './client.js';
import { idFromUrn } from './urn.util.js';
import type { LinkedInLead, LinkedInLeadFormField, LinkedInLeadGenForm, LinkedInLeadStatistics } from '../../types/linkedin.types.js';

const MAX_DOWNLOAD_PAGES = 20;
const DOWNLOAD_PAGE_SIZE = 100;

interface RawLeadGenForm {
  id: string;
  name: string;
  status: LinkedInLeadGenForm['status'];
  leadsCount?: number;
}

interface RawLeadGenFormsResponse {
  elements: RawLeadGenForm[];
}

function mapLeadGenForm(raw: RawLeadGenForm, accountUrn: string): LinkedInLeadGenForm {
  return {
    urn: raw.id,
    id: idFromUrn(raw.id),
    accountUrn,
    name: raw.name,
    status: raw.status,
    leadsCount: raw.leadsCount ?? 0,
  };
}

export async function listLeadGenForms(connectionKey: string, accountUrn: string): Promise<LinkedInLeadGenForm[]> {
  const accessToken = await getFreshAccessToken(connectionKey);
  const result = await linkedinClient.get<RawLeadGenFormsResponse>('/leadForms', {
    accessToken,
    operationName: 'listLeadGenForms',
    params: { q: 'account', account: accountUrn },
  });
  return result.data.elements.map((form) => mapLeadGenForm(form, accountUrn));
}

interface RawLeadFormResponseField {
  name: string;
  value: string;
}

interface RawLeadFormResponse {
  id: string;
  leadType: string;
  form: string;
  associatedCampaign?: string;
  associatedCreative?: string;
  submittedAt: number;
  formResponse: { answers: RawLeadFormResponseField[] };
}

interface RawLeadFormResponsesResponse {
  elements: RawLeadFormResponse[];
  paging?: { start: number; count: number; total?: number };
}

function mapLead(raw: RawLeadFormResponse): LinkedInLead {
  const fields: LinkedInLeadFormField[] = raw.formResponse.answers.map((answer) => ({
    name: answer.name,
    value: answer.value,
  }));
  return {
    id: raw.id,
    formUrn: raw.form,
    campaignUrn: raw.associatedCampaign,
    creativeUrn: raw.associatedCreative,
    submittedAt: new Date(raw.submittedAt).toISOString(),
    fields,
  };
}

export async function listLeads(connectionKey: string, formUrn: string, limit = 100): Promise<LinkedInLead[]> {
  const accessToken = await getFreshAccessToken(connectionKey);
  const result = await linkedinClient.get<RawLeadFormResponsesResponse>('/leadFormResponses', {
    accessToken,
    operationName: 'listLeads',
    params: { q: 'form', form: formUrn, count: limit },
  });
  return result.data.elements.map(mapLead);
}

/** Retrieves every lead for a form, paginating through results up to a safety cap of MAX_DOWNLOAD_PAGES pages. */
export async function downloadLeads(connectionKey: string, formUrn: string): Promise<LinkedInLead[]> {
  const accessToken = await getFreshAccessToken(connectionKey);
  const leads: LinkedInLead[] = [];

  for (let page = 0; page < MAX_DOWNLOAD_PAGES; page += 1) {
    const result = await linkedinClient.get<RawLeadFormResponsesResponse>('/leadFormResponses', {
      accessToken,
      operationName: 'downloadLeads',
      params: { q: 'form', form: formUrn, start: page * DOWNLOAD_PAGE_SIZE, count: DOWNLOAD_PAGE_SIZE },
    });

    leads.push(...result.data.elements.map(mapLead));

    const total = result.data.paging?.total;
    if (result.data.elements.length < DOWNLOAD_PAGE_SIZE || (total !== undefined && leads.length >= total)) {
      break;
    }
  }

  return leads;
}

export async function getLeadStatistics(connectionKey: string, formUrn: string): Promise<LinkedInLeadStatistics> {
  const leads = await downloadLeads(connectionKey, formUrn);
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

  const leadsLast7Days = leads.filter((lead) => new Date(lead.submittedAt).getTime() >= sevenDaysAgo).length;
  const leadsLast30Days = leads.filter((lead) => new Date(lead.submittedAt).getTime() >= thirtyDaysAgo).length;

  return {
    formUrn,
    totalLeads: leads.length,
    leadsLast7Days,
    leadsLast30Days,
  };
}
