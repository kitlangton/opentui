import { describe, expect, test } from "bun:test"
import { parseColor } from "../lib/RGBA.js"
import { createTestRenderer } from "../testing/test-renderer.js"
import { blendColor, DIAGRAM_FADE_STEPS } from "./diagram-style.js"
import { renderFlowchartGrid } from "./mermaid/flowchart/drawing.js"
import {
  DEFAULT_MIN_RANK_GAP,
  DEFAULT_MIN_VERTICAL_RANK_GAP,
  layoutFlowchartDiagram,
} from "./mermaid/flowchart/layout.js"
import {
  FlowchartDiagramRenderable,
  parseMermaidFlowchartDiagram,
  renderFlowchartDiagram,
  renderFlowchartDiagramAnsi,
} from "./FlowchartDiagram.js"

function flowchartTextSize(content: string): { width: number; height: number } {
  return renderFlowchartGrid(content).getTextSize({ trimBottom: true })
}

function routeRunsAlongHorizontalBorder(
  route: { points: readonly { x: number; y: number }[] },
  bounds: { left: number; top: number; width: number; height: number },
): boolean {
  const borderYs = new Set([bounds.top, bounds.top + bounds.height - 1])
  const left = bounds.left
  const right = bounds.left + bounds.width - 1

  for (let index = 1; index < route.points.length; index++) {
    const from = route.points[index - 1]!
    const to = route.points[index]!
    if (from.y !== to.y || !borderYs.has(from.y)) continue
    if (Math.max(from.x, to.x) >= left && Math.min(from.x, to.x) <= right) return true
  }
  return false
}

describe("FlowchartDiagram", () => {
  test("parses Mermaid flowchart nodes and standard arrows", () => {
    const diagram = parseMermaidFlowchartDiagram(`
flowchart TD
  Start([Start]):::focus --> Form[Collect Details]
  Form -->|valid| Store[(Orders DB)]:::store
  Form -- invalid --> Review(Manual Review)
  Review --> Decision{Approved?}
`)

    expect(diagram.direction).toBe("TD")
    expect(diagram.nodes).toEqual([
      { id: "Start", label: "Start", shape: "rounded" },
      { id: "Form", label: "Collect Details", shape: "box" },
      { id: "Store", label: "Orders DB", shape: "database" },
      { id: "Review", label: "Manual Review", shape: "rounded" },
      { id: "Decision", label: "Approved?", shape: "decision" },
    ])
    expect(diagram.edges).toEqual([
      { from: "Start", to: "Form", label: "" },
      { from: "Form", to: "Store", label: "valid" },
      { from: "Form", to: "Review", label: "invalid" },
      { from: "Review", to: "Decision", label: "" },
    ])
  })

  test("parses Mermaid subgraph groups", () => {
    const diagram = parseMermaidFlowchartDiagram(`
flowchart LR
  subgraph Web [Web App]
    UI[UI] --> API[API]
  end
  subgraph Platform
    API --> DB[(Database)]
  end
`)

    expect(diagram.subgraphs).toEqual([
      { id: "Web", label: "Web App", nodeIds: ["UI", "API"], parentId: undefined },
      { id: "Platform", label: "Platform", nodeIds: ["API", "DB"], parentId: undefined },
    ])
  })

  test("parses Mermaid subgraph-local directions", () => {
    const diagram = parseMermaidFlowchartDiagram(`
flowchart TD
  subgraph Verse
    direction LR
    A[A] --> B[B]
  end
`)

    expect(diagram.subgraphs).toEqual([
      { id: "Verse", label: "Verse", nodeIds: ["A", "B"], parentId: undefined, direction: "LR" },
    ])
  })

  test("parses and renders Mermaid subroutine nodes", () => {
    const content = `
flowchart LR
  Parse[[Parse]] --> Layout[Layout]
`
    const diagram = parseMermaidFlowchartDiagram(content)
    const output = renderFlowchartDiagram(content)

    expect(diagram.nodes[0]).toEqual({ id: "Parse", label: "Parse", shape: "subroutine" })
    expect(output).toContain("╭─┬─────┬─╮")
    expect(output).toContain("│ │Parse│ ├")
    expect(output).toContain("╰─┴─────┴─╯")
  })

  test("parses and renders Mermaid thick edges", () => {
    const content = `
flowchart LR
  Build[Build] ==> Ship[Ship]
`
    const diagram = parseMermaidFlowchartDiagram(content)
    const output = renderFlowchartDiagram(content)

    expect(diagram.edges).toEqual([{ from: "Build", to: "Ship", label: "", style: "thick" }])
    expect(output).toContain("━━━━━━━━━▶")
  })

  test("parses and renders Mermaid dashed edges", () => {
    const content = `
flowchart LR
  Build[Build] -.-> Ship[Ship]
`
    const diagram = parseMermaidFlowchartDiagram(content)
    const output = renderFlowchartDiagram(content)

    expect(diagram.edges).toEqual([{ from: "Build", to: "Ship", label: "", style: "dashed" }])
    expect(output).toContain("─ ─ ─ ─ ─▶")
  })

  test("tracks nested Mermaid subgraphs", () => {
    const diagram = parseMermaidFlowchartDiagram(`
flowchart LR
  subgraph Outer
    subgraph Inner [Inner Work]
      A[A] --> B[B]
    end
    B --> C[C]
  end
`)

    expect(diagram.subgraphs).toEqual([
      { id: "Outer", label: "Outer", nodeIds: ["B", "C"], parentId: undefined },
      { id: "Inner", label: "Inner Work", nodeIds: ["A", "B"], parentId: "Outer" },
    ])
  })

  test("detects graph headers and renders a terminal flowchart", () => {
    const output = renderFlowchartDiagram(`
graph LR
  Client([Client]) --> API[API]
  API --> Cache[(Cache)]
`)

    expect(output).toMatchInlineSnapshot(`
      "                                     ╭───────╮
      ╭────────╮          ╭─────╮          ├───────┤
      │ Client ├─────────▶│ API ├─────────▶│ Cache │
      ╰────────╯          ╰─────╯          ├───────┤
                                           ╰───────╯"
    `)
  })

  test("renders Mermaid decision diamond nodes", () => {
    const output = renderFlowchartDiagram(`
flowchart LR
  Build[Build] --> Gate{Ready?}
  Gate -->|yes| Ship([Ship])
  Gate -->|no| Fix[Fix]
`)

    expect(output).toContain("Ready?")
    expect(output).toContain("╭─╯")
    expect(output).toContain("╰─╮")
    expect(output).toContain("yes")
    expect(output).toContain("no")
    expect(output).not.toMatch(/[╱╲\\/]/)
  })

  test("pads edge labels away from corners and arrowheads", () => {
    const output = renderFlowchartDiagram(`
flowchart LR
  Gate{Ready?} -->|pass| Stage[(Stage)]
  Gate -->|notes| Notes([Notes])
`)

    expect(output).toContain(" pass ")
    expect(output).toContain(" notes ")
    expect(output).not.toContain("┌pass")
    expect(output).not.toContain("└notes")
    expect(output).not.toContain("pass─▶")
    expect(output).not.toContain("notes▶")
  })

  test("only expands horizontal rank gaps for labeled edges", () => {
    const { bounds } = layoutFlowchartDiagram(`
flowchart LR
  Spec[Spec] --> Plan[Plan]
  Plan --> Build[Build]
  Build --> Gate{Ready?}
  Gate -->|pass| Stage[(Stage)]
`)
    const gapBetween = (fromId: string, toId: string): number => {
      const from = bounds.get(fromId)!
      const to = bounds.get(toId)!
      return to.left - (from.left + from.width)
    }

    expect(gapBetween("Spec", "Plan")).toBe(DEFAULT_MIN_RANK_GAP)
    expect(gapBetween("Plan", "Build")).toBe(DEFAULT_MIN_RANK_GAP)
    expect(gapBetween("Build", "Gate")).toBe(DEFAULT_MIN_RANK_GAP)
    expect(gapBetween("Gate", "Stage")).toBeGreaterThan(DEFAULT_MIN_RANK_GAP)
  })

  test("renders Mermaid subgraph frames", () => {
    const output = renderFlowchartDiagram(`
graph LR
  subgraph Web [Web App]
    UI[UI] --> API[API]
  end
  API --> DB[(DB)]
`)

    expect(output).toContain("Web App")
    expect(output).toContain("UI")
    expect(output).toContain("API")
    expect(output).toContain("DB")
    expect(output).toContain("╭─ Web App ")
    expect(output.split("\n").find((line) => line.includes("API") && line.includes("DB"))).not.toContain("┼")
  })

  test("lays out subgraph-local directions independently from the outer flow", () => {
    const layout = layoutFlowchartDiagram(`
flowchart TD
  Start[Start] --> A[A]
  subgraph Steps
    direction LR
    A --> B[B]
    B --> C[C]
  end
  C --> Done[Done]
`)
    const a = layout.bounds.get("A")!
    const b = layout.bounds.get("B")!
    const c = layout.bounds.get("C")!
    const done = layout.bounds.get("Done")!
    const route = layout.routes.find((candidate) => candidate.edge.from === "A" && candidate.edge.to === "B")!

    expect(a.centerY).toBe(b.centerY)
    expect(b.left).toBeGreaterThan(a.left)
    expect(c.left).toBeGreaterThan(b.left)
    expect(done.top).toBeGreaterThan(c.top)
    expect(route.points[0]!.y).toBe(route.points[route.points.length - 1]!.y)
  })

  test("compacts stacked subgraph-local direction rows", () => {
    const layout = layoutFlowchartDiagram(`
flowchart TD
  Start[Start] --> A
  subgraph First [first row]
    direction LR
    A[A] --> B[B]
  end
  B --> C
  subgraph Second [second row]
    direction LR
    C[C] --> D[D]
  end
  D --> Done[Done]
`)
    const first = layout.subgraphBounds.get("First")!
    const second = layout.subgraphBounds.get("Second")!
    const betweenRows = layout.routes.find((route) => route.edge.from === "B" && route.edge.to === "C")!

    expect(second.top).toBeGreaterThan(first.top)
    expect(second.top - (first.top + first.height)).toBeLessThanOrEqual(DEFAULT_MIN_VERTICAL_RANK_GAP)
    expect(routeRunsAlongHorizontalBorder(betweenRows, first)).toBe(false)
    expect(routeRunsAlongHorizontalBorder(betweenRows, second)).toBe(false)
  })

  test("keeps subgraph labels readable when routes enter through the frame", () => {
    const output = renderFlowchartDiagram(`
flowchart TD
  Start[Start] --> Remember
  subgraph Remembering [remember to]
    direction LR
    Remember[remember to] --> Heart[Heart]
  end
`)

    expect(output).toContain(" remember to ")
    expect(output).not.toContain("rememb▼r")
  })

  test("keeps grouped fan routes orthogonal after subgraph translation", () => {
    const layout = layoutFlowchartDiagram(`
flowchart LR
  Brief([Sketch Brief]) --> Parse[Parse Mermaid]
  subgraph Plan [Diagram Plan]
    Parse --> Layout[Rank Layout]
    Parse --> Cache[(Diagram Cache)]
  end
  Layout --> Preview([Terminal Preview])
  Cache --> Preview
`)

    for (const route of layout.routes) {
      for (let index = 1; index < route.points.length; index++) {
        const from = route.points[index - 1]!
        const to = route.points[index]!
        expect(from.x === to.x || from.y === to.y).toBe(true)
      }
    }
  })

  test("moves subgraph labels away from crossing routes", () => {
    const output = renderFlowchartDiagram(`
flowchart TD
  Payment -->|approved| Orders[(Orders DB)]
  Payment -->|declined| Retry([Retry])
  Orders --> Receipt([Receipt])
  subgraph Fulfill [Fulfillment]
    Orders[(Orders DB)]
    Receipt([Receipt])
  end
`)
    const lines = output.split("\n")
    const titleLineIndex = lines.findIndex((line) => line.includes("Fulfillment"))
    const ordersLineIndex = lines.findIndex((line) => line.includes("Orders DB"))

    expect(titleLineIndex).toBeGreaterThan(ordersLineIndex)
    expect(lines[titleLineIndex]).not.toContain("approved")
  })

  test("renders labeled vertical branches", () => {
    const output = renderFlowchartDiagram(`
flowchart TD
  Input([Input]) --> Router[Route]
  Router -->|hit| Cache[(Cache)]
  Router -->|miss| Worker[Worker]
`)

    expect(output).toContain("Input")
    expect(output).toContain("Route")
    expect(output).toContain("Cache")
    expect(output).toContain("Worker")
    expect(output).toContain("hit")
    expect(output).toContain("miss")
    expect(output).toContain("▼")
  })

  test("routes branch edges without diagonal glyphs", () => {
    const output = renderFlowchartDiagram(`
graph LR
  Ticket([Ticket]) --> Triage[Auto Triage]
  Triage -->|billing| Billing[Billing Queue]
  Triage -->|bug| Bugs[(Bug Tracker)]
  Triage -->|question| Docs[Docs Reply]
  Billing --> Done([Closed])
  Bugs --> Done
  Docs --> Done
`)

    expect(output).toContain("Billing Queue")
    expect(output).toContain("Bug Tracker")
    expect(output).toContain("Docs Reply")
    expect(output).toContain("┼")
    expect(output).not.toMatch(/[▲▼]│/)
    expect(output).not.toMatch(/[╱╲\\/]/)
  })

  test("keeps vertical branch labels separated from return edges", () => {
    const output = renderFlowchartDiagram(`
flowchart TD
  Cart([Cart]) --> Address[Address]
  Address --> Payment[Payment]
  Payment -->|approved| Orders[(Orders DB)]
  Payment -->|declined| Retry([Retry])
  Retry --> Payment
  Orders --> Receipt([Receipt])
`)

    expect(output).toContain("approved")
    expect(output).toContain("declined")
    expect(output).not.toContain("approveddeclined")
    expect(output).not.toContain("declinedapproved")
  })

  test("expands canvas to include back-edge labels", () => {
    const output = renderFlowchartDiagram(`
flowchart TD
  A --> B
  B -->|again| A
`)

    expect(output).toContain("again")
  })

  test("keeps vertical flowcharts compact with attached source connectors", () => {
    const output = renderFlowchartDiagram(`
flowchart TD
  Cart([Cart]) --> Address[Address]
  Address --> Payment[Payment]
  Payment -->|approved| Orders[(Orders DB)]
  Payment -->|declined| Retry([Retry])
  Retry --> Payment
  Orders --> Receipt([Receipt])
`)
    const lines = output.split("\n")
    const cartConnectorLineIndex = lines.findIndex((line) => line.includes("┬"))
    const connectorColumn = [...lines[cartConnectorLineIndex]!].indexOf("┬")

    expect(lines.length).toBeLessThanOrEqual(34)
    expect([...lines[cartConnectorLineIndex + 1]!][connectorColumn]).toBe("│")
  })

  test("keeps short back-edge labels out of source nodes", () => {
    const output = renderFlowchartDiagram(`
flowchart LR
  Build[Build Services] --> Test[Integration Tests]
  Test -->|pass| Canary[Canary]
  Test -->|fail| Fix[Fix Forward]
  Fix --> Build
  Canary -->|rollback| Fix
`)
    const rollbackLine = output.split("\n").find((line) => line.includes("rollback"))

    expect(rollbackLine).toBeDefined()
    expect(rollbackLine).not.toContain("Canary")
    expect(rollbackLine).not.toContain("Fix Forward")
  })

  test("renders ANSI output with configurable styles", () => {
    const output = renderFlowchartDiagramAnsi(
      `
flowchart LR
  A --> B
`,
      { theme: { edge: "\x1b[31m" } },
    )

    expect(output).toContain("\x1b[31m")
    expect(output).toContain("▶")
    expect(output.endsWith("\n")).toBe(false)
  })

  test("renders subgraph frames with group styling", () => {
    const output = renderFlowchartDiagramAnsi(
      `
flowchart LR
  subgraph Web [Web App]
    UI[UI] --> API[API]
  end
`,
      { theme: { group: "\x1b[2m", edge: "\x1b[31m" } },
    )

    expect(output).toContain("\x1b[2m")
    expect(output).toContain("Web App")
  })

  test("renders ANSI pulse styles on flowchart arrows", () => {
    const output = renderFlowchartDiagramAnsi(
      `
flowchart LR
  A --> B
`,
      {
        pulseProgress: 0.5,
        pulseLength: 5,
        theme: {
          edgePulse: "[pulse]",
          edgePulseFade1: "[pulse-fade-1]",
          edgePulseFade2: "[pulse-fade-2]",
        },
      },
    )

    expect(output).toContain("[pulse]")
    expect(output).toContain("[pulse-fade-")
  })

  test("lets pulses start at source connectors", () => {
    const grid = renderFlowchartGrid("flowchart TD\n  A[A] ==> B[B]", { pulseProgress: 0, pulseLength: 5 })
    const sourceConnector = [...grid.rows.flatMap((row) => row)].find((cell) => cell?.char === "┬")

    expect(sourceConnector?.style).toBe("edgePulseFade1")
  })

  test("applies renderable pulse color separately from edge color", async () => {
    const { renderer, renderOnce, captureSpans } = await createTestRenderer({ width: 60, height: 8 })
    const pulseColor = parseColor("#f8fafc")
    const edgeColor = parseColor("#38bdf8")
    const diagram = new FlowchartDiagramRenderable(renderer, {
      id: "flowchart-pulse-style",
      content: "flowchart LR\n  A --> B",
      edgeColor,
      pulseColor,
      pulseProgress: 0.5,
      pulseLength: 5,
    })

    renderer.root.add(diagram)
    await renderOnce()

    const spans = captureSpans().lines.flatMap((line) => line.spans)
    const pulseSpan = spans.find((span) => span.fg?.equals(pulseColor))
    const edgeSpan = spans.find((span) => span.fg?.equals(edgeColor))
    expect(pulseSpan).toBeTruthy()
    expect(edgeSpan).toBeTruthy()

    renderer.destroy()
  })

  test("lets pulses travel through inline edge labels", async () => {
    const { renderer, renderOnce, captureSpans } = await createTestRenderer({ width: 90, height: 8 })
    const pulseColor = parseColor("#f8fafc")
    const labelColor = parseColor("#86e1c8")
    const diagram = new FlowchartDiagramRenderable(renderer, {
      id: "flowchart-label-pulse",
      content: "flowchart LR\n  Gate{Ready?} -->|pass| Stage[(Stage)]",
      labelColor,
      pulseColor,
      pulseProgress: 0.5,
      pulseLength: 17,
    })

    renderer.root.add(diagram)
    await renderOnce()

    const labelLine = captureSpans().lines.find((line) => line.spans.some((span) => span.text.includes("pass")))
    const pulsedLabelSpan = labelLine?.spans.find((span) => span.text.includes("pass") && !span.fg?.equals(labelColor))
    expect(pulsedLabelSpan).toBeTruthy()

    renderer.destroy()
  })

  test("applies renderable group color separately from edges", async () => {
    const { renderer, renderOnce, captureSpans } = await createTestRenderer({ width: 80, height: 12 })
    const groupColor = parseColor("#123456")
    const edgeColor = parseColor("#abcdef")
    const diagram = new FlowchartDiagramRenderable(renderer, {
      id: "flowchart-group-style",
      content: `flowchart LR
  subgraph Web [Web App]
    UI[UI] --> API[API]
  end`,
      groupColor,
      edgeColor,
    })

    renderer.root.add(diagram)
    await renderOnce()

    const frame = captureSpans()
    const groupLabel = frame.lines.flatMap((line) => line.spans).find((span) => span.text.includes("Web App"))
    const edge = frame.lines.flatMap((line) => line.spans).find((span) => span.text.includes("▶"))
    expect(groupLabel?.fg.equals(groupColor)).toBe(true)
    expect(edge?.fg.equals(edgeColor)).toBe(true)

    renderer.destroy()
  })

  test("updates renderable content and colors", async () => {
    const { renderer, renderOnce, captureCharFrame, captureSpans } = await createTestRenderer({ width: 60, height: 16 })
    const initialContent = "flowchart LR\n  A --> B"
    const diagram = new FlowchartDiagramRenderable(renderer, {
      id: "flowchart",
      content: initialContent,
      nodeColor: "#ff0000",
    })
    const initialSize = flowchartTextSize(initialContent)

    expect({ width: diagram.renderedWidth, height: diagram.renderedHeight }).toEqual(initialSize)
    expect(diagram.scrollHeight).toBe(initialSize.height)

    renderer.root.add(diagram)
    await renderOnce()
    expect(captureCharFrame()).toContain("A")

    const updatedContent = "flowchart LR\n  A --> C"
    diagram.content = updatedContent
    const nodeColor = parseColor("#00ff00")
    const edgeColor = parseColor("#0000ff")
    diagram.nodeColor = nodeColor
    diagram.edgeColor = edgeColor
    expect({ width: diagram.renderedWidth, height: diagram.renderedHeight }).toEqual(flowchartTextSize(updatedContent))
    await renderOnce()

    expect(captureCharFrame()).toContain("C")
    const frame = captureSpans()
    const sourceConnector = frame.lines.flatMap((line) => line.spans).find((span) => span.text.includes("├"))
    expect(frame.lines.some((line) => line.spans.some((span) => span.fg.equals(parseColor("#00ff00"))))).toBe(true)
    expect(sourceConnector?.fg.equals(blendColor(nodeColor, edgeColor, 1 / (DIAGRAM_FADE_STEPS.length + 1)))).toBe(true)
    expect(sourceConnector?.fg.equals(edgeColor)).toBe(false)

    renderer.destroy()
  })
})
