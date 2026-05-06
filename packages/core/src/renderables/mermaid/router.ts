import type { Renderable } from "../../Renderable.js"
import type { RGBA } from "../../lib/RGBA.js"
import type { RenderContext } from "../../types.js"
import { FlowchartDiagramRenderable, isMermaidFlowchartDiagram } from "./flowchart/FlowchartDiagram.js"
import { isMermaidSequenceDiagram, SequenceDiagramRenderable } from "../SequenceDiagram.js"
import { isMermaidStateDiagram, StateDiagramRenderable } from "../StateDiagram.js"

export type MermaidDiagramKind = "flowchart" | "sequence" | "state"
export type MermaidDiagramRenderable = FlowchartDiagramRenderable | SequenceDiagramRenderable | StateDiagramRenderable

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

type MermaidRenderableConstructor<RenderableType extends MermaidDiagramRenderable> = new (
  ctx: RenderContext,
  options: MermaidDiagramRenderableOptions & { width: "100%" },
) => RenderableType

function applyDiagramRenderable(
  renderable: MermaidDiagramRenderable,
  options: Omit<MermaidDiagramRenderableOptions, "id">,
): void {
  renderable.content = options.content
  renderable.fg = options.fg
  renderable.bg = options.bg
  renderable.marginBottom = options.marginBottom ?? 0
}

function createMermaidAdapter<RenderableType extends MermaidDiagramRenderable>(
  kind: MermaidDiagramKind,
  matches: (content: string) => boolean,
  RenderableClass: MermaidRenderableConstructor<RenderableType>,
): MermaidDiagramAdapter {
  return {
    kind,
    matches,
    isRenderable: (renderable: Renderable): renderable is RenderableType => renderable instanceof RenderableClass,
    create: (ctx: RenderContext, options: MermaidDiagramRenderableOptions): RenderableType =>
      new RenderableClass(ctx, {
        id: options.id,
        content: options.content,
        fg: options.fg,
        bg: options.bg,
        width: "100%",
        marginBottom: options.marginBottom ?? 0,
      }),
    apply: applyDiagramRenderable,
  }
}

export const MERMAID_DIAGRAM_ADAPTERS = [
  createMermaidAdapter("flowchart", isMermaidFlowchartDiagram, FlowchartDiagramRenderable),
  createMermaidAdapter("sequence", isMermaidSequenceDiagram, SequenceDiagramRenderable),
  createMermaidAdapter("state", isMermaidStateDiagram, StateDiagramRenderable),
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
