import { stringWidth } from "../platform/runtime.js"

export type DiagramCanvasCell<Style extends string, Metadata extends object = Record<string, never>> = {
  char: string
  style?: Style
} & Partial<Metadata>

export interface DiagramCanvasRun<Style extends string, Metadata extends object = Record<string, never>> {
  text: string
  style: Style | undefined
  cell: DiagramCanvasCell<Style, Metadata>
}

export interface DiagramCanvasOptions<Style extends string, Metadata extends object = Record<string, never>> {
  measure?: (text: string) => number
  mergeCell?: (
    existing: DiagramCanvasCell<Style, Metadata>,
    incoming: DiagramCanvasCell<Style, Metadata>,
  ) => DiagramCanvasCell<Style, Metadata>
}

export interface DiagramCanvasTextOptions {
  trimBottom?: boolean
}

export interface DiagramCanvasTextSize {
  width: number
  height: number
}

export interface DiagramCanvasRunOptions<Style extends string, Metadata extends object = Record<string, never>> {
  key?: (cell: DiagramCanvasCell<Style, Metadata>) => readonly unknown[]
  trimBottom?: boolean
}

function createEmptyCell<Style extends string, Metadata extends object>(): DiagramCanvasCell<Style, Metadata> {
  return { char: " " } as DiagramCanvasCell<Style, Metadata>
}

function sameKey(left: readonly unknown[] | undefined, right: readonly unknown[]): boolean {
  return Boolean(left && left.length === right.length && left.every((value, index) => Object.is(value, right[index])))
}

export class DiagramCanvas<Style extends string, Metadata extends object = Record<string, never>> {
  readonly rows: Array<Array<DiagramCanvasCell<Style, Metadata>>>

  private readonly measure: (text: string) => number
  private readonly mergeCell?: DiagramCanvasOptions<Style, Metadata>["mergeCell"]

  constructor(
    readonly width: number,
    readonly height: number,
    options: DiagramCanvasOptions<Style, Metadata> = {},
  ) {
    this.measure = options.measure ?? stringWidth
    this.mergeCell = options.mergeCell
    this.rows = Array.from({ length: height }, () => Array.from({ length: width }, () => createEmptyCell()))
  }

  private rowTextEnd(row: Array<DiagramCanvasCell<Style, Metadata>>): number {
    let rowEnd = row.length
    while (rowEnd > 0 && row[rowEnd - 1]?.char === " ") rowEnd -= 1
    return rowEnd
  }

  private rowText(row: Array<DiagramCanvasCell<Style, Metadata>>, rowEnd = this.rowTextEnd(row)): string {
    return row
      .slice(0, rowEnd)
      .map((cell) => cell.char)
      .join("")
  }

  private textRowCount(trimBottom: boolean): number {
    let rowCount = this.rows.length
    if (!trimBottom) return rowCount

    while (rowCount > 0 && this.rowTextEnd(this.rows[rowCount - 1]!) === 0) rowCount -= 1
    return rowCount
  }

  setCell(x: number, y: number, char: string, style?: Style, metadata?: Partial<Metadata>): void {
    if (y < 0 || y >= this.rows.length || x < 0 || x >= this.rows[y]!.length) return

    const incoming = { char, style, ...metadata } as DiagramCanvasCell<Style, Metadata>
    this.rows[y]![x] = this.mergeCell?.(this.rows[y]![x]!, incoming) ?? incoming
  }

  setText(x: number, y: number, text: string, style?: Style, metadata?: Partial<Metadata>): void {
    let offset = 0
    for (const char of text) {
      this.setCell(x + offset, y, char, style, metadata)
      offset += this.measure(char)
    }
  }

  toString(options: DiagramCanvasTextOptions = {}): string {
    const lines: string[] = []
    const rowCount = this.textRowCount(options.trimBottom ?? false)
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
      lines.push(this.rowText(this.rows[rowIndex]!))
    }
    return lines.join("\n")
  }

  getTextSize(options: DiagramCanvasTextOptions = {}): DiagramCanvasTextSize {
    const rowCount = this.textRowCount(options.trimBottom ?? false)
    let width = 0
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
      const row = this.rows[rowIndex]!
      const rowEnd = this.rowTextEnd(row)
      if (rowEnd > 0) width = Math.max(width, this.measure(this.rowText(row, rowEnd)))
    }
    return { width, height: rowCount }
  }

  forEachRun(
    onRun: (run: DiagramCanvasRun<Style, Metadata>) => void,
    onLineEnd: () => void,
    options: DiagramCanvasRunOptions<Style, Metadata> = {},
  ): void {
    const key = options.key
    const rowCount = this.textRowCount(options.trimBottom ?? false)

    for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
      const row = this.rows[rowIndex]!
      const rowEnd = this.rowTextEnd(row)

      let currentCell: DiagramCanvasCell<Style, Metadata> | undefined
      let currentKey: readonly unknown[] | undefined
      let currentText = ""
      const flush = () => {
        if (!currentText || !currentCell) return
        onRun({ text: currentText, style: currentCell.style, cell: currentCell })
        currentText = ""
      }

      for (let x = 0; x < rowEnd; x++) {
        const cell = row[x]!
        const nextKey = key?.(cell)
        const sameRun = currentCell && (key ? sameKey(currentKey, nextKey!) : currentCell.style === cell.style)
        if (!sameRun) {
          flush()
          currentCell = cell
          currentKey = nextKey
        }
        currentText += cell.char
      }

      flush()
      if (rowIndex < rowCount - 1) onLineEnd()
    }
  }
}
