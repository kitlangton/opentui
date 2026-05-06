import { ANSI } from "../../../ansi.js"
import { RGBA } from "../../../lib/RGBA.js"
import { StyledText } from "../../../lib/styled-text.js"
import type { TextChunk } from "../../../text-buffer.js"
import type { DiagramCanvas } from "../../diagram-canvas.js"
import {
  ansiFg,
  createColorRampTheme,
  createAnsiRampTheme,
  createAnsiPeakAndRampTheme,
  DIAGRAM_FADE_STEPS,
  numberedStyleKeys,
  rgba,
  brightenColor,
  type DiagramFadeStep,
  type DiagramRgb,
} from "../../diagram-style.js"

export type FlowchartBaseCellStyle = "node" | "database" | "edge" | "label" | "group"
export type FlowchartNodeEdgeFadeStyle = `nodeEdgeFade${DiagramFadeStep}`
export type FlowchartDatabaseEdgeFadeStyle = `databaseEdgeFade${DiagramFadeStep}`
export type FlowchartEdgeFadeStyle = FlowchartNodeEdgeFadeStyle | FlowchartDatabaseEdgeFadeStyle
export type FlowchartEdgePulseFadeStyle = `edgePulseFade${DiagramFadeStep}`
export type FlowchartEdgePulseStyle = "edgePulse" | FlowchartEdgePulseFadeStyle
export type FlowchartCellStyle = FlowchartBaseCellStyle | FlowchartEdgeFadeStyle | FlowchartEdgePulseStyle
export type FlowchartGrid = DiagramCanvas<FlowchartCellStyle>
export type FlowchartStyleColors = Required<Record<FlowchartCellStyle, RGBA>>
export type FlowchartDiagramAnsiTheme = Partial<Record<FlowchartCellStyle, string>>

export const DEFAULT_THEME_RGB = {
  node: [228, 239, 232],
  database: [228, 239, 232],
  edge: [134, 225, 200],
  edgePulse: [221, 255, 246],
  label: [134, 225, 200],
  group: [76, 99, 89],
} as const satisfies Record<FlowchartBaseCellStyle | "edgePulse", DiagramRgb>

export const NODE_EDGE_FADE_STYLES = numberedStyleKeys("nodeEdgeFade", DIAGRAM_FADE_STEPS)
export const DATABASE_EDGE_FADE_STYLES = numberedStyleKeys("databaseEdgeFade", DIAGRAM_FADE_STEPS)
export const EDGE_PULSE_FADE_STYLES = numberedStyleKeys("edgePulseFade", DIAGRAM_FADE_STEPS)
export const EDGE_PULSE_STYLES = [
  "edgePulseFade1",
  "edgePulseFade2",
  "edgePulseFade3",
  "edgePulseFade4",
  "edgePulseFade5",
  "edgePulse",
] as const satisfies readonly FlowchartEdgePulseStyle[]

const DEFAULT_ANSI_THEME: Required<Record<FlowchartCellStyle, string>> = {
  node: ansiFg(DEFAULT_THEME_RGB.node),
  database: ansiFg(DEFAULT_THEME_RGB.database),
  edge: ansiFg(DEFAULT_THEME_RGB.edge),
  label: ansiFg(DEFAULT_THEME_RGB.label),
  group: ansiFg(DEFAULT_THEME_RGB.group),
  ...createAnsiRampTheme(NODE_EDGE_FADE_STYLES, DEFAULT_THEME_RGB.node, DEFAULT_THEME_RGB.edge),
  ...createAnsiRampTheme(DATABASE_EDGE_FADE_STYLES, DEFAULT_THEME_RGB.database, DEFAULT_THEME_RGB.edge),
  ...createAnsiPeakAndRampTheme(
    "edgePulse",
    EDGE_PULSE_FADE_STYLES,
    DEFAULT_THEME_RGB.edge,
    DEFAULT_THEME_RGB.edgePulse,
  ),
}

function styleColor(style: FlowchartCellStyle | undefined, colors: FlowchartStyleColors): RGBA | undefined {
  return style ? colors[style] : undefined
}

export function resolveFlowchartStyleColors(
  colors: Partial<Record<FlowchartCellStyle, RGBA | undefined>> = {},
): FlowchartStyleColors {
  const node = colors.node ?? rgba(DEFAULT_THEME_RGB.node)
  const database = colors.database ?? rgba(DEFAULT_THEME_RGB.database)
  const edge = colors.edge ?? rgba(DEFAULT_THEME_RGB.edge)
  const edgePulse = colors.edgePulse ?? brightenColor(edge, 0.65) ?? rgba(DEFAULT_THEME_RGB.edgePulse)
  return {
    node,
    database,
    edge,
    edgePulse,
    label: colors.label ?? rgba(DEFAULT_THEME_RGB.label),
    group: colors.group ?? rgba(DEFAULT_THEME_RGB.group),
    ...createColorRampTheme(NODE_EDGE_FADE_STYLES, node, edge),
    ...createColorRampTheme(DATABASE_EDGE_FADE_STYLES, database, edge),
    ...createColorRampTheme(EDGE_PULSE_FADE_STYLES, edge, edgePulse),
  }
}

export function renderGridStyledText(grid: FlowchartGrid, colors: FlowchartStyleColors): StyledText {
  const chunks: TextChunk[] = []
  grid.forEachRun(
    (run) => {
      chunks.push({ __isChunk: true, text: run.text, fg: styleColor(run.style, colors) })
    },
    () => chunks.push({ __isChunk: true, text: "\n" }),
    { trimBottom: true },
  )
  return new StyledText(chunks)
}

export function renderGridAnsi(grid: FlowchartGrid, theme: FlowchartDiagramAnsiTheme = {}): string {
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
    { trimBottom: true },
  )
  return output
}
