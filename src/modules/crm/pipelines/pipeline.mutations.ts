import { currentOrganization } from '../../../core/organizations/legacyOrganizationAccess'
import { supabase } from '../../../lib/supabase'
import { toPipeline, toPipelineStage } from './pipeline.helpers'
import {
  PIPELINE_COLUMNS,
  PIPELINE_STAGE_COLUMNS,
  type Pipeline,
  type PipelineInput,
  type PipelineRow,
  type PipelineStage,
  type PipelineStageInput,
  type PipelineStageRow,
} from './pipeline.types'

function pipelinePayload(input: Partial<PipelineInput>): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  if (input.name !== undefined) patch.name = input.name.trim()
  if (input.description !== undefined) patch.description = input.description || null
  if (input.isDefault !== undefined) patch.is_default = input.isDefault
  if (input.active !== undefined) patch.active = input.active
  if (input.position !== undefined) patch.position = input.position
  return patch
}

function stagePayload(input: Partial<PipelineStageInput>): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  if (input.pipelineId !== undefined) patch.pipeline_id = input.pipelineId
  if (input.name !== undefined) patch.name = input.name.trim()
  if (input.description !== undefined) patch.description = input.description || null
  if (input.position !== undefined) patch.position = input.position
  if (input.color !== undefined) patch.color = input.color || null
  if (input.stageType !== undefined) patch.stage_type = input.stageType
  if (input.probability !== undefined) patch.probability = input.probability
  if (input.active !== undefined) patch.active = input.active
  return patch
}

export async function createPipeline(input: PipelineInput): Promise<Pipeline> {
  const { user, organizationId } = await currentOrganization()
  const { data, error } = await supabase!
    .from('pipelines')
    .insert({ organization_id: organizationId, created_by: user.id, ...pipelinePayload(input) })
    .select(PIPELINE_COLUMNS)
    .single()
  if (error) throw new Error(error.message)
  return toPipeline(data as PipelineRow)
}

export async function updatePipeline(pipelineId: string, input: Partial<PipelineInput>): Promise<Pipeline> {
  const { organizationId } = await currentOrganization()
  const { data, error } = await supabase!
    .from('pipelines')
    .update(pipelinePayload(input))
    .eq('organization_id', organizationId)
    .eq('id', pipelineId)
    .select(PIPELINE_COLUMNS)
    .single()
  if (error) throw new Error(error.message)
  return toPipeline(data as PipelineRow)
}

export async function createPipelineStage(input: PipelineStageInput): Promise<PipelineStage> {
  const { organizationId } = await currentOrganization()
  const { data, error } = await supabase!
    .from('pipeline_stages')
    .insert({ organization_id: organizationId, ...stagePayload(input) })
    .select(PIPELINE_STAGE_COLUMNS)
    .single()
  if (error) throw new Error(error.message)
  return toPipelineStage(data as PipelineStageRow)
}

export async function updatePipelineStage(
  stageId: string,
  input: Partial<PipelineStageInput>,
): Promise<PipelineStage> {
  const { organizationId } = await currentOrganization()
  const { data, error } = await supabase!
    .from('pipeline_stages')
    .update(stagePayload(input))
    .eq('organization_id', organizationId)
    .eq('id', stageId)
    .select(PIPELINE_STAGE_COLUMNS)
    .single()
  if (error) throw new Error(error.message)
  return toPipelineStage(data as PipelineStageRow)
}
