import type { BorderStyle } from "../../../lib/border.js"
import type { ColorInput } from "../../../lib/RGBA.js"
import type { TextBufferOptions } from "../../TextBufferRenderable.js"
import type { FlowchartDiagramAnsiTheme } from "./style.js"
import type { FlowchartDirection } from "./types.js"

export interface FlowchartDiagramRenderOptions {
  direction?: FlowchartDirection
  borderStyle?: BorderStyle
  minNodeGap?: number
  minRankGap?: number
  pulseFrame?: number
  pulseProgress?: number
  pulseLength?: number
  pulseGap?: number
}

export interface FlowchartDiagramAnsiOptions extends FlowchartDiagramRenderOptions {
  theme?: FlowchartDiagramAnsiTheme
}

export interface FlowchartDiagramOptions extends TextBufferOptions, FlowchartDiagramRenderOptions {
  content?: string
  nodeColor?: ColorInput
  databaseColor?: ColorInput
  edgeColor?: ColorInput
  pulseColor?: ColorInput
  labelColor?: ColorInput
  groupColor?: ColorInput
}
