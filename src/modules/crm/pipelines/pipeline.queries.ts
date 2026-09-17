import { authenticatedOrganization } from '../../../core/organizations/legacyOrganizationAccess'
import { supabase } from '../../../lib/supabase'
import { toPipeline } from './pipeline.helpers'
import { PIPELINE_COLUMNS, PIPELINE_STAGE_COLUMNS, type Pipeline, type PipelineRow } from './pipeline.types'

export async function fetchPipelines(activeOnly = true): Promise<Pipeline[]> {
  const { organizationId } = await authenticatedOrganization()
  let query = supabase!
    .from('pipelines')
    .select(`${PIPELINE_COLUMNS},pipeline_stages(${PIPELINE_STAGE_COLUMNS})`)
    .eq('organization_id', organizationId)
    .order('position', { ascending: true })
  if (activeOnly) query = query.eq('active', true)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return ((data ?? []) as PipelineRow[]).map(toPipeline)
}

export async function fetchPipeline(pipelineId: string): Promise<Pipeline | null> {
  const { organizationId } = await authenticatedOrganization()
  const { data, error } = await supabase!
    .from('pipelines')
    .select(`${PIPELINE_COLUMNS},pipeline_stages(${PIPELINE_STAGE_COLUMNS})`)
    .eq('organization_id', organizationId)
    .eq('id', pipelineId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data ? toPipeline(data as PipelineRow) : null
}
