import { describe, expect, test } from "bun:test"
import { parseColor } from "../lib/RGBA.js"
import { createTestRenderer } from "../testing/test-renderer.js"
import {
  FlowchartDiagramRenderable,
  parseMermaidFlowchartDiagram,
  renderFlowchartDiagram,
  renderFlowchartDiagramAnsi,
} from "./FlowchartDiagram.js"

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

  test("detects graph headers and renders a terminal flowchart", () => {
    const output = renderFlowchartDiagram(`
graph LR
  Client([Client]) --> API[API]
  API --> Cache[(Cache)]
`)

    expect(output).toMatchInlineSnapshot(`
      "╭────────╮          ╭─────╮          ╭───────╮
      │ Client │─────────▶│ API │─────────▶│ Cache │
      ╰────────╯          ╰─────╯          ╰───────╯"
    `)
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
  })

  test("updates renderable content and colors", async () => {
    const { renderer, renderOnce, captureCharFrame, captureSpans } = await createTestRenderer({ width: 60, height: 16 })
    const diagram = new FlowchartDiagramRenderable(renderer, {
      id: "flowchart",
      content: "flowchart LR\n  A --> B",
      nodeColor: "#ff0000",
    })

    renderer.root.add(diagram)
    await renderOnce()
    expect(captureCharFrame()).toContain("A")

    diagram.content = "flowchart LR\n  A --> C"
    diagram.nodeColor = "#00ff00"
    await renderOnce()

    expect(captureCharFrame()).toContain("C")
    expect(captureSpans().lines.some((line) => line.spans.some((span) => span.fg.equals(parseColor("#00ff00"))))).toBe(
      true,
    )

    renderer.destroy()
  })
})
