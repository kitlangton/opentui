export type DiagramPulsePoint = readonly [number, number]

export interface DiagramPulsePathOptions {
  pathLength: number
  pointAt: (index: number) => DiagramPulsePoint | undefined
  pulseFrame?: number
  pulseProgress?: number
  pulseLength: number
  pulseGap?: number
  visit: (point: DiagramPulsePoint, distance: number, radius: number, edgeDistance: number) => void
}

export function normalizeDiagramPulseFrame(value: number | undefined): number | undefined {
  return value === undefined || !Number.isFinite(value) ? undefined : Math.trunc(value)
}

export function normalizeDiagramPulseProgress(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined
  return Math.max(0, Math.min(1, value))
}

export function normalizeDiagramPositiveInt(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.max(1, Math.trunc(value))
}

export function diagramPulseLevel(
  distance: number,
  radius: number,
  edgeDistance: number,
  isLineGlyph: boolean,
): number {
  const distanceLevel = distance === 0 ? 6 : Math.max(1, Math.min(5, 6 - Math.ceil((distance / radius) * 5)))
  const edgeLevel = Math.max(1, Math.min(6, Math.ceil(((edgeDistance + 1) / (radius + 1)) * 6)))
  const glyphLevel = isLineGlyph ? 6 : 4
  return Math.min(distanceLevel, edgeLevel, glyphLevel)
}

export function visitDiagramPulsePath(options: DiagramPulsePathOptions): void {
  const { pathLength, pointAt, pulseFrame, pulseProgress, pulseLength, pulseGap, visit } = options
  if (pathLength === 0 || (pulseFrame === undefined && pulseProgress === undefined)) return

  const before = Math.floor((pulseLength - 1) / 2)
  const after = pulseLength - before - 1
  const radius = Math.max(1, before, after)
  const visitCenter = (centerIndex: number) => {
    for (let distance = -before; distance <= after; distance++) {
      const pathIndex = centerIndex + distance
      if (pathIndex < 0 || pathIndex >= pathLength) continue
      const point = pointAt(pathIndex)
      if (!point) continue
      const edgeDistance = Math.min(pathIndex, pathLength - 1 - pathIndex)
      visit(point, Math.abs(distance), radius, edgeDistance)
    }
  }

  if (pulseProgress !== undefined) {
    const travelLength = pathLength - 1 + before + after
    visitCenter(Math.round(pulseProgress * travelLength) - before)
    return
  }

  if (pulseFrame === undefined || pulseGap === undefined || pulseGap <= 0) return

  const phase = (((pulseFrame % pulseGap) + pulseGap) % pulseGap) - pulseLength
  for (let centerIndex = phase; centerIndex < pathLength + radius; centerIndex += pulseGap) {
    visitCenter(centerIndex)
  }
}
