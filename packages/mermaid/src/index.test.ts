import { describe, expect, test } from "bun:test"
import {
  detectMermaidDiagram,
  parseMermaidGitGraphDiagram,
  parseMermaidFlowchartDiagram,
  parseMermaidSequenceDiagram,
  parseMermaidStateDiagram,
  parseMermaidTimelineDiagram,
  renderFlowchartDiagram,
  renderGitGraphDiagram,
  renderSequenceDiagram,
  renderStateDiagram,
  renderTimelineDiagram,
} from "./index.js"

describe("public API", () => {
  test("detects, parses, and renders each supported diagram family", () => {
    const fixtures = [
      {
        source: 'gitGraph\n  commit id: "initial"',
        kind: "gitGraph",
        parse: parseMermaidGitGraphDiagram,
        render: renderGitGraphDiagram,
      },
      {
        source: "flowchart LR\n  Parse --> Render",
        kind: "flowchart",
        parse: parseMermaidFlowchartDiagram,
        render: renderFlowchartDiagram,
      },
      {
        source: "sequenceDiagram\n  Client->>Server: request",
        kind: "sequence",
        parse: parseMermaidSequenceDiagram,
        render: renderSequenceDiagram,
      },
      {
        source: "stateDiagram-v2\n  Idle --> Running",
        kind: "state",
        parse: parseMermaidStateDiagram,
        render: renderStateDiagram,
      },
      {
        source: "timeline\n  2026 : Timeline support",
        kind: "timeline",
        parse: parseMermaidTimelineDiagram,
        render: renderTimelineDiagram,
      },
    ] as const

    for (const fixture of fixtures) {
      expect(detectMermaidDiagram(fixture.source)).toBe(fixture.kind)
      expect(fixture.parse(fixture.source)).toBeDefined()
      expect(fixture.render(fixture.source)).not.toBeEmpty()
    }
  })
})
