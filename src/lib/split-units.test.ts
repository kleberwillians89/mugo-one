import { describe, expect, it } from 'vitest'
import { computeSplitPreview } from './split-units'

describe('computeSplitPreview', () => {
  it('computes total and remaining for a valid split, matching the briefing example (100ml, 3x5ml -> 85ml remaining)', () => {
    expect(computeSplitPreview(100, 5, 3)).toEqual({ totalMl: 15, remainingMl: 85, valid: true, error: null })
  })
  it('never creates or destroys ml — totalMl always equals quantityPerVial * count exactly', () => {
    const preview = computeSplitPreview(50, 2.5, 10)
    expect(preview.totalMl).toBe(25)
    expect(preview.remainingMl).toBe(25)
  })
  it('rejects a fractionation that would exceed the source bottle — never allows the source to go negative', () => {
    const preview = computeSplitPreview(10, 5, 3) // needs 15ml, only 10ml available
    expect(preview.valid).toBe(false)
    expect(preview.remainingMl).toBe(-5)
    expect(preview.error).toContain('5')
  })
  it('rejects a zero or negative quantity per vial', () => {
    expect(computeSplitPreview(100, 0, 3).valid).toBe(false)
    expect(computeSplitPreview(100, -5, 3).valid).toBe(false)
  })
  it('rejects a zero, negative, or non-integer vial count', () => {
    expect(computeSplitPreview(100, 5, 0).valid).toBe(false)
    expect(computeSplitPreview(100, 5, -1).valid).toBe(false)
    expect(computeSplitPreview(100, 5, 2.5).valid).toBe(false)
  })
  it('allows using the exact remaining amount (remainingMl can be exactly zero)', () => {
    expect(computeSplitPreview(15, 5, 3)).toEqual({ totalMl: 15, remainingMl: 0, valid: true, error: null })
  })
})
