import { ANSI } from "../../../ansi.js"
import { RGBA } from "../../../lib/RGBA.js"
import { StyledText } from "../../../lib/styled-text.js"
import type { TextChunk } from "../../../text-buffer.js"
import type { DiagramCanvas } from "../../diagram-canvas.js"
import {
  ansiFg,
  createColorRampTheme,
  createAnsiRampTheme,
  DIAGRAM_FADE_STEPS,
  numberedStyleKeys,
  rgba,
  type DiagramFadeStep,
  type DiagramRgb,
} from "../../diagram-style.js"

export type FlowchartBaseCellStyle = "node" | "database" | "edge" | "label" | "group"
export type FlowchartNodeEdgeFadeStyle = `nodeEdgeFade${DiagramFadeStep}`
export type FlowchartDatabaseEdgeFadeStyle = `databaseEdgeFade${DiagramFadeStep}`
export type FlowchartEdgeFadeStyle = FlowchartNodeEdgeFadeStyle | FlowchartDatabaseEdgeFadeStyle
export type FlowchartCellStyle = FlowchartBaseCellStyle | FlowchartEdgeFadeStyle
export type FlowchartGrid = DiagramCanvas<FlowchartCellStyle>
export type FlowchartStyleColors = Required<Record<FlowchartCellStyle, RGBA>>
export type FlowchartDiagramAnsiTheme = Partial<Record<FlowchartBaseCellStyle, string>>

export const DEFAULT_THEME_RGB = {
  node: [228, 239, 232],
  database: [228, 239, 232],
  edge: [134, 225, 200],
  label: [134, 225, 200],
  group: [76, 99, 89],
} as const satisfies Record<FlowchartBaseCellStyle, DiagramRgb>

export const NODE_EDGE_FADE_STYLES = numberedStyleKeys("nodeEdgeFade", DIAGRAM_FADE_STEPS)
export const DATABASE_EDGE_FADE_STYLES = numberedStyleKeys("databaseEdgeFade", DIAGRAM_FADE_STEPS)

const DEFAULT_ANSI_THEME: Required<Record<FlowchartCellStyle, string>> = {
  node: ansiFg(DEFAULT_THEME_RGB.node),
  database: ansiFg(DEFAULT_THEME_RGB.database),
  edge: ansiFg(DEFAULT_THEME_RGB.edge),
  label: ansiFg(DEFAULT_THEME_RGB.label),
  group: ansiFg(DEFAULT_THEME_RGB.group),
  ...createAnsiRampTheme(NODE_EDGE_FADE_STYLES, DEFAULT_THEME_RGB.node, DEFAULT_THEME_RGB.edge),
  ...createAnsiRampTheme(DATABASE_EDGE_FADE_STYLES, DEFAULT_THEME_RGB.database, DEFAULT_THEME_RGB.edge),
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
  return {
    node,
    database,
    edge,
    label: colors.label ?? rgba(DEFAULT_THEME_RGB.label),
    group: colors.group ?? rgba(DEFAULT_THEME_RGB.group),
    ...createColorRampTheme(NODE_EDGE_FADE_STYLES, node, edge),
    ...createColorRampTheme(DATABASE_EDGE_FADE_STYLES, database, edge),
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
