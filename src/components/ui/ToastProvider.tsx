import { createContext, ReactNode, useCallback, useContext, useRef, useState } from 'react'
import { AlertTriangle, Check, Info } from 'lucide-react'
import './Toast.css'

type Tone = 'success' | 'error' | 'info'
type ToastItem = { id: number; message: string; tone: Tone }
type PushOptions = { tone?: Tone; duration?: number }

const ToastContext = createContext<{ push: (message: string, options?: PushOptions) => void } | null>(null)

const icons: Record<Tone, typeof Check> = { success: Check, error: AlertTriangle, info: Info }

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const counter = useRef(0)
  const [paused, setPaused] = useState(false)

  const remove = useCallback((id: number) => setItems((current) => current.filter((item) => item.id !== id)), [])

  const push = useCallback((message: string, options?: PushOptions) => {
    const id = ++counter.current
    const tone = options?.tone ?? 'info'
    setItems((current) => [...current, { id, message, tone }])
    const duration = options?.duration ?? (tone === 'error' ? 6000 : 4000)
    window.setTimeout(() => { if (!paused) remove(id) }, duration)
  }, [paused, remove])

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="ui-toast-region" aria-live="polite" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
        {items.map((item) => {
          const Icon = icons[item.tone]
          return (
            <div key={item.id} className={`ui-toast ui-toast--${item.tone}`} role={item.tone === 'error' ? 'alert' : 'status'}>
              <Icon size={16} />
              <span>{item.message}</span>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast deve ser usado dentro de ToastProvider')
  return context
}
