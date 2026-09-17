import type { Deal, DealRow, DealStageHistory } from './deal.types'

export function toDeal(row: DealRow): Deal {
  return {
    id: row.id,
    organizationId: row.organization_id,
    pipelineId: row.pipeline_id,
    stageId: row.stage_id,
    customerId: row.customer_id,
    companyId: row.company_id,
    contactId: row.contact_id,
    leadId: row.lead_id,
    title: row.title,
    value: row.value,
    currency: row.currency,
    ownerUserId: row.owner_user_id,
    priority: row.priority,
    expectedCloseDate: row.expected_close_date,
    wonAt: row.won_at,
    lostAt: row.lost_at,
    lossReason: row.loss_reason,
    source: row.source,
    sourceChannel: row.source_channel,
    sourceMedium: row.source_medium,
    sourceCampaign: row.source_campaign,
    sourceExternalId: row.source_external_id,
    attributionMetadata: row.attribution_metadata ?? {},
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function toDealStageHistory(row: Record<string, unknown>): DealStageHistory {
  return {
    id: String(row.id),
    dealId: String(row.deal_id),
    fromStageId: String(row.from_stage_id),
    toStageId: String(row.to_stage_id),
    movedBy: row.moved_by ? String(row.moved_by) : null,
    movedAt: String(row.moved_at),
  }
}
