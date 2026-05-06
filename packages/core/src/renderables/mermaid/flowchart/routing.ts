import {
  advanceCoordinate,
  afterFarthestCoordinate,
  beforeNearestCoordinate,
  boundsCenter,
  boundsSidePoint,
  clampPoint,
  centeredSpanStart,
  centerCoordinate,
  insetSpan,
  keepAfter,
  keepBefore,
  lane,
  midpoint,
  oppositeSide,
  orthogonalPath,
  pathViaLane,
  point,
  pointOnSegment,
  segmentSpan,
  segmentsOf,
  sideForDirection,
  snapCoordinate,
  shiftPoint,
  spanCapacity,
  withCoordinate,
  type DiagramDirection,
  type DiagramSide,
  type DiagramSegment,
} from "../../diagram-geometry.js"
import type {
  FlowchartDiagram,
  FlowchartDirection,
  FlowchartEdge,
  FlowchartEdgeRoute,
  FlowchartNodeBounds,
  FlowchartPoint,
} from "./types.js"

export { directionBetween as flowchartDirectionBetween } from "../../diagram-geometry.js"

const BUS_CLEARANCE = 3
const NODE_CLEARANCE = 2
const LABEL_ENDPOINT_CLEARANCE = 1

type HorizontalTravel = Extract<DiagramDirection, "left" | "right">
type VerticalTravel = Extract<DiagramDirection, "up" | "down">
type PortRole = "source" | "target"

interface HorizontalEdgeRecord {
  edge: FlowchartEdge
  sourcePort: FlowchartPoint
  targetPort: FlowchartPoint
}

function isVerticalDirection(direction: FlowchartDirection): boolean {
  return direction === "TB" || direction === "TD" || direction === "BT"
}

function verticalTravel(from: FlowchartNodeBounds, to: FlowchartNodeBounds): VerticalTravel {
  return centerCoordinate(to, "y") >= centerCoordinate(from, "y") ? "down" : "up"
}

function isVerticalBackEdge(
  from: FlowchartNodeBounds,
  to: FlowchartNodeBounds,
  direction: FlowchartDirection,
): boolean {
  return direction === "BT"
    ? centerCoordinate(to, "y") > centerCoordinate(from, "y")
    : centerCoordinate(to, "y") < centerCoordinate(from, "y")
}

function horizontalTravel(
  from: FlowchartNodeBounds,
  to: FlowchartNodeBounds,
  direction: FlowchartDirection,
): HorizontalTravel {
  const targetIsRight = centerCoordinate(to, "x") > centerCoordinate(from, "x")
  const targetIsSameOrRight = centerCoordinate(to, "x") >= centerCoordinate(from, "x")
  return direction === "RL" ? (targetIsRight ? "right" : "left") : targetIsSameOrRight ? "right" : "left"
}

function verticalBackEdgePath(from: FlowchartNodeBounds, to: FlowchartNodeBounds): FlowchartPoint[] {
  const start = boundsSidePoint(from, "right")
  const end = boundsSidePoint(to, "right")
  return pathViaLane(start, lane("x", afterFarthestCoordinate([start, end], "x", "right", BUS_CLEARANCE)), end)
}

function verticalForwardEdgePath(from: FlowchartNodeBounds, to: FlowchartNodeBounds): FlowchartPoint[] {
  const travel = verticalTravel(from, to)
  const startSide = sideForDirection(travel)
  const endSide = oppositeSide(startSide)
  const sourceCenter = boundsCenter(from)
  const targetCenter = boundsCenter(to)
  const start = withCoordinate(boundsSidePoint(from, startSide), "x", snapCoordinate(sourceCenter.x, targetCenter.x, 1))
  const end = boundsSidePoint(to, endSide)
  return orthogonalPath(start, end, { preferredAxis: "y" })
}

function horizontalEdgePath(
  from: FlowchartNodeBounds,
  to: FlowchartNodeBounds,
  direction: FlowchartDirection,
): FlowchartPoint[] {
  if (centerCoordinate(from, "x") === centerCoordinate(to, "x")) return verticalForwardEdgePath(from, to)

  const travel = horizontalTravel(from, to, direction)
  const startSide = sideForDirection(travel)
  return orthogonalPath(boundsSidePoint(from, startSide), boundsSidePoint(to, oppositeSide(startSide)))
}

function edgePath(from: FlowchartNodeBounds, to: FlowchartNodeBounds, direction: FlowchartDirection): FlowchartPoint[] {
  if (!isVerticalDirection(direction)) return horizontalEdgePath(from, to, direction)
  return isVerticalBackEdge(from, to, direction) ? verticalBackEdgePath(from, to) : verticalForwardEdgePath(from, to)
}

function sourceFanOutLane(
  sourcePort: FlowchartPoint,
  targetPorts: readonly FlowchartPoint[],
  travel: HorizontalTravel,
): number {
  return keepBefore(
    advanceCoordinate(sourcePort.x, travel, BUS_CLEARANCE),
    beforeNearestCoordinate(targetPorts, "x", travel, NODE_CLEARANCE),
    travel,
  )
}

function targetFanInLane(
  sourcePorts: readonly FlowchartPoint[],
  targetPort: FlowchartPoint,
  travel: HorizontalTravel,
): number {
  return keepAfter(
    advanceCoordinate(targetPort.x, travel, -BUS_CLEARANCE),
    afterFarthestCoordinate(sourcePorts, "x", travel, NODE_CLEARANCE),
    travel,
  )
}

function horizontalPort(bounds: FlowchartNodeBounds, travel: HorizontalTravel, role: PortRole): FlowchartPoint {
  const side = role === "source" ? sideForDirection(travel) : oppositeSide(sideForDirection(travel))
  return boundsSidePoint(bounds, side)
}

function horizontalForwardRecords(
  edges: FlowchartEdge[],
  bounds: Map<string, FlowchartNodeBounds>,
  direction: FlowchartDirection,
): HorizontalEdgeRecord[] {
  const travel = direction === "RL" ? "left" : "right"
  const records: HorizontalEdgeRecord[] = []
  for (const edge of edges) {
    const source = bounds.get(edge.from)
    const target = bounds.get(edge.to)
    if (!source || !target) continue
    const forward =
      direction === "RL"
        ? centerCoordinate(target, "x") < centerCoordinate(source, "x")
        : centerCoordinate(target, "x") > centerCoordinate(source, "x")
    if (!forward) continue
    records.push({
      edge,
      sourcePort: horizontalPort(source, travel, "source"),
      targetPort: horizontalPort(target, travel, "target"),
    })
  }
  return records
}

function groupRecords(
  records: readonly HorizontalEdgeRecord[],
  key: (record: HorizontalEdgeRecord) => string,
): Map<string, HorizontalEdgeRecord[]> {
  const groups = new Map<string, HorizontalEdgeRecord[]>()
  for (const record of records) {
    const groupKey = key(record)
    const group = groups.get(groupKey) ?? []
    group.push(record)
    groups.set(groupKey, group)
  }
  return groups
}

function fanRoute(
  edge: FlowchartEdge,
  sourcePort: FlowchartPoint,
  targetPort: FlowchartPoint,
  busX: number,
): FlowchartEdgeRoute {
  return { edge, points: pathViaLane(sourcePort, lane("x", busX), targetPort) }
}

function routeHorizontalFanOut(
  records: readonly HorizontalEdgeRecord[],
  direction: FlowchartDirection,
  handled: Set<FlowchartEdge>,
  routes: FlowchartEdgeRoute[],
): void {
  for (const sourceRecords of groupRecords(records, (record) => record.edge.from).values()) {
    if (sourceRecords.length < 2) continue
    const travel = direction === "RL" ? "left" : "right"
    const sourcePort = sourceRecords[0]!.sourcePort
    const targetPorts = sourceRecords.map((record) => record.targetPort)

    const busX = sourceFanOutLane(sourcePort, targetPorts, travel)
    for (const record of sourceRecords) {
      routes.push(fanRoute(record.edge, sourcePort, record.targetPort, busX))
      handled.add(record.edge)
    }
  }
}

function routeHorizontalFanIn(
  records: readonly HorizontalEdgeRecord[],
  direction: FlowchartDirection,
  handled: Set<FlowchartEdge>,
  routes: FlowchartEdgeRoute[],
): void {
  const unhandledRecords = records.filter((record) => !handled.has(record.edge))
  for (const targetRecords of groupRecords(unhandledRecords, (record) => record.edge.to).values()) {
    if (targetRecords.length < 2) continue
    const travel = direction === "RL" ? "left" : "right"
    const targetPort = targetRecords[0]!.targetPort
    const sourcePorts = targetRecords.map((record) => record.sourcePort)

    const busX = targetFanInLane(sourcePorts, targetPort, travel)
    for (const record of targetRecords) {
      routes.push(fanRoute(record.edge, record.sourcePort, targetPort, busX))
      handled.add(record.edge)
    }
  }
}

function inlineLabelSlot(segment: DiagramSegment, labelWidth: number): { x: number; fits: boolean } {
  const slot = insetSpan(segmentSpan(segment), LABEL_ENDPOINT_CLEARANCE)
  return { x: centeredSpanStart(slot, labelWidth), fits: spanCapacity(slot) >= labelWidth }
}

function segmentLabelPoint(segment: DiagramSegment, labelWidth: number, direction: FlowchartDirection): FlowchartPoint {
  if (segment.axis === "x") {
    const slot = inlineLabelSlot(segment, labelWidth)
    if (slot.fits) {
      const inlinePoint = point(slot.x, segment.from.y)
      return isVerticalDirection(direction) ? clampPoint(shiftPoint(inlinePoint, "up")) : inlinePoint
    }

    return clampPoint(shiftPoint(shiftPoint(segment.from, segment.direction, LABEL_ENDPOINT_CLEARANCE), "up"))
  }

  return shiftPoint(pointOnSegment(segment, midpoint(segmentSpan(segment))), "right")
}

function bestLabelSegment(points: readonly FlowchartPoint[], labelWidth: number): DiagramSegment | undefined {
  const segments = segmentsOf(points)
  const roomyHorizontal = segments.find((segment) => segment.axis === "x" && inlineLabelSlot(segment, labelWidth).fits)
  if (roomyHorizontal) return roomyHorizontal
  const verticalBus = segments.find((segment) => segment.axis === "y")
  if (verticalBus) return verticalBus
  let longest = segments[0]
  for (const segment of segments.slice(1)) {
    if (!longest || segment.length > longest.length) longest = segment
  }
  return longest
}

export function flowchartLabelPoint(
  points: FlowchartPoint[],
  label: string,
  direction: FlowchartDirection,
  measure: (text: string) => number,
): FlowchartPoint {
  const labelWidth = measure(label)
  const segment = bestLabelSegment(points, labelWidth)
  return segment ? segmentLabelPoint(segment, labelWidth, direction) : (points[0] ?? point(0, 0))
}

export function routeFlowchartEdges(
  diagram: FlowchartDiagram,
  bounds: Map<string, FlowchartNodeBounds>,
): FlowchartEdgeRoute[] {
  const handled = new Set<FlowchartEdge>()
  const routes: FlowchartEdgeRoute[] = []
  if (diagram.direction === "LR" || diagram.direction === "RL") {
    const records = horizontalForwardRecords(diagram.edges, bounds, diagram.direction)
    routeHorizontalFanOut(records, diagram.direction, handled, routes)
    routeHorizontalFanIn(records, diagram.direction, handled, routes)
  }

  for (const edge of diagram.edges) {
    if (handled.has(edge)) continue
    const from = bounds.get(edge.from)
    const to = bounds.get(edge.to)
    if (!from || !to) continue
    routes.push({ edge, points: edgePath(from, to, diagram.direction) })
  }
  return routes
}

function sideForOutsidePoint(bounds: FlowchartNodeBounds, sourcePoint: FlowchartPoint): DiagramSide {
  if (sourcePoint.x < bounds.left) return "left"
  if (sourcePoint.x >= bounds.left + bounds.width) return "right"
  if (sourcePoint.y < bounds.top) return "top"
  return "bottom"
}

function connectorChar(side: DiagramSide): string {
  switch (side) {
    case "left":
      return "┤"
    case "right":
      return "├"
    case "top":
      return "┴"
    case "bottom":
      return "┬"
  }
}

export function flowchartSourceConnector(
  from: FlowchartNodeBounds,
  sourcePoint: FlowchartPoint,
): { x: number; y: number; char: string } {
  const side = sideForOutsidePoint(from, sourcePoint)
  const connector = boundsSidePoint(from, side, "border")
  return {
    x: side === "top" || side === "bottom" ? sourcePoint.x : connector.x,
    y: side === "left" || side === "right" ? sourcePoint.y : connector.y,
    char: connectorChar(side),
  }
}
