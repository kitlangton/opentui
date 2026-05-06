import { BorderChars, type BorderCharacters, type BorderStyle } from "../../../lib/border.js"
import { orthogonalPathPoints, walkOrthogonalSegment } from "../../diagram-geometry.js"
import { DiagramCanvas, type DiagramCanvasCell } from "../../diagram-canvas.js"
import { diagramPulseLevel, visitDiagramPulsePath } from "../../diagram-pulse.js"
import {
  DIAGRAM_ARROW_HEADS,
  diagramArrowHeadBetween,
  diagramDiamondCharactersFromBorder,
  diagramLineGlyph,
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
  flowchartNodeColorKey,
  NODE_EDGE_FADE_STYLES,
  type FlowchartCellStyle,
  type FlowchartCellMetadata,
  type FlowchartEdgeFadeStyle,
  type FlowchartEdgePulseStyle,
  type FlowchartGrid,
} from "./style.js"
import type {
  FlowchartDiagram,
  FlowchartActiveEdgeSelection,
  FlowchartEdgeRoute,
  FlowchartNode,
  FlowchartNodeBounds,
  FlowchartPoint,
  FlowchartSubgraphBounds,
} from "./types.js"

export const DEFAULT_BORDER_STYLE = "rounded" satisfies BorderStyle
const ACTIVE_EDGE_FRONTIER_ACTIVE_SIDE = 2
const ACTIVE_EDGE_FRONTIER_INACTIVE_SIDE = 5
const EDGE_DRAWING_STYLES = new Set<FlowchartCellStyle>([
  "edge",
  "activeEdge",
  "label",
  ...NODE_EDGE_FADE_STYLES,
  ...DATABASE_EDGE_FADE_STYLES,
  ...EDGE_PULSE_STYLES,
])

function mergeFlowchartCell(
  existing: DiagramCanvasCell<FlowchartCellStyle, FlowchartCellMetadata>,
  incoming: DiagramCanvasCell<FlowchartCellStyle, FlowchartCellMetadata>,
): DiagramCanvasCell<FlowchartCellStyle, FlowchartCellMetadata> {
  if (incoming.style !== "edge" && incoming.style !== "activeEdge") return incoming
  if (existing.style === "label") return existing
  if (incoming.char === " ") return existing
  if ((existing.style !== "edge" && existing.style !== "activeEdge") || existing.char === " ") return incoming
  if (DIAGRAM_ARROW_HEADS.has(existing.char) || DIAGRAM_ARROW_HEADS.has(incoming.char)) return incoming

  return {
    ...incoming,
    char: mergeDiagramLineGlyph(existing.char, incoming.char, "rounded") ?? incoming.char,
  } as DiagramCanvasCell<FlowchartCellStyle, FlowchartCellMetadata>
}

function setNodeText(
  grid: FlowchartGrid,
  bounds: FlowchartNodeBounds,
  nodeId: string,
  x: number,
  y: number,
  text: string,
  style: FlowchartCellStyle,
): void {
  let offset = 0
  for (const char of text) {
    grid.setCell(x + offset, y, char, style, nodeMetadataForCell(bounds, nodeId, x + offset, y))
    offset += visualLength(char)
  }
}

function nodeColorLevelForCell(bounds: FlowchartNodeBounds, x: number, y: number, border = false): number {
  const halfWidth = Math.max(1, (bounds.width - 1) / 2)
  const halfHeight = Math.max(1, (bounds.height - 1) / 2)
  const dx = (x - bounds.centerX) / halfWidth
  const dy = (y - bounds.centerY) / halfHeight
  const distance = Math.sqrt(dx * dx + dy * dy)
  const level = Math.max(0, Math.min(5, Math.round((1 - Math.min(1, distance)) * 5)))
  return border ? Math.min(1, level) : level
}

function nodeMetadataForCell(
  bounds: FlowchartNodeBounds,
  nodeId: string,
  x: number,
  y: number,
  border = false,
): FlowchartCellMetadata {
  const key = flowchartNodeColorKey(nodeId, nodeColorLevelForCell(bounds, x, y, border))
  return { nodeId: key, bgNodeId: key }
}

function fillNodeInterior(
  grid: FlowchartGrid,
  bounds: FlowchartNodeBounds,
  nodeId: string,
  style: FlowchartCellStyle,
): void {
  for (let y = bounds.top + 1; y < bounds.top + bounds.height - 1; y++) {
    for (let x = bounds.left + 1; x < bounds.left + bounds.width - 1; x++) {
      grid.setCell(x, y, " ", style, nodeMetadataForCell(bounds, nodeId, x, y))
    }
  }
}

function drawNode(
  grid: FlowchartGrid,
  node: FlowchartNode,
  bounds: FlowchartNodeBounds,
  borderStyle: BorderStyle,
  active: boolean,
): void {
  const chars = BorderChars[borderStyle]
  const style: FlowchartCellStyle = active ? "activeNode" : node.shape === "database" ? "database" : "node"

  if (node.shape === "decision") {
    drawDiagramDiamond(
      bounds,
      (x, y, char) => grid.setCell(x, y, char, style, nodeMetadataForCell(bounds, node.id, x, y, true)),
      diagramDiamondCharactersFromBorder(chars),
    )
  } else if (node.shape === "subroutine") {
    fillNodeInterior(grid, bounds, node.id, style)
    drawSubroutineNode(grid, bounds, chars, style, node.id)
  } else if (node.shape === "database") {
    fillNodeInterior(grid, bounds, node.id, style)
    drawDatabaseNode(grid, bounds, chars, style, node.id)
  } else {
    fillNodeInterior(grid, bounds, node.id, style)
    drawDiagramFrame(bounds, chars, (x, y, char) =>
      grid.setCell(x, y, char, style, nodeMetadataForCell(bounds, node.id, x, y, true)),
    )
  }

  const textTop =
    node.shape === "decision"
      ? bounds.top + Math.floor((bounds.height - bounds.lines.length) / 2)
      : node.shape === "database"
        ? bounds.top + 2
        : bounds.top + 1
  for (const [index, line] of bounds.lines.entries()) {
    const lineX =
      node.shape === "subroutine"
        ? bounds.left + 3
        : bounds.left + Math.max(1, Math.floor((bounds.width - visualLength(line)) / 2))
    setNodeText(grid, bounds, node.id, lineX, textTop + index, line, style)
  }
}

function drawSubroutineNode(
  grid: FlowchartGrid,
  bounds: FlowchartNodeBounds,
  chars: BorderCharacters,
  style: FlowchartCellStyle,
  nodeId: string,
): void {
  drawDiagramFrame(bounds, chars, (x, y, char) =>
    grid.setCell(x, y, char, style, nodeMetadataForCell(bounds, nodeId, x, y, true)),
  )
  const leftRailX = bounds.left + 2
  const rightRailX = bounds.left + bounds.width - 3
  grid.setCell(
    leftRailX,
    bounds.top,
    chars.topT,
    style,
    nodeMetadataForCell(bounds, nodeId, leftRailX, bounds.top, true),
  )
  grid.setCell(
    rightRailX,
    bounds.top,
    chars.topT,
    style,
    nodeMetadataForCell(bounds, nodeId, rightRailX, bounds.top, true),
  )
  grid.setCell(
    leftRailX,
    bounds.top + bounds.height - 1,
    chars.bottomT,
    style,
    nodeMetadataForCell(bounds, nodeId, leftRailX, bounds.top + bounds.height - 1, true),
  )
  grid.setCell(
    rightRailX,
    bounds.top + bounds.height - 1,
    chars.bottomT,
    style,
    nodeMetadataForCell(bounds, nodeId, rightRailX, bounds.top + bounds.height - 1, true),
  )
  for (let y = bounds.top + 1; y < bounds.top + bounds.height - 1; y++) {
    grid.setCell(leftRailX, y, chars.vertical, style, nodeMetadataForCell(bounds, nodeId, leftRailX, y, true))
    grid.setCell(rightRailX, y, chars.vertical, style, nodeMetadataForCell(bounds, nodeId, rightRailX, y, true))
  }
}

function drawDatabaseNode(
  grid: FlowchartGrid,
  bounds: FlowchartNodeBounds,
  chars: BorderCharacters,
  style: FlowchartCellStyle,
  nodeId: string,
): void {
  drawDiagramFrame(bounds, chars, (x, y, char) =>
    grid.setCell(x, y, char, style, nodeMetadataForCell(bounds, nodeId, x, y, true)),
  )
  const topRailY = bounds.top + 1
  const bottomRailY = bounds.top + bounds.height - 2
  for (const y of [topRailY, bottomRailY]) {
    grid.setCell(bounds.left, y, chars.leftT, style, nodeMetadataForCell(bounds, nodeId, bounds.left, y, true))
    grid.setCell(
      bounds.left + bounds.width - 1,
      y,
      chars.rightT,
      style,
      nodeMetadataForCell(bounds, nodeId, bounds.left + bounds.width - 1, y, true),
    )
    for (let x = bounds.left + 1; x < bounds.left + bounds.width - 1; x++) {
      grid.setCell(x, y, chars.horizontal, style, nodeMetadataForCell(bounds, nodeId, x, y, true))
    }
  }
}

function drawSubgraphFrame(grid: FlowchartGrid, bounds: FlowchartSubgraphBounds, borderStyle: BorderStyle): void {
  const chars = BorderChars[borderStyle]
  drawDiagramFrame(bounds, chars, (x, y, char) => grid.setCell(x, y, char, "group"))
}

function drawSubgraphLabel(grid: FlowchartGrid, bounds: FlowchartSubgraphBounds): void {
  if (bounds.label) {
    const labelY = bounds.labelSide === "top" ? bounds.top : bounds.top + bounds.height - 1
    grid.setText(bounds.left + 2, labelY, ` ${bounds.label} `, "group")
  }
}

function drawRoutedEdge(grid: FlowchartGrid, route: FlowchartEdgeRoute, active = false): void {
  const { edge, points } = route
  if (points.length < 2) return
  const style: FlowchartCellStyle = active ? "activeEdge" : "edge"

  drawOrthogonalPath(points, (x, y, char) => grid.setCell(x, y, char, style), {
    cornerStyle: "rounded",
    lineStyle: edge.style === "thick" ? "heavy" : edge.style === "dashed" ? "dashed" : "single",
  })
  const end = points[points.length - 1]!
  const arrowFrom = points[points.length - 2]!
  grid.setCell(end.x, end.y, diagramArrowHeadBetween(arrowFrom, end), style)
  if (edge.label) {
    const label = flowchartEdgeLabelLayout(points, edge.label, visualLength)
    grid.setText(label.point.x, label.point.y, label.text, active ? "activeEdge" : "label")
  }
}

function activeEdgeMatches(
  route: FlowchartEdgeRoute,
  edgeIndex: number,
  activeEdge: FlowchartActiveEdgeSelection,
): boolean {
  return (
    route.edge.from === activeEdge.from &&
    route.edge.to === activeEdge.to &&
    (activeEdge.index ?? edgeIndex) === edgeIndex
  )
}

function activeRoute(
  routes: readonly FlowchartEdgeRoute[],
  diagram: FlowchartDiagram,
  activeEdge: FlowchartActiveEdgeSelection | undefined,
): FlowchartEdgeRoute | undefined {
  if (!activeEdge) return undefined
  const edgeIndexes = new Map(diagram.edges.map((edge, index) => [edge, index]))
  for (let index = 0; index < routes.length; index++) {
    const route = routes[index]!
    if (activeEdgeMatches(route, edgeIndexes.get(route.edge) ?? index, activeEdge)) return route
  }
  return undefined
}

function drawActiveRouteProgress(
  grid: FlowchartGrid,
  route: FlowchartEdgeRoute,
  progress: number,
  from: FlowchartNodeBounds | undefined,
): void {
  const sourcePoint = route.points[0]
  const points =
    from && sourcePoint ? [{ ...flowchartSourceConnector(from, sourcePoint) }, ...route.points] : route.points
  const path = orthogonalPathPoints(points)
  if (path.length === 0) return

  const cutoff = Math.round(progress * path.length)
  for (let index = 0; index < cutoff; index++) {
    const point = path[index]!
    const cell = grid.rows[point.y]?.[point.x]
    if (cell?.style === "activeEdge") cell.style = "edge"
  }

  const before = ACTIVE_EDGE_FRONTIER_INACTIVE_SIDE
  const after = ACTIVE_EDGE_FRONTIER_ACTIVE_SIDE
  const radius = Math.max(before, after)
  for (let offset = -before; offset <= after; offset++) {
    const pathIndex = cutoff + offset
    if (pathIndex < 0 || pathIndex >= path.length) continue
    const point = path[pathIndex]!
    setFlowchartPulseCell(
      grid,
      point.x,
      point.y,
      Math.abs(offset),
      radius,
      Math.min(pathIndex, path.length - 1 - pathIndex),
      isFlowchartFrontierTargetStyle,
    )
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
  const level = diagramPulseLevel(distance, radius, edgeDistance, "─│━┃".includes(char))
  return { style: EDGE_PULSE_STYLES[level - 1]!, level }
}

function isFlowchartPulseTargetStyle(style: FlowchartCellStyle | undefined): boolean {
  return style ? style !== "activeEdge" && EDGE_DRAWING_STYLES.has(style) : false
}

function isFlowchartFrontierTargetStyle(style: FlowchartCellStyle | undefined): boolean {
  return style ? EDGE_DRAWING_STYLES.has(style) : false
}

function setFlowchartPulseCell(
  grid: FlowchartGrid,
  x: number,
  y: number,
  distance: number,
  radius: number,
  edgeDistance: number,
  canStyle: (style: FlowchartCellStyle | undefined) => boolean = isFlowchartPulseTargetStyle,
): void {
  const cell = grid.rows[y]?.[x]
  if (!cell || cell.char === " " || !canStyle(cell.style)) return

  const pulse = flowchartPulseCellStyle(distance, radius, edgeDistance, cell.char)
  if (flowchartPulseStyleLevel(cell.style) > pulse.level) return
  cell.style = pulse.style
}

function drawEdgePulse(
  grid: FlowchartGrid,
  diagram: FlowchartDiagram,
  bounds: Map<string, FlowchartNodeBounds>,
  routes: readonly FlowchartEdgeRoute[],
  pulseFrame: number | undefined,
  pulseProgress: number | undefined,
  pulseLength: number,
  pulseGap: number,
): void {
  if (pulseFrame === undefined && pulseProgress === undefined) return
  const paths = routes.map((route) => {
    const from = bounds.get(route.edge.from)
    const sourcePoint = route.points[0]
    if (!from || !sourcePoint) return orthogonalPathPoints(route.points)

    const connector = flowchartSourceConnector(from, sourcePoint)
    return orthogonalPathPoints([{ x: connector.x, y: connector.y }, ...route.points])
  })
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
    const routeDirection = route.points[1] ? flowchartDirectionBetween(sourcePoint, route.points[1]!) : undefined
    const connectorDirection = flowchartDirectionBetween(sourcePoint, connector)
    if (routeDirection && connectorDirection) {
      const cell = grid.rows[sourcePoint.y]?.[sourcePoint.x]
      if (cell) {
        cell.char = diagramLineGlyph(
          new Set([routeDirection, connectorDirection]),
          "rounded",
          route.edge.style === "thick" ? "heavy" : "single",
        )
        cell.style = "edge"
      }
    }
    fadeSourcePath(grid, route.points, styles)
  }
}

function drawActiveSourceConnector(
  grid: FlowchartGrid,
  route: FlowchartEdgeRoute,
  from: FlowchartNodeBounds,
  sourcePoint: FlowchartPoint,
): void {
  const connector = flowchartSourceConnector(from, sourcePoint)
  grid.setCell(connector.x, connector.y, connector.char, "activeEdge")
  const routeDirection = route.points[1] ? flowchartDirectionBetween(sourcePoint, route.points[1]!) : undefined
  const connectorDirection = flowchartDirectionBetween(sourcePoint, connector)
  if (routeDirection && connectorDirection) {
    const cell = grid.rows[sourcePoint.y]?.[sourcePoint.x]
    const char = diagramLineGlyph(
      new Set([routeDirection, connectorDirection]),
      "rounded",
      route.edge.style === "thick" ? "heavy" : "single",
    )
    if (cell) {
      cell.char = char
      cell.style = "activeEdge"
    } else {
      grid.setCell(sourcePoint.x, sourcePoint.y, char, "activeEdge")
    }
  }
}

export function renderFlowchartGrid(content: string, options: FlowchartDiagramRenderOptions = {}): FlowchartGrid {
  const borderStyle = options.borderStyle ?? DEFAULT_BORDER_STYLE
  const pulseFrame = normalizeFlowchartPulseFrame(options.pulseFrame)
  const pulseProgress = normalizeFlowchartPulseProgress(options.pulseProgress)
  const activeEdgeProgress = normalizeFlowchartPulseProgress(options.activeEdgeProgress)
  const pulseLength = normalizeFlowchartPulseLength(options.pulseLength)
  const pulseGap = normalizeFlowchartPulseGap(options.pulseGap)
  const { diagram, bounds, routes, subgraphBounds, width, height } = layoutFlowchartDiagram(content, options)
  const grid = new DiagramCanvas<FlowchartCellStyle, FlowchartCellMetadata>(width, height, {
    mergeCell: mergeFlowchartCell,
  })
  const selectedRoute = activeRoute(routes, diagram, options.activeEdge)

  for (const subgraph of diagram.subgraphs ?? []) {
    const bound = subgraphBounds.get(subgraph.id)
    if (bound) drawSubgraphFrame(grid, bound, borderStyle)
  }
  for (const route of routes) drawRoutedEdge(grid, route)
  for (const node of diagram.nodes) {
    const bound = bounds.get(node.id)
    if (bound) drawNode(grid, node, bound, borderStyle, node.id === options.activeNode)
  }
  drawSourceConnectors(grid, diagram, bounds, routes)
  if (selectedRoute) {
    drawRoutedEdge(grid, selectedRoute, true)
    const sourcePoint = selectedRoute.points[0]
    const from = bounds.get(selectedRoute.edge.from)
    if (from && sourcePoint) {
      drawActiveSourceConnector(grid, selectedRoute, from, sourcePoint)
    }
    if (activeEdgeProgress !== undefined) drawActiveRouteProgress(grid, selectedRoute, activeEdgeProgress, from)
  }
  drawEdgePulse(grid, diagram, bounds, routes, pulseFrame, pulseProgress, pulseLength, pulseGap)
  for (const subgraph of diagram.subgraphs ?? []) {
    const bound = subgraphBounds.get(subgraph.id)
    if (bound) drawSubgraphLabel(grid, bound)
  }

  return grid
}

export function renderGridText(grid: FlowchartGrid): string {
  return grid.toString({ trimBottom: true })
}
