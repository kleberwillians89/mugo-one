export const exportCsv = (name: string, rows: Record<string, unknown>[]) => {
  const keys = Object.keys(rows[0] ?? {})
  const escape = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`
  const csv = [keys.map(escape).join(';'), ...rows.map((row) => keys.map((key) => escape(row[key])).join(';'))].join('\n')
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}
