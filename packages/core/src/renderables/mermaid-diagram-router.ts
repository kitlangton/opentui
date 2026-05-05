import type { Renderable } from "../Renderable.js"
import type { RGBA } from "../lib/RGBA.js"
import type { RenderContext } from "../types.js"
import { isMermaidSequenceDiagram, SequenceDiagramRenderable } from "./SequenceDiagram.js"
import { isMermaidStateDiagram, StateDiagramRenderable } from "./StateDiagram.js"

export type MermaidDiagramKind = "sequence" | "state"
export type MermaidDiagramRenderable = SequenceDiagramRenderable | StateDiagramRenderable

export interface MermaidDiagramRenderableOptions {
  id: string
  content: string
  fg?: RGBA
  bg?: RGBA
  marginBottom?: number
}

export interface MermaidDiagramAdapter {
  kind: MermaidDiagramKind
  matches: (content: string) => boolean
  isRenderable: (renderable: Renderable) => renderable is MermaidDiagramRenderable
  create: (ctx: RenderContext, options: MermaidDiagramRenderableOptions) => MermaidDiagramRenderable
  apply: (renderable: MermaidDiagramRenderable, options: Omit<MermaidDiagramRenderableOptions, "id">) => void
}

function applyDiagramRenderable(
  renderable: MermaidDiagramRenderable,
  options: Omit<MermaidDiagramRenderableOptions, "id">,
): void {
  renderable.content = options.content
  renderable.fg = options.fg
  renderable.bg = options.bg
  renderable.marginBottom = options.marginBottom ?? 0
}

export const MERMAID_DIAGRAM_ADAPTERS = [
  {
    kind: "sequence",
    matches: isMermaidSequenceDiagram,
    isRenderable: (renderable: Renderable): renderable is SequenceDiagramRenderable =>
      renderable instanceof SequenceDiagramRenderable,
    create: (ctx: RenderContext, options: MermaidDiagramRenderableOptions): SequenceDiagramRenderable =>
      new SequenceDiagramRenderable(ctx, {
        id: options.id,
        content: options.content,
        fg: options.fg,
        bg: options.bg,
        width: "100%",
        marginBottom: options.marginBottom ?? 0,
      }),
    apply: applyDiagramRenderable,
  },
  {
    kind: "state",
    matches: isMermaidStateDiagram,
    isRenderable: (renderable: Renderable): renderable is StateDiagramRenderable =>
      renderable instanceof StateDiagramRenderable,
    create: (ctx: RenderContext, options: MermaidDiagramRenderableOptions): StateDiagramRenderable =>
      new StateDiagramRenderable(ctx, {
        id: options.id,
        content: options.content,
        fg: options.fg,
        bg: options.bg,
        width: "100%",
        marginBottom: options.marginBottom ?? 0,
      }),
    apply: applyDiagramRenderable,
  },
] as const satisfies readonly MermaidDiagramAdapter[]

export function mermaidDiagramAdapterForCode(
  filetype: string | undefined,
  content: string,
): MermaidDiagramAdapter | undefined {
  if (filetype !== "mermaid") return undefined
  return MERMAID_DIAGRAM_ADAPTERS.find((adapter) => adapter.matches(content))
}

export function createMermaidDiagramRenderable(
  ctx: RenderContext,
  adapter: MermaidDiagramAdapter,
  options: MermaidDiagramRenderableOptions,
): MermaidDiagramRenderable {
  return adapter.create(ctx, options)
}

export function applyMermaidDiagramRenderable(
  renderable: Renderable,
  adapter: MermaidDiagramAdapter,
  options: Omit<MermaidDiagramRenderableOptions, "id">,
): boolean {
  if (!adapter.isRenderable(renderable)) return false
  adapter.apply(renderable, options)
  return true
}
