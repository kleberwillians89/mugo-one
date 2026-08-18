/**
 * A camera decode loop calls back on every frame where jsQR finds a code —
 * often many frames in a row for the same physical QR while the camera
 * settles. Without dedup, one scan gesture would resolve/navigate/vibrate
 * repeatedly (briefing section 12: "evitar múltiplas leituras do mesmo
 * frame"). This is the pure decision function; the camera loop just calls it.
 */

const COOLDOWN_MS = 1500

export class QrScanDedup {
  private lastValue: string | null = null
  private lastAt = 0

  /** Returns true exactly once per distinct value per cooldown window. */
  shouldAccept(value: string, atMs: number): boolean {
    if (value === this.lastValue && atMs - this.lastAt < COOLDOWN_MS) return false
    this.lastValue = value
    this.lastAt = atMs
    return true
  }

  reset(): void {
    this.lastValue = null
    this.lastAt = 0
  }
}
