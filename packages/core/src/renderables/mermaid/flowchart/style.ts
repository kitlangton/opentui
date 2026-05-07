import { ANSI } from "../../../ansi.js"
import { RGBA, type ColorInput } from "../../../lib/RGBA.js"
import { StyledText } from "../../../lib/styled-text.js"
import type { TextChunk } from "../../../text-buffer.js"
import type { DiagramCanvas, DiagramCanvasRunOptions } from "../../diagram-canvas.js"
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

export type FlowchartBaseCellStyle = "node" | "activeNode" | "database" | "edge" | "activeEdge" | "label" | "group"
export type FlowchartNodeEdgeFadeStyle = `nodeEdgeFade${DiagramFadeStep}`
export type FlowchartDatabaseEdgeFadeStyle = `databaseEdgeFade${DiagramFadeStep}`
export type FlowchartEdgeFadeStyle = FlowchartNodeEdgeFadeStyle | FlowchartDatabaseEdgeFadeStyle
export type FlowchartEdgePulseFadeStyle = `edgePulseFade${DiagramFadeStep}`
export type FlowchartEdgePulseStyle = "edgePulse" | FlowchartEdgePulseFadeStyle
export type FlowchartActiveEdgePulseFadeStyle = `activeEdgePulseFade${DiagramFadeStep}`
export type FlowchartActiveEdgePulseStyle = "activeEdgePulse" | FlowchartActiveEdgePulseFadeStyle
export type FlowchartCellStyle =
  | FlowchartBaseCellStyle
  | FlowchartEdgeFadeStyle
  | FlowchartEdgePulseStyle
  | FlowchartActiveEdgePulseStyle
export interface FlowchartCellMetadata {
  nodeId?: string
  bgNodeId?: string
}
export type FlowchartGrid = DiagramCanvas<FlowchartCellStyle, FlowchartCellMetadata>
export type FlowchartStyleColors = Required<Record<FlowchartCellStyle, RGBA>>
export type FlowchartDiagramAnsiTheme = Partial<Record<FlowchartCellStyle, string>>
export type FlowchartNodeColorMap = ReadonlyMap<string, RGBA>
export type FlowchartNodeColors = Record<string, ColorInput | undefined> | ReadonlyMap<string, ColorInput | undefined>

const FLOWCHART_NODE_COLOR_LEVEL_SEPARATOR = "::cell:"
const FLOWCHART_NODE_COLOR_LEVEL_COUNT = 6

function normalizeFlowchartNodeColorLevel(level: number): number {
  return Math.max(0, Math.min(FLOWCHART_NODE_COLOR_LEVEL_COUNT - 1, Math.round(level)))
}

export function flowchartNodeColorKey(nodeId: string, level: number): string {
  return `${nodeId}${FLOWCHART_NODE_COLOR_LEVEL_SEPARATOR}${normalizeFlowchartNodeColorLevel(level)}`
}

function baseFlowchartNodeColorKey(nodeId: string): string {
  const index = nodeId.lastIndexOf(FLOWCHART_NODE_COLOR_LEVEL_SEPARATOR)
  return index === -1 ? nodeId : nodeId.slice(0, index)
}

export const DEFAULT_THEME_RGB = {
  node: [228, 239, 232],
  activeNode: [221, 255, 246],
  database: [228, 239, 232],
  edge: [134, 225, 200],
  activeEdge: [221, 255, 246],
  edgePulse: [221, 255, 246],
  activeEdgePulse: [255, 232, 205],
  label: [134, 225, 200],
  group: [76, 99, 89],
} as const satisfies Record<FlowchartBaseCellStyle | "edgePulse" | "activeEdgePulse", DiagramRgb>

export const NODE_EDGE_FADE_STYLES = numberedStyleKeys("nodeEdgeFade", DIAGRAM_FADE_STEPS)
export const DATABASE_EDGE_FADE_STYLES = numberedStyleKeys("databaseEdgeFade", DIAGRAM_FADE_STEPS)
export const EDGE_PULSE_FADE_STYLES = numberedStyleKeys("edgePulseFade", DIAGRAM_FADE_STEPS)
export const ACTIVE_EDGE_PULSE_FADE_STYLES = numberedStyleKeys("activeEdgePulseFade", DIAGRAM_FADE_STEPS)
export const EDGE_PULSE_STYLES = [
  "edgePulseFade1",
  "edgePulseFade2",
  "edgePulseFade3",
  "edgePulseFade4",
  "edgePulseFade5",
  "edgePulse",
] as const satisfies readonly FlowchartEdgePulseStyle[]
export const ACTIVE_EDGE_PULSE_STYLES = [
  "activeEdgePulseFade1",
  "activeEdgePulseFade2",
  "activeEdgePulseFade3",
  "activeEdgePulseFade4",
  "activeEdgePulseFade5",
  "activeEdgePulse",
] as const satisfies readonly FlowchartActiveEdgePulseStyle[]

const DEFAULT_ANSI_THEME: Required<Record<FlowchartCellStyle, string>> = {
  node: ansiFg(DEFAULT_THEME_RGB.node),
  activeNode: ansiFg(DEFAULT_THEME_RGB.activeNode),
  database: ansiFg(DEFAULT_THEME_RGB.database),
  edge: ansiFg(DEFAULT_THEME_RGB.edge),
  activeEdge: ansiFg(DEFAULT_THEME_RGB.activeEdge),
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
  ...createAnsiPeakAndRampTheme(
    "activeEdgePulse",
    ACTIVE_EDGE_PULSE_FADE_STYLES,
    DEFAULT_THEME_RGB.activeEdge,
    DEFAULT_THEME_RGB.activeEdgePulse,
  ),
}

function nodeMappedColor(colors: FlowchartNodeColorMap | undefined, nodeId: string | undefined): RGBA | undefined {
  return nodeId ? (colors?.get(nodeId) ?? colors?.get(baseFlowchartNodeColorKey(nodeId))) : undefined
}

function styleColor(
  style: FlowchartCellStyle | undefined,
  colors: FlowchartStyleColors,
  nodeColors?: FlowchartNodeColorMap,
  nodeId?: string,
): RGBA | undefined {
  return nodeMappedColor(nodeColors, nodeId) ?? (style ? colors[style] : undefined)
}

function styleBgColor(nodeBgColors: FlowchartNodeColorMap | undefined, nodeId: string | undefined): RGBA | undefined {
  return nodeMappedColor(nodeBgColors, nodeId)
}

export function resolveFlowchartStyleColors(
  colors: Partial<Record<FlowchartCellStyle, RGBA | undefined>> = {},
): FlowchartStyleColors {
  const node = colors.node ?? rgba(DEFAULT_THEME_RGB.node)
  const activeNode = colors.activeNode ?? rgba(DEFAULT_THEME_RGB.activeNode)
  const database = colors.database ?? rgba(DEFAULT_THEME_RGB.database)
  const edge = colors.edge ?? rgba(DEFAULT_THEME_RGB.edge)
  const activeEdge = colors.activeEdge ?? rgba(DEFAULT_THEME_RGB.activeEdge)
  const edgePulse = colors.edgePulse ?? brightenColor(edge, 0.65) ?? rgba(DEFAULT_THEME_RGB.edgePulse)
  const activeEdgePulse = colors.activeEdgePulse ?? rgba(DEFAULT_THEME_RGB.activeEdgePulse)
  return {
    node,
    activeNode,
    database,
    edge,
    activeEdge,
    edgePulse,
    activeEdgePulse,
    label: colors.label ?? rgba(DEFAULT_THEME_RGB.label),
    group: colors.group ?? rgba(DEFAULT_THEME_RGB.group),
    ...createColorRampTheme(NODE_EDGE_FADE_STYLES, node, edge),
    ...createColorRampTheme(DATABASE_EDGE_FADE_STYLES, database, edge),
    ...createColorRampTheme(EDGE_PULSE_FADE_STYLES, edge, edgePulse),
    ...createColorRampTheme(ACTIVE_EDGE_PULSE_FADE_STYLES, activeEdge, activeEdgePulse),
  }
}

export function renderGridStyledText(
  grid: FlowchartGrid,
  colors: FlowchartStyleColors,
  nodeColors?: FlowchartNodeColorMap,
  nodeBgColors?: FlowchartNodeColorMap,
): StyledText {
  const chunks: TextChunk[] = []
  const useNodeRuns = Boolean(nodeColors?.size || nodeBgColors?.size)
  const runOptions: DiagramCanvasRunOptions<FlowchartCellStyle, FlowchartCellMetadata> = useNodeRuns
    ? { trimBottom: true, key: (cell) => [cell.style, cell.nodeId, cell.bgNodeId] }
    : { trimBottom: true }
  grid.forEachRun(
    (run) => {
      chunks.push({
        __isChunk: true,
        text: run.text,
        fg: styleColor(run.style, colors, nodeColors, run.cell.nodeId),
        bg: styleBgColor(nodeBgColors, run.cell.bgNodeId),
      })
    },
    () => chunks.push({ __isChunk: true, text: "\n" }),
    runOptions,
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
