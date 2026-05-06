import { describe, expect, test } from "bun:test"
import { parseColor } from "../lib/RGBA.js"
import { createTestRenderer } from "../testing/test-renderer.js"
import { blendColor, DIAGRAM_FADE_STEPS } from "./diagram-style.js"
import { renderFlowchartGrid } from "./mermaid/flowchart/drawing.js"
import { layoutFlowchartDiagram } from "./mermaid/flowchart/layout.js"
import {
  FlowchartDiagramRenderable,
  parseMermaidFlowchartDiagram,
  renderFlowchartDiagram,
  renderFlowchartDiagramAnsi,
} from "./FlowchartDiagram.js"

function flowchartTextSize(content: string): { width: number; height: number } {
  return renderFlowchartGrid(content).getTextSize({ trimBottom: true })
}

describe("FlowchartDiagram", () => {
  test("parses Mermaid flowchart nodes and standard arrows", () => {
    const diagram = parseMermaidFlowchartDiagram(`
flowchart TD
  Start([Start]):::focus --> Form[Collect Details]
  Form -->|valid| Store[(Orders DB)]:::store
  Form -- invalid --> Review(Manual Review)
`)

    expect(diagram.direction).toBe("TD")
    expect(diagram.nodes).toEqual([
      { id: "Start", label: "Start", shape: "rounded" },
      { id: "Form", label: "Collect Details", shape: "box" },
      { id: "Store", label: "Orders DB", shape: "database" },
      { id: "Review", label: "Manual Review", shape: "rounded" },
    ])
    expect(diagram.edges).toEqual([
      { from: "Start", to: "Form", label: "" },
      { from: "Form", to: "Store", label: "valid" },
      { from: "Form", to: "Review", label: "invalid" },
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
      "╭────────╮          ╭─────╮          ╭───────╮
      │ Client ├─────────▶│ API ├─────────▶│ Cache │
      ╰────────╯          ╰─────╯          ╰───────╯"
    `)
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

    expect(lines.length).toBeLessThanOrEqual(32)
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
