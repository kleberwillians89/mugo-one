import { RefObject, useEffect, useRef } from 'react'

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Trap keyboard focus inside `containerRef` while `active` is true, close on
 * ESC via `onClose`, and restore focus to whatever triggered the panel once
 * it closes — shared by Modal and Drawer so both get the same a11y contract.
 */
export function useFocusTrap(active: boolean, containerRef: RefObject<HTMLElement | null>, onClose: () => void) {
  const triggerRef = useRef<Element | null>(null)

  useEffect(() => {
    if (!active) return
    triggerRef.current = document.activeElement
    const container = containerRef.current
    const focusable = () => Array.from(container?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
    const first = focusable()[0]
    first?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
      if (event.key !== 'Tab') return
      const items = focusable()
      if (items.length === 0) return
      const firstItem = items[0]
      const lastItem = items[items.length - 1]
      if (event.shiftKey && document.activeElement === firstItem) { event.preventDefault(); lastItem.focus() }
      else if (!event.shiftKey && document.activeElement === lastItem) { event.preventDefault(); firstItem.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (triggerRef.current instanceof HTMLElement) triggerRef.current.focus()
    }
  }, [active, containerRef, onClose])
}
