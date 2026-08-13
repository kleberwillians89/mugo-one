import './Divider.css'

export function Divider({ label }: { label?: string }) {
  if (!label) return <hr className="ui-divider" />
  return (
    <div className="ui-divider-labeled" role="separator">
      <span>{label}</span>
    </div>
  )
}
