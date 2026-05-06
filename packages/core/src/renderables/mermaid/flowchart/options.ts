import type { BorderStyle } from "../../../lib/border.js"
import type { ColorInput } from "../../../lib/RGBA.js"
import type { TextBufferOptions } from "../../TextBufferRenderable.js"
import type { FlowchartDiagramAnsiTheme, FlowchartNodeColors } from "./style.js"
import type { FlowchartActiveEdgeSelection, FlowchartDirection } from "./types.js"

const DEFAULT_PULSE_LENGTH = 7
const DEFAULT_PULSE_GAP = 16

function normalizePositiveInt(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.max(1, Math.trunc(value))
}

export function normalizeFlowchartPulseFrame(value: number | undefined): number | undefined {
  return value === undefined || !Number.isFinite(value) ? undefined : Math.trunc(value)
}

export function normalizeFlowchartPulseProgress(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined
  return Math.max(0, Math.min(1, value))
}

export function normalizeFlowchartPulseLength(value: number | undefined): number {
  return normalizePositiveInt(value, DEFAULT_PULSE_LENGTH)
}

export function normalizeFlowchartPulseGap(value: number | undefined): number {
  return normalizePositiveInt(value, DEFAULT_PULSE_GAP)
}

export interface FlowchartDiagramRenderOptions {
  direction?: FlowchartDirection
  borderStyle?: BorderStyle
  minNodeGap?: number
  minRankGap?: number
  pulseFrame?: number
  pulseProgress?: number
  pulseLength?: number
  pulseGap?: number
  activeNode?: string
  activeEdge?: FlowchartActiveEdgeSelection
  activeEdgeProgress?: number
}

export interface FlowchartDiagramAnsiOptions extends FlowchartDiagramRenderOptions {
  theme?: FlowchartDiagramAnsiTheme
}

export interface FlowchartDiagramOptions extends TextBufferOptions, FlowchartDiagramRenderOptions {
  content?: string
  nodeColor?: ColorInput
  nodeColors?: FlowchartNodeColors
  nodeBgColors?: FlowchartNodeColors
  databaseColor?: ColorInput
  edgeColor?: ColorInput
  activeNodeColor?: ColorInput
  activeEdgeColor?: ColorInput
  pulseColor?: ColorInput
  labelColor?: ColorInput
  groupColor?: ColorInput
}
