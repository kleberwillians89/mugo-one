import { Home, MoreHorizontal } from 'lucide-react'

export function Metric({ label, value, detail, icon: Icon, tone = 'gold' }: { label: string; value: string; detail: string; icon: typeof Home; tone?: string }) {
  return <article className="metric card">
    <div className={`metric-icon ${tone}`}><Icon size={19} /></div>
    <div className="metric-top"><span>{label}</span><button><MoreHorizontal size={17} /></button></div>
    <strong>{value}</strong><small>{detail}</small>
  </article>
}
