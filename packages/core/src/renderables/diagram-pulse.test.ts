import { describe, expect, test } from "bun:test"
import {
  normalizeDiagramPositiveInt,
  normalizeDiagramPulseFrame,
  normalizeDiagramPulseProgress,
} from "./diagram-pulse.js"

describe("diagram pulse helpers", () => {
  test("normalizes pulse frame values", () => {
    expect(normalizeDiagramPulseFrame(undefined)).toBeUndefined()
    expect(normalizeDiagramPulseFrame(Number.NaN)).toBeUndefined()
    expect(normalizeDiagramPulseFrame(2.9)).toBe(2)
  })

  test("normalizes pulse progress values", () => {
    expect(normalizeDiagramPulseProgress(undefined)).toBeUndefined()
    expect(normalizeDiagramPulseProgress(Number.POSITIVE_INFINITY)).toBeUndefined()
    expect(normalizeDiagramPulseProgress(-0.5)).toBe(0)
    expect(normalizeDiagramPulseProgress(1.5)).toBe(1)
  })

  test("normalizes positive integer pulse options", () => {
    expect(normalizeDiagramPositiveInt(undefined, 7)).toBe(7)
    expect(normalizeDiagramPositiveInt(Number.NaN, 7)).toBe(7)
    expect(normalizeDiagramPositiveInt(-2, 7)).toBe(1)
    expect(normalizeDiagramPositiveInt(3.9, 7)).toBe(3)
  })
})
