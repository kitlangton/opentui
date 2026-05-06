import type { BorderCharacters } from "../lib/border.js"
import {
  directionBetween,
  walkOrthogonalSegment,
  type DiagramBounds,
  type DiagramDirection,
  type DiagramPoint,
} from "./diagram-geometry.js"

export type DiagramLineCornerStyle = "square" | "rounded"
export type DiagramArrowHeadStyle = "filled" | "line"

export const DIAGRAM_ARROW_HEADS = new Set(["▶", "◀", "▼", "▲", "→", "←", "↓", "↑"])

function lineDirections(char: string): readonly DiagramDirection[] | undefined {
  switch (char) {
    case "─":
      return ["left", "right"]
    case "│":
      return ["up", "down"]
    case "┌":
    case "╭":
      return ["right", "down"]
    case "┐":
    case "╮":
      return ["left", "down"]
    case "└":
    case "╰":
      return ["up", "right"]
    case "┘":
    case "╯":
      return ["up", "left"]
    case "├":
      return ["up", "down", "right"]
    case "┤":
      return ["up", "down", "left"]
    case "┬":
      return ["left", "right", "down"]
    case "┴":
      return ["left", "right", "up"]
    case "┼":
      return ["up", "down", "left", "right"]
    default:
      return undefined
  }
}

export function diagramLineGlyph(
  directions: ReadonlySet<DiagramDirection>,
  cornerStyle: DiagramLineCornerStyle = "square",
): string {
  const up = directions.has("up")
  const down = directions.has("down")
  const left = directions.has("left")
  const right = directions.has("right")
  if (up && down && left && right) return "┼"
  if (up && down && right) return "├"
  if (up && down && left) return "┤"
  if (left && right && down) return "┬"
  if (left && right && up) return "┴"
  if (up && right) return cornerStyle === "rounded" ? "╰" : "└"
  if (up && left) return cornerStyle === "rounded" ? "╯" : "┘"
  if (down && right) return cornerStyle === "rounded" ? "╭" : "┌"
  if (down && left) return cornerStyle === "rounded" ? "╮" : "┐"
  if (up || down) return "│"
  return "─"
}

export function mergeDiagramLineGlyph(
  existing: string,
  incoming: string,
  cornerStyle: DiagramLineCornerStyle = "square",
): string | undefined {
  const existingDirections = lineDirections(existing)
  const incomingDirections = lineDirections(incoming)
  if (!existingDirections || !incomingDirections) return undefined

  return diagramLineGlyph(new Set([...existingDirections, ...incomingDirections]), cornerStyle)
}

export function diagramArrowHead(direction: DiagramDirection, style: DiagramArrowHeadStyle = "filled"): string {
  if (style === "line") {
    if (direction === "right") return "→"
    if (direction === "left") return "←"
    if (direction === "up") return "↑"
    return "↓"
  }

  if (direction === "right") return "▶"
  if (direction === "left") return "◀"
  if (direction === "up") return "▲"
  return "▼"
}

export function diagramArrowHeadBetween(
  from: DiagramPoint,
  to: DiagramPoint,
  style: DiagramArrowHeadStyle = "filled",
): string {
  const direction = directionBetween(from, to)
  return direction ? diagramArrowHead(direction, style) : diagramArrowHead("right", style)
}

export function drawDiagramFrame(
  bounds: DiagramBounds,
  chars: BorderCharacters,
  setCell: (x: number, y: number, char: string) => void,
): void {
  setCell(bounds.left, bounds.top, chars.topLeft)
  setCell(bounds.left + bounds.width - 1, bounds.top, chars.topRight)
  setCell(bounds.left, bounds.top + bounds.height - 1, chars.bottomLeft)
  setCell(bounds.left + bounds.width - 1, bounds.top + bounds.height - 1, chars.bottomRight)
  for (let x = bounds.left + 1; x < bounds.left + bounds.width - 1; x++) {
    setCell(x, bounds.top, chars.horizontal)
    setCell(x, bounds.top + bounds.height - 1, chars.horizontal)
  }
  for (let y = bounds.top + 1; y < bounds.top + bounds.height - 1; y++) {
    setCell(bounds.left, y, chars.vertical)
    setCell(bounds.left + bounds.width - 1, y, chars.vertical)
  }
}

export function drawOrthogonalPath(
  points: readonly DiagramPoint[],
  setCell: (x: number, y: number, char: string) => void,
  options: { cornerStyle?: DiagramLineCornerStyle } = {},
): void {
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1]!
    const to = points[index]!
    const direction = directionBetween(from, to)
    if (!direction) continue
    const glyph = direction === "left" || direction === "right" ? "─" : "│"
    walkOrthogonalSegment(from, to, index === 1, (point) => setCell(point.x, point.y, glyph))
  }

  for (let index = 1; index < points.length - 1; index++) {
    const previous = points[index - 1]!
    const current = points[index]!
    const next = points[index + 1]!
    const fromDirection = directionBetween(current, previous)
    const toDirection = directionBetween(current, next)
    const directions = new Set<DiagramDirection>()
    if (fromDirection) directions.add(fromDirection)
    if (toDirection) directions.add(toDirection)
    setCell(current.x, current.y, diagramLineGlyph(directions, options.cornerStyle))
  }
}
