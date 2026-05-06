import { describe, expect, test } from "bun:test"
import { flowchartEdgeLabelLayout } from "./labels.js"

const measure = (text: string): number => text.length

describe("flowchart edge labels", () => {
  test("places vertical-route labels beside the bus", () => {
    expect(
      flowchartEdgeLabelLayout(
        [
          { x: 22, y: 3 },
          { x: 22, y: 7 },
        ],
        "rollback",
        measure,
      ).point,
    ).toEqual({ x: 23, y: 5 })
  })

  test("places labels inline only when padded text fits with clearance", () => {
    expect(
      flowchartEdgeLabelLayout(
        [
          { x: 0, y: 2 },
          { x: 13, y: 2 },
        ],
        "rollback",
        measure,
      ).point,
    ).toEqual({ x: 2, y: 2 })

    expect(
      flowchartEdgeLabelLayout(
        [
          { x: 0, y: 2 },
          { x: 9, y: 2 },
        ],
        "rollback",
        measure,
      ).point,
    ).toEqual({ x: 2, y: 1 })

    expect(
      flowchartEdgeLabelLayout(
        [
          { x: 0, y: 2 },
          { x: 7, y: 2 },
        ],
        "rollback",
        measure,
      ).point,
    ).toEqual({ x: 2, y: 1 })
  })

  test("uses vertical bus labels before short terminal branches", () => {
    expect(
      flowchartEdgeLabelLayout(
        [
          { x: 155, y: 5 },
          { x: 150, y: 5 },
          { x: 150, y: 9 },
          { x: 146, y: 9 },
        ],
        "rollback",
        measure,
      ).point,
    ).toEqual({ x: 151, y: 7 })
  })
})
