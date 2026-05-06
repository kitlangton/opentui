import {
  type CliRenderer,
  createCliRenderer,
  FlowchartDiagramRenderable,
  type KeyEvent,
  parseColor,
  RGBA,
  renderFlowchartDiagram,
  renderFlowchartDiagramAnsi,
  ScrollBoxRenderable,
  TextRenderable,
} from "@opentui/core"
import { setupCommonDemoKeys } from "./lib/standalone-keys.js"

export const SKETCH_FLOWCHART = `flowchart LR
  Brief([Sketch Brief]) --> Parse[Parse Mermaid]
  subgraph Plan [Diagram Plan]
    Parse --> Layout[Rank Layout]
    Parse --> Cache[(Diagram Cache)]
  end
  Layout --> Preview([Terminal Preview])
  Cache --> Preview`

export const CHECKOUT_FLOWCHART = `flowchart TD
  Cart([Cart]) --> Address[Address]
  Address --> Payment[Payment]
  Payment -->|approved| Orders[(Orders DB)]
  Payment -->|declined| Retry([Retry])
  Retry --> Payment
  Orders --> Receipt([Receipt])`

export const SUPPORT_FLOWCHART = `graph LR
  Ticket([Ticket]) --> Triage[Auto Triage]
  Triage -->|billing| Billing[Billing Queue]
  Triage -->|bug| Bugs[(Bug Tracker)]
  Triage -->|question| Docs[Docs Reply]
  Billing --> Done([Closed])
  Bugs --> Done
  Docs --> Done`

export const RELEASE_FLOWCHART = `flowchart LR
  Spec([Spec]) --> Plan[Plan]
  subgraph BuildPlan [Build Plan]
    Plan --> Build[Build]
    Build --> Gate{Ready?}
  end
  Gate -->|pass| Stage[(Stage)]
  subgraph ReleasePath [Release Path]
    Stage --> Done([Done])
    Notes --> Done
  end
  Gate -->|notes| Notes([Notes])`

interface FlowchartExample {
  title: string
  content: string
}

interface FlowchartTheme {
  name: string
  background: string
  foreground: string
  footer: string
  node: string
  database: string
  edge: string
  pulse: string
  label: string
  group: string
}

interface ParsedFlowchartTheme {
  background: RGBA
  foreground: RGBA
  footer: RGBA
  node: RGBA
  database: RGBA
  edge: RGBA
  pulse: RGBA
  label: RGBA
  group: RGBA
}

const EXAMPLES: FlowchartExample[] = [
  { title: "Sketch Pipeline", content: SKETCH_FLOWCHART },
  { title: "Checkout", content: CHECKOUT_FLOWCHART },
  { title: "Support Routing", content: SUPPORT_FLOWCHART },
  { title: "Release Gate", content: RELEASE_FLOWCHART },
]

const THEMES: FlowchartTheme[] = [
  {
    name: "Moss Copper",
    background: "#101815",
    foreground: "#D7E5DD",
    footer: "#8DA99B",
    node: "#E4EFE8",
    database: "#E4EFE8",
    edge: "#86E1C8",
    pulse: "#DDFFF6",
    label: "#86E1C8",
    group: "#5D766B",
  },
  {
    name: "Glacier",
    background: "#111827",
    foreground: "#D6DEE9",
    footer: "#94A3B8",
    node: "#E7EDF5",
    database: "#E7EDF5",
    edge: "#7DD3FC",
    pulse: "#E0F2FE",
    label: "#BAE6FD",
    group: "#64748B",
  },
  {
    name: "Ink Peach",
    background: "#111422",
    foreground: "#D8DEEE",
    footer: "#9AA6C1",
    node: "#E8ECF8",
    database: "#E8ECF8",
    edge: "#93C5FD",
    pulse: "#FFE4D6",
    label: "#C4B5FD",
    group: "#68738F",
  },
]

let diagram: FlowchartDiagramRenderable | undefined
let scrollBox: ScrollBoxRenderable | undefined
let footer: TextRenderable | undefined
let exampleIndex = 0
let themeIndex = 0
let activeRenderer: CliRenderer | undefined
let keyHandler: ((key: KeyEvent) => void) | undefined
let resizeHandler: (() => void) | undefined
let animationTimer: ReturnType<typeof setInterval> | undefined
let lastPulseStepAt = 0
let currentThemeColors: ParsedFlowchartTheme | undefined
let themeTransition: { from: ParsedFlowchartTheme; to: ParsedFlowchartTheme; startedAt: number } | undefined
const parsedThemeCache = new WeakMap<FlowchartTheme, ParsedFlowchartTheme>()
const THEME_TRANSITION_MS = 260
const ANIMATION_INTERVAL_MS = 16
const PULSE_STEP_MS = 60
const DEMO_PULSE_LENGTH = 9
const DEMO_PULSE_GAP = 22
const SCROLLBOX_PADDING = 1

function parsedTheme(theme: FlowchartTheme): ParsedFlowchartTheme {
  const cached = parsedThemeCache.get(theme)
  if (cached) return cached

  const parsed = {
    background: parseColor(theme.background),
    foreground: parseColor(theme.foreground),
    footer: parseColor(theme.footer),
    node: parseColor(theme.node),
    database: parseColor(theme.database),
    edge: parseColor(theme.edge),
    pulse: parseColor(theme.pulse),
    label: parseColor(theme.label),
    group: parseColor(theme.group),
  }
  parsedThemeCache.set(theme, parsed)
  return parsed
}

function mixColor(from: RGBA, to: RGBA, amount: number): RGBA {
  const [fromR, fromG, fromB, fromA] = from.toInts()
  const [toR, toG, toB, toA] = to.toInts()
  const mix = (left: number, right: number) => left + (right - left) * amount
  return RGBA.fromInts(mix(fromR, toR), mix(fromG, toG), mix(fromB, toB), mix(fromA, toA))
}

function mixTheme(from: ParsedFlowchartTheme, to: ParsedFlowchartTheme, amount: number): ParsedFlowchartTheme {
  return {
    background: mixColor(from.background, to.background, amount),
    foreground: mixColor(from.foreground, to.foreground, amount),
    footer: mixColor(from.footer, to.footer, amount),
    node: mixColor(from.node, to.node, amount),
    database: mixColor(from.database, to.database, amount),
    edge: mixColor(from.edge, to.edge, amount),
    pulse: mixColor(from.pulse, to.pulse, amount),
    label: mixColor(from.label, to.label, amount),
    group: mixColor(from.group, to.group, amount),
  }
}

function applyThemeColors(renderer: CliRenderer, colors: ParsedFlowchartTheme): void {
  renderer.setBackgroundColor(colors.background)
  if (scrollBox) {
    scrollBox.backgroundColor = colors.background
    scrollBox.viewport.backgroundColor = colors.background
    scrollBox.content.backgroundColor = colors.background
  }
  if (diagram) {
    diagram.batchUpdate(() => {
      diagram.fg = colors.foreground
      diagram.bg = colors.background
      diagram.nodeColor = colors.node
      diagram.databaseColor = colors.database
      diagram.edgeColor = colors.edge
      diagram.pulseColor = colors.pulse
      diagram.labelColor = colors.label
      diagram.groupColor = colors.group
    })
  }
  if (footer) footer.fg = colors.footer
  currentThemeColors = colors
}

function ensureAnimationTimer(renderer: CliRenderer): void {
  if (animationTimer) return
  animationTimer = setInterval(() => tickAnimations(renderer), ANIMATION_INTERVAL_MS)
}

function tickPulse(now: number): void {
  if (!diagram) {
    lastPulseStepAt = now
    return
  }

  if (lastPulseStepAt === 0) lastPulseStepAt = now
  const steps = Math.floor((now - lastPulseStepAt) / PULSE_STEP_MS)
  if (steps <= 0) return

  lastPulseStepAt += steps * PULSE_STEP_MS
  diagram.pulseFrame = (diagram.pulseFrame ?? 0) + steps
}

function tickAnimations(renderer: CliRenderer): void {
  const now = Date.now()
  tickPulse(now)

  if (!themeTransition) {
    return
  }

  const amount = Math.min(1, (now - themeTransition.startedAt) / THEME_TRANSITION_MS)
  applyThemeColors(renderer, mixTheme(themeTransition.from, themeTransition.to, amount))
  if (amount >= 1) themeTransition = undefined
}

function sizeDiagram(): void {
  if (!diagram) return
  diagram.width = diagram.renderedWidth
  diagram.height = diagram.renderedHeight
}

function centerDiagramInViewport(renderer: CliRenderer = activeRenderer!): void {
  if (!diagram || !scrollBox) return
  const viewportWidth = Math.max(scrollBox.viewport.width, renderer.width)
  const viewportHeight = Math.max(scrollBox.viewport.height, Math.max(1, renderer.height - 1))
  diagram.marginLeft = Math.max(SCROLLBOX_PADDING, Math.floor((viewportWidth - diagram.renderedWidth) / 2))
  diagram.marginTop = Math.max(SCROLLBOX_PADDING, Math.floor((viewportHeight - diagram.renderedHeight) / 2))
  diagram.marginRight = SCROLLBOX_PADDING
  diagram.marginBottom = SCROLLBOX_PADDING
}

function resizeSurface(renderer: CliRenderer = activeRenderer!): void {
  if (scrollBox) {
    scrollBox.width = renderer.width
    scrollBox.height = Math.max(1, renderer.height - 1)
    centerDiagramInViewport(renderer)
  }
  if (footer) {
    footer.top = Math.max(0, renderer.height - 1)
    footer.width = renderer.width
  }
}

function applyTheme(renderer: CliRenderer = activeRenderer!): void {
  const to = parsedTheme(THEMES[themeIndex]!)
  themeTransition = { from: currentThemeColors ?? to, to, startedAt: Date.now() }
  ensureAnimationTimer(renderer)
  updateFooter()
}

function updateFooter(): void {
  if (!footer) return
  const example = EXAMPLES[exampleIndex]!
  const theme = THEMES[themeIndex]!
  footer.content = `${example.title} · ${theme.name} · animated arrows · arrows/HJKL scroll · N/P example · 1-${EXAMPLES.length} jump · T theme · Esc quit`
}

function updateDiagram(): void {
  if (!diagram) return
  diagram.content = EXAMPLES[exampleIndex]!.content
  sizeDiagram()
  centerDiagramInViewport()
  scrollBox?.scrollTo({ x: 0, y: 0 })
  updateFooter()
}

export function run(renderer: CliRenderer): void {
  activeRenderer = renderer
  const theme = THEMES[themeIndex]!
  currentThemeColors = parsedTheme(theme)
  const example = EXAMPLES[exampleIndex]!
  renderer.setBackgroundColor(currentThemeColors.background)

  scrollBox = new ScrollBoxRenderable(renderer, {
    id: "flowchart-scrollbox",
    position: "absolute",
    left: 0,
    top: 0,
    width: renderer.width,
    height: Math.max(1, renderer.height - 1),
    scrollX: true,
    scrollY: true,
    rootOptions: {
      border: false,
      backgroundColor: currentThemeColors.background,
    },
    viewportOptions: {
      backgroundColor: currentThemeColors.background,
    },
    contentOptions: {
      backgroundColor: currentThemeColors.background,
      minHeight: 0,
    },
  })

  diagram = new FlowchartDiagramRenderable(renderer, {
    id: "flowchart-demo",
    content: example.content,
    fg: currentThemeColors.foreground,
    bg: currentThemeColors.background,
    nodeColor: currentThemeColors.node,
    databaseColor: currentThemeColors.database,
    edgeColor: currentThemeColors.edge,
    pulseColor: currentThemeColors.pulse,
    labelColor: currentThemeColors.label,
    groupColor: currentThemeColors.group,
    pulseFrame: 0,
    pulseLength: DEMO_PULSE_LENGTH,
    pulseGap: DEMO_PULSE_GAP,
  })
  lastPulseStepAt = Date.now()
  ensureAnimationTimer(renderer)
  sizeDiagram()
  centerDiagramInViewport(renderer)
  scrollBox.add(diagram)
  renderer.root.add(scrollBox)

  footer = new TextRenderable(renderer, {
    id: "flowchart-footer",
    content: "",
    position: "absolute",
    left: 0,
    top: Math.max(0, renderer.height - 1),
    width: renderer.width,
    fg: currentThemeColors.footer,
    truncate: true,
  })
  renderer.root.add(footer)
  updateFooter()
  scrollBox.focus()

  keyHandler = (key) => {
    if (key.name === "n") {
      exampleIndex = (exampleIndex + 1) % EXAMPLES.length
      updateDiagram()
    } else if (key.name === "p") {
      exampleIndex = (exampleIndex - 1 + EXAMPLES.length) % EXAMPLES.length
      updateDiagram()
    } else if (/^[1-9]$/.test(key.name)) {
      const nextExampleIndex = Number(key.name) - 1
      if (nextExampleIndex < EXAMPLES.length) {
        exampleIndex = nextExampleIndex
        updateDiagram()
      }
    } else if (key.name === "t") {
      themeIndex = (themeIndex + 1) % THEMES.length
      applyTheme(renderer)
    }
  }
  renderer.keyInput.on("keypress", keyHandler)

  resizeHandler = () => resizeSurface(renderer)
  renderer.on("resize", resizeHandler)
  setupCommonDemoKeys(renderer)
}

export function destroy(renderer: CliRenderer): void {
  if (animationTimer) clearInterval(animationTimer)
  if (keyHandler) renderer.keyInput.off("keypress", keyHandler)
  if (resizeHandler) renderer.off("resize", resizeHandler)
  scrollBox?.destroyRecursively()
  footer?.destroyRecursively()
  diagram = undefined
  scrollBox = undefined
  footer = undefined
  activeRenderer = undefined
  keyHandler = undefined
  resizeHandler = undefined
  animationTimer = undefined
  lastPulseStepAt = 0
  themeTransition = undefined
  currentThemeColors = undefined
}

if (import.meta.main) {
  if (process.argv.includes("--print")) {
    const exampleArg = process.argv.find((arg) => arg.startsWith("--example="))
    const index = Math.max(0, Math.min(EXAMPLES.length - 1, Number.parseInt(exampleArg?.split("=")[1] ?? "1", 10) - 1))
    const plain = process.argv.includes("--plain")
    const content = EXAMPLES[index]!.content
    process.stdout.write(plain ? renderFlowchartDiagram(content) : renderFlowchartDiagramAnsi(content))
  } else {
    const renderer = await createCliRenderer({ targetFps: 30 })
    run(renderer)
  }
}
