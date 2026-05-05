import {
  type CliRenderer,
  createCliRenderer,
  type KeyEvent,
  parseMermaidStateDiagram,
  parseColor,
  renderStateDiagram,
  renderStateDiagramAnsi,
  RGBA,
  stateDiagramStateColorKey,
  type ColorInput,
  type StateDiagram,
  type StateDiagramActiveTransition,
  StateDiagramRenderable,
  TextRenderable,
} from "@opentui/core"
import { setupCommonDemoKeys } from "./lib/standalone-keys.js"

export const REQUEST_STATE_DIAGRAM = `stateDiagram-v2
  direction LR
  [*] --> Idle
  Idle --> Loading: submit
  Loading --> Success: 200 OK
  Loading --> Error: timeout
  note right of Loading : waiting for response
  Error --> Loading: retry
  Success --> [*]`

export const AUTH_STATE_DIAGRAM = `stateDiagram-v2
  direction LR
  [*] --> Authenticated: login
  state "Authenticated Session" as Authenticated {
    [*] --> Browsing
    Browsing --> Editing: open
    Editing --> Browsing: save
    Browsing --> [*]: logout
  }
  Authenticated --> [*]
  note right of Editing : unsaved changes`

export const CHECKOUT_STATE_DIAGRAM = `stateDiagram-v2
  direction TB
  [*] --> Cart
  Cart --> Payment: checkout
  Payment --> Authorized: approved
  Payment --> Failed: declined
  Failed --> Payment: retry
  Authorized --> Fulfillment
  Fulfillment --> Complete
  Complete --> [*]`

export const EDITOR_STATE_DIAGRAM = `stateDiagram-v2
  direction LR
  state Decision <<choice>>
  [*] --> Editing
  Editing --> Editing: type
  Editing --> Validating: submit
  Validating --> Decision
  Decision --> Submitted: valid
  Decision --> Invalid: errors
  Invalid --> Editing: fix`

export const SOCKET_STATE_DIAGRAM = `stateDiagram-v2
  direction LR
  [*] --> Socket
  state "Socket Session" as Socket {
    state "Backoff<br/>Timer" as Backoff
    [*] --> Disconnected
    Disconnected --> Connecting: connect
    Connecting --> Connected: open
    Connecting --> Backoff: fail
    Connected --> Disconnected: close
    Backoff --> Connecting: timer
  }`

export const TWITTER_STATE_DIAGRAM = `stateDiagram-v2
  direction LR
  state "Focus<br/>Mode" as Focus
  [*] --> Focus
  Focus --> Vortex: one sec
  state "Scroll Vortex" as Vortex {
    [*] --> Checking
    state "Check<br/>Feed" as Checking
    state "Open<br/>Thread" as Thread
    state "Draft<br/>Take" as Draft
    state "Guilt" as Guilt
    state "Ritual" as Ritual
    Checking --> Checking: refresh
    Checking --> Thread: bait
    Thread --> Draft: reply
    Draft --> Guilt: post
    Guilt --> Ritual: promise
    Ritual --> Checking: snooze
    note right of Checking : one more refresh
    note right of Ritual : snooze wins
  }
`

interface StateDiagramExample {
  title: string
  content: string
  size?: { width: number; height: number }
}

interface SelectableTransition {
  label: string
  to: string
  path: StateDiagramActiveTransition[]
}

function renderedSize(content: string): { width: number; height: number } {
  const lines = renderStateDiagram(content).split("\n")
  return {
    width: Math.max(0, ...lines.map((line) => line.length)),
    height: lines.length,
  }
}

const EXAMPLES: StateDiagramExample[] = [
  { title: "Request Lifecycle", content: REQUEST_STATE_DIAGRAM },
  { title: "Authenticated Session", content: AUTH_STATE_DIAGRAM },
  { title: "Checkout", content: CHECKOUT_STATE_DIAGRAM },
  { title: "Form Submit", content: EDITOR_STATE_DIAGRAM },
  { title: "WebSocket", content: SOCKET_STATE_DIAGRAM },
  { title: "Twitter Loop", content: TWITTER_STATE_DIAGRAM },
]

interface StateDiagramTheme {
  name: string
  background: string
  foreground: string
  footer: string
  state: string
  activeState: string
  composite: string
  transition: string
  activeTransition: string
  pulse: string
  noteBorder: string
  noteText: string
  noteConnector: string
  end: string
}

interface ParsedThemeColors {
  background: RGBA
  state: RGBA
  activeState: RGBA
  transition: RGBA
  activeTransition: RGBA
  pulse: RGBA
  end: RGBA
}

const THEMES: StateDiagramTheme[] = [
  {
    name: "Moss Copper",
    background: "#101815",
    foreground: "#D7E5DD",
    footer: "#8DA99B",
    state: "#E4EFE8",
    activeState: "#FFD3A0",
    composite: "#6F8A7E",
    transition: "#86E1C8",
    activeTransition: "#E6B17E",
    pulse: "#FFF3D7",
    noteBorder: "#A9795B",
    noteText: "#F4DEC5",
    noteConnector: "#A9795B",
    end: "#E6B17E",
  },
  {
    name: "Glacier",
    background: "#111827",
    foreground: "#D6DEE9",
    footer: "#94A3B8",
    state: "#E7EDF5",
    activeState: "#FFE38A",
    composite: "#64748B",
    transition: "#7DD3FC",
    activeTransition: "#FCD34D",
    pulse: "#FFF7CC",
    noteBorder: "#94A3B8",
    noteText: "#E0F2FE",
    noteConnector: "#64748B",
    end: "#FCD34D",
  },
  {
    name: "Ink Peach",
    background: "#111422",
    foreground: "#D8DEEE",
    footer: "#9AA6C1",
    state: "#E8ECF8",
    activeState: "#FFD0A3",
    composite: "#69728B",
    transition: "#93C5FD",
    activeTransition: "#FDBA74",
    pulse: "#FFE7D0",
    noteBorder: "#C4B5FD",
    noteText: "#FFE7D0",
    noteConnector: "#A78BFA",
    end: "#FDBA74",
  },
  {
    name: "Ember Terminal",
    background: "#17120F",
    foreground: "#F3E8D8",
    footer: "#BDA38B",
    state: "#F3E8D8",
    activeState: "#FF9AAD",
    composite: "#8A7664",
    transition: "#F59E0B",
    activeTransition: "#FB7185",
    pulse: "#FFE4E6",
    noteBorder: "#B45309",
    noteText: "#FFE4E6",
    noteConnector: "#92400E",
    end: "#FB7185",
  },
]

const parsedThemeColorCache = new WeakMap<StateDiagramTheme, ParsedThemeColors>()

let diagram: StateDiagramRenderable | undefined
let footer: TextRenderable | undefined
let exampleIndex = 0
let themeIndex = 0
let parsedDiagram = parseMermaidStateDiagram(EXAMPLES[exampleIndex]!.content)
let activeState: string | undefined
let previousActiveState: string | undefined
let activeTransitionIndex = 0
let activeRenderer: CliRenderer | undefined
let resizeHandler: ((width: number, height: number) => void) | undefined
let keyHandler: ((key: KeyEvent) => void) | undefined
let animationTimer: ReturnType<typeof setInterval> | undefined
let transitionAnimationStartedAt = 0
let stateTransitionStartedAt = 0
let pendingFollow: { transition: SelectableTransition; startedAt: number } | undefined

const EDGE_FADE_MS = 260
const EDGE_REVEAL_MS = 620
const FOLLOW_PULSE_MS = 620
const STATE_COLOR_FADE_MS = 840
const ANIMATION_INTERVAL_MS = 45
const STATE_GLOW_LEVELS = [0, 1, 2, 3, 4, 5] as const

function exampleSize(example: StateDiagramExample): { width: number; height: number } {
  example.size ??= renderedSize(example.content)
  return example.size
}

function centerDiagram(): void {
  if (!diagram || !activeRenderer) return
  const size = exampleSize(EXAMPLES[exampleIndex]!)
  diagram.width = size.width
  diagram.height = size.height
  diagram.x = Math.max(0, Math.floor((activeRenderer.width - size.width) / 2))
  diagram.y = Math.max(0, Math.floor((activeRenderer.height - size.height) / 2))

  positionFooter()
}

function positionFooter(): void {
  if (!footer || !activeRenderer) return
  footer.y = Math.max(0, activeRenderer.height - 2)
  footer.x = Math.max(0, Math.floor((activeRenderer.width - footer.content.length) / 2))
}

function applyTheme(renderer: CliRenderer): void {
  if (!diagram) return
  const theme = THEMES[themeIndex]!
  renderer.setBackgroundColor(theme.background)
  diagram.fg = theme.foreground
  diagram.bg = theme.background
  diagram.stateColor = theme.state
  diagram.activeStateColor = theme.activeState
  diagram.compositeColor = theme.composite
  diagram.transitionColor = theme.transition
  diagram.labelColor = theme.transition
  diagram.noteBorderColor = theme.noteBorder
  diagram.noteTextColor = theme.noteText
  diagram.noteConnectorColor = theme.noteConnector
  diagram.pulseColor = theme.pulse
  diagram.startColor = theme.transition
  diagram.choiceColor = theme.transition
  diagram.endColor = theme.end

  if (footer) {
    footer.fg = theme.footer
    updateFooter()
  }
  applyAnimatedColors()
  centerDiagram()
}

function animationNow(): number {
  return performance.now()
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function easeOutCubic(value: number): number {
  const inverse = 1 - clamp01(value)
  return 1 - inverse * inverse * inverse
}

function easeInOutCubic(value: number): number {
  const clamped = clamp01(value)
  return clamped < 0.5 ? 4 * clamped * clamped * clamped : 1 - Math.pow(-2 * clamped + 2, 3) / 2
}

function mixChannel(left: number, right: number, amount: number): number {
  return Math.round(left + (right - left) * amount)
}

function mixColor(left: ColorInput, right: ColorInput, amount: number): RGBA {
  const leftRgb = parseColor(left).toInts()
  const rightRgb = parseColor(right).toInts()
  const clampedAmount = clamp01(amount)
  return RGBA.fromInts(
    mixChannel(leftRgb[0], rightRgb[0], clampedAmount),
    mixChannel(leftRgb[1], rightRgb[1], clampedAmount),
    mixChannel(leftRgb[2], rightRgb[2], clampedAmount),
    mixChannel(leftRgb[3], rightRgb[3], clampedAmount),
  )
}

function parsedThemeColors(theme: StateDiagramTheme): ParsedThemeColors {
  const cached = parsedThemeColorCache.get(theme)
  if (cached) return cached
  const colors = {
    background: parseColor(theme.background),
    state: parseColor(theme.state),
    activeState: parseColor(theme.activeState),
    transition: parseColor(theme.transition),
    activeTransition: parseColor(theme.activeTransition),
    pulse: parseColor(theme.pulse),
    end: parseColor(theme.end),
  }
  parsedThemeColorCache.set(theme, colors)
  return colors
}

function animatedActiveTransitionColor(theme: StateDiagramTheme, now = animationNow()): RGBA {
  const colors = parsedThemeColors(theme)
  const fadeAmount = easeOutCubic((now - transitionAnimationStartedAt) / EDGE_FADE_MS)
  const baseColor = mixColor(colors.transition, colors.activeTransition, fadeAmount)
  const pulsePhase = now / (pendingFollow ? 68 : 420)
  const pulseAmount = pendingFollow ? ((Math.sin(pulsePhase) + 1) / 2) * 0.68 : 0
  return pulseAmount > 0 ? mixColor(baseColor, colors.activeState, pulseAmount) : baseColor
}

function stateNeutralColor(colors: ParsedThemeColors, stateId: string | undefined): ColorInput {
  const state = parsedDiagram.states.find((candidate) => candidate.id === stateId)
  if (state?.kind === "start" || state?.kind === "choice") return colors.transition
  if (state?.kind === "end") return colors.end
  return colors.state
}

function animatedStateColors(theme: StateDiagramTheme, now = animationNow()): Record<string, RGBA> | undefined {
  if (!previousActiveState || !activeState) return undefined
  const progress = clamp01((now - stateTransitionStartedAt) / STATE_COLOR_FADE_MS)
  if (progress >= 1) return undefined

  const colors = parsedThemeColors(theme)
  const incomingNeutral = stateNeutralColor(colors, activeState)
  const outgoingNeutral = stateNeutralColor(colors, previousActiveState)
  const incomingActivation = easeOutCubic(progress / 0.18)
  const incomingSettle = 1 - easeOutCubic(progress)
  const incomingFlash = mixColor(colors.activeState, colors.pulse, 0.86)
  const stateColors: Record<string, RGBA> = {
    [previousActiveState]: mixColor(colors.activeState, outgoingNeutral, easeOutCubic(progress)),
  }

  for (const level of STATE_GLOW_LEVELS) {
    const intensity = level / (STATE_GLOW_LEVELS.length - 1)
    const activationAmount = incomingActivation * (0.18 + intensity * 0.82)
    const flashAmount = incomingSettle * Math.pow(intensity, 1.45) * 0.88
    const incomingSettled = mixColor(incomingNeutral, colors.activeState, activationAmount)
    stateColors[stateDiagramStateColorKey(activeState, level)] = mixColor(incomingSettled, incomingFlash, flashAmount)
  }

  return stateColors
}

function activeStateBackgroundColors(theme: StateDiagramTheme, now = animationNow()): Record<string, RGBA> | undefined {
  if (!previousActiveState || !activeState) return undefined

  const colors = parsedThemeColors(theme)
  const progress = clamp01((now - stateTransitionStartedAt) / STATE_COLOR_FADE_MS)
  if (progress >= 1) return undefined

  const stateBgColors: Record<string, RGBA> = {}
  const fadeAmount = 1 - easeOutCubic(progress)
  for (const level of STATE_GLOW_LEVELS) {
    const intensity = level / (STATE_GLOW_LEVELS.length - 1)
    stateBgColors[stateDiagramStateColorKey(activeState, level)] = mixColor(
      colors.background,
      colors.pulse,
      Math.pow(intensity, 1.7) * 0.24 * fadeAmount,
    )
  }

  return stateBgColors
}

function applyAnimatedColors(now = animationNow()): void {
  if (!diagram) return
  const theme = THEMES[themeIndex]!
  const edgeProgress = pendingFollow
    ? clamp01((now - pendingFollow.startedAt) / FOLLOW_PULSE_MS)
    : clamp01((now - transitionAnimationStartedAt) / EDGE_REVEAL_MS)
  diagram.activeTransitionColor = animatedActiveTransitionColor(theme, now)
  diagram.activeTransitionMode = pendingFollow ? "fade" : "reveal"
  diagram.activeTransitionProgress = edgeProgress
  const stateColors = animatedStateColors(theme, now)
  const stateBgColors = activeStateBackgroundColors(theme, now)
  diagram.stateColors = stateColors
  diagram.stateBgColors = stateBgColors
  if (!stateColors) previousActiveState = undefined
}

function restartTransitionAnimation(now = animationNow()): void {
  transitionAnimationStartedAt = now
}

function restartStateColorAnimation(from: string | undefined, to: string | undefined, now = animationNow()): void {
  previousActiveState = from ?? to
  stateTransitionStartedAt = now
}

function stateTitle(parsed: StateDiagram, id: string | undefined): string {
  if (!id) return "none"
  if (id === "__start") return "start"
  if (id === "__end") return "end"
  return parsed.states.find((state) => state.id === id)?.label.replace(/<br\s*\/?>/gi, " ") ?? id
}

function selectableTransitionsFrom(
  parsed: StateDiagram,
  from: string,
  visited: Set<string> = new Set(),
): SelectableTransition[] {
  if (visited.has(from)) return []
  const nextVisited = new Set(visited)
  nextVisited.add(from)
  const statesById = new Map(parsed.states.map((state) => [state.id, state]))
  const transitions = parsed.transitions.filter((transition) => transition.from === from)
  const selectables: SelectableTransition[] = []

  for (const transition of transitions) {
    const path = [{ from: transition.from, to: transition.to, label: transition.label }]
    const targetKind = statesById.get(transition.to)?.kind
    if (
      (targetKind === "choice" || targetKind === "start" || targetKind === "end") &&
      parsed.transitions.some((next) => next.from === transition.to)
    ) {
      const branches = selectableTransitionsFrom(parsed, transition.to, nextVisited)
      if (branches.length > 0) {
        for (const branch of branches) {
          selectables.push({
            label: transition.label || branch.label || "next",
            to: branch.to,
            path: [...path, ...branch.path],
          })
        }
        continue
      }
    }

    selectables.push({ label: transition.label || "next", to: transition.to, path })
  }

  return selectables
}

function selectableTransitions(parsed = parsedDiagram): SelectableTransition[] {
  if (!activeState) return []
  return selectableTransitionsFrom(parsed, activeState)
}

function selectedTransition(parsed = parsedDiagram): SelectableTransition | undefined {
  const transitions = selectableTransitions(parsed)
  if (transitions.length === 0) return undefined
  const index = ((activeTransitionIndex % transitions.length) + transitions.length) % transitions.length
  return transitions[index]
}

function selectedActiveTransition(parsed = parsedDiagram): StateDiagramActiveTransition[] | undefined {
  const transition = selectedTransition(parsed)
  if (!transition) return undefined
  return transition.path
}

function visibleActiveTransition(parsed = parsedDiagram): StateDiagramActiveTransition[] | undefined {
  return pendingFollow?.transition.path ?? selectedActiveTransition(parsed)
}

function resetInteraction(): void {
  const parsed = parsedDiagram
  activeState = parsed.states.find((state) => state.kind === "start")?.id ?? parsed.states[0]?.id
  previousActiveState = undefined
  activeTransitionIndex = 0
}

function updateFooter(): void {
  if (!footer) return
  const parsed = parsedDiagram
  const transition = selectedTransition(parsed)
  const transitionText = transition
    ? `Selected: ${transition.label || "next"} -> ${stateTitle(parsed, transition.to)}`
    : "No outgoing transition"
  const followText = pendingFollow ? ` · Following: ${pendingFollow.transition.label}` : ""
  footer.content = `${EXAMPLES[exampleIndex]!.title} · State: ${stateTitle(parsed, activeState)} · ${transitionText}${followText} · Tab edge · Enter pulse+follow · ←/→ examples · T theme`
  positionFooter()
}

function syncInteraction(): void {
  if (!diagram) return
  const parsed = parsedDiagram
  diagram.batchUpdate(() => {
    diagram!.activeState = activeState
    diagram!.activeTransition = visibleActiveTransition(parsed)
    applyAnimatedColors()
  })
  updateFooter()
}

function updateDiagram(): void {
  if (!diagram || !activeRenderer) return
  const example = EXAMPLES[exampleIndex]!
  pendingFollow = undefined
  parsedDiagram = parseMermaidStateDiagram(example.content)
  diagram.content = example.content
  resetInteraction()
  restartTransitionAnimation()
  syncInteraction()
  applyTheme(activeRenderer)
}

function cycleTransition(direction: 1 | -1): void {
  if (pendingFollow) return
  const transitions = selectableTransitions()
  if (transitions.length === 0) return
  activeTransitionIndex = (activeTransitionIndex + direction + transitions.length) % transitions.length
  restartTransitionAnimation()
  syncInteraction()
}

function followSelectedTransition(): void {
  if (pendingFollow) return
  const transition = selectedTransition()
  if (!transition) return
  const now = animationNow()
  pendingFollow = { transition, startedAt: now }
  transitionAnimationStartedAt = now - EDGE_FADE_MS
  if (diagram) diagram.pulseProgress = 0
  syncInteraction()
}

function finishPendingFollow(): void {
  if (!pendingFollow) return
  const previousState = activeState
  activeState = pendingFollow.transition.to
  pendingFollow = undefined
  if (diagram) diagram.pulseProgress = undefined
  activeTransitionIndex = 0
  restartTransitionAnimation()
  restartStateColorAnimation(previousState, activeState)
  syncInteraction()
}

function tickAnimations(): void {
  const now = animationNow()
  const update = () => {
    if (diagram) {
      diagram.pulseFrame = (diagram.pulseFrame ?? 0) + (pendingFollow ? 3 : 1)
      diagram.pulseProgress = pendingFollow ? clamp01((now - pendingFollow.startedAt) / FOLLOW_PULSE_MS) : undefined
    }
    if (pendingFollow && now - pendingFollow.startedAt >= FOLLOW_PULSE_MS) {
      finishPendingFollow()
      return
    }
    applyAnimatedColors(now)
  }

  if (diagram) {
    diagram.batchUpdate(update)
  } else {
    update()
  }
}

export function run(renderer: CliRenderer): void {
  activeRenderer = renderer
  const theme = THEMES[themeIndex]!
  renderer.setBackgroundColor(theme.background)
  const example = EXAMPLES[exampleIndex]!
  parsedDiagram = parseMermaidStateDiagram(example.content)
  resetInteraction()
  restartTransitionAnimation()
  const size = exampleSize(example)
  diagram = new StateDiagramRenderable(renderer, {
    id: "state-diagram-demo",
    content: example.content,
    activeState,
    activeTransition: selectedActiveTransition(),
    position: "absolute",
    left: Math.max(0, Math.floor((renderer.width - size.width) / 2)),
    top: Math.max(0, Math.floor((renderer.height - size.height) / 2)),
    width: size.width,
    height: size.height,
    fg: theme.foreground,
    bg: theme.background,
    stateColor: theme.state,
    activeStateColor: theme.activeState,
    compositeColor: theme.composite,
    transitionColor: theme.transition,
    activeTransitionColor: theme.activeTransition,
    pulseColor: theme.pulse,
    pulseFrame: 0,
    pulseLength: 9,
    pulseGap: 16,
    labelColor: theme.transition,
    noteBorderColor: theme.noteBorder,
    noteTextColor: theme.noteText,
    noteConnectorColor: theme.noteConnector,
    startColor: theme.transition,
    choiceColor: theme.transition,
    endColor: theme.end,
  })
  renderer.root.add(diagram)

  footer = new TextRenderable(renderer, {
    id: "state-diagram-footer",
    content: "",
    position: "absolute",
    left: 0,
    top: Math.max(0, renderer.height - 2),
    fg: theme.footer,
  })
  renderer.root.add(footer)
  applyTheme(renderer)
  syncInteraction()

  keyHandler = (key) => {
    if (key.name === "right") {
      exampleIndex = (exampleIndex + 1) % EXAMPLES.length
      updateDiagram()
    } else if (key.name === "left") {
      exampleIndex = (exampleIndex - 1 + EXAMPLES.length) % EXAMPLES.length
      updateDiagram()
    } else if (key.name === "tab") {
      key.preventDefault()
      cycleTransition(key.shift ? -1 : 1)
    } else if (key.name === "return" || key.name === "linefeed" || key.name === "enter") {
      key.preventDefault()
      followSelectedTransition()
    } else if (key.name === "t") {
      themeIndex = (themeIndex + 1) % THEMES.length
      applyTheme(renderer)
    }
  }
  renderer.keyInput.on("keypress", keyHandler)

  resizeHandler = () => centerDiagram()
  renderer.on("resize", resizeHandler)
  if (animationTimer) clearInterval(animationTimer)
  animationTimer = setInterval(tickAnimations, ANIMATION_INTERVAL_MS)
  setupCommonDemoKeys(renderer)
}

export function destroy(renderer: CliRenderer): void {
  if (animationTimer) clearInterval(animationTimer)
  if (keyHandler) renderer.keyInput.off("keypress", keyHandler)
  if (resizeHandler) renderer.off("resize", resizeHandler)
  diagram?.destroyRecursively()
  footer?.destroyRecursively()
  diagram = undefined
  footer = undefined
  activeRenderer = undefined
  keyHandler = undefined
  resizeHandler = undefined
  animationTimer = undefined
  pendingFollow = undefined
  previousActiveState = undefined
}

if (import.meta.main) {
  if (process.argv.includes("--print")) {
    const exampleArg = process.argv.find((arg) => arg.startsWith("--example="))
    const index = Math.max(0, Math.min(EXAMPLES.length - 1, Number.parseInt(exampleArg?.split("=")[1] ?? "1", 10) - 1))
    const plain = process.argv.includes("--plain")
    const content = EXAMPLES[index]!.content
    process.stdout.write(plain ? renderStateDiagram(content) : renderStateDiagramAnsi(content))
  } else {
    const renderer = await createCliRenderer({ targetFps: 30 })
    run(renderer)
  }
}
