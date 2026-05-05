import { ANSI } from "../ansi.js"
import { BorderChars, type BorderStyle } from "../lib/border.js"
import { RGBA, parseColor, type ColorInput } from "../lib/RGBA.js"
import { StyledText } from "../lib/styled-text.js"
import { stringWidth } from "../platform/runtime.js"
import type { TextChunk } from "../text-buffer.js"
import type { RenderContext } from "../types.js"
import { DiagramCanvas, type DiagramCanvasCell } from "./diagram-canvas.js"
import { ansiFg, rgba, type DiagramRgb } from "./diagram-style.js"
import { TextBufferRenderable, type TextBufferOptions } from "./TextBufferRenderable.js"

export type FlowchartDirection = "TB" | "TD" | "BT" | "LR" | "RL"
export type FlowchartNodeShape = "box" | "rounded" | "database"

export interface FlowchartNode {
  id: string
  label: string
  shape: FlowchartNodeShape
}

export interface FlowchartEdge {
  from: string
  to: string
  label: string
}

export interface FlowchartDiagram {
  direction: FlowchartDirection
  nodes: FlowchartNode[]
  edges: FlowchartEdge[]
}

export interface FlowchartDiagramRenderOptions {
  direction?: FlowchartDirection
  borderStyle?: BorderStyle
  minNodeGap?: number
  minRankGap?: number
}

export type FlowchartDiagramAnsiTheme = Partial<Record<FlowchartCellStyle, string>>

export interface FlowchartDiagramAnsiOptions extends FlowchartDiagramRenderOptions {
  theme?: FlowchartDiagramAnsiTheme
}

export interface FlowchartDiagramOptions extends TextBufferOptions, FlowchartDiagramRenderOptions {
  content?: string
  nodeColor?: ColorInput
  databaseColor?: ColorInput
  edgeColor?: ColorInput
  labelColor?: ColorInput
}

type FlowchartCellStyle = "node" | "database" | "edge" | "label"
type FlowchartGrid = DiagramCanvas<FlowchartCellStyle>
type EdgeDirection = "up" | "down" | "left" | "right"

interface FlowchartNodeSize {
  width: number
  height: number
  lines: string[]
}

interface FlowchartNodeBounds extends FlowchartNodeSize {
  id: string
  left: number
  top: number
  centerX: number
  centerY: number
}

type FlowchartStyleColors = Required<Record<FlowchartCellStyle, RGBA>>

const DEFAULT_DIRECTION = "TD" satisfies FlowchartDirection
const DEFAULT_BORDER_STYLE = "rounded" satisfies BorderStyle
const DEFAULT_MIN_NODE_GAP = 5
const DEFAULT_MIN_BRANCH_LABEL_GAP = 12
const DEFAULT_MIN_RANK_GAP = 10
const FLOWCHART_HEADER_RE = /^(flowchart|graph)(?:\s+(TB|TD|BT|LR|RL))?$/i
const ID_RE = "[A-Za-z_][A-Za-z0-9_.-]*"
const DATABASE_NODE_RE = new RegExp(`^(${ID_RE})\\[\\((.+)\\)\\]$`)
const ROUNDED_BRACKET_NODE_RE = new RegExp(`^(${ID_RE})\\(\\[(.+)\\]\\)$`)
const ROUNDED_NODE_RE = new RegExp(`^(${ID_RE})\\((.+)\\)$`)
const BOX_NODE_RE = new RegExp(`^(${ID_RE})\\[(.+)\\]$`)
const EXPLICIT_NODE_SHAPE_RE = new RegExp(`^${ID_RE}(?:\\[|\\()`)
const DEFAULT_THEME_RGB = {
  node: [228, 239, 232],
  database: [230, 177, 126],
  edge: [134, 225, 200],
  label: [134, 225, 200],
} as const satisfies Record<FlowchartCellStyle, DiagramRgb>
const DEFAULT_ANSI_THEME: Required<Record<FlowchartCellStyle, string>> = {
  node: ansiFg(DEFAULT_THEME_RGB.node),
  database: ansiFg(DEFAULT_THEME_RGB.database),
  edge: ansiFg(DEFAULT_THEME_RGB.edge),
  label: ansiFg(DEFAULT_THEME_RGB.label),
}
const EDGE_ARROWS = new Set(["▶", "◀", "▼", "▲"])

function visualLength(value: string): number {
  return stringWidth(value)
}

function stripQuotes(value: string): string {
  const trimmed = value.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function splitLines(value: string): string[] {
  return value.split(/<br\s*\/?>/i).map((line) => line.trim())
}

function normalizeDirection(value?: string): FlowchartDirection {
  const upper = value?.toUpperCase()
  if (upper === "TB" || upper === "TD" || upper === "BT" || upper === "LR" || upper === "RL") return upper
  return DEFAULT_DIRECTION
}

function normalizePositiveInt(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.max(1, Math.trunc(value))
}

function meaningfulLines(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("%%"))
}

export function isMermaidFlowchartDiagram(content: string): boolean {
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("%%")) continue
    return FLOWCHART_HEADER_RE.test(trimmed)
  }
  return false
}

function parseNodeToken(token: string): FlowchartNode {
  const trimmed = token.trim().replace(/;$/, "")
  const database = trimmed.match(DATABASE_NODE_RE)
  if (database) return { id: database[1]!, label: stripQuotes(database[2]!), shape: "database" }

  const roundedBracket = trimmed.match(ROUNDED_BRACKET_NODE_RE)
  if (roundedBracket) return { id: roundedBracket[1]!, label: stripQuotes(roundedBracket[2]!), shape: "rounded" }

  const rounded = trimmed.match(ROUNDED_NODE_RE)
  if (rounded) return { id: rounded[1]!, label: stripQuotes(rounded[2]!), shape: "rounded" }

  const box = trimmed.match(BOX_NODE_RE)
  if (box) return { id: box[1]!, label: stripQuotes(box[2]!), shape: "box" }

  return { id: trimmed, label: trimmed, shape: "box" }
}

function hasExplicitNodeShape(token: string): boolean {
  return EXPLICIT_NODE_SHAPE_RE.test(token.trim())
}

function ensureNode(nodes: Map<string, FlowchartNode>, token: string): FlowchartNode {
  const node = parseNodeToken(token)
  const existing = nodes.get(node.id)
  if (!existing) {
    nodes.set(node.id, node)
    return node
  }

  if (hasExplicitNodeShape(token)) {
    existing.label = node.label
    existing.shape = node.shape
  }
  return existing
}

function stripNodeToken(token: string): string {
  return token
    .replace(/\s*:::.*$/, "")
    .replace(/;$/, "")
    .trim()
}

export function parseMermaidFlowchartDiagram(content: string): FlowchartDiagram {
  const nodes = new Map<string, FlowchartNode>()
  const edges: FlowchartEdge[] = []
  let direction: FlowchartDirection = DEFAULT_DIRECTION

  for (const line of meaningfulLines(content)) {
    const header = line.match(FLOWCHART_HEADER_RE)
    if (header) {
      direction = normalizeDirection(header[2])
      continue
    }

    const pipeEdge = line.match(/^(.+?)\s*-->\s*(?:\|([^|]*)\|\s*)?(.+)$/)
    const textEdge = line.match(/^(.+?)\s*--\s+(.+?)\s+-->\s*(.+)$/)
    const edgeMatch = textEdge ?? pipeEdge
    if (edgeMatch) {
      const from = ensureNode(nodes, stripNodeToken(edgeMatch[1]!))
      const to = ensureNode(nodes, stripNodeToken(edgeMatch[3]!))
      edges.push({ from: from.id, to: to.id, label: (edgeMatch[2] ?? "").trim() })
      continue
    }

    if (hasExplicitNodeShape(line)) ensureNode(nodes, line)
  }

  return { direction, nodes: [...nodes.values()], edges }
}

function nodeSize(node: FlowchartNode): FlowchartNodeSize {
  const lines = splitLines(node.label)
  const innerWidth = Math.max(...lines.map(visualLength), 1)
  return { width: innerWidth + 4, height: lines.length + 2, lines }
}

function rankNodes(diagram: FlowchartDiagram): Map<string, number> {
  const ranks = new Map<string, number>()
  const outgoing = new Map<string, string[]>()
  const incoming = new Set<string>()

  for (const edge of diagram.edges) {
    const list = outgoing.get(edge.from) ?? []
    list.push(edge.to)
    outgoing.set(edge.from, list)
    incoming.add(edge.to)
  }

  const starts = diagram.nodes.filter((node) => !incoming.has(node.id))
  if (starts.length === 0 && diagram.nodes[0]) starts.push(diagram.nodes[0])

  const queue = starts.map((node) => node.id)
  for (const node of starts) ranks.set(node.id, 0)

  while (queue.length > 0) {
    const id = queue.shift()!
    const rank = ranks.get(id) ?? 0
    for (const to of outgoing.get(id) ?? []) {
      const nextRank = rank + 1
      if ((ranks.get(to) ?? Number.POSITIVE_INFINITY) <= nextRank) continue
      ranks.set(to, nextRank)
      queue.push(to)
    }
  }

  for (const node of diagram.nodes) {
    if (!ranks.has(node.id)) ranks.set(node.id, ranks.size)
  }
  return ranks
}

function layoutFlowchartDiagram(
  content: string,
  options: FlowchartDiagramRenderOptions = {},
): { diagram: FlowchartDiagram; bounds: Map<string, FlowchartNodeBounds>; grid: FlowchartGrid } {
  const diagram = parseMermaidFlowchartDiagram(content)
  diagram.direction = options.direction ?? diagram.direction
  const direction = diagram.direction
  const horizontal = direction === "LR" || direction === "RL"
  const minNodeGap = normalizePositiveInt(options.minNodeGap, DEFAULT_MIN_NODE_GAP)
  const rankNodeGap = horizontal ? minNodeGap : Math.max(minNodeGap, DEFAULT_MIN_BRANCH_LABEL_GAP)
  const minRankGap = normalizePositiveInt(options.minRankGap, DEFAULT_MIN_RANK_GAP)
  const ranks = rankNodes(diagram)
  const maxRank = Math.max(0, ...ranks.values())
  const sizes = new Map(diagram.nodes.map((node) => [node.id, nodeSize(node)]))
  const ranksByIndex = new Map<number, FlowchartNode[]>()

  for (const node of diagram.nodes) {
    const rank = ranks.get(node.id) ?? 0
    const normalizedRank = direction === "RL" || direction === "BT" ? maxRank - rank : rank
    const nodes = ranksByIndex.get(normalizedRank) ?? []
    nodes.push(node)
    ranksByIndex.set(normalizedRank, nodes)
  }

  const rankKeys = [...ranksByIndex.keys()].sort((a, b) => a - b)
  const bounds = new Map<string, FlowchartNodeBounds>()

  if (horizontal) {
    const columnWidths = rankKeys.map((rank) =>
      Math.max(...ranksByIndex.get(rank)!.map((node) => sizes.get(node.id)!.width)),
    )
    const columnHeights = rankKeys.map((rank) => {
      const nodes = ranksByIndex.get(rank)!
      return (
        nodes.reduce((total, node) => total + sizes.get(node.id)!.height, 0) +
        Math.max(0, nodes.length - 1) * rankNodeGap
      )
    })
    const canvasHeight = Math.max(1, ...columnHeights)
    let x = 0
    for (let rankIndex = 0; rankIndex < rankKeys.length; rankIndex++) {
      const rank = rankKeys[rankIndex]!
      const nodes = ranksByIndex.get(rank)!
      const columnWidth = columnWidths[rankIndex]!
      let y = Math.floor((canvasHeight - columnHeights[rankIndex]!) / 2)
      for (const node of nodes) {
        const size = sizes.get(node.id)!
        const left = x + Math.floor((columnWidth - size.width) / 2)
        bounds.set(node.id, {
          id: node.id,
          ...size,
          left,
          top: y,
          centerX: left + Math.floor(size.width / 2),
          centerY: y + Math.floor(size.height / 2),
        })
        y += size.height + rankNodeGap
      }
      x += columnWidth + minRankGap
    }
  } else {
    const rowHeights = rankKeys.map((rank) =>
      Math.max(...ranksByIndex.get(rank)!.map((node) => sizes.get(node.id)!.height)),
    )
    const rowWidths = rankKeys.map((rank) => {
      const nodes = ranksByIndex.get(rank)!
      return (
        nodes.reduce((total, node) => total + sizes.get(node.id)!.width, 0) +
        Math.max(0, nodes.length - 1) * rankNodeGap
      )
    })
    const canvasWidth = Math.max(1, ...rowWidths)
    let y = 0
    for (let rankIndex = 0; rankIndex < rankKeys.length; rankIndex++) {
      const rank = rankKeys[rankIndex]!
      const nodes = ranksByIndex.get(rank)!
      const rowHeight = rowHeights[rankIndex]!
      let x = Math.floor((canvasWidth - rowWidths[rankIndex]!) / 2)
      for (const node of nodes) {
        const size = sizes.get(node.id)!
        const top = y + Math.floor((rowHeight - size.height) / 2)
        bounds.set(node.id, {
          id: node.id,
          ...size,
          left: x,
          top,
          centerX: x + Math.floor(size.width / 2),
          centerY: top + Math.floor(size.height / 2),
        })
        x += size.width + rankNodeGap
      }
      y += rowHeight + minRankGap
    }
  }

  const maxX = Math.max(0, ...[...bounds.values()].map((bound) => bound.left + bound.width))
  const maxY = Math.max(0, ...[...bounds.values()].map((bound) => bound.top + bound.height))
  const grid = new DiagramCanvas<FlowchartCellStyle>(maxX + 4, maxY + 4, { mergeCell: mergeFlowchartCell })
  return { diagram, bounds, grid }
}

function edgeDirections(char: string): Set<EdgeDirection> {
  switch (char) {
    case "─":
      return new Set(["left", "right"])
    case "│":
      return new Set(["up", "down"])
    case "┌":
      return new Set(["right", "down"])
    case "┐":
      return new Set(["left", "down"])
    case "└":
      return new Set(["up", "right"])
    case "┘":
      return new Set(["up", "left"])
    case "├":
      return new Set(["up", "down", "right"])
    case "┤":
      return new Set(["up", "down", "left"])
    case "┬":
      return new Set(["left", "right", "down"])
    case "┴":
      return new Set(["left", "right", "up"])
    case "┼":
      return new Set(["up", "down", "left", "right"])
    default:
      return new Set()
  }
}

function edgeGlyph(directions: Set<EdgeDirection>): string {
  const up = directions.has("up")
  const down = directions.has("down")
  const left = directions.has("left")
  const right = directions.has("right")
  if (up && down && left && right) return "┼"
  if (up && down && right) return "├"
  if (up && down && left) return "┤"
  if (left && right && down) return "┬"
  if (left && right && up) return "┴"
  if (up && right) return "└"
  if (up && left) return "┘"
  if (down && right) return "┌"
  if (down && left) return "┐"
  if (up || down) return "│"
  return "─"
}

function mergeFlowchartCell(
  existing: DiagramCanvasCell<FlowchartCellStyle>,
  incoming: DiagramCanvasCell<FlowchartCellStyle>,
): DiagramCanvasCell<FlowchartCellStyle> {
  if (incoming.style !== "edge") return incoming
  if (existing.style === "label") return existing
  if (existing.style !== "edge" || existing.char === " ") return incoming
  if (EDGE_ARROWS.has(existing.char) || EDGE_ARROWS.has(incoming.char)) return incoming

  const directions = edgeDirections(existing.char)
  for (const direction of edgeDirections(incoming.char)) directions.add(direction)
  return { ...incoming, char: edgeGlyph(directions) } as DiagramCanvasCell<FlowchartCellStyle>
}

function drawNode(
  grid: FlowchartGrid,
  node: FlowchartNode,
  bounds: FlowchartNodeBounds,
  borderStyle: BorderStyle,
): void {
  const chars = BorderChars[borderStyle]
  const style: FlowchartCellStyle = node.shape === "database" ? "database" : "node"

  grid.setCell(bounds.left, bounds.top, chars.topLeft, style)
  grid.setCell(bounds.left + bounds.width - 1, bounds.top, chars.topRight, style)
  grid.setCell(bounds.left, bounds.top + bounds.height - 1, chars.bottomLeft, style)
  grid.setCell(bounds.left + bounds.width - 1, bounds.top + bounds.height - 1, chars.bottomRight, style)
  for (let x = bounds.left + 1; x < bounds.left + bounds.width - 1; x++) {
    grid.setCell(x, bounds.top, chars.horizontal, style)
    grid.setCell(x, bounds.top + bounds.height - 1, chars.horizontal, style)
  }
  for (let y = bounds.top + 1; y < bounds.top + bounds.height - 1; y++) {
    grid.setCell(bounds.left, y, chars.vertical, style)
    grid.setCell(bounds.left + bounds.width - 1, y, chars.vertical, style)
  }

  for (const [index, line] of bounds.lines.entries()) {
    const lineX = bounds.left + Math.max(1, Math.floor((bounds.width - visualLength(line)) / 2))
    grid.setText(lineX, bounds.top + 1 + index, line, style)
  }
}

function arrowHead(fromX: number, fromY: number, toX: number, toY: number): string {
  const dx = toX - fromX
  const dy = toY - fromY
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "▶" : "◀"
  return dy >= 0 ? "▼" : "▲"
}

interface FlowchartPoint {
  x: number
  y: number
}

function appendPoint(points: FlowchartPoint[], point: FlowchartPoint): void {
  const previous = points[points.length - 1]
  if (previous && previous.x === point.x && previous.y === point.y) return
  points.push(point)
}

function orthogonalEdgePath(startX: number, startY: number, endX: number, endY: number): FlowchartPoint[] {
  const points: FlowchartPoint[] = [{ x: startX, y: startY }]
  if (startX === endX || startY === endY) {
    appendPoint(points, { x: endX, y: endY })
    return points
  }

  if (Math.abs(endX - startX) >= Math.abs(endY - startY)) {
    const direction = endX > startX ? 1 : -1
    const midX = endX - direction * Math.min(4, Math.max(1, Math.abs(endX - startX) - 1))
    appendPoint(points, { x: midX, y: startY })
    appendPoint(points, { x: midX, y: endY })
  } else {
    const direction = endY > startY ? 1 : -1
    const midY = endY - direction * Math.min(4, Math.max(1, Math.abs(endY - startY) - 1))
    appendPoint(points, { x: startX, y: midY })
    appendPoint(points, { x: endX, y: midY })
  }

  appendPoint(points, { x: endX, y: endY })
  return points
}

function verticalBackEdgePath(from: FlowchartNodeBounds, to: FlowchartNodeBounds): FlowchartPoint[] {
  const startX = from.left + from.width
  const endX = to.left + to.width
  const laneX = Math.max(startX, endX) + 3
  return [
    { x: startX, y: from.centerY },
    { x: laneX, y: from.centerY },
    { x: laneX, y: to.centerY },
    { x: endX, y: to.centerY },
  ]
}

function verticalForwardEdgePath(from: FlowchartNodeBounds, to: FlowchartNodeBounds): FlowchartPoint[] {
  const downward = to.centerY >= from.centerY
  const startX = Math.abs(from.centerX - to.centerX) <= 1 ? to.centerX : from.centerX
  const startY = downward ? from.top + from.height : from.top - 1
  const endX = to.centerX
  const endY = downward ? to.top - 1 : to.top + to.height
  const points: FlowchartPoint[] = [{ x: startX, y: startY }]

  if (startX === endX || startY === endY) {
    appendPoint(points, { x: endX, y: endY })
    return points
  }

  const direction = endY > startY ? 1 : -1
  const midY = endY - direction * Math.min(4, Math.max(1, Math.abs(endY - startY) - 1))
  appendPoint(points, { x: startX, y: midY })
  appendPoint(points, { x: endX, y: midY })
  appendPoint(points, { x: endX, y: endY })
  return points
}

function horizontalPort(bounds: FlowchartNodeBounds, side: "left" | "right"): FlowchartPoint {
  return { x: side === "right" ? bounds.left + bounds.width : bounds.left - 1, y: bounds.centerY }
}

function horizontalEdgePath(
  from: FlowchartNodeBounds,
  to: FlowchartNodeBounds,
  direction: FlowchartDirection,
): FlowchartPoint[] {
  const rightward = direction === "RL" ? to.centerX > from.centerX : to.centerX >= from.centerX
  const start = horizontalPort(from, rightward ? "right" : "left")
  const end = horizontalPort(to, rightward ? "left" : "right")
  return orthogonalEdgePath(start.x, start.y, end.x, end.y)
}

function edgePath(from: FlowchartNodeBounds, to: FlowchartNodeBounds, direction: FlowchartDirection): FlowchartPoint[] {
  const vertical = direction === "TB" || direction === "TD" || direction === "BT"
  if (vertical) {
    const backEdge = direction === "BT" ? to.centerY > from.centerY : to.centerY < from.centerY
    return backEdge ? verticalBackEdgePath(from, to) : verticalForwardEdgePath(from, to)
  }

  return horizontalEdgePath(from, to, direction)
}

function directionBetween(from: FlowchartPoint, to: FlowchartPoint): EdgeDirection | undefined {
  if (to.x > from.x) return "right"
  if (to.x < from.x) return "left"
  if (to.y > from.y) return "down"
  if (to.y < from.y) return "up"
  return undefined
}

function cornerGlyph(previous: FlowchartPoint, current: FlowchartPoint, next: FlowchartPoint): string {
  const fromDirection = directionBetween(current, previous)
  const toDirection = directionBetween(current, next)
  const directions = new Set<EdgeDirection>()
  if (fromDirection) directions.add(fromDirection)
  if (toDirection) directions.add(toDirection)
  return edgeGlyph(directions)
}

function drawSegment(grid: FlowchartGrid, from: FlowchartPoint, to: FlowchartPoint, includeStart: boolean): void {
  const direction = directionBetween(from, to)
  if (!direction) return
  const glyph = direction === "left" || direction === "right" ? "─" : "│"
  const dx = direction === "right" ? 1 : direction === "left" ? -1 : 0
  const dy = direction === "down" ? 1 : direction === "up" ? -1 : 0
  let x = includeStart ? from.x : from.x + dx
  let y = includeStart ? from.y : from.y + dy

  while (x !== to.x || y !== to.y) {
    grid.setCell(x, y, glyph, "edge")
    x += dx
    y += dy
  }
}

function drawEdgePath(grid: FlowchartGrid, points: FlowchartPoint[]): void {
  for (let index = 1; index < points.length; index++) {
    drawSegment(grid, points[index - 1]!, points[index]!, index === 1)
  }

  for (let index = 1; index < points.length - 1; index++) {
    const previous = points[index - 1]!
    const current = points[index]!
    const next = points[index + 1]!
    grid.setCell(current.x, current.y, cornerGlyph(previous, current, next), "edge")
  }
}

function labelPoint(points: FlowchartPoint[], label: string, direction: FlowchartDirection): FlowchartPoint {
  const labelWidth = visualLength(label)
  const vertical = direction === "TB" || direction === "TD" || direction === "BT"
  let selected = { from: points[0]!, to: points[points.length - 1]!, length: 0, horizontal: false }

  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1]!
    const to = points[index]!
    const length = Math.abs(to.x - from.x) + Math.abs(to.y - from.y)
    const horizontal = from.y === to.y
    if (horizontal && length >= labelWidth + 1) {
      selected = { from, to, length, horizontal }
      break
    }
    if (length > selected.length) selected = { from, to, length, horizontal }
  }

  if (selected.horizontal) {
    const left = Math.min(selected.from.x, selected.to.x)
    const right = Math.max(selected.from.x, selected.to.x)
    return {
      x: Math.max(left, Math.min(right - labelWidth + 1, left + Math.floor((selected.length - labelWidth) / 2))),
      y: vertical ? Math.max(0, selected.from.y - 1) : selected.from.y,
    }
  }

  return {
    x: Math.round((selected.from.x + selected.to.x) / 2) + 1,
    y: Math.round((selected.from.y + selected.to.y) / 2),
  }
}

function drawRoutedEdge(
  grid: FlowchartGrid,
  edge: FlowchartEdge,
  points: FlowchartPoint[],
  direction: FlowchartDirection,
): void {
  if (points.length < 2) return

  drawEdgePath(grid, points)
  const end = points[points.length - 1]!
  const arrowFrom = points[points.length - 2]!
  grid.setCell(end.x, end.y, arrowHead(arrowFrom.x, arrowFrom.y, end.x, end.y), "edge")
  if (edge.label) {
    const point = labelPoint(points, edge.label, direction)
    grid.setText(point.x, point.y, edge.label, "label")
  }
}

function drawEdge(
  grid: FlowchartGrid,
  edge: FlowchartEdge,
  bounds: Map<string, FlowchartNodeBounds>,
  direction: FlowchartDirection,
): void {
  const from = bounds.get(edge.from)
  const to = bounds.get(edge.to)
  if (!from || !to) return

  drawRoutedEdge(grid, edge, edgePath(from, to, direction), direction)
}

function forwardHorizontalEdge(
  edge: FlowchartEdge,
  bounds: Map<string, FlowchartNodeBounds>,
  direction: FlowchartDirection,
): boolean {
  const from = bounds.get(edge.from)
  const to = bounds.get(edge.to)
  if (!from || !to) return false
  return direction === "RL" ? to.centerX < from.centerX : to.centerX > from.centerX
}

function drawHorizontalFanOut(
  grid: FlowchartGrid,
  edges: FlowchartEdge[],
  bounds: Map<string, FlowchartNodeBounds>,
  direction: FlowchartDirection,
  handled: Set<FlowchartEdge>,
): void {
  const bySource = new Map<string, FlowchartEdge[]>()
  for (const edge of edges) {
    if (!forwardHorizontalEdge(edge, bounds, direction)) continue
    const list = bySource.get(edge.from) ?? []
    list.push(edge)
    bySource.set(edge.from, list)
  }

  for (const [sourceId, sourceEdges] of bySource) {
    if (sourceEdges.length < 2) continue
    const source = bounds.get(sourceId)
    if (!source) continue

    const rightward = direction !== "RL"
    const sourcePort = horizontalPort(source, rightward ? "right" : "left")
    const targetPorts = sourceEdges
      .map((edge) => bounds.get(edge.to))
      .filter((bound): bound is FlowchartNodeBounds => Boolean(bound))
      .map((target) => horizontalPort(target, rightward ? "left" : "right"))
    if (targetPorts.length < 2) continue

    const nearestTargetX = rightward
      ? Math.min(...targetPorts.map((point) => point.x))
      : Math.max(...targetPorts.map((point) => point.x))
    const preferredBusX = sourcePort.x + (rightward ? 3 : -3)
    const busX = rightward ? Math.min(preferredBusX, nearestTargetX - 2) : Math.max(preferredBusX, nearestTargetX + 2)

    for (const edge of sourceEdges) {
      const target = bounds.get(edge.to)
      if (!target) continue
      const targetPort = horizontalPort(target, rightward ? "left" : "right")
      drawRoutedEdge(
        grid,
        edge,
        [sourcePort, { x: busX, y: sourcePort.y }, { x: busX, y: targetPort.y }, targetPort],
        direction,
      )
      handled.add(edge)
    }
  }
}

function drawHorizontalFanIn(
  grid: FlowchartGrid,
  edges: FlowchartEdge[],
  bounds: Map<string, FlowchartNodeBounds>,
  direction: FlowchartDirection,
  handled: Set<FlowchartEdge>,
): void {
  const byTarget = new Map<string, FlowchartEdge[]>()
  for (const edge of edges) {
    if (!forwardHorizontalEdge(edge, bounds, direction)) continue
    const list = byTarget.get(edge.to) ?? []
    list.push(edge)
    byTarget.set(edge.to, list)
  }

  for (const [targetId, targetEdges] of byTarget) {
    if (targetEdges.length < 2) continue
    const target = bounds.get(targetId)
    if (!target) continue

    const rightward = direction !== "RL"
    const targetPort = horizontalPort(target, rightward ? "left" : "right")
    const sourcePorts = targetEdges
      .map((edge) => bounds.get(edge.from))
      .filter((bound): bound is FlowchartNodeBounds => Boolean(bound))
      .map((source) => horizontalPort(source, rightward ? "right" : "left"))
    if (sourcePorts.length < 2) continue

    const nearestSourceX = rightward
      ? Math.max(...sourcePorts.map((point) => point.x))
      : Math.min(...sourcePorts.map((point) => point.x))
    const preferredBusX = targetPort.x + (rightward ? -3 : 3)
    const busX = rightward ? Math.max(preferredBusX, nearestSourceX + 2) : Math.min(preferredBusX, nearestSourceX - 2)

    for (const edge of targetEdges) {
      const source = bounds.get(edge.from)
      if (!source) continue
      const sourcePort = horizontalPort(source, rightward ? "right" : "left")
      drawRoutedEdge(
        grid,
        edge,
        [sourcePort, { x: busX, y: sourcePort.y }, { x: busX, y: targetPort.y }, targetPort],
        direction,
      )
      handled.add(edge)
    }
  }
}

function drawFlowchartEdges(
  grid: FlowchartGrid,
  diagram: FlowchartDiagram,
  bounds: Map<string, FlowchartNodeBounds>,
): void {
  const handled = new Set<FlowchartEdge>()
  if (diagram.direction === "LR" || diagram.direction === "RL") {
    drawHorizontalFanOut(grid, diagram.edges, bounds, diagram.direction, handled)
    drawHorizontalFanIn(grid, diagram.edges, bounds, diagram.direction, handled)
  }

  for (const edge of diagram.edges) {
    if (!handled.has(edge)) drawEdge(grid, edge, bounds, diagram.direction)
  }
}

function sourceConnector(
  from: FlowchartNodeBounds,
  to: FlowchartNodeBounds,
  direction: FlowchartDirection,
): { x: number; y: number; char: string } {
  if (direction === "LR" || direction === "RL") {
    const rightward = direction === "RL" ? to.centerX > from.centerX : to.centerX >= from.centerX
    return {
      x: rightward ? from.left + from.width - 1 : from.left,
      y: from.centerY,
      char: rightward ? "├" : "┤",
    }
  }

  const backEdge = direction === "BT" ? to.centerY > from.centerY : to.centerY < from.centerY
  if (backEdge) return { x: from.left + from.width - 1, y: from.centerY, char: "├" }

  const downward = to.centerY >= from.centerY
  return {
    x: from.centerX,
    y: downward ? from.top + from.height - 1 : from.top,
    char: downward ? "┬" : "┴",
  }
}

function drawSourceConnectors(
  grid: FlowchartGrid,
  diagram: FlowchartDiagram,
  bounds: Map<string, FlowchartNodeBounds>,
): void {
  for (const edge of diagram.edges) {
    const from = bounds.get(edge.from)
    const to = bounds.get(edge.to)
    if (!from || !to) continue
    const connector = sourceConnector(from, to, diagram.direction)
    grid.setCell(connector.x, connector.y, connector.char, "edge")
  }
}

function renderFlowchartGrid(content: string, options: FlowchartDiagramRenderOptions = {}): FlowchartGrid {
  const borderStyle = options.borderStyle ?? DEFAULT_BORDER_STYLE
  const { diagram, bounds, grid } = layoutFlowchartDiagram(content, options)

  drawFlowchartEdges(grid, diagram, bounds)
  for (const node of diagram.nodes) {
    const bound = bounds.get(node.id)
    if (bound) drawNode(grid, node, bound, borderStyle)
  }
  drawSourceConnectors(grid, diagram, bounds)

  return grid
}

function renderGridText(grid: FlowchartGrid): string {
  return grid.toString({ trimBottom: true })
}

function styleColor(style: FlowchartCellStyle | undefined, colors: FlowchartStyleColors): RGBA | undefined {
  return style ? colors[style] : undefined
}

function resolveFlowchartStyleColors(
  colors: Partial<Record<FlowchartCellStyle, RGBA | undefined>> = {},
): FlowchartStyleColors {
  return {
    node: colors.node ?? rgba(DEFAULT_THEME_RGB.node),
    database: colors.database ?? rgba(DEFAULT_THEME_RGB.database),
    edge: colors.edge ?? rgba(DEFAULT_THEME_RGB.edge),
    label: colors.label ?? rgba(DEFAULT_THEME_RGB.label),
  }
}

function renderGridStyledText(grid: FlowchartGrid, colors: FlowchartStyleColors): StyledText {
  const chunks: TextChunk[] = []
  grid.forEachRun(
    (run) => {
      chunks.push({ __isChunk: true, text: run.text, fg: styleColor(run.style, colors) })
    },
    () => chunks.push({ __isChunk: true, text: "\n" }),
  )
  return new StyledText(chunks)
}

function renderGridAnsi(grid: FlowchartGrid, theme: FlowchartDiagramAnsiTheme = {}): string {
  const resolved = { ...DEFAULT_ANSI_THEME, ...theme }
  let output = ""
  grid.forEachRun(
    (run) => {
      const ansi = run.style ? resolved[run.style] : undefined
      output += ansi ? `${ansi}${run.text}${ANSI.reset}` : run.text
    },
    () => {
      output += "\n"
    },
  )
  return output
}

function colorsEqual(left?: RGBA, right?: RGBA): boolean {
  if (!left || !right) return left === right
  return left.equals(right)
}

export function renderFlowchartDiagram(content: string, options: FlowchartDiagramRenderOptions = {}): string {
  return renderGridText(renderFlowchartGrid(content, options))
}

export function renderFlowchartDiagramAnsi(content: string, options: FlowchartDiagramAnsiOptions = {}): string {
  return renderGridAnsi(renderFlowchartGrid(content, options), options.theme)
}

export class FlowchartDiagramRenderable extends TextBufferRenderable {
  private _content: string
  private _direction?: FlowchartDirection
  private _borderStyle: BorderStyle
  private _minNodeGap: number
  private _minRankGap: number
  private _nodeColor?: RGBA
  private _databaseColor?: RGBA
  private _edgeColor?: RGBA
  private _labelColor?: RGBA
  private _batchDepth = 0
  private _needsUpdate = false

  constructor(ctx: RenderContext, options: FlowchartDiagramOptions = {}) {
    super(ctx, { ...options, wrapMode: options.wrapMode ?? "none" })
    this._content = options.content ?? ""
    this._direction = options.direction
    this._borderStyle = options.borderStyle ?? DEFAULT_BORDER_STYLE
    this._minNodeGap = normalizePositiveInt(options.minNodeGap, DEFAULT_MIN_NODE_GAP)
    this._minRankGap = normalizePositiveInt(options.minRankGap, DEFAULT_MIN_RANK_GAP)
    this._nodeColor = options.nodeColor ? parseColor(options.nodeColor) : undefined
    this._databaseColor = options.databaseColor ? parseColor(options.databaseColor) : undefined
    this._edgeColor = options.edgeColor ? parseColor(options.edgeColor) : undefined
    this._labelColor = options.labelColor ? parseColor(options.labelColor) : undefined
    this.updateDiagram()
  }

  get content(): string {
    return this._content
  }

  set content(value: string) {
    if (this._content === value) return
    this._content = value
    this.invalidateDiagram()
  }

  set direction(value: FlowchartDirection | undefined) {
    if (this._direction === value) return
    this._direction = value
    this.invalidateDiagram()
  }

  set borderStyle(value: BorderStyle | undefined) {
    const next = value ?? DEFAULT_BORDER_STYLE
    if (this._borderStyle === next) return
    this._borderStyle = next
    this.invalidateDiagram()
  }

  private setColor(
    current: RGBA | undefined,
    value: ColorInput | undefined,
    assign: (color: RGBA | undefined) => void,
  ): void {
    const next = value ? parseColor(value) : undefined
    if (colorsEqual(current, next)) return
    assign(next)
    this.invalidateDiagram()
  }

  set nodeColor(value: ColorInput | undefined) {
    this.setColor(this._nodeColor, value, (color) => (this._nodeColor = color))
  }

  set databaseColor(value: ColorInput | undefined) {
    this.setColor(this._databaseColor, value, (color) => (this._databaseColor = color))
  }

  set edgeColor(value: ColorInput | undefined) {
    this.setColor(this._edgeColor, value, (color) => (this._edgeColor = color))
  }

  set labelColor(value: ColorInput | undefined) {
    this.setColor(this._labelColor, value, (color) => (this._labelColor = color))
  }

  batchUpdate(update: () => void): void {
    this._batchDepth += 1
    try {
      update()
    } finally {
      this._batchDepth -= 1
      if (this._batchDepth === 0 && this._needsUpdate) {
        this._needsUpdate = false
        this.updateDiagram()
      }
    }
  }

  private invalidateDiagram(): void {
    if (this._batchDepth > 0) {
      this._needsUpdate = true
      return
    }
    this.updateDiagram()
  }

  private updateDiagram(): void {
    const grid = renderFlowchartGrid(this._content, {
      direction: this._direction,
      borderStyle: this._borderStyle,
      minNodeGap: this._minNodeGap,
      minRankGap: this._minRankGap,
    })
    this.textBuffer.setStyledText(
      renderGridStyledText(
        grid,
        resolveFlowchartStyleColors({
          node: this._nodeColor,
          database: this._databaseColor,
          edge: this._edgeColor,
          label: this._labelColor,
        }),
      ),
    )
    this.updateTextInfo()
    this.requestRender()
  }
}
