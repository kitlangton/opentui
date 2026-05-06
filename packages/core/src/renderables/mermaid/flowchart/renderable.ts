import type { BorderStyle } from "../../../lib/border.js"
import { parseColor, RGBA, type ColorInput } from "../../../lib/RGBA.js"
import type { RenderContext } from "../../../types.js"
import { TextBufferRenderable } from "../../TextBufferRenderable.js"
import { colorsEqual } from "../../diagram-style.js"
import { DEFAULT_BORDER_STYLE, renderFlowchartGrid } from "./drawing.js"
import type { FlowchartDiagramOptions } from "./options.js"
import { renderGridStyledText, resolveFlowchartStyleColors, type FlowchartGrid } from "./style.js"
import type { FlowchartDirection } from "./types.js"

export class FlowchartDiagramRenderable extends TextBufferRenderable {
  private _content: string
  private _direction?: FlowchartDirection
  private _borderStyle: BorderStyle
  private _minNodeGap?: number
  private _minRankGap?: number
  private _nodeColor?: RGBA
  private _databaseColor?: RGBA
  private _edgeColor?: RGBA
  private _labelColor?: RGBA
  private _groupColor?: RGBA
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
    this._labelColor = options.labelColor ? parseColor(options.labelColor) : undefined
    this._groupColor = options.groupColor ? parseColor(options.groupColor) : undefined
    this.updateDiagram()
  }

  get content(): string {
    return this._content
  }

  set content(value: string) {
    if (this._content === value) return
    this._content = value
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

  set labelColor(value: ColorInput | undefined) {
    this.setColor(this._labelColor, value, (color) => (this._labelColor = color))
  }

  set groupColor(value: ColorInput | undefined) {
    this.setColor(this._groupColor, value, (color) => (this._groupColor = color))
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

  private updateDiagram(): void {
    const grid = renderFlowchartGrid(this._content, {
      direction: this._direction,
      borderStyle: this._borderStyle,
      minNodeGap: this._minNodeGap,
      minRankGap: this._minRankGap,
    })
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
      grid = renderFlowchartGrid(this._content, {
        direction: this._direction,
        borderStyle: this._borderStyle,
        minNodeGap: this._minNodeGap,
        minRankGap: this._minRankGap,
      })
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
          label: this._labelColor,
          group: this._groupColor,
        }),
      ),
    )
    this.updateTextInfo()
  }
}
