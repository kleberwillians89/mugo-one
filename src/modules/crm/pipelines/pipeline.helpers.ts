import type { Pipeline, PipelineRow, PipelineStage, PipelineStageRow } from './pipeline.types'

export function toPipelineStage(row: PipelineStageRow): PipelineStage {
  return {
    id: row.id,
    organizationId: row.organization_id,
    pipelineId: row.pipeline_id,
    name: row.name,
    description: row.description,
    position: row.position,
    color: row.color,
    stageType: row.stage_type,
    probability: row.probability,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function toPipeline(row: PipelineRow): Pipeline {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    description: row.description,
    isDefault: row.is_default,
    active: row.active,
    position: row.position,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    stages: (row.pipeline_stages ?? []).map(toPipelineStage).sort((a, b) => a.position - b.position),
  }
}
