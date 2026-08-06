import { getFreshAccessToken } from '../../auth/tokenManager.js';
import { metaClient } from './client.js';
import { normalizeAccountId } from './accountId.util.js';
import type { MetaLead, MetaLeadForm } from '../../types/meta.types.js';

const LEAD_FORM_FIELDS = 'id,name,status,leads_count';
const LEAD_FIELDS = 'id,created_time,field_data,ad_id,campaign_id';

interface RawLeadForm {
  id: string;
  name: string;
  status: string;
  leads_count?: number;
}

interface RawLeadFieldDatum {
  name: string;
  values: string[];
}

interface RawLead {
  id: string;
  created_time: string;
  field_data: RawLeadFieldDatum[];
  ad_id?: string;
  campaign_id?: string;
}

export async function listLeadForms(connectionKey: string, accountId: string): Promise<MetaLeadForm[]> {
  const accessToken = await getFreshAccessToken(connectionKey);
  const result = await metaClient.get<{ data: RawLeadForm[] }>(`/${normalizeAccountId(accountId)}/leadgen_forms`, {
    accessToken,
    operationName: 'listLeadForms',
    params: { fields: LEAD_FORM_FIELDS, limit: 200 },
  });
  return result.data.data.map((form) => ({
    id: form.id,
    name: form.name,
    status: form.status,
    leadsCount: form.leads_count ?? 0,
  }));
}

export async function listLeads(connectionKey: string, formId: string, limit = 100): Promise<MetaLead[]> {
  const accessToken = await getFreshAccessToken(connectionKey);
  const result = await metaClient.get<{ data: RawLead[] }>(`/${formId}/leads`, {
    accessToken,
    operationName: 'listLeads',
    params: { fields: LEAD_FIELDS, limit },
  });
  return result.data.data.map((lead) => ({
    id: lead.id,
    formId,
    campaignId: lead.campaign_id,
    adId: lead.ad_id,
    createdTime: lead.created_time,
    fieldData: lead.field_data.map((field) => ({ name: field.name, values: field.values })),
  }));
}
