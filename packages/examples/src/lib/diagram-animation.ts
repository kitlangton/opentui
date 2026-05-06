import { parseColor, RGBA, type ColorInput } from "@opentui/core"

export const DIAGRAM_GLOW_LEVELS = [0, 1, 2, 3, 4, 5] as const

export function animationNow(): number {
  return performance.now()
}

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

export function easeOutCubic(value: number): number {
  const inverse = 1 - clamp01(value)
  return 1 - inverse * inverse * inverse
}

function mixChannel(left: number, right: number, amount: number): number {
  return Math.round(left + (right - left) * amount)
}

export function mixColor(left: ColorInput, right: ColorInput, amount: number): RGBA {
  const leftRgb = parseColor(left).toInts()
  const rightRgb = parseColor(right).toInts()
  const clampedAmount = clamp01(amount)
  return RGBA.fromInts(
    mixChannel(leftRgb[0], rightRgb[0], clampedAmount),
    mixChannel(leftRgb[1], rightRgb[1], clampedAmount),
    mixChannel(leftRgb[2], rightRgb[2], clampedAmount),
    mixChannel(leftRgb[3], rightRgb[3], clampedAmount),
  )
}

export function diagramNodeActivationColors(options: {
  activeId: string
  previousId?: string
  levels?: readonly number[]
  progress: number
  activeColor: ColorInput
  activeNeutralColor: ColorInput
  previousNeutralColor?: ColorInput
  pulseColor: ColorInput
  keyForLevel: (id: string, level: number) => string
}): Record<string, RGBA> {
  const levels = options.levels ?? DIAGRAM_GLOW_LEVELS
  const incomingActivation = easeOutCubic(options.progress / 0.18)
  const incomingSettle = 1 - easeOutCubic(options.progress)
  const incomingFlash = mixColor(options.activeColor, options.pulseColor, 0.86)
  const colors: Record<string, RGBA> = {}

  if (options.previousId) {
    colors[options.previousId] = mixColor(
      options.activeColor,
      options.previousNeutralColor ?? options.activeNeutralColor,
      easeOutCubic(options.progress),
    )
  }

  for (const level of levels) {
    const intensity = level / (levels.length - 1)
    const activationAmount = incomingActivation * (0.18 + intensity * 0.82)
    const flashAmount = incomingSettle * Math.pow(intensity, 1.45) * 0.88
    const incomingSettled = mixColor(options.activeNeutralColor, options.activeColor, activationAmount)
    colors[options.keyForLevel(options.activeId, level)] = mixColor(incomingSettled, incomingFlash, flashAmount)
  }

  return colors
}

export function diagramNodeBackgroundFlashColors(options: {
  activeId: string
  levels?: readonly number[]
  progress: number
  backgroundColor: ColorInput
  pulseColor: ColorInput
  keyForLevel: (id: string, level: number) => string
}): Record<string, RGBA> {
  const levels = options.levels ?? DIAGRAM_GLOW_LEVELS
  const colors: Record<string, RGBA> = {}
  const fadeAmount = 1 - easeOutCubic(options.progress)

  for (const level of levels) {
    const intensity = level / (levels.length - 1)
    colors[options.keyForLevel(options.activeId, level)] = mixColor(
      options.backgroundColor,
      options.pulseColor,
      Math.pow(intensity, 1.7) * 0.24 * fadeAmount,
    )
  }

  return colors
}
