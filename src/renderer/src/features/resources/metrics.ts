const MIB = 1024 * 1024

/** nanocores -> "12.3m (0.0123 cores)" */
export function formatCpuNano(nano: number | undefined): string {
  if (typeof nano !== 'number' || Number.isNaN(nano)) return 'n/a'
  const cores = nano / 1e9
  return `${(nano / 1e6).toFixed(1)}m (${cores.toFixed(3)} cores)`
}

/** bytes -> "57.3 MiB" */
export function formatMemBytes(bytes: number | undefined): string {
  if (typeof bytes !== 'number' || Number.isNaN(bytes)) return 'n/a'
  if (bytes >= 1024 * MIB) return `${(bytes / (1024 * MIB)).toFixed(2)} GiB`
  return `${(bytes / MIB).toFixed(1)} MiB`
}

export function usagePercent(used: number | undefined, capacity: number | undefined): number | null {
  if (
    typeof used !== 'number' ||
    typeof capacity !== 'number' ||
    Number.isNaN(used) ||
    Number.isNaN(capacity) ||
    capacity <= 0
  ) {
    return null
  }
  return Math.min(100, Math.max(0, (used / capacity) * 100))
}

export function barColor(pct: number | null): string {
  if (pct === null) return 'transparent'
  if (pct > 85) return '#e5534b'
  if (pct > 65) return '#d29922'
  return '#3fb950'
}
