import {
  advanceCoordinate,
  afterFarthestCoordinate,
  beforeNearestCoordinate,
  boundsCenter,
  boundsSidePoint,
  centerCoordinate,
  coordinate,
  keepAfter,
  keepBefore,
  lane,
  oppositeSide,
  orthogonalPath,
  pathThrough,
  pathViaLane,
  sideForDirection,
  snapCoordinate,
  shiftPoint,
  withCoordinate,
  type DiagramAxis,
  type DiagramDirection,
  type DiagramLane,
  type DiagramSide,
} from "../../diagram-geometry.js"
import type {
  FlowchartDiagram,
  FlowchartDirection,
  FlowchartEdge,
  FlowchartEdgeRoute,
  FlowchartNodeBounds,
  FlowchartPoint,
  FlowchartSubgraph,
  FlowchartSubgraphBounds,
} from "./types.js"

export { directionBetween as flowchartDirectionBetween } from "../../diagram-geometry.js"

const BUS_CLEARANCE = 3
const NODE_CLEARANCE = 2
type HorizontalTravel = Extract<DiagramDirection, "left" | "right">
type VerticalTravel = Extract<DiagramDirection, "up" | "down">
type PortRole = "source" | "target"

interface EdgeRecord {
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

function verticalBackEdgePath(
  from: FlowchartNodeBounds,
  to: FlowchartNodeBounds,
  leftBoundary?: number,
): FlowchartPoint[] {
  const start = boundsSidePoint(from, "left")
  const end = boundsSidePoint(to, "left")
  const busX = Math.min(
    afterFarthestCoordinate([start, end], "x", "left", BUS_CLEARANCE),
    leftBoundary === undefined ? Number.POSITIVE_INFINITY : leftBoundary - BUS_CLEARANCE * 2,
  )
  return pathViaLane(start, lane("x", busX), end)
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

function selfEdgePath(bounds: FlowchartNodeBounds): FlowchartPoint[] {
  const start = boundsSidePoint(bounds, "right")
  const end = boundsSidePoint(bounds, "bottom")
  const rightLaneX = bounds.left + bounds.width + BUS_CLEARANCE
  const bottomLaneY = bounds.top + bounds.height + 1
  return [start, { x: rightLaneX, y: start.y }, { x: rightLaneX, y: bottomLaneY }, { x: end.x, y: bottomLaneY }, end]
}

function edgePath(
  from: FlowchartNodeBounds,
  to: FlowchartNodeBounds,
  direction: FlowchartDirection,
  leftBoundary?: number,
): FlowchartPoint[] {
  if (from.id === to.id) return selfEdgePath(from)
  if (!isVerticalDirection(direction)) return horizontalEdgePath(from, to, direction)
  return isVerticalBackEdge(from, to, direction)
    ? verticalBackEdgePath(from, to, leftBoundary)
    : verticalForwardEdgePath(from, to)
}

function sourceFanOutLane(
  sourcePort: FlowchartPoint,
  targetPorts: readonly FlowchartPoint[],
  axis: DiagramAxis,
  travel: DiagramDirection,
): number {
  return keepBefore(
    advanceCoordinate(coordinate(sourcePort, axis), travel, BUS_CLEARANCE),
    beforeNearestCoordinate(targetPorts, axis, travel, NODE_CLEARANCE),
    travel,
  )
}

function targetFanInLane(
  sourcePorts: readonly FlowchartPoint[],
  targetPort: FlowchartPoint,
  axis: DiagramAxis,
  travel: DiagramDirection,
): number {
  return keepAfter(
    advanceCoordinate(coordinate(targetPort, axis), travel, -BUS_CLEARANCE),
    afterFarthestCoordinate(sourcePorts, axis, travel, NODE_CLEARANCE),
    travel,
  )
}

function portForTravel(bounds: FlowchartNodeBounds, travel: DiagramDirection, role: PortRole): FlowchartPoint {
  const side = role === "source" ? sideForDirection(travel) : oppositeSide(sideForDirection(travel))
  return boundsSidePoint(bounds, side)
}

function horizontalForwardRecords(
  edges: FlowchartEdge[],
  bounds: Map<string, FlowchartNodeBounds>,
  direction: FlowchartDirection,
): EdgeRecord[] {
  const travel = direction === "RL" ? "left" : "right"
  const records: EdgeRecord[] = []
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
      sourcePort: portForTravel(source, travel, "source"),
      targetPort: portForTravel(target, travel, "target"),
    })
  }
  return records
}

function verticalForwardRecords(
  edges: FlowchartEdge[],
  bounds: Map<string, FlowchartNodeBounds>,
  direction: FlowchartDirection,
): EdgeRecord[] {
  const travel = direction === "BT" ? "up" : "down"
  const records: EdgeRecord[] = []
  for (const edge of edges) {
    const source = bounds.get(edge.from)
    const target = bounds.get(edge.to)
    if (!source || !target) continue
    const forward =
      direction === "BT"
        ? centerCoordinate(target, "y") < centerCoordinate(source, "y")
        : centerCoordinate(target, "y") > centerCoordinate(source, "y")
    if (!forward) continue
    records.push({
      edge,
      sourcePort: portForTravel(source, travel, "source"),
      targetPort: portForTravel(target, travel, "target"),
    })
  }
  return records
}

function horizontalExitSubgraph(diagram: FlowchartDiagram, edge: FlowchartEdge): FlowchartSubgraph | undefined {
  for (const subgraph of [...(diagram.subgraphs ?? [])].reverse()) {
    if (subgraph.direction !== "LR" && subgraph.direction !== "RL") continue
    if (subgraph.nodeIds.includes(edge.from) && !subgraph.nodeIds.includes(edge.to)) return subgraph
  }
  return undefined
}

function horizontalEntrySubgraph(diagram: FlowchartDiagram, edge: FlowchartEdge): FlowchartSubgraph | undefined {
  for (const subgraph of [...(diagram.subgraphs ?? [])].reverse()) {
    if (subgraph.direction !== "LR" && subgraph.direction !== "RL") continue
    if (subgraph.nodeIds.includes(edge.to) && !subgraph.nodeIds.includes(edge.from)) return subgraph
  }
  return undefined
}

function horizontalSubgraphEntryTravel(subgraph: FlowchartSubgraph): HorizontalTravel {
  return subgraph.direction === "RL" ? "left" : "right"
}

function horizontalSubgraphEntryLane(subgraph: FlowchartSubgraph, subgraphBound: FlowchartSubgraphBounds): number {
  return subgraph.direction === "RL"
    ? subgraphBound.left + subgraphBound.width + BUS_CLEARANCE
    : subgraphBound.left - BUS_CLEARANCE
}

function horizontalSubgraphJoinY(from: FlowchartSubgraphBounds, targetSubgraphBound: FlowchartSubgraphBounds): number {
  if (from.centerY <= targetSubgraphBound.centerY) {
    const start = from.top + from.height
    const end = targetSubgraphBound.top - 1
    return start <= end ? Math.floor((start + end) / 2) : start
  }

  const start = targetSubgraphBound.top + targetSubgraphBound.height
  const end = from.top - 1
  return start <= end ? Math.floor((start + end) / 2) : end
}

function horizontalSubgraphExitJoinY(
  from: FlowchartSubgraphBounds,
  targetPort: FlowchartPoint,
  targetBelow: boolean,
): number {
  if (targetBelow) {
    const outside = from.top + from.height
    const beforeTarget = targetPort.y - 1
    const preferred = targetPort.y - BUS_CLEARANCE
    return outside <= beforeTarget ? Math.min(Math.max(outside, preferred), beforeTarget) : beforeTarget
  }

  const outside = from.top - 1
  const afterTarget = targetPort.y + 1
  const preferred = targetPort.y + BUS_CLEARANCE
  return afterTarget <= outside ? Math.max(Math.min(outside, preferred), afterTarget) : afterTarget
}

function groupRecords(records: readonly EdgeRecord[], key: (record: EdgeRecord) => string): Map<string, EdgeRecord[]> {
  const groups = new Map<string, EdgeRecord[]>()
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
  routeLane: DiagramLane,
): FlowchartEdgeRoute {
  return { edge, points: pathViaLane(sourcePort, routeLane, targetPort) }
}

function alignClusteredVerticalSources(records: readonly EdgeRecord[]): EdgeRecord[] {
  const xs = records.map((record) => record.sourcePort.x)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  if (maxX - minX > 1) return [...records]

  const x = Math.round(xs.reduce((total, value) => total + value, 0) / xs.length)
  return records.map((record) => ({ ...record, sourcePort: { ...record.sourcePort, x } }))
}

function routeHorizontalFanOut(
  records: readonly EdgeRecord[],
  direction: FlowchartDirection,
  handled: Set<FlowchartEdge>,
  routes: FlowchartEdgeRoute[],
): void {
  for (const sourceRecords of groupRecords(records, (record) => record.edge.from).values()) {
    if (sourceRecords.length < 2) continue
    const travel = direction === "RL" ? "left" : "right"
    const sourcePort = sourceRecords[0]!.sourcePort
    const targetPorts = sourceRecords.map((record) => record.targetPort)

    const busX = sourceFanOutLane(sourcePort, targetPorts, "x", travel)
    for (const record of sourceRecords) {
      routes.push(fanRoute(record.edge, sourcePort, record.targetPort, lane("x", busX)))
      handled.add(record.edge)
    }
  }
}

function routeHorizontalFanIn(
  records: readonly EdgeRecord[],
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

    const busX = targetFanInLane(sourcePorts, targetPort, "x", travel)
    for (const record of targetRecords) {
      routes.push(fanRoute(record.edge, record.sourcePort, targetPort, lane("x", busX)))
      handled.add(record.edge)
    }
  }
}

function routeVerticalFanOut(
  records: readonly EdgeRecord[],
  direction: FlowchartDirection,
  handled: Set<FlowchartEdge>,
  routes: FlowchartEdgeRoute[],
): void {
  for (const sourceRecords of groupRecords(records, (record) => record.edge.from).values()) {
    if (sourceRecords.length < 2) continue
    const travel = direction === "BT" ? "up" : "down"
    const sourcePort = sourceRecords[0]!.sourcePort
    const targetPorts = sourceRecords.map((record) => record.targetPort)

    const busY = sourceFanOutLane(sourcePort, targetPorts, "y", travel)
    for (const record of sourceRecords) {
      routes.push(fanRoute(record.edge, sourcePort, record.targetPort, lane("y", busY)))
      handled.add(record.edge)
    }
  }
}

function routeVerticalFanIn(
  records: readonly EdgeRecord[],
  direction: FlowchartDirection,
  handled: Set<FlowchartEdge>,
  routes: FlowchartEdgeRoute[],
): void {
  const unhandledRecords = records.filter((record) => !handled.has(record.edge))
  for (const unalignedTargetRecords of groupRecords(unhandledRecords, (record) => record.edge.to).values()) {
    const targetRecords = alignClusteredVerticalSources(unalignedTargetRecords)
    if (targetRecords.length < 2) continue
    const travel = direction === "BT" ? "up" : "down"
    const targetPort = targetRecords[0]!.targetPort
    const sourcePorts = targetRecords.map((record) => record.sourcePort)

    const busY = targetFanInLane(sourcePorts, targetPort, "y", travel)
    for (const record of targetRecords) {
      routes.push(fanRoute(record.edge, record.sourcePort, targetPort, lane("y", busY)))
      handled.add(record.edge)
    }
  }
}

function routeHorizontalSubgraphExitFanIn(
  diagram: FlowchartDiagram,
  bounds: Map<string, FlowchartNodeBounds>,
  subgraphBounds: ReadonlyMap<string, FlowchartSubgraphBounds> | undefined,
  handled: Set<FlowchartEdge>,
  routes: FlowchartEdgeRoute[],
): void {
  if (!subgraphBounds) return

  const groups = new Map<string, { edge: FlowchartEdge; subgraph: FlowchartSubgraph; source: FlowchartNodeBounds }[]>()
  for (const edge of diagram.edges) {
    if (handled.has(edge)) continue
    const subgraph = horizontalExitSubgraph(diagram, edge)
    const source = bounds.get(edge.from)
    const target = bounds.get(edge.to)
    if (!subgraph || !source || !target) continue

    const key = `${subgraph.id}:${edge.to}`
    const group = groups.get(key) ?? []
    group.push({ edge, subgraph, source })
    groups.set(key, group)
  }

  for (const group of groups.values()) {
    const subgraph = group[0]!.subgraph
    const subgraphBound = subgraphBounds.get(subgraph.id)
    const target = bounds.get(group[0]!.edge.to)
    if (!subgraphBound || !target) continue

    const travel: HorizontalTravel = subgraph.direction === "RL" ? "left" : "right"
    const busX =
      subgraph.direction === "RL"
        ? subgraphBound.left - BUS_CLEARANCE
        : subgraphBound.left + subgraphBound.width + BUS_CLEARANCE
    const targetSubgraph = horizontalEntrySubgraph(diagram, group[0]!.edge)
    const targetSubgraphBound = targetSubgraph ? subgraphBounds.get(targetSubgraph.id) : undefined
    const targetBelow = target.centerY >= subgraphBound.centerY
    const targetPort = targetSubgraph
      ? portForTravel(target, horizontalSubgraphEntryTravel(targetSubgraph), "target")
      : boundsSidePoint(target, targetBelow ? "top" : "bottom")
    const joinY = targetSubgraphBound
      ? horizontalSubgraphJoinY(subgraphBound, targetSubgraphBound)
      : horizontalSubgraphExitJoinY(subgraphBound, targetPort, targetBelow)
    const entryX =
      targetSubgraph && targetSubgraphBound
        ? horizontalSubgraphEntryLane(targetSubgraph, targetSubgraphBound)
        : targetPort.x

    for (const record of group) {
      const sourcePort = portForTravel(record.source, travel, "source")
      routes.push({
        edge: record.edge,
        points: pathThrough([
          sourcePort,
          { x: busX, y: sourcePort.y },
          { x: busX, y: joinY },
          { x: entryX, y: joinY },
          { x: entryX, y: targetPort.y },
          targetPort,
        ]),
      })
      handled.add(record.edge)
    }
  }
}

function routeHorizontalSubgraphEntries(
  diagram: FlowchartDiagram,
  bounds: Map<string, FlowchartNodeBounds>,
  subgraphBounds: ReadonlyMap<string, FlowchartSubgraphBounds> | undefined,
  handled: Set<FlowchartEdge>,
  routes: FlowchartEdgeRoute[],
): void {
  if (!subgraphBounds) return

  for (const edge of diagram.edges) {
    if (handled.has(edge)) continue
    const subgraph = horizontalEntrySubgraph(diagram, edge)
    const subgraphBound = subgraph ? subgraphBounds.get(subgraph.id) : undefined
    const from = bounds.get(edge.from)
    const to = bounds.get(edge.to)
    if (!subgraph || !subgraphBound || !from || !to) continue

    const targetPort = portForTravel(to, horizontalSubgraphEntryTravel(subgraph), "target")
    const entryX = horizontalSubgraphEntryLane(subgraph, subgraphBound)
    const travel = verticalTravel(from, to)
    const sourcePort = portForTravel(from, travel, "source")
    routes.push({
      edge,
      points: pathThrough([sourcePort, { x: entryX, y: sourcePort.y }, { x: entryX, y: targetPort.y }, targetPort]),
    })
    handled.add(edge)
  }
}

export function routeFlowchartEdges(
  diagram: FlowchartDiagram,
  bounds: Map<string, FlowchartNodeBounds>,
  directionForEdge: (edge: FlowchartEdge) => FlowchartDirection = () => diagram.direction,
  subgraphBounds?: ReadonlyMap<string, FlowchartSubgraphBounds>,
): FlowchartEdgeRoute[] {
  const handled = new Set<FlowchartEdge>()
  const routes: FlowchartEdgeRoute[] = []
  const leftBoundary = subgraphBounds
    ? Math.min(...[...bounds.values(), ...subgraphBounds.values()].map((bound) => bound.left))
    : undefined

  for (const direction of ["LR", "RL"] satisfies FlowchartDirection[]) {
    const horizontalEdges = diagram.edges.filter((edge) => directionForEdge(edge) === direction)
    if (horizontalEdges.length === 0) continue
    const records = horizontalForwardRecords(horizontalEdges, bounds, direction)
    routeHorizontalFanOut(records, direction, handled, routes)
    routeHorizontalFanIn(records, direction, handled, routes)
  }

  routeHorizontalSubgraphExitFanIn(diagram, bounds, subgraphBounds, handled, routes)
  routeHorizontalSubgraphEntries(diagram, bounds, subgraphBounds, handled, routes)

  for (const direction of ["TD", "TB", "BT"] satisfies FlowchartDirection[]) {
    const verticalEdges = diagram.edges.filter((edge) => directionForEdge(edge) === direction)
    if (verticalEdges.length === 0) continue
    const records = verticalForwardRecords(verticalEdges, bounds, direction)
    routeVerticalFanOut(records, direction, handled, routes)
    routeVerticalFanIn(records, direction, handled, routes)
  }

  for (const edge of diagram.edges) {
    if (handled.has(edge)) continue
    const from = bounds.get(edge.from)
    const to = bounds.get(edge.to)
    if (!from || !to) continue
    routes.push({ edge, points: edgePath(from, to, directionForEdge(edge), leftBoundary) })
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
