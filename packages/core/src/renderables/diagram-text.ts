import { stringWidth } from "../platform/runtime.js"

export interface DiagramTextBoxSize {
  width: number
  height: number
  lines: string[]
}

export function diagramTextWidth(value: string): number {
  return stringWidth(value)
}

export function splitDiagramLines(value: string): string[] {
  return value.split(/<br\s*\/?>/i).map((line) => line.trim())
}

export function measureDiagramTextBox(
  value: string,
  options: { paddingX?: number; paddingY?: number; minInnerWidth?: number } = {},
): DiagramTextBoxSize {
  const lines = splitDiagramLines(value)
  const innerWidth = Math.max(...lines.map(diagramTextWidth), options.minInnerWidth ?? 1)
  return {
    width: innerWidth + (options.paddingX ?? 0) * 2,
    height: lines.length + (options.paddingY ?? 0) * 2,
    lines,
  }
}
