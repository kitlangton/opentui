import {
  clampPoint,
  centeredSpanStart,
  insetSpan,
  midpoint,
  point,
  pointOnSegment,
  segmentBetween,
  segmentSpan,
  shiftPoint,
  spanCapacity,
  type DiagramSegment,
} from "../../diagram-geometry.js"
import type { FlowchartPoint } from "./types.js"

const LABEL_BUS_CLEARANCE = 3
const LABEL_NODE_CLEARANCE = 2
const LABEL_LINE_CLEARANCE = 2
const LABEL_PADDING = 1

export interface FlowchartEdgeLabelLayout {
  text: string
  point: FlowchartPoint
  width: number
}

export function flowchartLabelText(label: string): string {
  return `${" ".repeat(LABEL_PADDING)}${label}${" ".repeat(LABEL_PADDING)}`
}

export function flowchartLabelWidth(label: string, measure: (text: string) => number): number {
  return measure(label) + LABEL_PADDING * 2
}

function minimumInlineLabelLength(labelWidth: number): number {
  return labelWidth + LABEL_LINE_CLEARANCE * 2 - 1
}

export function flowchartHorizontalLabelRankGap(labelWidth: number): number {
  return minimumInlineLabelLength(labelWidth) + LABEL_BUS_CLEARANCE + 1
}

export function flowchartVerticalBranchLabelGap(labelWidth: number): number {
  return minimumInlineLabelLength(labelWidth) + LABEL_BUS_CLEARANCE + LABEL_NODE_CLEARANCE
}

function inlineLabelSlot(segment: DiagramSegment, labelWidth: number): { x: number; fits: boolean } {
  const slot = insetSpan(segmentSpan(segment), LABEL_LINE_CLEARANCE)
  return { x: centeredSpanStart(slot, labelWidth), fits: spanCapacity(slot) >= labelWidth }
}

function segmentLabelPoint(segment: DiagramSegment, labelWidth: number): FlowchartPoint {
  if (segment.axis === "x") {
    const slot = inlineLabelSlot(segment, labelWidth)
    if (slot.fits) return point(slot.x, segment.from.y)

    return clampPoint(shiftPoint(shiftPoint(segment.from, segment.direction, LABEL_LINE_CLEARANCE), "up"))
  }

  return shiftPoint(pointOnSegment(segment, midpoint(segmentSpan(segment))), "right")
}

function bestLabelSegment(points: readonly FlowchartPoint[], labelWidth: number): DiagramSegment | undefined {
  let roomyHorizontal: DiagramSegment | undefined
  let verticalBus: DiagramSegment | undefined
  let longest: DiagramSegment | undefined

  for (let index = 1; index < points.length; index++) {
    const segment = segmentBetween(points[index - 1]!, points[index]!)
    if (!segment) continue
    if (!roomyHorizontal && segment.axis === "x" && inlineLabelSlot(segment, labelWidth).fits) roomyHorizontal = segment
    if (!verticalBus && segment.axis === "y") verticalBus = segment
    if (!longest || segment.length > longest.length) longest = segment
  }

  return roomyHorizontal ?? verticalBus ?? longest
}

function flowchartLabelPoint(points: readonly FlowchartPoint[], labelWidth: number): FlowchartPoint {
  const segment = bestLabelSegment(points, labelWidth)
  return segment ? segmentLabelPoint(segment, labelWidth) : (points[0] ?? point(0, 0))
}

export function flowchartEdgeLabelLayout(
  points: readonly FlowchartPoint[],
  label: string,
  measure: (text: string) => number,
): FlowchartEdgeLabelLayout {
  const width = flowchartLabelWidth(label, measure)
  return { text: flowchartLabelText(label), point: flowchartLabelPoint(points, width), width }
}
