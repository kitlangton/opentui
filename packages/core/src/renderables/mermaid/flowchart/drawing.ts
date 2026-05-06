import { BorderChars, type BorderStyle } from "../../../lib/border.js"
import { orthogonalPathPoints, walkOrthogonalSegment } from "../../diagram-geometry.js"
import { DiagramCanvas, type DiagramCanvasCell } from "../../diagram-canvas.js"
import { diagramPulseLevel, visitDiagramPulsePath } from "../../diagram-pulse.js"
import {
  DIAGRAM_ARROW_HEADS,
  diagramArrowHeadBetween,
  diagramDiamondCharactersFromBorder,
  drawDiagramDiamond,
  drawDiagramFrame,
  drawOrthogonalPath,
  mergeDiagramLineGlyph,
} from "../../diagram-drawing.js"
import { layoutFlowchartDiagram, visualLength } from "./layout.js"
import { flowchartEdgeLabelLayout } from "./labels.js"
import {
  normalizeFlowchartPulseFrame,
  normalizeFlowchartPulseGap,
  normalizeFlowchartPulseLength,
  normalizeFlowchartPulseProgress,
  type FlowchartDiagramRenderOptions,
} from "./options.js"
import { flowchartDirectionBetween, flowchartSourceConnector } from "./routing.js"
import {
  DATABASE_EDGE_FADE_STYLES,
  EDGE_PULSE_STYLES,
  NODE_EDGE_FADE_STYLES,
  type FlowchartCellStyle,
  type FlowchartEdgeFadeStyle,
  type FlowchartEdgePulseStyle,
  type FlowchartGrid,
} from "./style.js"
import type {
  FlowchartDiagram,
  FlowchartEdgeRoute,
  FlowchartNode,
  FlowchartNodeBounds,
  FlowchartPoint,
  FlowchartSubgraphBounds,
} from "./types.js"

export const DEFAULT_BORDER_STYLE = "rounded" satisfies BorderStyle
const EDGE_DRAWING_STYLES = new Set<FlowchartCellStyle>([
  "edge",
  "label",
  ...NODE_EDGE_FADE_STYLES,
  ...DATABASE_EDGE_FADE_STYLES,
  ...EDGE_PULSE_STYLES,
])

function mergeFlowchartCell(
  existing: DiagramCanvasCell<FlowchartCellStyle>,
  incoming: DiagramCanvasCell<FlowchartCellStyle>,
): DiagramCanvasCell<FlowchartCellStyle> {
  if (incoming.style !== "edge") return incoming
  if (existing.style === "label") return existing
  if (existing.style !== "edge" || existing.char === " ") return incoming
  if (DIAGRAM_ARROW_HEADS.has(existing.char) || DIAGRAM_ARROW_HEADS.has(incoming.char)) return incoming

  return {
    ...incoming,
    char: mergeDiagramLineGlyph(existing.char, incoming.char) ?? incoming.char,
  } as DiagramCanvasCell<FlowchartCellStyle>
}

function drawNode(
  grid: FlowchartGrid,
  node: FlowchartNode,
  bounds: FlowchartNodeBounds,
  borderStyle: BorderStyle,
): void {
  const chars = BorderChars[borderStyle]
  const style: FlowchartCellStyle = node.shape === "database" ? "database" : "node"

  if (node.shape === "decision") {
    drawDiagramDiamond(
      bounds,
      (x, y, char) => grid.setCell(x, y, char, style),
      diagramDiamondCharactersFromBorder(chars),
    )
  } else {
    drawDiagramFrame(bounds, chars, (x, y, char) => grid.setCell(x, y, char, style))
  }

  const textTop =
    node.shape === "decision" ? bounds.top + Math.floor((bounds.height - bounds.lines.length) / 2) : bounds.top + 1
  for (const [index, line] of bounds.lines.entries()) {
    const lineX = bounds.left + Math.max(1, Math.floor((bounds.width - visualLength(line)) / 2))
    grid.setText(lineX, textTop + index, line, style)
  }
}

function drawSubgraph(grid: FlowchartGrid, bounds: FlowchartSubgraphBounds, borderStyle: BorderStyle): void {
  const chars = BorderChars[borderStyle]
  drawDiagramFrame(bounds, chars, (x, y, char) => grid.setCell(x, y, char, "group"))
  if (bounds.label) {
    const labelY = bounds.labelSide === "top" ? bounds.top : bounds.top + bounds.height - 1
    grid.setText(bounds.left + 2, labelY, ` ${bounds.label} `, "group")
  }
}

function drawRoutedEdge(grid: FlowchartGrid, route: FlowchartEdgeRoute): void {
  const { edge, points } = route
  if (points.length < 2) return

  drawOrthogonalPath(points, (x, y, char) => grid.setCell(x, y, char, "edge"))
  const end = points[points.length - 1]!
  const arrowFrom = points[points.length - 2]!
  grid.setCell(end.x, end.y, diagramArrowHeadBetween(arrowFrom, end), "edge")
  if (edge.label) {
    const label = flowchartEdgeLabelLayout(points, edge.label, visualLength)
    grid.setText(label.point.x, label.point.y, label.text, "label")
  }
}

function flowchartPulseStyleLevel(style: FlowchartCellStyle | undefined): number {
  if (!style) return 0
  const index = (EDGE_PULSE_STYLES as readonly FlowchartCellStyle[]).indexOf(style)
  return index >= 0 ? index + 1 : 0
}

function flowchartPulseCellStyle(
  distance: number,
  radius: number,
  edgeDistance: number,
  char: string,
): { style: FlowchartEdgePulseStyle; level: number } {
  const level = diagramPulseLevel(distance, radius, edgeDistance, char === "─" || char === "│")
  return { style: EDGE_PULSE_STYLES[level - 1]!, level }
}

function isFlowchartPulseTargetStyle(style: FlowchartCellStyle | undefined): boolean {
  return style ? EDGE_DRAWING_STYLES.has(style) : false
}

function setFlowchartPulseCell(
  grid: FlowchartGrid,
  x: number,
  y: number,
  distance: number,
  radius: number,
  edgeDistance: number,
): void {
  const cell = grid.rows[y]?.[x]
  if (!cell || cell.char === " " || !isFlowchartPulseTargetStyle(cell.style)) return

  const pulse = flowchartPulseCellStyle(distance, radius, edgeDistance, cell.char)
  if (flowchartPulseStyleLevel(cell.style) > pulse.level) return
  cell.style = pulse.style
}

function drawEdgePulse(
  grid: FlowchartGrid,
  routes: readonly FlowchartEdgeRoute[],
  pulseFrame: number | undefined,
  pulseProgress: number | undefined,
  pulseLength: number,
  pulseGap: number,
): void {
  if (pulseFrame === undefined && pulseProgress === undefined) return
  const paths = routes.map((route) => orthogonalPathPoints(route.points))
  const pathLength = paths.reduce((total, path) => total + path.length, 0)
  if (pathLength === 0) return

  visitDiagramPulsePath({
    pathLength,
    pointAt: (index) => {
      let offset = index
      for (const path of paths) {
        if (offset < path.length) {
          const point = path[offset]!
          return [point.x, point.y]
        }
        offset -= path.length
      }
      return undefined
    },
    pulseFrame,
    pulseProgress,
    pulseLength,
    pulseGap,
    visit: ([x, y], distance, radius, edgeDistance) =>
      setFlowchartPulseCell(grid, x, y, distance, radius, edgeDistance),
  })
}

function flowchartNodeStyle(node: FlowchartNode | undefined): "node" | "database" {
  return node?.shape === "database" ? "database" : "node"
}

function sourceFadeStyles(sourceStyle: "node" | "database"): readonly FlowchartEdgeFadeStyle[] {
  return sourceStyle === "database" ? DATABASE_EDGE_FADE_STYLES : NODE_EDGE_FADE_STYLES
}

function styleExistingEdgeCell(grid: FlowchartGrid, x: number, y: number, style: FlowchartEdgeFadeStyle): boolean {
  const cell = grid.rows[y]?.[x]
  if (!cell || cell.char === " " || cell.style === "label" || DIAGRAM_ARROW_HEADS.has(cell.char)) return false
  grid.setCell(x, y, cell.char, style)
  return true
}

function fadeSourcePath(
  grid: FlowchartGrid,
  points: FlowchartPoint[],
  styles: readonly FlowchartEdgeFadeStyle[],
): void {
  let styleIndex = 1
  const seen = new Set<string>()

  for (let index = 1; index < points.length && styleIndex < styles.length; index++) {
    const from = points[index - 1]!
    const to = points[index]!
    const direction = flowchartDirectionBetween(from, to)
    if (!direction) continue
    walkOrthogonalSegment(from, to, index === 1, (point) => {
      if (styleIndex >= styles.length) return false
      const key = `${point.x}:${point.y}`
      if (!seen.has(key)) {
        seen.add(key)
        if (styleExistingEdgeCell(grid, point.x, point.y, styles[styleIndex]!)) styleIndex += 1
      }
      return styleIndex < styles.length
    })
  }
}

function drawSourceConnectors(
  grid: FlowchartGrid,
  diagram: FlowchartDiagram,
  bounds: Map<string, FlowchartNodeBounds>,
  routes: readonly FlowchartEdgeRoute[],
): void {
  const nodesById = new Map(diagram.nodes.map((node) => [node.id, node]))

  for (const route of routes) {
    const from = bounds.get(route.edge.from)
    const sourcePoint = route.points[0]
    if (!from || !sourcePoint) continue
    const styles = sourceFadeStyles(flowchartNodeStyle(nodesById.get(route.edge.from)))
    const connector = flowchartSourceConnector(from, sourcePoint)
    grid.setCell(connector.x, connector.y, connector.char, styles[0])
    fadeSourcePath(grid, route.points, styles)
  }
}

export function renderFlowchartGrid(content: string, options: FlowchartDiagramRenderOptions = {}): FlowchartGrid {
  const borderStyle = options.borderStyle ?? DEFAULT_BORDER_STYLE
  const pulseFrame = normalizeFlowchartPulseFrame(options.pulseFrame)
  const pulseProgress = normalizeFlowchartPulseProgress(options.pulseProgress)
  const pulseLength = normalizeFlowchartPulseLength(options.pulseLength)
  const pulseGap = normalizeFlowchartPulseGap(options.pulseGap)
  const { diagram, bounds, routes, subgraphBounds, width, height } = layoutFlowchartDiagram(content, options)
  const grid = new DiagramCanvas<FlowchartCellStyle>(width, height, { mergeCell: mergeFlowchartCell })

  for (const subgraph of diagram.subgraphs ?? []) {
    const bound = subgraphBounds.get(subgraph.id)
    if (bound) drawSubgraph(grid, bound, borderStyle)
  }
  for (const route of routes) drawRoutedEdge(grid, route)
  for (const node of diagram.nodes) {
    const bound = bounds.get(node.id)
    if (bound) drawNode(grid, node, bound, borderStyle)
  }
  drawSourceConnectors(grid, diagram, bounds, routes)
  drawEdgePulse(grid, routes, pulseFrame, pulseProgress, pulseLength, pulseGap)

  return grid
}

export function renderGridText(grid: FlowchartGrid): string {
  return grid.toString({ trimBottom: true })
}
