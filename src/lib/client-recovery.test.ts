import { describe, expect, it } from 'vitest'
import { bestContact, recoveryUrgencyTone } from './client-recovery'

describe('recoveryUrgencyTone', () => {
  it('is warning just above the 90-day queue threshold', () => {
    expect(recoveryUrgencyTone(91)).toBe('warning')
    expect(recoveryUrgencyTone(179)).toBe('warning')
  })
  it('is danger at double the threshold (180 days) and beyond', () => {
    expect(recoveryUrgencyTone(180)).toBe('danger')
    expect(recoveryUrgencyTone(400)).toBe('danger')
  })
})

describe('bestContact', () => {
  it('prefers whatsapp over plain phone', () => {
    expect(bestContact({ whatsapp_phone: '11999999999', phone: '1133334444' })).toBe('11999999999')
  })
  it('falls back to phone when there is no whatsapp', () => {
    expect(bestContact({ whatsapp_phone: null, phone: '1133334444' })).toBe('1133334444')
  })
  it('falls back to an em dash when neither exists', () => {
    expect(bestContact({ whatsapp_phone: null, phone: null })).toBe('—')
  })
})
