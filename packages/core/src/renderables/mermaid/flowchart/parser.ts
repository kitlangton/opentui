import type {
  FlowchartDiagram,
  FlowchartDirection,
  FlowchartEdge,
  FlowchartEdgeStyle,
  FlowchartNode,
  FlowchartSubgraph,
} from "./types.js"

const DEFAULT_DIRECTION = "TD" satisfies FlowchartDirection
const FLOWCHART_HEADER_RE = /^(flowchart|graph)(?:\s+(TB|TD|BT|LR|RL))?$/i
const ID_RE = "[A-Za-z_][A-Za-z0-9_.-]*"
const SUBGRAPH_RE = /^subgraph\s+(.+)$/i
const SUBGRAPH_WITH_LABEL_RE = new RegExp(`^(${ID_RE})\\s*\\[(.+)\\]$`)
const SUBGRAPH_DIRECTION_RE = /^direction\s+(TB|TD|BT|LR|RL)$/i
const DATABASE_NODE_RE = new RegExp(`^(${ID_RE})\\[\\((.+)\\)\\]$`)
const SUBROUTINE_NODE_RE = new RegExp(`^(${ID_RE})\\[\\[(.+)\\]\\]$`)
const ROUNDED_BRACKET_NODE_RE = new RegExp(`^(${ID_RE})\\(\\[(.+)\\]\\)$`)
const ROUNDED_NODE_RE = new RegExp(`^(${ID_RE})\\((.+)\\)$`)
const DECISION_NODE_RE = new RegExp(`^(${ID_RE})\\{(.+)\\}$`)
const BOX_NODE_RE = new RegExp(`^(${ID_RE})\\[(.+)\\]$`)
const ID_ONLY_RE = new RegExp(`^${ID_RE}$`)
const EXPLICIT_NODE_SHAPE_RE = new RegExp(`^${ID_RE}(?:\\[|\\(|\\{)`)

function stripQuotes(value: string): string {
  const trimmed = value.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function normalizeDirection(value?: string): FlowchartDirection {
  const upper = value?.toUpperCase()
  if (upper === "TB" || upper === "TD" || upper === "BT" || upper === "LR" || upper === "RL") return upper
  return DEFAULT_DIRECTION
}

function normalizeSubgraphId(value: string, index: number): string {
  const stripped = stripQuotes(value)
  return ID_ONLY_RE.test(stripped) ? stripped : `subgraph_${index + 1}`
}

function parseSubgraphToken(token: string, index: number): Pick<FlowchartSubgraph, "id" | "label"> {
  const trimmed = token
    .trim()
    .replace(/\s*:::.*$/, "")
    .replace(/;$/, "")
  const withLabel = trimmed.match(SUBGRAPH_WITH_LABEL_RE)
  if (withLabel) {
    return { id: withLabel[1]!, label: stripQuotes(withLabel[2]!) }
  }

  const label = stripQuotes(trimmed)
  return { id: normalizeSubgraphId(trimmed, index), label }
}

function meaningfulLines(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("%%"))
}

function parseNodeToken(token: string): FlowchartNode {
  const trimmed = token.trim().replace(/;$/, "")
  const database = trimmed.match(DATABASE_NODE_RE)
  if (database) return { id: database[1]!, label: stripQuotes(database[2]!), shape: "database" }

  const subroutine = trimmed.match(SUBROUTINE_NODE_RE)
  if (subroutine) return { id: subroutine[1]!, label: stripQuotes(subroutine[2]!), shape: "subroutine" }

  const roundedBracket = trimmed.match(ROUNDED_BRACKET_NODE_RE)
  if (roundedBracket) return { id: roundedBracket[1]!, label: stripQuotes(roundedBracket[2]!), shape: "rounded" }

  const rounded = trimmed.match(ROUNDED_NODE_RE)
  if (rounded) return { id: rounded[1]!, label: stripQuotes(rounded[2]!), shape: "rounded" }

  const decision = trimmed.match(DECISION_NODE_RE)
  if (decision) return { id: decision[1]!, label: stripQuotes(decision[2]!), shape: "decision" }

  const box = trimmed.match(BOX_NODE_RE)
  if (box) return { id: box[1]!, label: stripQuotes(box[2]!), shape: "box" }

  return { id: trimmed, label: trimmed, shape: "box" }
}

function hasExplicitNodeShape(token: string): boolean {
  return EXPLICIT_NODE_SHAPE_RE.test(token.trim())
}

function ensureNode(nodes: Map<string, FlowchartNode>, token: string): FlowchartNode {
  const node = parseNodeToken(token)
  const existing = nodes.get(node.id)
  if (!existing) {
    nodes.set(node.id, node)
    return node
  }

  if (hasExplicitNodeShape(token)) {
    existing.label = node.label
    existing.shape = node.shape
  }
  return existing
}

function addNodeToSubgraph(subgraph: FlowchartSubgraph | undefined, nodeId: string): void {
  if (!subgraph || subgraph.nodeIds.includes(nodeId)) return
  subgraph.nodeIds.push(nodeId)
}

function stripNodeToken(token: string): string {
  return token
    .replace(/\s*:::.*$/, "")
    .replace(/;$/, "")
    .trim()
}

function edgeStyleFromArrow(...arrows: string[]): FlowchartEdgeStyle | undefined {
  if (arrows.some((arrow) => arrow.includes("=="))) return "thick"
  if (arrows.some((arrow) => arrow.includes("."))) return "dashed"
  return undefined
}

function createEdge(from: string, to: string, label: string, style: FlowchartEdgeStyle | undefined): FlowchartEdge {
  return style ? { from, to, label, style } : { from, to, label }
}

export function isMermaidFlowchartDiagram(content: string): boolean {
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("%%")) continue
    return FLOWCHART_HEADER_RE.test(trimmed)
  }
  return false
}

export function parseMermaidFlowchartDiagram(content: string): FlowchartDiagram {
  const nodes = new Map<string, FlowchartNode>()
  const edges: FlowchartEdge[] = []
  const subgraphs: FlowchartSubgraph[] = []
  const subgraphStack: FlowchartSubgraph[] = []
  let direction: FlowchartDirection = DEFAULT_DIRECTION

  for (const line of meaningfulLines(content)) {
    const header = line.match(FLOWCHART_HEADER_RE)
    if (header) {
      direction = normalizeDirection(header[2])
      continue
    }

    const subgraphMatch = line.match(SUBGRAPH_RE)
    if (subgraphMatch) {
      const parsed = parseSubgraphToken(subgraphMatch[1]!, subgraphs.length)
      const subgraph: FlowchartSubgraph = {
        ...parsed,
        nodeIds: [],
        parentId: subgraphStack[subgraphStack.length - 1]?.id,
      }
      subgraphs.push(subgraph)
      subgraphStack.push(subgraph)
      continue
    }

    if (/^end$/i.test(line)) {
      subgraphStack.pop()
      continue
    }

    const currentSubgraph = subgraphStack[subgraphStack.length - 1]

    const subgraphDirection = line.match(SUBGRAPH_DIRECTION_RE)
    if (subgraphDirection) {
      if (currentSubgraph) currentSubgraph.direction = normalizeDirection(subgraphDirection[1])
      continue
    }

    const pipeEdge = line.match(/^(.+?)\s*(-->|==>|-\.->)\s*(?:\|([^|]*)\|\s*)?(.+)$/)
    const textEdge = line.match(/^(.+?)\s*(--|==|-\.)\s+(.+?)\s+(-->|==>|\.->|-\.->)\s*(.+)$/)
    const edgeMatch = textEdge ?? pipeEdge
    if (edgeMatch) {
      const from = ensureNode(nodes, stripNodeToken(edgeMatch[1]!))
      const toToken = textEdge ? edgeMatch[5]! : edgeMatch[4]!
      const to = ensureNode(nodes, stripNodeToken(toToken))
      addNodeToSubgraph(currentSubgraph, from.id)
      addNodeToSubgraph(currentSubgraph, to.id)
      const arrow = textEdge ? edgeMatch[4]! : edgeMatch[2]!
      const label = textEdge ? edgeMatch[3]! : (edgeMatch[3] ?? "")
      edges.push(createEdge(from.id, to.id, label.trim(), edgeStyleFromArrow(textEdge ? edgeMatch[2]! : arrow, arrow)))
      continue
    }

    if (hasExplicitNodeShape(line)) {
      const node = ensureNode(nodes, line)
      addNodeToSubgraph(currentSubgraph, node.id)
    }
  }

  return { direction, nodes: [...nodes.values()], edges, subgraphs }
}
