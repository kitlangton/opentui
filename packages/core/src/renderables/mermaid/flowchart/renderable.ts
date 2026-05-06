import type { BorderStyle } from "../../../lib/border.js"
import { parseColor, RGBA, type ColorInput } from "../../../lib/RGBA.js"
import type { RenderContext } from "../../../types.js"
import { TextBufferRenderable } from "../../TextBufferRenderable.js"
import { colorsEqual } from "../../diagram-style.js"
import { DEFAULT_BORDER_STYLE, renderFlowchartGrid } from "./drawing.js"
import {
  normalizeFlowchartPulseFrame,
  normalizeFlowchartPulseGap,
  normalizeFlowchartPulseLength,
  normalizeFlowchartPulseProgress,
  type FlowchartDiagramRenderOptions,
  type FlowchartDiagramOptions,
} from "./options.js"
import { parseMermaidFlowchartDiagram } from "./parser.js"
import {
  renderGridStyledText,
  resolveFlowchartStyleColors,
  type FlowchartGrid,
  type FlowchartNodeColors,
} from "./style.js"
import type { FlowchartActiveEdgeSelection, FlowchartDiagram, FlowchartDirection, FlowchartEdge } from "./types.js"

interface IndexedFlowchartEdge {
  edge: FlowchartEdge
  index: number
}

function normalizeFlowchartNodeColors(value: FlowchartNodeColors | undefined): Map<string, RGBA> {
  const colors = new Map<string, RGBA>()
  if (!value) return colors

  const entries = value instanceof Map ? value.entries() : Object.entries(value)
  for (const [nodeId, color] of entries) {
    if (color !== undefined) colors.set(nodeId, parseColor(color))
  }

  return colors
}

function flowchartNodeColorMapsEqual(left: ReadonlyMap<string, RGBA>, right: ReadonlyMap<string, RGBA>): boolean {
  if (left.size !== right.size) return false
  for (const [nodeId, color] of left) {
    if (!colorsEqual(color, right.get(nodeId))) return false
  }
  return true
}

function flowchartActiveEdgesEqual(
  left: FlowchartActiveEdgeSelection | undefined,
  right: FlowchartActiveEdgeSelection | undefined,
): boolean {
  return left?.from === right?.from && left?.to === right?.to && left?.index === right?.index
}

export class FlowchartDiagramRenderable extends TextBufferRenderable {
  private _content: string
  private _direction?: FlowchartDirection
  private _borderStyle: BorderStyle
  private _minNodeGap?: number
  private _minRankGap?: number
  private _nodeColor?: RGBA
  private _databaseColor?: RGBA
  private _edgeColor?: RGBA
  private _activeNodeColor?: RGBA
  private _activeEdgeColor?: RGBA
  private _nodeColors: Map<string, RGBA>
  private _nodeBgColors: Map<string, RGBA>
  private _pulseColor?: RGBA
  private _labelColor?: RGBA
  private _groupColor?: RGBA
  private _pulseFrame?: number
  private _pulseProgress?: number
  private _activeNode?: string
  private _activeEdge?: FlowchartActiveEdgeSelection
  private _selectedConnectionIndex = 0
  private _activeEdgeProgress?: number
  private _pulseLength: number
  private _pulseGap: number
  private _navigationDiagram?: FlowchartDiagram
  private _grid?: FlowchartGrid
  private _renderedWidth = 0
  private _renderedHeight = 0
  private _batchDepth = 0
  private _needsLayoutUpdate = false
  private _needsStyleUpdate = false

  constructor(ctx: RenderContext, options: FlowchartDiagramOptions = {}) {
    super(ctx, { ...options, wrapMode: options.wrapMode ?? "none" })
    this._content = options.content ?? ""
    this._direction = options.direction
    this._borderStyle = options.borderStyle ?? DEFAULT_BORDER_STYLE
    this._minNodeGap = options.minNodeGap
    this._minRankGap = options.minRankGap
    this._nodeColor = options.nodeColor ? parseColor(options.nodeColor) : undefined
    this._databaseColor = options.databaseColor ? parseColor(options.databaseColor) : undefined
    this._edgeColor = options.edgeColor ? parseColor(options.edgeColor) : undefined
    this._activeNodeColor = options.activeNodeColor ? parseColor(options.activeNodeColor) : undefined
    this._activeEdgeColor = options.activeEdgeColor ? parseColor(options.activeEdgeColor) : undefined
    this._nodeColors = normalizeFlowchartNodeColors(options.nodeColors)
    this._nodeBgColors = normalizeFlowchartNodeColors(options.nodeBgColors)
    this._pulseColor = options.pulseColor ? parseColor(options.pulseColor) : undefined
    this._labelColor = options.labelColor ? parseColor(options.labelColor) : undefined
    this._groupColor = options.groupColor ? parseColor(options.groupColor) : undefined
    this._pulseFrame = normalizeFlowchartPulseFrame(options.pulseFrame)
    this._pulseProgress = normalizeFlowchartPulseProgress(options.pulseProgress)
    this._activeNode = options.activeNode
    this._activeEdge = options.activeEdge
    this._activeEdgeProgress = normalizeFlowchartPulseProgress(options.activeEdgeProgress)
    this._pulseLength = normalizeFlowchartPulseLength(options.pulseLength)
    this._pulseGap = normalizeFlowchartPulseGap(options.pulseGap)
    this.updateDiagram()
  }

  get content(): string {
    return this._content
  }

  set content(value: string) {
    if (this._content === value) return
    this._content = value
    this._navigationDiagram = undefined
    this._activeNode = undefined
    this._activeEdge = undefined
    this._selectedConnectionIndex = 0
    this._activeEdgeProgress = undefined
    this.invalidateDiagram()
  }

  get renderedWidth(): number {
    return this._renderedWidth
  }

  get renderedHeight(): number {
    return this._renderedHeight
  }

  set direction(value: FlowchartDirection | undefined) {
    if (this._direction === value) return
    this._direction = value
    this._navigationDiagram = undefined
    this.invalidateDiagram()
  }

  set borderStyle(value: BorderStyle | undefined) {
    const next = value ?? DEFAULT_BORDER_STYLE
    if (this._borderStyle === next) return
    this._borderStyle = next
    this.invalidateDiagram()
  }

  private setColor(
    current: RGBA | undefined,
    value: ColorInput | undefined,
    assign: (color: RGBA | undefined) => void,
  ): void {
    const next = value ? parseColor(value) : undefined
    if (colorsEqual(current, next)) return
    assign(next)
    this.invalidateStyle()
  }

  set nodeColor(value: ColorInput | undefined) {
    this.setColor(this._nodeColor, value, (color) => (this._nodeColor = color))
  }

  set databaseColor(value: ColorInput | undefined) {
    this.setColor(this._databaseColor, value, (color) => (this._databaseColor = color))
  }

  set edgeColor(value: ColorInput | undefined) {
    this.setColor(this._edgeColor, value, (color) => (this._edgeColor = color))
  }

  set activeNodeColor(value: ColorInput | undefined) {
    this.setColor(this._activeNodeColor, value, (color) => (this._activeNodeColor = color))
  }

  set activeEdgeColor(value: ColorInput | undefined) {
    this.setColor(this._activeEdgeColor, value, (color) => (this._activeEdgeColor = color))
  }

  set nodeColors(value: FlowchartNodeColors | undefined) {
    const next = normalizeFlowchartNodeColors(value)
    if (flowchartNodeColorMapsEqual(this._nodeColors, next)) return
    this._nodeColors = next
    this.invalidateStyle()
  }

  set nodeBgColors(value: FlowchartNodeColors | undefined) {
    const next = normalizeFlowchartNodeColors(value)
    if (flowchartNodeColorMapsEqual(this._nodeBgColors, next)) return
    this._nodeBgColors = next
    this.invalidateStyle()
  }

  get activeNode(): string | undefined {
    return this._activeNode
  }

  set activeNode(value: string | undefined) {
    if (this._activeNode === value) return
    this._activeNode = value
    this._activeEdge = undefined
    this._selectedConnectionIndex = 0
    this._activeEdgeProgress = undefined
    this.invalidateDiagram()
  }

  get selectedConnectionIndex(): number {
    return this._selectedConnectionIndex
  }

  get selectedConnection(): FlowchartActiveEdgeSelection | undefined {
    const selected = this.selectedOutgoingEdge()
    return selected ? { from: selected.edge.from, to: selected.edge.to, index: selected.index } : undefined
  }

  get activeEdge(): FlowchartActiveEdgeSelection | undefined {
    return this._activeEdge
  }

  set activeEdge(value: FlowchartActiveEdgeSelection | undefined) {
    if (flowchartActiveEdgesEqual(this._activeEdge, value)) return
    this._activeEdge = value ? { ...value } : undefined
    this.invalidateDiagram()
  }

  get activeEdgeProgress(): number | undefined {
    return this._activeEdgeProgress
  }

  set activeEdgeProgress(value: number | undefined) {
    const next = normalizeFlowchartPulseProgress(value)
    if (this._activeEdgeProgress === next) return
    this._activeEdgeProgress = next
    this.invalidateDiagram()
  }

  set pulseColor(value: ColorInput | undefined) {
    this.setColor(this._pulseColor, value, (color) => (this._pulseColor = color))
  }

  set labelColor(value: ColorInput | undefined) {
    this.setColor(this._labelColor, value, (color) => (this._labelColor = color))
  }

  set groupColor(value: ColorInput | undefined) {
    this.setColor(this._groupColor, value, (color) => (this._groupColor = color))
  }

  get pulseFrame(): number | undefined {
    return this._pulseFrame
  }

  set pulseFrame(value: number | undefined) {
    const next = normalizeFlowchartPulseFrame(value)
    if (this._pulseFrame === next) return
    this._pulseFrame = next
    this.invalidateDiagram()
  }

  get pulseProgress(): number | undefined {
    return this._pulseProgress
  }

  set pulseProgress(value: number | undefined) {
    const next = normalizeFlowchartPulseProgress(value)
    if (this._pulseProgress === next) return
    this._pulseProgress = next
    this.invalidateDiagram()
  }

  get pulseLength(): number {
    return this._pulseLength
  }

  set pulseLength(value: number | undefined) {
    const next = normalizeFlowchartPulseLength(value)
    if (this._pulseLength === next) return
    this._pulseLength = next
    this.invalidateDiagram()
  }

  get pulseGap(): number {
    return this._pulseGap
  }

  set pulseGap(value: number | undefined) {
    const next = normalizeFlowchartPulseGap(value)
    if (this._pulseGap === next) return
    this._pulseGap = next
    this.invalidateDiagram()
  }

  activateFirstNode(): string | undefined {
    if (this._activeNode) return this._activeNode
    const node = this.parsedDiagram().nodes[0]
    if (!node) return undefined
    this.activeNode = node.id
    return node.id
  }

  selectNextConnection(): FlowchartActiveEdgeSelection | undefined {
    return this.selectConnection(1)
  }

  selectPreviousConnection(): FlowchartActiveEdgeSelection | undefined {
    return this.selectConnection(-1)
  }

  private selectConnection(delta: 1 | -1): FlowchartActiveEdgeSelection | undefined {
    this.activateFirstNode()
    const outgoing = this.activeOutgoingEdges()
    if (outgoing.length === 0) return undefined
    this._activeEdge = undefined
    this._activeEdgeProgress = undefined
    if (outgoing.length === 1) {
      this.invalidateDiagram()
      return this.selectedConnection
    }
    this._selectedConnectionIndex = (this._selectedConnectionIndex + delta + outgoing.length) % outgoing.length
    this.invalidateDiagram()
    return this.selectedConnection
  }

  followSelectedConnection(): string | undefined {
    const selected = this.selectedOutgoingEdge()
    if (!selected) return undefined
    this._activeNode = selected.edge.to
    this._activeEdge = undefined
    this._selectedConnectionIndex = 0
    this._activeEdgeProgress = undefined
    this.invalidateDiagram()
    return selected.edge.to
  }

  private parsedDiagram(): FlowchartDiagram {
    if (!this._navigationDiagram) {
      const diagram = parseMermaidFlowchartDiagram(this._content)
      diagram.direction = this._direction ?? diagram.direction
      this._navigationDiagram = diagram
    }
    return this._navigationDiagram
  }

  private activeOutgoingEdges(): IndexedFlowchartEdge[] {
    if (!this._activeNode) return []
    return this.parsedDiagram().edges.flatMap((edge, index) =>
      edge.from === this._activeNode ? [{ edge, index }] : [],
    )
  }

  private selectedOutgoingEdge(): IndexedFlowchartEdge | undefined {
    const outgoing = this.activeOutgoingEdges()
    if (outgoing.length === 0) return undefined
    const index = ((this._selectedConnectionIndex % outgoing.length) + outgoing.length) % outgoing.length
    return outgoing[index]
  }

  batchUpdate(update: () => void): void {
    this._batchDepth += 1
    try {
      update()
    } finally {
      this._batchDepth -= 1
      if (this._batchDepth === 0 && this._needsLayoutUpdate) {
        this._needsLayoutUpdate = false
        this._needsStyleUpdate = false
        this.updateDiagram()
      } else if (this._batchDepth === 0 && this._needsStyleUpdate) {
        this._needsStyleUpdate = false
        this.updateStyledText()
      }
    }
  }

  private invalidateDiagram(): void {
    if (this._batchDepth > 0) {
      this._needsLayoutUpdate = true
      return
    }
    this.updateDiagram()
  }

  private invalidateStyle(): void {
    if (this._batchDepth > 0) {
      this._needsStyleUpdate = true
      return
    }
    this.updateStyledText()
  }

  private renderOptions(): FlowchartDiagramRenderOptions {
    return {
      direction: this._direction,
      borderStyle: this._borderStyle,
      minNodeGap: this._minNodeGap,
      minRankGap: this._minRankGap,
      pulseFrame: this._pulseFrame,
      pulseProgress: this._pulseProgress,
      activeNode: this._activeNode,
      activeEdge: this._activeEdge ?? this.selectedConnection,
      activeEdgeProgress: this._activeEdgeProgress,
      pulseLength: this._pulseLength,
      pulseGap: this._pulseGap,
    }
  }

  private updateDiagram(): void {
    const grid = renderFlowchartGrid(this._content, this.renderOptions())
    this._grid = grid
    this.updateRenderedSize(grid)
    this.updateStyledText()
  }

  private updateRenderedSize(grid: FlowchartGrid): void {
    const size = grid.getTextSize({ trimBottom: true })
    this._renderedWidth = size.width
    this._renderedHeight = size.height
  }

  private updateStyledText(): void {
    let grid = this._grid
    if (!grid) {
      grid = renderFlowchartGrid(this._content, this.renderOptions())
      this._grid = grid
      this.updateRenderedSize(grid)
    }
    this.textBuffer.setStyledText(
      renderGridStyledText(
        grid,
        resolveFlowchartStyleColors({
          node: this._nodeColor,
          database: this._databaseColor,
          edge: this._edgeColor,
          activeNode: this._activeNodeColor,
          activeEdge: this._activeEdgeColor,
          edgePulse: this._pulseColor,
          label: this._labelColor,
          group: this._groupColor,
        }),
        this._nodeColors,
        this._nodeBgColors,
      ),
    )
    this.updateTextInfo()
  }
}
