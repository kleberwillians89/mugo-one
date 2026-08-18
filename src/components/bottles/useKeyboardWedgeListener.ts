import { useEffect, useRef } from 'react'
import { KeyboardWedgeBuffer } from '../../lib/keyboard-wedge-scanner'

/**
 * Listens globally so the operator never has to click into a specific field
 * before bipping (briefing section 11). Skips real text inputs/textareas —
 * if focus happens to be there, the scanner's keystrokes just type into that
 * field normally instead of being double-handled here.
 */
export function useKeyboardWedgeListener(onScan: (value: string) => void, enabled = true) {
  const bufferRef = useRef(new KeyboardWedgeBuffer())
  useEffect(() => {
    if (!enabled) return
    function handleKeydown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      if (event.key === 'Enter') {
        const result = bufferRef.current.submit(performance.now())
        if (result.type === 'scan') onScan(result.value)
        return
      }
      if (event.key.length === 1) bufferRef.current.push(event.key, performance.now())
    }
    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [onScan, enabled])
}
