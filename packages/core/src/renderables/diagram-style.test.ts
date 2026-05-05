import { describe, expect, test } from "bun:test"
import { RGBA } from "../lib/RGBA.js"
import {
  ansiBg,
  ansiFg,
  blendColor,
  brightenColor,
  createAnsiPeakAndRampTheme,
  createAnsiRampTheme,
  createColorPeakAndRamp,
  mixRgb,
  numberedStyleKeys,
  rgba,
} from "./diagram-style.js"

describe("diagram style helpers", () => {
  test("mixes rgb values and emits truecolor ANSI", () => {
    expect(mixRgb([0, 10, 20], [10, 30, 60], 0.5)).toEqual([5, 20, 40])
    expect(ansiFg([1, 2, 3])).toBe("\x1b[38;2;1;2;3m")
    expect(ansiBg([4, 5, 6])).toBe("\x1b[48;2;4;5;6m")
  })

  test("converts rgb tuples and blends optional RGBA values", () => {
    const black = RGBA.fromInts(0, 0, 0, 255)
    const white = RGBA.fromInts(10, 20, 30, 255)

    expect(rgba([1, 2, 3]).equals(RGBA.fromInts(1, 2, 3, 255))).toBe(true)
    expect(blendColor(black, white, 0.5).equals(RGBA.fromInts(5, 10, 15, 255))).toBe(true)
    expect(blendColor(undefined, white, 0.5)?.equals(white)).toBe(true)
    expect(blendColor(undefined, undefined, 0.5)).toBeUndefined()
  })

  test("brightens colors toward white", () => {
    const color = brightenColor(RGBA.fromInts(100, 150, 200, 255), 0.5)

    expect(color?.equals(RGBA.fromInts(178, 203, 228, 255))).toBe(true)
    expect(brightenColor(undefined)).toBeUndefined()
  })

  test("creates numbered style keys and ANSI ramps", () => {
    const styles = numberedStyleKeys("requestFade", [1, 2, 3] as const)
    const theme = createAnsiRampTheme(styles, [0, 0, 0], [12, 24, 36])

    expect(styles).toEqual(["requestFade1", "requestFade2", "requestFade3"])
    expect(theme.requestFade1).toBe("\x1b[38;2;3;6;9m")
    expect(theme.requestFade2).toBe("\x1b[38;2;6;12;18m")
    expect(theme.requestFade3).toBe("\x1b[38;2;9;18;27m")
  })

  test("creates peak and ramp themes", () => {
    const ansiTheme = createAnsiPeakAndRampTheme(
      "requestPulse",
      ["requestPulseFade1", "requestPulseFade2"] as const,
      [0, 0, 0],
      [12, 24, 36],
    )
    const colorTheme = createColorPeakAndRamp(
      "requestPulse",
      ["requestPulseFade1", "requestPulseFade2"] as const,
      RGBA.fromInts(0, 0, 0, 255),
      RGBA.fromInts(12, 24, 36, 255),
    )

    expect(ansiTheme.requestPulse).toBe("\x1b[38;2;12;24;36m")
    expect(ansiTheme.requestPulseFade1).toBe("\x1b[38;2;4;8;12m")
    expect(colorTheme.requestPulse?.equals(RGBA.fromInts(12, 24, 36, 255))).toBe(true)
    expect(colorTheme.requestPulseFade2?.equals(RGBA.fromInts(8, 16, 24, 255))).toBe(true)
  })
})
