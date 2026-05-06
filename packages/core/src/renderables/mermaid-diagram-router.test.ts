import { describe, expect, test } from "bun:test"
import { mermaidDiagramAdapterForCode } from "./mermaid-diagram-router.js"

describe("Mermaid diagram router", () => {
  test("matches supported Mermaid diagram adapters", () => {
    expect(mermaidDiagramAdapterForCode("mermaid", "graph TD\n  A-->B")?.kind).toBe("flowchart")
    expect(mermaidDiagramAdapterForCode("mermaid", "sequenceDiagram\n  A->>B: hi")?.kind).toBe("sequence")
    expect(mermaidDiagramAdapterForCode("mermaid", "stateDiagram-v2\n  [*] --> Idle")?.kind).toBe("state")
  })

  test("ignores non-Mermaid fences and unsupported Mermaid content", () => {
    expect(mermaidDiagramAdapterForCode("typescript", "sequenceDiagram\n  A->>B: hi")).toBeUndefined()
    expect(mermaidDiagramAdapterForCode("mermaid", "pie\n  title Snacks")).toBeUndefined()
  })
})
