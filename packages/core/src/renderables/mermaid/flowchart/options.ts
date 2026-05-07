import type { BorderStyle } from "../../../lib/border.js"
import type { ColorInput } from "../../../lib/RGBA.js"
import {
  normalizeDiagramPositiveInt,
  normalizeDiagramPulseFrame,
  normalizeDiagramPulseProgress,
} from "../../diagram-pulse.js"
import type { TextBufferOptions } from "../../TextBufferRenderable.js"
import type { FlowchartDiagramAnsiTheme, FlowchartNodeColors } from "./style.js"
import type { FlowchartActiveEdgeSelection, FlowchartDirection } from "./types.js"

const DEFAULT_PULSE_LENGTH = 7
const DEFAULT_PULSE_GAP = 16

export function normalizeFlowchartPulseFrame(value: number | undefined): number | undefined {
  return normalizeDiagramPulseFrame(value)
}

export function normalizeFlowchartPulseProgress(value: number | undefined): number | undefined {
  return normalizeDiagramPulseProgress(value)
}

export function normalizeFlowchartPulseLength(value: number | undefined): number {
  return normalizeDiagramPositiveInt(value, DEFAULT_PULSE_LENGTH)
}

export function normalizeFlowchartPulseGap(value: number | undefined): number {
  return normalizeDiagramPositiveInt(value, DEFAULT_PULSE_GAP)
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
