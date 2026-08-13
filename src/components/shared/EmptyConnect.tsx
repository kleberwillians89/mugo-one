import { ChartNoAxesCombined, Settings } from 'lucide-react'

export function EmptyConnect({ title, text }: { title: string; text: string }) {
  return <div className="empty card">
    <div className="empty-icon"><ChartNoAxesCombined /></div><h3>{title}</h3><p>{text}</p>
    <button className="primary"><Settings size={17} /> Configurar Supabase</button>
  </div>
}
