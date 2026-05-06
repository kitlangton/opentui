import { describe, expect, test } from "bun:test"
import type { FlowchartDiagram, FlowchartNodeBounds } from "./types.js"
import { flowchartEdgeLabelLayout, routeFlowchartEdges } from "./routing.js"

function bounds(id: string, left: number, top: number): FlowchartNodeBounds {
  const width = 5
  const height = 3
  return {
    id,
    width,
    height,
    lines: [id],
    left,
    top,
    centerX: left + Math.floor(width / 2),
    centerY: top + Math.floor(height / 2),
  }
}

function diagram(direction: FlowchartDiagram["direction"], edges: FlowchartDiagram["edges"]): FlowchartDiagram {
  return { direction, nodes: [], edges, subgraphs: [] }
}

describe("flowchart routing", () => {
  test("routes a simple horizontal edge from source port to target port", () => {
    const edge = { from: "A", to: "B", label: "" }
    const routes = routeFlowchartEdges(
      diagram("LR", [edge]),
      new Map([
        ["A", bounds("A", 0, 0)],
        ["B", bounds("B", 20, 0)],
      ]),
    )

    expect(routes).toEqual([
      {
        edge,
        points: [
          { x: 5, y: 1 },
          { x: 19, y: 1 },
        ],
      },
    ])
  })

  test("routes horizontal fan-out through a shared bus lane", () => {
    const edges = [
      { from: "A", to: "B", label: "" },
      { from: "A", to: "C", label: "" },
    ]
    const routes = routeFlowchartEdges(
      diagram("LR", edges),
      new Map([
        ["A", bounds("A", 0, 6)],
        ["B", bounds("B", 20, 0)],
        ["C", bounds("C", 20, 12)],
      ]),
    )

    expect(routes.map((route) => route.points)).toEqual([
      [
        { x: 5, y: 7 },
        { x: 8, y: 7 },
        { x: 8, y: 1 },
        { x: 19, y: 1 },
      ],
      [
        { x: 5, y: 7 },
        { x: 8, y: 7 },
        { x: 8, y: 13 },
        { x: 19, y: 13 },
      ],
    ])
  })

  test("routes each horizontal edge once when fan-in and fan-out overlap", () => {
    const edges = [
      { from: "A", to: "C", label: "" },
      { from: "A", to: "D", label: "" },
      { from: "B", to: "C", label: "" },
      { from: "B", to: "D", label: "" },
    ]
    const routes = routeFlowchartEdges(
      diagram("LR", edges),
      new Map([
        ["A", bounds("A", 0, 0)],
        ["B", bounds("B", 0, 12)],
        ["C", bounds("C", 24, 0)],
        ["D", bounds("D", 24, 12)],
      ]),
    )

    expect(routes).toHaveLength(edges.length)
    expect(routes.map((route) => `${route.edge.from}->${route.edge.to}`).sort()).toEqual([
      "A->C",
      "A->D",
      "B->C",
      "B->D",
    ])
  })

  test("routes vertical back-edges around the right side", () => {
    const edge = { from: "B", to: "A", label: "" }
    const routes = routeFlowchartEdges(
      diagram("TD", [edge]),
      new Map([
        ["A", bounds("A", 0, 0)],
        ["B", bounds("B", 0, 12)],
      ]),
    )

    expect(routes).toEqual([
      {
        edge,
        points: [
          { x: 5, y: 13 },
          { x: 8, y: 13 },
          { x: 8, y: 1 },
          { x: 5, y: 1 },
        ],
      },
    ])
  })

  test("routes same-column horizontal-flow edges through vertical ports", () => {
    const edge = { from: "A", to: "B", label: "rollback" }
    const routes = routeFlowchartEdges(
      diagram("LR", [edge]),
      new Map([
        ["A", bounds("A", 20, 0)],
        ["B", bounds("B", 20, 8)],
      ]),
    )

    expect(routes).toEqual([
      {
        edge,
        points: [
          { x: 22, y: 3 },
          { x: 22, y: 7 },
        ],
      },
    ])
    expect(flowchartEdgeLabelLayout(routes[0]!.points, edge.label, (text) => text.length).point).toEqual({
      x: 23,
      y: 5,
    })
  })

  test("places labels inline only when the padded text fits with clearance", () => {
    expect(
      flowchartEdgeLabelLayout(
        [
          { x: 0, y: 2 },
          { x: 13, y: 2 },
        ],
        "rollback",
        (text) => text.length,
      ).point,
    ).toEqual({ x: 2, y: 2 })

    expect(
      flowchartEdgeLabelLayout(
        [
          { x: 0, y: 2 },
          { x: 9, y: 2 },
        ],
        "rollback",
        (text) => text.length,
      ).point,
    ).toEqual({ x: 2, y: 1 })

    expect(
      flowchartEdgeLabelLayout(
        [
          { x: 0, y: 2 },
          { x: 7, y: 2 },
        ],
        "rollback",
        (text) => text.length,
      ).point,
    ).toEqual({ x: 2, y: 1 })

    expect(
      flowchartEdgeLabelLayout(
        [
          { x: 155, y: 5 },
          { x: 150, y: 5 },
          { x: 150, y: 9 },
          { x: 146, y: 9 },
        ],
        "rollback",
        (text) => text.length,
      ).point,
    ).toEqual({ x: 151, y: 7 })
  })
})
