export type PipelineStageType = 'open' | 'won' | 'lost'

export type PipelineStage = {
  id: string
  organizationId: string
  pipelineId: string
  name: string
  description: string | null
  position: number
  color: string | null
  stageType: PipelineStageType
  probability: number
  active: boolean
  createdAt: string
  updatedAt: string
}

export type Pipeline = {
  id: string
  organizationId: string
  name: string
  description: string | null
  isDefault: boolean
  active: boolean
  position: number
  createdBy: string | null
  createdAt: string
  updatedAt: string
  stages: PipelineStage[]
}

export type PipelineInput = {
  name: string
  description?: string | null
  isDefault?: boolean
  active?: boolean
  position?: number
}

export type PipelineStageInput = {
  pipelineId: string
  name: string
  description?: string | null
  position?: number
  color?: string | null
  stageType?: PipelineStageType
  probability?: number
  active?: boolean
}

export type PipelineStageRow = {
  id: string
  organization_id: string
  pipeline_id: string
  name: string
  description: string | null
  position: number
  color: string | null
  stage_type: PipelineStageType
  probability: number
  active: boolean
  created_at: string
  updated_at: string
}

export type PipelineRow = {
  id: string
  organization_id: string
  name: string
  description: string | null
  is_default: boolean
  active: boolean
  position: number
  created_by: string | null
  created_at: string
  updated_at: string
  pipeline_stages?: PipelineStageRow[] | null
}

export const PIPELINE_COLUMNS =
  'id,organization_id,name,description,is_default,active,position,created_by,created_at,updated_at'
export const PIPELINE_STAGE_COLUMNS =
  'id,organization_id,pipeline_id,name,description,position,color,stage_type,probability,active,created_at,updated_at'
