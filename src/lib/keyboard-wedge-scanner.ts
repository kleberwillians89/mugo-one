/**
 * USB/Bluetooth barcode scanners overwhelmingly present themselves to the OS
 * as a keyboard: they "type" the encoded value character-by-character, very
 * fast, then send Enter. This module is the pure decision logic — given a
 * stream of keystroke events with timestamps, decide whether they form a
 * scan (fast burst + terminator) or ordinary human typing, without ever
 * requiring the operator to click into a specific input first (briefing
 * section 11: "não exigir clique em input toda vez").
 *
 * No DOM/window access here — a thin hook wires this to real keydown events.
 */

const MAX_INTERKEY_MS = 40
const MIN_SCAN_LENGTH = 4

export type WedgeResult = { type: 'scan'; value: string } | { type: 'idle' }

export class KeyboardWedgeBuffer {
  private chars: string[] = []
  private lastAt: number | null = null

  /** Feed one printable character keystroke. */
  push(char: string, atMs: number): void {
    if (this.lastAt !== null && atMs - this.lastAt > MAX_INTERKEY_MS) this.chars = []
    this.chars.push(char)
    this.lastAt = atMs
  }

  /** Feed the terminator (Enter). Returns a scan only if the burst was fast and long enough to plausibly be a scanner, never a stray Enter press. */
  submit(atMs: number): WedgeResult {
    const isFastBurst = this.lastAt !== null && atMs - this.lastAt <= MAX_INTERKEY_MS
    const value = this.chars.join('')
    this.reset()
    if (isFastBurst && value.length >= MIN_SCAN_LENGTH) return { type: 'scan', value }
    return { type: 'idle' }
  }

  reset(): void {
    this.chars = []
    this.lastAt = null
  }
}
