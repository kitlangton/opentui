import { ANSI } from "../ansi.js"
import { BorderChars, type BorderCharacters, type BorderStyle } from "../lib/border.js"
import { StyledText } from "../lib/styled-text.js"
import { RGBA, parseColor, type ColorInput } from "../lib/RGBA.js"
import { stringWidth } from "../platform/runtime.js"
import type { TextChunk } from "../text-buffer.js"
import { type RenderContext } from "../types.js"
import { DiagramCanvas, type DiagramCanvasCell } from "./diagram-canvas.js"
import {
  diagramCellColorKey,
  diagramColorMapsEqual,
  diagramRadialCellColorLevel,
  mappedDiagramColor,
  normalizeDiagramColorMap,
} from "./diagram-color-map.js"
import { diagramArrowHead, diagramLineGlyph, drawDiagramFrame, mergeDiagramLineGlyph } from "./diagram-drawing.js"
import type { DiagramDirection } from "./diagram-geometry.js"
import {
  diagramPulseLevel,
  normalizeDiagramPositiveInt,
  normalizeDiagramPulseFrame,
  normalizeDiagramPulseProgress,
  visitDiagramPulsePath,
} from "./diagram-pulse.js"
import {
  ansiFg,
  blendColor,
  colorsEqual,
  createAnsiPeakAndRampTheme,
  createAnsiRampTheme,
  DIAGRAM_FADE_STEPS,
  numberedStyleKeys,
  rgba,
  type DiagramFadeStep,
  type DiagramRgb,
} from "./diagram-style.js"
import {
  createStateDiagramLayout,
  expandCompositeBoundsForFeedback,
  hasReverseTransition,
  splitStateDiagramLines as splitLines,
  type StateDiagramBoxBounds as BoxBounds,
  type StateDiagramNoteBounds as StateNoteBounds,
} from "./StateDiagramLayout.js"
import { TextBufferRenderable, type TextBufferOptions } from "./TextBufferRenderable.js"

export type StateDiagramDirection = "TB" | "TD" | "LR" | "RL"
export type StateDiagramArrowHeadStyle = "filled" | "line"
export type StateDiagramActiveTransitionMode = "reveal" | "fade"

export interface StateDiagramState {
  id: string
  label: string
  kind: "state" | "start" | "end" | "choice"
  parentId?: string
}

export interface StateDiagramTransition {
  from: string
  to: string
  label: string
}

interface StateDiagramRenderTransition extends StateDiagramTransition {
  sourceTransitions?: readonly StateDiagramTransition[]
}

export interface StateDiagramActiveTransition {
  from: string
  to: string
  label?: string
}

export interface StateDiagramCompositeState {
  id: string
  label: string
  parentId?: string
}

export interface StateDiagramNote {
  target: string
  position: "left" | "right"
  lines: string[]
}

export type StateDiagramActiveTransitionSelection =
  | StateDiagramActiveTransition
  | readonly StateDiagramActiveTransition[]
export type StateDiagramStateColors =
  | Record<string, ColorInput | undefined>
  | ReadonlyMap<string, ColorInput | undefined>

export interface StateDiagram {
  direction: StateDiagramDirection
  states: StateDiagramState[]
  transitions: StateDiagramTransition[]
  composites: StateDiagramCompositeState[]
  notes: StateDiagramNote[]
}

export interface StateDiagramRenderOptions {
  direction?: StateDiagramDirection
  borderStyle?: BorderStyle
  arrowHeadStyle?: StateDiagramArrowHeadStyle
  minStateGap?: number
  activeState?: string
  activeTransition?: StateDiagramActiveTransitionSelection
  activeTransitionProgress?: number
  activeTransitionMode?: StateDiagramActiveTransitionMode
  pulseFrame?: number
  pulseProgress?: number
  pulseLength?: number
  pulseGap?: number
}

export interface StateDiagramAnsiOptions extends StateDiagramRenderOptions {
  theme?: StateDiagramAnsiTheme
}

export interface StateDiagramOptions extends TextBufferOptions, StateDiagramRenderOptions {
  content?: string
  stateColor?: ColorInput
  activeStateColor?: ColorInput
  compositeColor?: ColorInput
  transitionColor?: ColorInput
  labelColor?: ColorInput
  noteBorderColor?: ColorInput
  noteTextColor?: ColorInput
  noteConnectorColor?: ColorInput
  pulseColor?: ColorInput
  startColor?: ColorInput
  endColor?: ColorInput
  choiceColor?: ColorInput
  activeTransitionColor?: ColorInput
  stateColors?: StateDiagramStateColors
  stateBgColors?: StateDiagramStateColors
}

export type StateDiagramAnsiTheme = Partial<Record<StateCellStyle, string>>

type FadeStep = DiagramFadeStep
type FadeSourceStyle = "state" | "activeState" | "composite" | "start" | "end" | "choice"
type TransitionFadeStyle = `${FadeSourceStyle}TransitionFade${FadeStep}`
type ActiveTransitionFadeStyle = `${FadeSourceStyle}ActiveTransitionFade${FadeStep}`
type ActiveTransitionPulseFadeStyle = `activeTransitionPulseFade${FadeStep}`
type BaseStateCellStyle =
  | "state"
  | "activeState"
  | "composite"
  | "transition"
  | "activeTransition"
  | "activeTransitionPulse"
  | "label"
  | "noteBorder"
  | "noteText"
  | "noteConnector"
  | "start"
  | "end"
  | "choice"
type StateCellStyle =
  | BaseStateCellStyle
  | TransitionFadeStyle
  | ActiveTransitionFadeStyle
  | ActiveTransitionPulseFadeStyle

type StateStyleColors = Required<Record<BaseStateCellStyle, RGBA>> &
  Required<Record<TransitionFadeStyle, RGBA>> &
  Required<Record<ActiveTransitionFadeStyle, RGBA>> &
  Required<Record<ActiveTransitionPulseFadeStyle, RGBA>>

interface StateCellMetadata {
  stateId?: string
  bgStateId?: string
}

type StateCell = DiagramCanvasCell<StateCellStyle, StateCellMetadata>
type StateGrid = DiagramCanvas<StateCellStyle, StateCellMetadata>

type StatePathPoint = readonly [number, number]

interface TransitionDrawContext {
  fadeSource: FadeSourceStyle
  active: boolean
  fadeFromSource: boolean
  path?: StatePathPoint[]
  sourceStateId: string
}

interface TransitionFadeInfo {
  step: FadeStep
  active: boolean
}

const DEFAULT_DIRECTION = "LR" satisfies StateDiagramDirection
const DEFAULT_MIN_STATE_GAP = 5
const DEFAULT_BORDER_STYLE = "rounded" satisfies BorderStyle
const DEFAULT_ARROW_HEAD_STYLE = "filled" satisfies StateDiagramArrowHeadStyle
const DEFAULT_PULSE_LENGTH = 5
const DEFAULT_PULSE_GAP = 14
const ACTIVE_TRANSITION_FRONTIER_ACTIVE_SIDE = 2
const ACTIVE_TRANSITION_FRONTIER_INACTIVE_SIDE = 5
const STATE_RE = /^state\s+"([^"]+)"\s+as\s+(\S+)$/i
const COMPOSITE_STATE_RE = /^state\s+(?:"([^"]+)"\s+as\s+)?(\S+)\s*\{$/i
const CHOICE_STATE_RE = /^state\s+(\S+)\s+<<choice>>$/i
const TRANSITION_RE = /^(\[\*\]|[^\s:]+)\s*-->\s*(\[\*\]|[^\s:]+)(?:\s*:\s*(.*))?$/
const DIRECTION_RE = /^direction\s+(TB|TD|LR|RL)$/i
const NOTE_INLINE_RE = /^note\s+(left|right)\s+of\s+(\S+)\s*:\s*(.*)$/i
const NOTE_START_RE = /^note\s+(left|right)\s+of\s+(\S+)\s*$/i
const NOTE_END_RE = /^end\s+note$/i
const DEFAULT_THEME_RGB = {
  state: [228, 239, 232],
  activeState: [221, 255, 246],
  composite: [111, 138, 126],
  transition: [134, 225, 200],
  activeTransition: [221, 255, 246],
  activeTransitionPulse: [255, 232, 205],
  label: [134, 225, 200],
  noteBorder: [141, 169, 155],
  noteText: [215, 229, 221],
  noteConnector: [141, 169, 155],
  start: [134, 225, 200],
  end: [230, 177, 126],
  choice: [134, 225, 200],
} as const satisfies Record<BaseStateCellStyle, DiagramRgb>
const FADE_STEPS = DIAGRAM_FADE_STEPS
const FADE_SOURCE_STYLES = [
  "state",
  "activeState",
  "composite",
  "start",
  "end",
  "choice",
] as const satisfies readonly FadeSourceStyle[]
const ACTIVE_TRANSITION_PULSE_STYLES = [
  "activeTransitionPulseFade1",
  "activeTransitionPulseFade2",
  "activeTransitionPulseFade3",
  "activeTransitionPulseFade4",
  "activeTransitionPulseFade5",
  "activeTransitionPulse",
] as const satisfies readonly StateCellStyle[]
const ACTIVE_TRANSITION_STYLES = new Set<StateCellStyle>([
  "activeTransition",
  ...FADE_STEPS.flatMap((step) =>
    FADE_SOURCE_STYLES.map((source) => `${source}ActiveTransitionFade${step}` as StateCellStyle),
  ),
])
const TRANSITION_FADE_INFOS: ReadonlyMap<StateCellStyle, TransitionFadeInfo> = new Map(
  FADE_SOURCE_STYLES.flatMap((source) =>
    FADE_STEPS.flatMap(
      (step): Array<[StateCellStyle, TransitionFadeInfo]> => [
        [`${source}TransitionFade${step}` as StateCellStyle, { step, active: false }],
        [`${source}ActiveTransitionFade${step}` as StateCellStyle, { step, active: true }],
      ],
    ),
  ),
)
const DEFAULT_ANSI_THEME: Required<Record<StateCellStyle, string>> = {
  state: ansiFg(DEFAULT_THEME_RGB.state),
  activeState: ansiFg(DEFAULT_THEME_RGB.activeState),
  composite: ansiFg(DEFAULT_THEME_RGB.composite),
  transition: ansiFg(DEFAULT_THEME_RGB.transition),
  activeTransition: ansiFg(DEFAULT_THEME_RGB.activeTransition),
  label: ansiFg(DEFAULT_THEME_RGB.label),
  noteBorder: ansiFg(DEFAULT_THEME_RGB.noteBorder),
  noteText: ansiFg(DEFAULT_THEME_RGB.noteText),
  noteConnector: ansiFg(DEFAULT_THEME_RGB.noteConnector),
  start: ansiFg(DEFAULT_THEME_RGB.start),
  end: ansiFg(DEFAULT_THEME_RGB.end),
  choice: ansiFg(DEFAULT_THEME_RGB.choice),
  ...createAnsiFadeTheme("state", DEFAULT_THEME_RGB.state, DEFAULT_THEME_RGB.transition),
  ...createAnsiFadeTheme("activeState", DEFAULT_THEME_RGB.activeState, DEFAULT_THEME_RGB.transition),
  ...createAnsiFadeTheme("composite", DEFAULT_THEME_RGB.composite, DEFAULT_THEME_RGB.transition),
  ...createAnsiFadeTheme("start", DEFAULT_THEME_RGB.start, DEFAULT_THEME_RGB.transition),
  ...createAnsiFadeTheme("end", DEFAULT_THEME_RGB.end, DEFAULT_THEME_RGB.transition),
  ...createAnsiFadeTheme("choice", DEFAULT_THEME_RGB.choice, DEFAULT_THEME_RGB.transition),
  ...createAnsiActiveTransitionFadeTheme("state", DEFAULT_THEME_RGB.state, DEFAULT_THEME_RGB.activeTransition),
  ...createAnsiActiveTransitionFadeTheme(
    "activeState",
    DEFAULT_THEME_RGB.activeState,
    DEFAULT_THEME_RGB.activeTransition,
  ),
  ...createAnsiActiveTransitionFadeTheme("composite", DEFAULT_THEME_RGB.composite, DEFAULT_THEME_RGB.activeTransition),
  ...createAnsiActiveTransitionFadeTheme("start", DEFAULT_THEME_RGB.start, DEFAULT_THEME_RGB.activeTransition),
  ...createAnsiActiveTransitionFadeTheme("end", DEFAULT_THEME_RGB.end, DEFAULT_THEME_RGB.activeTransition),
  ...createAnsiActiveTransitionFadeTheme("choice", DEFAULT_THEME_RGB.choice, DEFAULT_THEME_RGB.activeTransition),
  ...createAnsiActiveTransitionPulseTheme(DEFAULT_THEME_RGB.activeTransition, DEFAULT_THEME_RGB.activeTransitionPulse),
}

function createAnsiFadeTheme(
  source: FadeSourceStyle,
  from: DiagramRgb,
  to: DiagramRgb,
): Record<TransitionFadeStyle, string> {
  return createAnsiRampTheme(numberedStyleKeys(`${source}TransitionFade`, FADE_STEPS), from, to) as Record<
    TransitionFadeStyle,
    string
  >
}

function createAnsiActiveTransitionFadeTheme(
  source: FadeSourceStyle,
  from: DiagramRgb,
  to: DiagramRgb,
): Record<ActiveTransitionFadeStyle, string> {
  return createAnsiRampTheme(numberedStyleKeys(`${source}ActiveTransitionFade`, FADE_STEPS), from, to) as Record<
    ActiveTransitionFadeStyle,
    string
  >
}

function createAnsiActiveTransitionPulseTheme(
  from: DiagramRgb,
  to: DiagramRgb,
): Record<"activeTransitionPulse" | ActiveTransitionPulseFadeStyle, string> {
  return createAnsiPeakAndRampTheme(
    "activeTransitionPulse",
    numberedStyleKeys("activeTransitionPulseFade", FADE_STEPS),
    from,
    to,
  )
}

export function stateDiagramStateColorKey(stateId: string, level: number): string {
  return diagramCellColorKey(stateId, level)
}

function stateMappedColor(
  colors: ReadonlyMap<string, RGBA> | undefined,
  stateId: string | undefined,
): RGBA | undefined {
  return mappedDiagramColor(colors, stateId)
}

function transitionFadeInfo(style: StateCellStyle | undefined): TransitionFadeInfo | undefined {
  return style ? TRANSITION_FADE_INFOS.get(style) : undefined
}

function createStateActiveTransitionPulseColors(from: RGBA, to: RGBA): Record<ActiveTransitionPulseFadeStyle, RGBA> {
  return Object.fromEntries(
    FADE_STEPS.map((step) => [
      `activeTransitionPulseFade${step}`,
      blendColor(from, to, step / (FADE_STEPS.length + 1)),
    ]),
  ) as Record<ActiveTransitionPulseFadeStyle, RGBA>
}

function styleColor(
  style: StateCellStyle | undefined,
  colors: StateStyleColors,
  stateColors?: ReadonlyMap<string, RGBA>,
  stateId?: string,
): RGBA | undefined {
  const stateColor = stateMappedColor(stateColors, stateId)
  if (!stateColor) return style ? colors[style] : undefined

  const fadeInfo = transitionFadeInfo(style)
  if (fadeInfo) {
    return blendColor(stateColor, fadeInfo.active ? colors.activeTransition : colors.transition, fadeInfo.step / 6)
  }
  return stateColor
}

function styleBgColor(
  stateBgColors: ReadonlyMap<string, RGBA> | undefined,
  stateId: string | undefined,
): RGBA | undefined {
  return stateMappedColor(stateBgColors, stateId)
}

function resolveStateStyleColors(colors: Partial<Record<StateCellStyle, RGBA | undefined>> = {}): StateStyleColors {
  const state = colors.state ?? rgba(DEFAULT_THEME_RGB.state)
  const composite = colors.composite ?? rgba(DEFAULT_THEME_RGB.composite)
  const transition = colors.transition ?? rgba(DEFAULT_THEME_RGB.transition)
  const activeTransition = colors.activeTransition ?? rgba(DEFAULT_THEME_RGB.activeTransition)
  const activeTransitionPulse = colors.activeTransitionPulse ?? rgba(DEFAULT_THEME_RGB.activeTransitionPulse)
  const activeState = colors.activeState ?? rgba(DEFAULT_THEME_RGB.activeState)
  const start = colors.start ?? rgba(DEFAULT_THEME_RGB.start)
  const end = colors.end ?? rgba(DEFAULT_THEME_RGB.end)
  const choice = colors.choice ?? transition
  const noteBorder = colors.noteBorder ?? rgba(DEFAULT_THEME_RGB.noteBorder)
  const noteText = colors.noteText ?? rgba(DEFAULT_THEME_RGB.noteText)
  const noteConnector = colors.noteConnector ?? noteBorder

  return {
    state,
    activeState,
    composite,
    transition,
    activeTransition,
    activeTransitionPulse,
    label: colors.label ?? transition,
    noteBorder,
    noteText,
    noteConnector,
    start,
    end,
    choice,
    stateTransitionFade1: blendColor(state, transition, 1 / 6),
    stateTransitionFade2: blendColor(state, transition, 2 / 6),
    stateTransitionFade3: blendColor(state, transition, 3 / 6),
    stateTransitionFade4: blendColor(state, transition, 4 / 6),
    stateTransitionFade5: blendColor(state, transition, 5 / 6),
    activeStateTransitionFade1: blendColor(activeState, transition, 1 / 6),
    activeStateTransitionFade2: blendColor(activeState, transition, 2 / 6),
    activeStateTransitionFade3: blendColor(activeState, transition, 3 / 6),
    activeStateTransitionFade4: blendColor(activeState, transition, 4 / 6),
    activeStateTransitionFade5: blendColor(activeState, transition, 5 / 6),
    compositeTransitionFade1: blendColor(composite, transition, 1 / 6),
    compositeTransitionFade2: blendColor(composite, transition, 2 / 6),
    compositeTransitionFade3: blendColor(composite, transition, 3 / 6),
    compositeTransitionFade4: blendColor(composite, transition, 4 / 6),
    compositeTransitionFade5: blendColor(composite, transition, 5 / 6),
    startTransitionFade1: blendColor(start, transition, 1 / 6),
    startTransitionFade2: blendColor(start, transition, 2 / 6),
    startTransitionFade3: blendColor(start, transition, 3 / 6),
    startTransitionFade4: blendColor(start, transition, 4 / 6),
    startTransitionFade5: blendColor(start, transition, 5 / 6),
    endTransitionFade1: blendColor(end, transition, 1 / 6),
    endTransitionFade2: blendColor(end, transition, 2 / 6),
    endTransitionFade3: blendColor(end, transition, 3 / 6),
    endTransitionFade4: blendColor(end, transition, 4 / 6),
    endTransitionFade5: blendColor(end, transition, 5 / 6),
    choiceTransitionFade1: blendColor(choice, transition, 1 / 6),
    choiceTransitionFade2: blendColor(choice, transition, 2 / 6),
    choiceTransitionFade3: blendColor(choice, transition, 3 / 6),
    choiceTransitionFade4: blendColor(choice, transition, 4 / 6),
    choiceTransitionFade5: blendColor(choice, transition, 5 / 6),
    stateActiveTransitionFade1: blendColor(state, activeTransition, 1 / 6),
    stateActiveTransitionFade2: blendColor(state, activeTransition, 2 / 6),
    stateActiveTransitionFade3: blendColor(state, activeTransition, 3 / 6),
    stateActiveTransitionFade4: blendColor(state, activeTransition, 4 / 6),
    stateActiveTransitionFade5: blendColor(state, activeTransition, 5 / 6),
    activeStateActiveTransitionFade1: blendColor(activeState, activeTransition, 1 / 6),
    activeStateActiveTransitionFade2: blendColor(activeState, activeTransition, 2 / 6),
    activeStateActiveTransitionFade3: blendColor(activeState, activeTransition, 3 / 6),
    activeStateActiveTransitionFade4: blendColor(activeState, activeTransition, 4 / 6),
    activeStateActiveTransitionFade5: blendColor(activeState, activeTransition, 5 / 6),
    compositeActiveTransitionFade1: blendColor(composite, activeTransition, 1 / 6),
    compositeActiveTransitionFade2: blendColor(composite, activeTransition, 2 / 6),
    compositeActiveTransitionFade3: blendColor(composite, activeTransition, 3 / 6),
    compositeActiveTransitionFade4: blendColor(composite, activeTransition, 4 / 6),
    compositeActiveTransitionFade5: blendColor(composite, activeTransition, 5 / 6),
    startActiveTransitionFade1: blendColor(start, activeTransition, 1 / 6),
    startActiveTransitionFade2: blendColor(start, activeTransition, 2 / 6),
    startActiveTransitionFade3: blendColor(start, activeTransition, 3 / 6),
    startActiveTransitionFade4: blendColor(start, activeTransition, 4 / 6),
    startActiveTransitionFade5: blendColor(start, activeTransition, 5 / 6),
    endActiveTransitionFade1: blendColor(end, activeTransition, 1 / 6),
    endActiveTransitionFade2: blendColor(end, activeTransition, 2 / 6),
    endActiveTransitionFade3: blendColor(end, activeTransition, 3 / 6),
    endActiveTransitionFade4: blendColor(end, activeTransition, 4 / 6),
    endActiveTransitionFade5: blendColor(end, activeTransition, 5 / 6),
    choiceActiveTransitionFade1: blendColor(choice, activeTransition, 1 / 6),
    choiceActiveTransitionFade2: blendColor(choice, activeTransition, 2 / 6),
    choiceActiveTransitionFade3: blendColor(choice, activeTransition, 3 / 6),
    choiceActiveTransitionFade4: blendColor(choice, activeTransition, 4 / 6),
    choiceActiveTransitionFade5: blendColor(choice, activeTransition, 5 / 6),
    ...createStateActiveTransitionPulseColors(activeTransition, activeTransitionPulse),
  }
}

function visualLength(value: string): number {
  return stringWidth(value)
}

function normalizeDirection(value?: string): StateDiagramDirection {
  const upper = value?.toUpperCase()
  if (upper === "TB" || upper === "TD" || upper === "LR" || upper === "RL") return upper
  return DEFAULT_DIRECTION
}

function normalizePulseFrame(value: number | undefined): number | undefined {
  return normalizeDiagramPulseFrame(value)
}

function normalizePulseProgress(value: number | undefined): number | undefined {
  return normalizeDiagramPulseProgress(value)
}

function normalizeActiveTransitionMode(
  value: StateDiagramActiveTransitionMode | undefined,
): StateDiagramActiveTransitionMode {
  return value === "fade" ? "fade" : "reveal"
}

function normalizePulseLength(value: number | undefined): number {
  return normalizeDiagramPositiveInt(value, DEFAULT_PULSE_LENGTH)
}

function normalizePulseGap(value: number | undefined): number {
  return normalizeDiagramPositiveInt(value, DEFAULT_PULSE_GAP)
}

function isMermaidHeader(line: string): boolean {
  return line.toLowerCase() === "statediagram-v2" || line.toLowerCase() === "statediagram"
}

function markerId(position: "from" | "to", scope?: string): string {
  const id = position === "from" ? "__start" : "__end"
  return scope ? `${scope}.${id}` : id
}

function normalizeEndpoint(value: string, position: "from" | "to", scope?: string): string {
  return value === "[*]" ? markerId(position, scope) : value
}

function normalizeActiveTransition(activeTransition: StateDiagramActiveTransition): StateDiagramActiveTransition {
  return {
    from: normalizeEndpoint(activeTransition.from, "from"),
    to: normalizeEndpoint(activeTransition.to, "to"),
    label: activeTransition.label,
  }
}

function normalizeActiveTransitions(
  activeTransition: StateDiagramActiveTransitionSelection | undefined,
): StateDiagramActiveTransition[] {
  if (!activeTransition) return []
  const transitions = Array.isArray(activeTransition) ? activeTransition : [activeTransition]
  return transitions.map(normalizeActiveTransition)
}

function activeTransitionEqual(left: StateDiagramActiveTransition, right: StateDiagramActiveTransition): boolean {
  return left.from === right.from && left.to === right.to && left.label === right.label
}

function activeTransitionListsEqual(
  left: readonly StateDiagramActiveTransition[],
  right: readonly StateDiagramActiveTransition[],
): boolean {
  return (
    left.length === right.length && left.every((transition, index) => activeTransitionEqual(transition, right[index]!))
  )
}

function isActiveTransition(
  transition: StateDiagramTransition,
  activeTransitions: readonly StateDiagramActiveTransition[],
): boolean {
  return activeTransitionIndex(transition, activeTransitions) !== -1
}

function activeTransitionIndex(
  transition: StateDiagramTransition,
  activeTransitions: readonly StateDiagramActiveTransition[],
): number {
  const exactIndex = activeTransitions.findIndex(
    (activeTransition) =>
      activeTransition.from === transition.from &&
      activeTransition.to === transition.to &&
      (activeTransition.label === undefined || activeTransition.label === transition.label),
  )
  if (exactIndex !== -1) return exactIndex

  const sourceTransitions = (transition as StateDiagramRenderTransition).sourceTransitions
  if (!sourceTransitions || sourceTransitions.length <= 1 || activeTransitions.length < sourceTransitions.length)
    return -1

  for (let index = 0; index <= activeTransitions.length - sourceTransitions.length; index++) {
    const matches = sourceTransitions.every((sourceTransition, offset) => {
      const activeTransition = activeTransitions[index + offset]!
      return (
        activeTransition.from === sourceTransition.from &&
        activeTransition.to === sourceTransition.to &&
        (activeTransition.label === undefined || activeTransition.label === sourceTransition.label)
      )
    })
    if (matches) return index
  }

  return -1
}

function ensureState(
  states: Map<string, StateDiagramState>,
  id: string,
  label = id,
  kind: StateDiagramState["kind"] = "state",
  parentId?: string,
) {
  const existing = states.get(id)
  if (existing) {
    if (existing.label === existing.id && label !== id) existing.label = label
    if (parentId && !existing.parentId) existing.parentId = parentId
    if (kind !== "state") {
      existing.kind = kind
      existing.label = label
    }
    return
  }
  states.set(id, parentId ? { id, label, kind, parentId } : { id, label, kind })
}

function resolveCompositeTransitionEndpoint(
  id: string,
  markerPosition: "from" | "to",
  compositeIds: ReadonlySet<string>,
  states: Map<string, StateDiagramState>,
): string {
  if (!compositeIds.has(id)) return id
  const marker = markerId(markerPosition, id)
  return states.has(marker) ? marker : id
}

function resolveCompositeTransitions(
  transitions: readonly StateDiagramTransition[],
  compositeIds: ReadonlySet<string>,
  states: Map<string, StateDiagramState>,
): StateDiagramTransition[] {
  return transitions.map((transition) => ({
    from: resolveCompositeTransitionEndpoint(transition.from, "to", compositeIds, states),
    to: resolveCompositeTransitionEndpoint(transition.to, "from", compositeIds, states),
    label: transition.label,
  }))
}

export function isMermaidStateDiagram(content: string): boolean {
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("%%")) continue
    return isMermaidHeader(line)
  }
  return false
}

export function parseMermaidStateDiagram(content: string): StateDiagram {
  const states = new Map<string, StateDiagramState>()
  const transitions: StateDiagramTransition[] = []
  const composites: StateDiagramCompositeState[] = []
  const notes: StateDiagramNote[] = []
  const parentStack: string[] = []
  let pendingNote: { target: string; position: "left" | "right"; lines: string[] } | undefined
  let direction: StateDiagramDirection = DEFAULT_DIRECTION

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (pendingNote) {
      if (NOTE_END_RE.test(line)) {
        notes.push({ target: pendingNote.target, position: pendingNote.position, lines: pendingNote.lines })
        pendingNote = undefined
      } else if (line || pendingNote.lines.length > 0) {
        pendingNote.lines.push(line)
      }
      continue
    }

    if (!line || line.startsWith("%%") || isMermaidHeader(line)) continue

    if (line === "}") {
      parentStack.pop()
      continue
    }

    const parentId = parentStack[parentStack.length - 1]

    const directionMatch = line.match(DIRECTION_RE)
    if (directionMatch) {
      direction = normalizeDirection(directionMatch[1])
      continue
    }

    const inlineNoteMatch = line.match(NOTE_INLINE_RE)
    if (inlineNoteMatch) {
      notes.push({
        position: inlineNoteMatch[1]!.toLowerCase() as "left" | "right",
        target: inlineNoteMatch[2]!,
        lines: splitLines(inlineNoteMatch[3]!.trim()),
      })
      continue
    }

    const noteMatch = line.match(NOTE_START_RE)
    if (noteMatch) {
      pendingNote = {
        position: noteMatch[1]!.toLowerCase() as "left" | "right",
        target: noteMatch[2]!,
        lines: [],
      }
      continue
    }

    const compositeMatch = line.match(COMPOSITE_STATE_RE)
    if (compositeMatch) {
      const id = compositeMatch[2]!
      composites.push({
        id,
        label: compositeMatch[1] ?? id,
        ...(parentId ? { parentId } : {}),
      })
      parentStack.push(id)
      continue
    }

    const stateMatch = line.match(STATE_RE)
    if (stateMatch) {
      ensureState(states, stateMatch[2]!, stateMatch[1]!, "state", parentId)
      continue
    }

    const choiceMatch = line.match(CHOICE_STATE_RE)
    if (choiceMatch) {
      ensureState(states, choiceMatch[1]!, "┼", "choice", parentId)
      continue
    }

    const transitionMatch = line.match(TRANSITION_RE)
    if (transitionMatch) {
      const rawFrom = transitionMatch[1]!
      const rawTo = transitionMatch[2]!
      const from = normalizeEndpoint(rawFrom, "from", parentId)
      const to = normalizeEndpoint(rawTo, "to", parentId)
      ensureState(states, from, rawFrom === "[*]" ? "●" : from, rawFrom === "[*]" ? "start" : "state", parentId)
      ensureState(states, to, rawTo === "[*]" ? "◎" : to, rawTo === "[*]" ? "end" : "state", parentId)
      transitions.push({ from, to, label: transitionMatch[3]?.trim() ?? "" })
    }
  }

  if (pendingNote) notes.push({ target: pendingNote.target, position: pendingNote.position, lines: pendingNote.lines })

  if (composites.length === 0) {
    return { direction, states: [...states.values()], transitions, composites, notes }
  }

  const compositeIds = new Set(composites.map((composite) => composite.id))
  return {
    direction,
    states: [...states.values()].filter((state) => !compositeIds.has(state.id)),
    transitions: resolveCompositeTransitions(transitions, compositeIds, states),
    composites,
    notes,
  }
}

function makeGrid(width: number, height: number): StateGrid {
  return new DiagramCanvas(width, height, {
    mergeCell: (existing, incoming): StateCell => {
      const shouldMerge = isTransitionDrawingStyle(existing.style) && isTransitionDrawingStyle(incoming.style)
      return {
        ...incoming,
        char: shouldMerge
          ? (mergeDiagramLineGlyph(existing.char, incoming.char, "rounded") ?? incoming.char)
          : incoming.char,
      }
    },
  })
}

function isTransitionDrawingStyle(style: StateCellStyle | undefined): boolean {
  return (
    style === "transition" ||
    style === "activeTransition" ||
    isActiveTransitionStyle(style) ||
    (typeof style === "string" && style.includes("TransitionFade"))
  )
}

function setCell(
  grid: StateGrid,
  x: number,
  y: number,
  char: string,
  style?: StateCellStyle,
  stateId?: string,
  bgStateId?: string,
): void {
  grid.setCell(x, y, char, style, { stateId, bgStateId })
}

function addPathPoint(path: StatePathPoint[] | undefined, x: number, y: number): void {
  path?.push([x, y])
}

function setPathCell(
  grid: StateGrid,
  path: StatePathPoint[] | undefined,
  x: number,
  y: number,
  char: string,
  style?: StateCellStyle,
  stateId?: string,
): void {
  setCell(grid, x, y, char, style, stateId)
  addPathPoint(path, x, y)
}

function setText(
  grid: StateGrid,
  x: number,
  y: number,
  text: string,
  style?: StateCellStyle,
  stateId?: string,
  bgStateId?: string,
): void {
  grid.setText(x, y, text, style, { stateId, bgStateId })
}

function isHiddenCompositeMarker(state: StateDiagramState | undefined): boolean {
  return Boolean(state?.parentId && (state.kind === "start" || state.kind === "end"))
}

function sourceTransitionsOf(transition: StateDiagramRenderTransition): readonly StateDiagramTransition[] {
  return transition.sourceTransitions ?? [transition]
}

function composeTransitionLabel(incoming: StateDiagramTransition, outgoing: StateDiagramTransition): string {
  return incoming.label || outgoing.label
}

function collapseHiddenCompositeMarkerTransitionsOnce(
  transitions: readonly StateDiagramRenderTransition[],
  statesById: ReadonlyMap<string, StateDiagramState>,
): { transitions: StateDiagramRenderTransition[]; changed: boolean } {
  const hiddenMarkers = new Set(
    [...statesById.values()].filter((state) => isHiddenCompositeMarker(state)).map((state) => state.id),
  )
  if (hiddenMarkers.size === 0) return { transitions: [...transitions], changed: false }

  const skipped = new Set<StateDiagramRenderTransition>()
  const collapsed: StateDiagramRenderTransition[] = []
  let changed = false

  for (const markerId of hiddenMarkers) {
    const incoming = transitions.filter((transition) => transition.to === markerId && transition.from !== markerId)
    const outgoing = transitions.filter((transition) => transition.from === markerId && transition.to !== markerId)
    if (incoming.length === 0 || outgoing.length === 0) continue

    changed = true
    for (const incomingTransition of incoming) {
      skipped.add(incomingTransition)
      for (const outgoingTransition of outgoing) {
        skipped.add(outgoingTransition)
        collapsed.push({
          from: incomingTransition.from,
          to: outgoingTransition.to,
          label: composeTransitionLabel(incomingTransition, outgoingTransition),
          sourceTransitions: [...sourceTransitionsOf(incomingTransition), ...sourceTransitionsOf(outgoingTransition)],
        })
      }
    }
  }

  return { transitions: [...transitions.filter((transition) => !skipped.has(transition)), ...collapsed], changed }
}

function collapseHiddenCompositeMarkerTransitions(diagram: StateDiagram): StateDiagramRenderTransition[] {
  const statesById = new Map(diagram.states.map((state) => [state.id, state]))
  let transitions: StateDiagramRenderTransition[] = diagram.transitions.map((transition) => ({
    ...transition,
    sourceTransitions: [transition],
  }))

  while (true) {
    const result = collapseHiddenCompositeMarkerTransitionsOnce(transitions, statesById)
    transitions = result.transitions
    if (!result.changed) return transitions
  }
}

function createRenderDiagram(diagram: StateDiagram): StateDiagram {
  const transitions = collapseHiddenCompositeMarkerTransitions(diagram)
  const referencedHiddenMarkers = new Set<string>()
  const statesById = new Map(diagram.states.map((state) => [state.id, state]))
  for (const transition of transitions) {
    const from = statesById.get(transition.from)
    const to = statesById.get(transition.to)
    if (from && isHiddenCompositeMarker(from)) referencedHiddenMarkers.add(from.id)
    if (to && isHiddenCompositeMarker(to)) referencedHiddenMarkers.add(to.id)
  }

  return {
    ...diagram,
    states: diagram.states.filter((state) => !isHiddenCompositeMarker(state) || referencedHiddenMarkers.has(state.id)),
    transitions,
  }
}

function drawBox(
  grid: StateGrid,
  state: StateDiagramState,
  bounds: BoxBounds,
  lines: string[],
  active: boolean,
  borderStyle: BorderStyle,
): void {
  if (isHiddenCompositeMarker(state)) return

  if (state.kind !== "state") {
    setCell(grid, bounds.left, bounds.top, state.label, active ? "activeState" : state.kind, state.id)
    return
  }
  const style: StateCellStyle = active ? "activeState" : "state"
  fillBoxInterior(grid, bounds, style, state.id)
  drawStateFrame(grid, bounds, BorderChars[borderStyle], style, state.id)
  lines.forEach((line, index) => {
    setStateText(grid, bounds, bounds.left + 2, bounds.top + 1 + index, line, style, state.id)
  })
}

function stateColorKeyForCell(bounds: BoxBounds, stateId: string, x: number, y: number, border = false): string {
  return stateDiagramStateColorKey(stateId, diagramRadialCellColorLevel(bounds, x, y, border))
}

function fillBoxInterior(grid: StateGrid, bounds: BoxBounds, style: StateCellStyle, stateId: string): void {
  for (let y = bounds.top + 1; y < bounds.top + bounds.height - 1; y++) {
    for (let x = bounds.left + 1; x < bounds.left + bounds.width - 1; x++) {
      const colorKey = stateColorKeyForCell(bounds, stateId, x, y)
      setCell(grid, x, y, " ", style, colorKey, colorKey)
    }
  }
}

function drawStateFrame(
  grid: StateGrid,
  bounds: BoxBounds,
  chars: BorderCharacters,
  style: StateCellStyle,
  stateId: string,
): void {
  const setBorderCell = (x: number, y: number, char: string) => {
    setCell(grid, x, y, char, style, stateColorKeyForCell(bounds, stateId, x, y, true))
  }

  drawDiagramFrame(bounds, chars, setBorderCell)
}

function setStateText(
  grid: StateGrid,
  bounds: BoxBounds,
  x: number,
  y: number,
  text: string,
  style: StateCellStyle,
  stateId: string,
): void {
  let offset = 0
  for (const char of text) {
    const colorKey = stateColorKeyForCell(bounds, stateId, x + offset, y)
    setCell(grid, x + offset, y, char, style, colorKey, colorKey)
    offset += visualLength(char)
  }
}

function drawContainerFrame(
  grid: StateGrid,
  bounds: BoxBounds,
  label: string,
  chars: BorderCharacters,
  style: StateCellStyle,
  stateId?: string,
): void {
  drawDiagramFrame(bounds, chars, (x, y, char) => setCell(grid, x, y, char, style, stateId))
  if (label) setText(grid, bounds.left + 2, bounds.top, ` ${label} `, style, stateId)
}

function drawHorizontalNoteConnector(grid: StateGrid, fromX: number, toX: number, y: number, char: string): void {
  const step = fromX <= toX ? 1 : -1
  for (let x = fromX; step === 1 ? x <= toX : x >= toX; x += step) {
    setCell(grid, x, y, char, "noteConnector")
  }
}

function drawNote(grid: StateGrid, bounds: StateNoteBounds, target: BoxBounds): void {
  const chars = BorderChars.double
  const connectorChars = BorderChars.double
  const noteX = bounds.note.position === "right" ? bounds.left - 1 : bounds.left + bounds.width
  const targetX = bounds.note.position === "right" ? target.left + target.width : target.left - 1
  const targetBottom = target.top + target.height - 1
  const noteBottom = bounds.top + bounds.height - 1
  const noteAbove = noteBottom < target.top
  const noteBelow = bounds.top > targetBottom
  let connectorY: number

  if (noteAbove || noteBelow) {
    const targetY = noteAbove ? target.top - 1 : targetBottom + 1
    connectorY = bounds.centerY
    const verticalStep = targetY <= connectorY ? 1 : -1

    for (let y = targetY; verticalStep === 1 ? y <= connectorY : y >= connectorY; y += verticalStep) {
      setCell(grid, targetX, y, connectorChars.vertical, "noteConnector")
    }

    drawHorizontalNoteConnector(grid, targetX, noteX, connectorY, connectorChars.horizontal)
    const connectorTurnsRight = targetX <= noteX
    const corner = noteAbove
      ? connectorTurnsRight
        ? connectorChars.topLeft
        : connectorChars.topRight
      : connectorTurnsRight
        ? connectorChars.bottomLeft
        : connectorChars.bottomRight
    setCell(grid, targetX, connectorY, corner, "noteConnector")
  } else {
    connectorY = Math.max(bounds.top + 1, Math.min(target.centerY, bounds.top + bounds.height - 2))
    drawHorizontalNoteConnector(grid, targetX, noteX, connectorY, connectorChars.horizontal)
  }

  drawContainerFrame(grid, bounds, "", chars, "noteBorder")
  setCell(
    grid,
    bounds.note.position === "right" ? bounds.left : bounds.left + bounds.width - 1,
    connectorY,
    bounds.note.position === "right" ? chars.rightT : chars.leftT,
    "noteBorder",
  )
  bounds.lines.forEach((line, index) => setText(grid, bounds.left + 2, bounds.top + 1 + index, line, "noteText"))
}

function transitionLineStyle(active: boolean): StateCellStyle {
  return active ? "activeTransition" : "transition"
}

function transitionLabelStyle(active: boolean): StateCellStyle {
  return active ? "activeTransition" : "label"
}

function transitionFadeStyle(
  source: FadeSourceStyle,
  distance: number,
  active: boolean,
  fadeFromSource: boolean,
): StateCellStyle {
  if (active) {
    if (!fadeFromSource) return "activeTransition"
    if (distance <= 0) return `${source}ActiveTransitionFade1` as ActiveTransitionFadeStyle
    if (distance >= FADE_STEPS.length) return "activeTransition"
    return `${source}ActiveTransitionFade${distance + 1}` as ActiveTransitionFadeStyle
  }
  if (distance <= 0) return `${source}TransitionFade1` as TransitionFadeStyle
  if (distance >= FADE_STEPS.length) return transitionLineStyle(active)
  return `${source}TransitionFade${distance + 1}` as TransitionFadeStyle
}

function transitionFadeCellStyle(context: TransitionDrawContext, distance: number): StateCellStyle {
  return transitionFadeStyle(context.fadeSource, distance, context.active, context.fadeFromSource)
}

function drawHorizontalRamp(
  grid: StateGrid,
  fromX: number,
  toX: number,
  y: number,
  direction: 1 | -1,
  startDistance: number,
  context: TransitionDrawContext,
): void {
  let distance = startDistance
  for (let x = fromX; direction === 1 ? x <= toX : x >= toX; x += direction) {
    setPathCell(grid, context.path, x, y, "─", transitionFadeCellStyle(context, distance), context.sourceStateId)
    distance += 1
  }
}

function drawVerticalRamp(
  grid: StateGrid,
  x: number,
  fromY: number,
  toY: number,
  direction: 1 | -1,
  startDistance: number,
  context: TransitionDrawContext,
): void {
  let distance = startDistance
  for (let y = fromY; direction === 1 ? y <= toY : y >= toY; y += direction) {
    setPathCell(grid, context.path, x, y, "│", transitionFadeCellStyle(context, distance), context.sourceStateId)
    distance += 1
  }
}

function drawRightDeparture(grid: StateGrid, bounds: BoxBounds, context: TransitionDrawContext): void {
  if (bounds.width <= 1 || bounds.height <= 1) return
  setPathCell(
    grid,
    context.path,
    bounds.left + bounds.width - 1,
    bounds.centerY,
    BorderChars.rounded.leftT,
    transitionFadeCellStyle(context, 0),
    context.sourceStateId,
  )
}

function drawBottomDeparture(grid: StateGrid, bounds: BoxBounds, x: number, context: TransitionDrawContext): void {
  if (bounds.width <= 1 || bounds.height <= 1) return
  setPathCell(
    grid,
    context.path,
    x,
    bounds.top + bounds.height - 1,
    BorderChars.rounded.topT,
    transitionFadeCellStyle(context, 0),
    context.sourceStateId,
  )
}

function drawTopDeparture(grid: StateGrid, bounds: BoxBounds, x: number, context: TransitionDrawContext): void {
  if (bounds.width <= 1 || bounds.height <= 1) return
  setPathCell(
    grid,
    context.path,
    x,
    bounds.top,
    BorderChars.rounded.bottomT,
    transitionFadeCellStyle(context, 0),
    context.sourceStateId,
  )
}

function drawHorizontal(
  grid: StateGrid,
  from: BoxBounds,
  to: BoxBounds,
  label: string,
  transition: StateDiagramTransition,
  diagram: StateDiagram,
  feedbackLaneY: number,
  arrowHeadStyle: StateDiagramArrowHeadStyle,
  context: TransitionDrawContext,
): void {
  if (transition.from === transition.to) {
    drawSelfTransition(grid, from, label, arrowHeadStyle, context)
    return
  }

  const leftToRight = from.centerX <= to.centerX
  const targetState = diagram.states.find((state) => state.id === transition.to)
  const targetIsChoice = targetState?.kind === "choice" || isHiddenCompositeMarker(targetState)
  if (!leftToRight) {
    drawBottomFeedback(grid, from, to, label, feedbackLaneY, arrowHeadStyle, targetIsChoice, context)
    return
  }

  if (from.centerY !== to.centerY) {
    drawVerticalElbowTransition(
      grid,
      from,
      to,
      label,
      hasReverseTransition(diagram, transition),
      arrowHeadStyle,
      targetIsChoice,
      context,
    )
    return
  }

  const y = from.centerY
  const lineStyle = transitionLineStyle(context.active)
  drawRightDeparture(grid, from, context)
  const startX = from.left + from.width
  const endX = to.left - 1
  const startDistance = from.width <= 1 || from.height <= 1 ? 0 : 1
  drawHorizontalRamp(grid, startX, targetIsChoice ? endX : endX - 1, y, 1, startDistance, context)
  if (targetIsChoice) addPathPoint(context.path, to.left, y)
  else setPathCell(grid, context.path, endX, y, diagramArrowHead("right", arrowHeadStyle), lineStyle)
  if (label) {
    const text = splitLines(label)[0] ?? ""
    const labelX = Math.min(startX, endX) + Math.max(1, Math.floor(Math.abs(endX - startX - visualLength(text)) / 2))
    setText(grid, labelX, Math.max(0, y - 1), text, transitionLabelStyle(context.active))
  }
}

function drawSelfTransition(
  grid: StateGrid,
  bounds: BoxBounds,
  label: string,
  arrowHeadStyle: StateDiagramArrowHeadStyle,
  context: TransitionDrawContext,
): void {
  if (bounds.width <= 1 || bounds.height <= 1) return

  const lineStyle = transitionLineStyle(context.active)
  const sourceX = bounds.left + Math.max(2, Math.floor(bounds.width / 3))
  const bottomY = bounds.top + bounds.height - 1
  const railY = bottomY + 2
  const targetX = Math.max(sourceX + 3, bounds.left + Math.min(bounds.width - 3, Math.ceil((bounds.width * 2) / 3)))

  drawBottomDeparture(grid, bounds, sourceX, context)
  setPathCell(grid, context.path, sourceX, bottomY + 1, "│", transitionFadeCellStyle(context, 1), context.sourceStateId)
  setPathCell(grid, context.path, sourceX, railY, "╰", lineStyle)
  for (let x = sourceX + 1; x < targetX; x++) setPathCell(grid, context.path, x, railY, "─", lineStyle)
  setPathCell(grid, context.path, targetX, railY, "╯", lineStyle)
  setPathCell(grid, context.path, targetX, bottomY + 1, diagramArrowHead("up", arrowHeadStyle), lineStyle)

  if (label) setText(grid, targetX + 2, bottomY + 1, splitLines(label)[0] ?? "", transitionLabelStyle(context.active))
}

function outsideBottomY(bounds: BoxBounds): number {
  return bounds.top + bounds.height
}

function drawBottomFeedback(
  grid: StateGrid,
  from: BoxBounds,
  to: BoxBounds,
  label: string,
  railY: number,
  arrowHeadStyle: StateDiagramArrowHeadStyle,
  targetIsChoice: boolean,
  context: TransitionDrawContext,
): void {
  const lineStyle = transitionLineStyle(context.active)
  const sourceX = from.centerX
  const targetX = to.width > 1 ? (sourceX > to.centerX ? to.left + 1 : to.left + to.width - 2) : to.centerX
  const sourceBottomY = outsideBottomY(from)
  const targetBottomY = outsideBottomY(to)
  const startDistance = from.width <= 1 || from.height <= 1 ? 0 : 1

  drawBottomDeparture(grid, from, sourceX, context)
  drawVerticalRamp(grid, sourceX, sourceBottomY, railY - 1, 1, startDistance, context)
  setPathCell(grid, context.path, sourceX, railY, sourceX > targetX ? "╯" : "╰", lineStyle)
  if (sourceX !== targetX) {
    const horizontalStep = sourceX < targetX ? 1 : -1
    for (let x = sourceX + horizontalStep; x !== targetX; x += horizontalStep) {
      setPathCell(grid, context.path, x, railY, "─", lineStyle)
    }
  }
  setPathCell(grid, context.path, targetX, railY, sourceX > targetX ? "╰" : "╯", lineStyle)
  for (let y = railY - 1; y > targetBottomY; y--) setPathCell(grid, context.path, targetX, y, "│", lineStyle)
  setPathCell(
    grid,
    context.path,
    targetX,
    targetBottomY,
    targetIsChoice ? "│" : diagramArrowHead("up", arrowHeadStyle),
    lineStyle,
  )
  if (targetIsChoice) addPathPoint(context.path, to.left, to.top)

  if (label) {
    const text = splitLines(label)[0] ?? ""
    const labelX =
      Math.min(sourceX, targetX) + Math.max(1, Math.floor((Math.abs(sourceX - targetX) - visualLength(text)) / 2))
    setText(grid, labelX, Math.max(0, railY - 1), text, transitionLabelStyle(context.active))
  }
}

function drawVerticalElbowTransition(
  grid: StateGrid,
  from: BoxBounds,
  to: BoxBounds,
  label: string,
  hasReverse: boolean,
  arrowHeadStyle: StateDiagramArrowHeadStyle,
  targetIsChoice: boolean,
  context: TransitionDrawContext,
): void {
  const lineStyle = transitionLineStyle(context.active)
  const topToBottom = from.centerY < to.centerY
  const offset = hasReverse ? (topToBottom ? -2 : 2) : 0
  const startX = from.centerX + offset
  const endX = to.centerX + offset
  const startY = topToBottom ? from.top + from.height : from.top - 1
  const endY = topToBottom ? to.top - 1 : to.top + to.height
  const verticalStep = topToBottom ? 1 : -1
  const startDistance = from.width <= 1 || from.height <= 1 ? 0 : 1

  if (topToBottom) {
    drawBottomDeparture(grid, from, startX, context)
  } else {
    drawTopDeparture(grid, from, startX, context)
  }

  if (startY !== endY) drawVerticalRamp(grid, startX, startY, endY - verticalStep, verticalStep, startDistance, context)

  if (startX !== endX) {
    const horizontalStep = startX < endX ? 1 : -1
    setPathCell(
      grid,
      context.path,
      startX,
      endY,
      topToBottom ? (startX < endX ? "╰" : "╯") : startX < endX ? "╭" : "╮",
      lineStyle,
    )
    for (let x = startX + horizontalStep; x !== endX; x += horizontalStep) {
      setPathCell(grid, context.path, x, endY, "─", lineStyle)
    }
  }

  const targetChar = targetIsChoice
    ? startX === endX
      ? "│"
      : topToBottom
        ? "┬"
        : "┴"
    : diagramArrowHead(topToBottom ? "down" : "up", arrowHeadStyle)
  setPathCell(grid, context.path, endX, endY, targetChar, lineStyle)
  if (targetIsChoice) addPathPoint(context.path, to.left, to.top)
  if (label) {
    const text = splitLines(label)[0] ?? ""
    if (topToBottom) {
      const labelX = hasReverse || endX < startX ? startX - visualLength(text) - 2 : startX + 2
      setText(grid, labelX, Math.min(startY + 1, endY), text, transitionLabelStyle(context.active))
    } else {
      const labelX =
        Math.min(startX, endX) + Math.max(1, Math.floor((Math.abs(endX - startX) - visualLength(text)) / 2))
      setText(
        grid,
        startX === endX ? startX + 3 : labelX,
        Math.max(0, startY),
        text,
        transitionLabelStyle(context.active),
      )
    }
  }
}

function drawVertical(
  grid: StateGrid,
  from: BoxBounds,
  to: BoxBounds,
  label: string,
  arrowHeadStyle: StateDiagramArrowHeadStyle,
  targetIsChoice: boolean,
  context: TransitionDrawContext,
): void {
  const lineStyle = transitionLineStyle(context.active)
  const topToBottom = from.centerY <= to.centerY
  const x = from.centerX
  const startY = topToBottom ? from.top + from.height : from.top - 1
  const endY = topToBottom ? to.top - 1 : to.top + to.height
  const step = topToBottom ? 1 : -1
  const startDistance = from.width <= 1 || from.height <= 1 ? 0 : 1

  if (topToBottom) {
    drawBottomDeparture(grid, from, x, context)
  } else {
    drawTopDeparture(grid, from, x, context)
  }

  if (startY !== endY) drawVerticalRamp(grid, x, startY, endY - step, step, startDistance, context)
  setPathCell(
    grid,
    context.path,
    x,
    endY,
    targetIsChoice ? "│" : diagramArrowHead(topToBottom ? "down" : "up", arrowHeadStyle),
    lineStyle,
  )
  if (targetIsChoice) addPathPoint(context.path, to.left, to.top)
  if (label)
    setText(grid, x + 2, Math.min(startY, endY) + 1, splitLines(label)[0] ?? "", transitionLabelStyle(context.active))
}

function connectionDirection(from: BoxBounds, to: BoxBounds): DiagramDirection {
  const deltaX = to.centerX - from.centerX
  const deltaY = to.centerY - from.centerY
  if (Math.abs(deltaX) >= Math.abs(deltaY) && deltaX !== 0) return deltaX > 0 ? "right" : "left"
  if (deltaY !== 0) return deltaY > 0 ? "down" : "up"
  return "right"
}

function drawChoiceJunctions(
  grid: StateGrid,
  diagram: StateDiagram,
  bounds: Map<string, BoxBounds>,
  activeState: string | undefined,
  activeTransitions: readonly StateDiagramActiveTransition[],
): void {
  for (const state of diagram.states) {
    if (state.kind !== "choice") continue
    const choiceBounds = bounds.get(state.id)
    if (!choiceBounds) continue

    const connections = new Set<DiagramDirection>()
    let active = false
    for (const transition of diagram.transitions) {
      if (transition.to === state.id) {
        const sourceBounds = bounds.get(transition.from)
        if (sourceBounds) connections.add(connectionDirection(choiceBounds, sourceBounds))
        active = active || isActiveTransition(transition, activeTransitions)
      }
      if (transition.from === state.id) {
        const targetBounds = bounds.get(transition.to)
        if (targetBounds) {
          const feedback =
            (diagram.direction === "LR" || diagram.direction === "RL") && targetBounds.centerX < choiceBounds.centerX
          connections.add(feedback ? "down" : connectionDirection(choiceBounds, targetBounds))
        }
        active = active || isActiveTransition(transition, activeTransitions)
      }
    }

    setCell(
      grid,
      choiceBounds.left,
      choiceBounds.top,
      diagramLineGlyph(connections, "rounded"),
      state.id === activeState ? "activeState" : active ? "activeTransition" : "choice",
    )
  }
}

function drawHiddenCompositeMarkerJunctions(
  grid: StateGrid,
  diagram: StateDiagram,
  bounds: Map<string, BoxBounds>,
  activeState: string | undefined,
  activeTransitions: readonly StateDiagramActiveTransition[],
): void {
  for (const state of diagram.states) {
    if (!isHiddenCompositeMarker(state)) continue
    const markerBounds = bounds.get(state.id)
    if (!markerBounds) continue

    const connections = new Set<DiagramDirection>()
    let active = false
    for (const transition of diagram.transitions) {
      if (transition.to === state.id) {
        const sourceBounds = bounds.get(transition.from)
        if (sourceBounds) connections.add(connectionDirection(markerBounds, sourceBounds))
        active = active || isActiveTransition(transition, activeTransitions)
      }
      if (transition.from === state.id) {
        const targetBounds = bounds.get(transition.to)
        if (targetBounds) connections.add(connectionDirection(markerBounds, targetBounds))
        active = active || isActiveTransition(transition, activeTransitions)
      }
    }

    setCell(
      grid,
      markerBounds.left,
      markerBounds.top,
      diagramLineGlyph(connections, "rounded"),
      state.id === activeState ? "activeState" : active ? "activeTransition" : "transition",
    )
  }
}

function isActiveTransitionStyle(style: StateCellStyle | undefined): boolean {
  return style ? ACTIVE_TRANSITION_STYLES.has(style) : false
}

function activeTransitionPulseStyleLevel(style: StateCellStyle | undefined): number {
  if (!style) return 0
  const index = (ACTIVE_TRANSITION_PULSE_STYLES as readonly StateCellStyle[]).indexOf(style)
  return index >= 0 ? index + 1 : 0
}

function activeTransitionPulseCellStyle(
  distance: number,
  radius: number,
  edgeDistance: number,
  char: string,
): { style: StateCellStyle; level: number } {
  const level = diagramPulseLevel(distance, radius, edgeDistance, char === "─" || char === "│")

  return { style: ACTIVE_TRANSITION_PULSE_STYLES[level - 1]!, level }
}

function isActiveTransitionPulseTargetStyle(style: StateCellStyle | undefined): boolean {
  return isActiveTransitionStyle(style) || activeTransitionPulseStyleLevel(style) > 0
}

function setActiveTransitionPulseCell(
  grid: StateGrid,
  x: number,
  y: number,
  distance: number,
  radius: number,
  edgeDistance: number,
): void {
  setTransitionPulseCell(grid, x, y, distance, radius, edgeDistance, isActiveTransitionPulseTargetStyle)
}

function isTransitionFrontierStyle(style: StateCellStyle | undefined): boolean {
  return isTransitionDrawingStyle(style) || activeTransitionPulseStyleLevel(style) > 0
}

function setTransitionPulseCell(
  grid: StateGrid,
  x: number,
  y: number,
  distance: number,
  radius: number,
  edgeDistance: number,
  canStyle: (style: StateCellStyle | undefined) => boolean,
): void {
  const cell = grid.rows[y]?.[x]
  if (!cell || cell.char === " " || !canStyle(cell.style)) return

  const pulse = activeTransitionPulseCellStyle(distance, radius, edgeDistance, cell.char)
  if (activeTransitionPulseStyleLevel(cell.style) > pulse.level) return
  cell.style = pulse.style
}

function setTransitionFrontierCell(
  grid: StateGrid,
  x: number,
  y: number,
  distance: number,
  radius: number,
  edgeDistance: number,
): void {
  setTransitionPulseCell(grid, x, y, distance, radius, edgeDistance, isTransitionFrontierStyle)
}

function activeTransitionPathLength(paths: readonly StatePathPoint[][]): number {
  return paths.reduce((total, path) => total + path.length, 0)
}

function activeTransitionPathPointAt(paths: readonly StatePathPoint[][], index: number): StatePathPoint | undefined {
  let offset = index
  for (const path of paths) {
    if (offset < path.length) return path[offset]
    offset -= path.length
  }
  return undefined
}

function drawActiveTransitionPulseOnPaths(
  grid: StateGrid,
  paths: readonly StatePathPoint[][],
  pulseFrame: number | undefined,
  pulseProgress: number | undefined,
  pulseLength: number,
  pulseGap: number,
): void {
  const pathLength = activeTransitionPathLength(paths)
  if (pathLength === 0 || (pulseFrame === undefined && pulseProgress === undefined)) return

  visitDiagramPulsePath({
    pathLength,
    pointAt: (index) => activeTransitionPathPointAt(paths, index),
    pulseFrame,
    pulseProgress,
    pulseLength,
    pulseGap,
    visit: ([x, y], distance, radius, edgeDistance) =>
      setActiveTransitionPulseCell(grid, x, y, distance, radius, edgeDistance),
  })
}

function applyActiveTransitionPulse(
  grid: StateGrid,
  pulseFrame: number | undefined,
  pulseProgress: number | undefined,
  pulseLength: number,
  pulseGap: number,
  activeTransitionPaths: readonly StatePathPoint[][],
): void {
  if (pulseFrame === undefined && pulseProgress === undefined) return

  drawActiveTransitionPulseOnPaths(grid, activeTransitionPaths, pulseFrame, pulseProgress, pulseLength, pulseGap)
}

function inactiveTransitionStyle(style: StateCellStyle | undefined): StateCellStyle | undefined {
  if (style === "activeTransition") return "transition"
  if (style?.includes("ActiveTransitionFade")) {
    return style.replace("ActiveTransitionFade", "TransitionFade") as TransitionFadeStyle
  }
  return style
}

function setInactiveTransitionCell(grid: StateGrid, x: number, y: number): void {
  const cell = grid.rows[y]?.[x]
  if (!cell || !isActiveTransitionStyle(cell.style)) return
  cell.style = inactiveTransitionStyle(cell.style)
}

function applyActiveTransitionMask(
  grid: StateGrid,
  activeTransitionPaths: readonly StatePathPoint[][],
  progress: number | undefined,
  mode: StateDiagramActiveTransitionMode,
): void {
  if (progress === undefined) return

  const pathLength = activeTransitionPathLength(activeTransitionPaths)
  if (pathLength === 0) return

  const cutoff = Math.round(progress * pathLength)
  for (let index = 0; index < pathLength; index++) {
    const inactive = mode === "reveal" ? index >= cutoff : index < cutoff
    if (!inactive) continue
    const point = activeTransitionPathPointAt(activeTransitionPaths, index)
    if (!point) continue
    const [x, y] = point
    setInactiveTransitionCell(grid, x, y)
  }

  const before = mode === "reveal" ? ACTIVE_TRANSITION_FRONTIER_ACTIVE_SIDE : ACTIVE_TRANSITION_FRONTIER_INACTIVE_SIDE
  const after = mode === "reveal" ? ACTIVE_TRANSITION_FRONTIER_INACTIVE_SIDE : ACTIVE_TRANSITION_FRONTIER_ACTIVE_SIDE
  const radius = Math.max(before, after)
  for (let offset = -before; offset <= after; offset++) {
    const pathIndex = cutoff + offset
    if (pathIndex < 0 || pathIndex >= pathLength) continue
    const point = activeTransitionPathPointAt(activeTransitionPaths, pathIndex)
    if (!point) continue
    const [x, y] = point
    const edgeDistance = Math.min(pathIndex, pathLength - 1 - pathIndex)
    setTransitionFrontierCell(grid, x, y, Math.abs(offset), radius, edgeDistance)
  }
}

function transitionFadeSource(
  statesById: Map<string, StateDiagramState>,
  transition: StateDiagramTransition,
  activeState: string | undefined,
): FadeSourceStyle {
  if (transition.from === activeState) return "activeState"
  const source = statesById.get(transition.from)
  if (isHiddenCompositeMarker(source)) return "composite"
  if (source?.kind === "start") return "start"
  if (source?.kind === "end") return "end"
  if (source?.kind === "choice") return "choice"
  return "state"
}

function layoutStateDiagram(content: string, options: StateDiagramRenderOptions = {}): StateGrid {
  const parsedDiagram = parseMermaidStateDiagram(content)
  parsedDiagram.direction = options.direction ?? parsedDiagram.direction
  const diagram = createRenderDiagram(parsedDiagram)
  const borderStyle = options.borderStyle ?? DEFAULT_BORDER_STYLE
  const arrowHeadStyle = options.arrowHeadStyle ?? DEFAULT_ARROW_HEAD_STYLE
  const minStateGap = Math.max(1, Math.floor(options.minStateGap ?? DEFAULT_MIN_STATE_GAP))
  const pulseFrame = normalizePulseFrame(options.pulseFrame)
  const pulseProgress = normalizePulseProgress(options.pulseProgress)
  const pulseLength = normalizePulseLength(options.pulseLength)
  const pulseGap = normalizePulseGap(options.pulseGap)
  const activeTransitionProgress = normalizePulseProgress(options.activeTransitionProgress)
  const activeTransitionMode = normalizeActiveTransitionMode(options.activeTransitionMode)
  const activeTransitions = normalizeActiveTransitions(options.activeTransition)
  const { bounds, sizes, compositeBounds, noteBounds } = createStateDiagramLayout(diagram, { minStateGap })
  const statesById = new Map(diagram.states.map((state) => [state.id, state]))
  let allBounds = [...bounds.values(), ...noteBounds]
  let maxY = Math.max(0, ...allBounds.map((bound) => bound.top + bound.height))
  const feedbackLaneY = maxY + 3
  expandCompositeBoundsForFeedback(diagram, bounds, compositeBounds, feedbackLaneY)
  allBounds = [...bounds.values(), ...noteBounds]
  const maxX = Math.max(0, ...allBounds.map((bound) => bound.left + bound.width))
  maxY = Math.max(0, ...allBounds.map((bound) => bound.top + bound.height))
  const grid = makeGrid(maxX + 24, maxY + 8)
  const activeTransitionPaths: StatePathPoint[][] = []

  for (const composite of diagram.composites) {
    const bound = compositeBounds.get(composite.id)
    if (!bound) continue
    drawContainerFrame(
      grid,
      bound,
      composite.label,
      BorderChars[borderStyle],
      options.activeState === composite.id ? "activeState" : "composite",
    )
  }

  for (const state of diagram.states) {
    const bound = bounds.get(state.id)
    const size = sizes.get(state.id)
    if (!bound || !size) continue
    drawBox(grid, state, bound, size.lines, options.activeState === state.id, borderStyle)
  }

  for (const transition of diagram.transitions) {
    const from = bounds.get(transition.from)
    const to = bounds.get(transition.to)
    if (!from || !to) continue
    const fadeSource = transitionFadeSource(statesById, transition, options.activeState)
    const activeIndex = activeTransitionIndex(transition, activeTransitions)
    const active = activeIndex !== -1
    const fadeFromSource = activeIndex <= 0
    const targetState = statesById.get(transition.to)
    const targetIsChoice = targetState?.kind === "choice" || isHiddenCompositeMarker(targetState)
    const activePath: StatePathPoint[] | undefined = active ? [] : undefined
    const drawContext: TransitionDrawContext = {
      fadeSource,
      active,
      fadeFromSource,
      path: activePath,
      sourceStateId: transition.from,
    }
    if (diagram.direction === "LR" || diagram.direction === "RL")
      drawHorizontal(grid, from, to, transition.label, transition, diagram, feedbackLaneY, arrowHeadStyle, drawContext)
    else drawVertical(grid, from, to, transition.label, arrowHeadStyle, targetIsChoice, drawContext)

    if (activePath?.length) activeTransitionPaths[activeIndex] = activePath
  }

  drawChoiceJunctions(grid, diagram, bounds, options.activeState, activeTransitions)
  drawHiddenCompositeMarkerJunctions(grid, diagram, bounds, options.activeState, activeTransitions)
  applyActiveTransitionMask(grid, activeTransitionPaths, activeTransitionProgress, activeTransitionMode)
  applyActiveTransitionPulse(grid, pulseFrame, pulseProgress, pulseLength, pulseGap, activeTransitionPaths)

  for (const noteBound of noteBounds) {
    const target = bounds.get(noteBound.note.target)
    if (target) drawNote(grid, noteBound, target)
  }

  return grid
}

function renderGridText(grid: StateGrid): string {
  return grid.toString({ trimBottom: true })
}

function forEachGridRun(
  grid: StateGrid,
  onRun: (
    text: string,
    style: StateCellStyle | undefined,
    stateId: string | undefined,
    bgStateId: string | undefined,
  ) => void,
  onLineEnd: () => void,
  useStateRuns = false,
): void {
  grid.forEachRun(
    (run) => {
      onRun(
        run.text,
        run.style,
        useStateRuns ? run.cell.stateId : undefined,
        useStateRuns ? run.cell.bgStateId : undefined,
      )
    },
    onLineEnd,
    { key: (cell) => (useStateRuns ? [cell.style, cell.stateId, cell.bgStateId] : [cell.style]) },
  )
}

function renderGridStyledText(
  grid: StateGrid,
  colors: StateStyleColors,
  stateColors?: ReadonlyMap<string, RGBA>,
  stateBgColors?: ReadonlyMap<string, RGBA>,
): StyledText {
  const chunks: TextChunk[] = []
  const useStateRuns = Boolean(stateColors?.size || stateBgColors?.size)

  forEachGridRun(
    grid,
    (text, style, stateId, bgStateId) => {
      chunks.push({
        __isChunk: true,
        text,
        fg: styleColor(style, colors, stateColors, stateId),
        bg: styleBgColor(stateBgColors, bgStateId),
      })
    },
    () => {
      chunks.push({ __isChunk: true, text: "\n" })
    },
    useStateRuns,
  )

  return new StyledText(chunks)
}

function renderGridAnsi(grid: StateGrid, theme: StateDiagramAnsiTheme = {}): string {
  const resolved = { ...DEFAULT_ANSI_THEME, ...theme }
  let output = ""

  forEachGridRun(
    grid,
    (text, style) => {
      const ansi = style ? resolved[style] : undefined
      output += ansi ? `${ansi}${text}${ANSI.reset}` : text
    },
    () => {
      output += "\n"
    },
  )

  return output.trimEnd()
}

export function renderStateDiagram(content: string, options: StateDiagramRenderOptions = {}): string {
  return renderGridText(layoutStateDiagram(content, options))
}

export function renderStateDiagramAnsi(content: string, options: StateDiagramAnsiOptions = {}): string {
  return renderGridAnsi(layoutStateDiagram(content, options), options.theme)
}

export class StateDiagramRenderable extends TextBufferRenderable {
  private _content: string
  private _direction?: StateDiagramDirection
  private _borderStyle: BorderStyle
  private _arrowHeadStyle: StateDiagramArrowHeadStyle
  private _minStateGap: number
  private _activeState?: string
  private _activeTransitions: StateDiagramActiveTransition[]
  private _activeTransitionProgress?: number
  private _activeTransitionMode: StateDiagramActiveTransitionMode
  private _stateColor?: RGBA
  private _activeStateColor?: RGBA
  private _compositeColor?: RGBA
  private _transitionColor?: RGBA
  private _activeTransitionColor?: RGBA
  private _pulseColor?: RGBA
  private _labelColor?: RGBA
  private _noteBorderColor?: RGBA
  private _noteTextColor?: RGBA
  private _noteConnectorColor?: RGBA
  private _startColor?: RGBA
  private _endColor?: RGBA
  private _choiceColor?: RGBA
  private _stateColors: Map<string, RGBA>
  private _stateBgColors: Map<string, RGBA>
  private _pulseFrame?: number
  private _pulseProgress?: number
  private _pulseLength: number
  private _pulseGap: number
  private _batchDepth = 0
  private _needsUpdate = false

  constructor(ctx: RenderContext, options: StateDiagramOptions = {}) {
    super(ctx, { ...options, wrapMode: options.wrapMode ?? "none" })
    this._content = options.content ?? ""
    this._direction = options.direction
    this._borderStyle = options.borderStyle ?? DEFAULT_BORDER_STYLE
    this._arrowHeadStyle = options.arrowHeadStyle ?? DEFAULT_ARROW_HEAD_STYLE
    this._minStateGap = options.minStateGap ?? DEFAULT_MIN_STATE_GAP
    this._activeState = options.activeState
    this._activeTransitions = normalizeActiveTransitions(options.activeTransition)
    this._activeTransitionProgress = normalizePulseProgress(options.activeTransitionProgress)
    this._activeTransitionMode = normalizeActiveTransitionMode(options.activeTransitionMode)
    this._stateColor = options.stateColor ? parseColor(options.stateColor) : undefined
    this._activeStateColor = options.activeStateColor ? parseColor(options.activeStateColor) : undefined
    this._compositeColor = options.compositeColor ? parseColor(options.compositeColor) : undefined
    this._transitionColor = options.transitionColor ? parseColor(options.transitionColor) : undefined
    this._activeTransitionColor = options.activeTransitionColor ? parseColor(options.activeTransitionColor) : undefined
    this._pulseColor = options.pulseColor ? parseColor(options.pulseColor) : undefined
    this._labelColor = options.labelColor ? parseColor(options.labelColor) : undefined
    this._noteBorderColor = options.noteBorderColor ? parseColor(options.noteBorderColor) : undefined
    this._noteTextColor = options.noteTextColor ? parseColor(options.noteTextColor) : undefined
    this._noteConnectorColor = options.noteConnectorColor ? parseColor(options.noteConnectorColor) : undefined
    this._startColor = options.startColor ? parseColor(options.startColor) : undefined
    this._endColor = options.endColor ? parseColor(options.endColor) : undefined
    this._choiceColor = options.choiceColor ? parseColor(options.choiceColor) : undefined
    this._stateColors = normalizeDiagramColorMap(options.stateColors)
    this._stateBgColors = normalizeDiagramColorMap(options.stateBgColors)
    this._pulseFrame = normalizePulseFrame(options.pulseFrame)
    this._pulseProgress = normalizePulseProgress(options.pulseProgress)
    this._pulseLength = normalizePulseLength(options.pulseLength)
    this._pulseGap = normalizePulseGap(options.pulseGap)
    this.updateDiagram()
  }

  get content(): string {
    return this._content
  }

  set content(value: string) {
    if (this._content === value) return
    this._content = value
    this.invalidateDiagram()
  }

  get activeState(): string | undefined {
    return this._activeState
  }

  set activeState(value: string | undefined) {
    if (this._activeState === value) return
    this._activeState = value
    this.invalidateDiagram()
  }

  get direction(): StateDiagramDirection | undefined {
    return this._direction
  }

  set direction(value: StateDiagramDirection | undefined) {
    if (this._direction === value) return
    this._direction = value
    this.invalidateDiagram()
  }

  get borderStyle(): BorderStyle {
    return this._borderStyle
  }

  set borderStyle(value: BorderStyle | undefined) {
    const next = value ?? DEFAULT_BORDER_STYLE
    if (this._borderStyle === next) return
    this._borderStyle = next
    this.invalidateDiagram()
  }

  get minStateGap(): number {
    return this._minStateGap
  }

  set minStateGap(value: number | undefined) {
    const next = value ?? DEFAULT_MIN_STATE_GAP
    if (this._minStateGap === next) return
    this._minStateGap = next
    this.invalidateDiagram()
  }

  get activeTransition(): StateDiagramActiveTransitionSelection | undefined {
    if (this._activeTransitions.length === 0) return undefined
    if (this._activeTransitions.length === 1) return this._activeTransitions[0]
    return [...this._activeTransitions]
  }

  set activeTransition(value: StateDiagramActiveTransitionSelection | undefined) {
    const next = normalizeActiveTransitions(value)
    if (activeTransitionListsEqual(this._activeTransitions, next)) return
    this._activeTransitions = next
    this.invalidateDiagram()
  }

  get activeTransitionProgress(): number | undefined {
    return this._activeTransitionProgress
  }

  set activeTransitionProgress(value: number | undefined) {
    const next = normalizePulseProgress(value)
    if (this._activeTransitionProgress === next) return
    this._activeTransitionProgress = next
    this.invalidateDiagram()
  }

  get activeTransitionMode(): StateDiagramActiveTransitionMode {
    return this._activeTransitionMode
  }

  set activeTransitionMode(value: StateDiagramActiveTransitionMode | undefined) {
    const next = normalizeActiveTransitionMode(value)
    if (this._activeTransitionMode === next) return
    this._activeTransitionMode = next
    this.invalidateDiagram()
  }

  get arrowHeadStyle(): StateDiagramArrowHeadStyle {
    return this._arrowHeadStyle
  }

  set arrowHeadStyle(value: StateDiagramArrowHeadStyle | undefined) {
    const next = value ?? DEFAULT_ARROW_HEAD_STYLE
    if (this._arrowHeadStyle === next) return
    this._arrowHeadStyle = next
    this.invalidateDiagram()
  }

  private setColor(
    current: RGBA | undefined,
    value: ColorInput | undefined,
    assign: (color: RGBA | undefined) => void,
  ): void {
    const next = value ? parseColor(value) : undefined
    if (colorsEqual(current, next)) return
    assign(next)
    this.invalidateDiagram()
  }

  set stateColor(value: ColorInput | undefined) {
    this.setColor(this._stateColor, value, (color) => (this._stateColor = color))
  }

  set activeStateColor(value: ColorInput | undefined) {
    this.setColor(this._activeStateColor, value, (color) => (this._activeStateColor = color))
  }

  set compositeColor(value: ColorInput | undefined) {
    this.setColor(this._compositeColor, value, (color) => (this._compositeColor = color))
  }

  set transitionColor(value: ColorInput | undefined) {
    this.setColor(this._transitionColor, value, (color) => (this._transitionColor = color))
  }

  set activeTransitionColor(value: ColorInput | undefined) {
    this.setColor(this._activeTransitionColor, value, (color) => (this._activeTransitionColor = color))
  }

  set pulseColor(value: ColorInput | undefined) {
    this.setColor(this._pulseColor, value, (color) => (this._pulseColor = color))
  }

  set labelColor(value: ColorInput | undefined) {
    this.setColor(this._labelColor, value, (color) => (this._labelColor = color))
  }

  set noteBorderColor(value: ColorInput | undefined) {
    this.setColor(this._noteBorderColor, value, (color) => (this._noteBorderColor = color))
  }

  set noteTextColor(value: ColorInput | undefined) {
    this.setColor(this._noteTextColor, value, (color) => (this._noteTextColor = color))
  }

  set noteConnectorColor(value: ColorInput | undefined) {
    this.setColor(this._noteConnectorColor, value, (color) => (this._noteConnectorColor = color))
  }

  set startColor(value: ColorInput | undefined) {
    this.setColor(this._startColor, value, (color) => (this._startColor = color))
  }

  set endColor(value: ColorInput | undefined) {
    this.setColor(this._endColor, value, (color) => (this._endColor = color))
  }

  set choiceColor(value: ColorInput | undefined) {
    this.setColor(this._choiceColor, value, (color) => (this._choiceColor = color))
  }

  set stateColors(value: StateDiagramStateColors | undefined) {
    const next = normalizeDiagramColorMap(value)
    if (diagramColorMapsEqual(this._stateColors, next)) return
    this._stateColors = next
    this.invalidateDiagram()
  }

  set stateBgColors(value: StateDiagramStateColors | undefined) {
    const next = normalizeDiagramColorMap(value)
    if (diagramColorMapsEqual(this._stateBgColors, next)) return
    this._stateBgColors = next
    this.invalidateDiagram()
  }

  get pulseFrame(): number | undefined {
    return this._pulseFrame
  }

  set pulseFrame(value: number | undefined) {
    const next = normalizePulseFrame(value)
    if (this._pulseFrame === next) return
    this._pulseFrame = next
    this.invalidateDiagram()
  }

  get pulseProgress(): number | undefined {
    return this._pulseProgress
  }

  set pulseProgress(value: number | undefined) {
    const next = normalizePulseProgress(value)
    if (this._pulseProgress === next) return
    this._pulseProgress = next
    this.invalidateDiagram()
  }

  get pulseLength(): number {
    return this._pulseLength
  }

  set pulseLength(value: number | undefined) {
    const next = normalizePulseLength(value)
    if (this._pulseLength === next) return
    this._pulseLength = next
    this.invalidateDiagram()
  }

  get pulseGap(): number {
    return this._pulseGap
  }

  set pulseGap(value: number | undefined) {
    const next = normalizePulseGap(value)
    if (this._pulseGap === next) return
    this._pulseGap = next
    this.invalidateDiagram()
  }

  batchUpdate(update: () => void): void {
    this._batchDepth += 1
    try {
      update()
    } finally {
      this._batchDepth -= 1
      if (this._batchDepth === 0 && this._needsUpdate) {
        this._needsUpdate = false
        this.updateDiagram()
      }
    }
  }

  private invalidateDiagram(): void {
    if (this._batchDepth > 0) {
      this._needsUpdate = true
      return
    }
    this.updateDiagram()
  }

  private updateDiagram(): void {
    const grid = layoutStateDiagram(this._content, {
      direction: this._direction,
      borderStyle: this._borderStyle,
      arrowHeadStyle: this._arrowHeadStyle,
      minStateGap: this._minStateGap,
      activeState: this._activeState,
      activeTransition: this._activeTransitions,
      activeTransitionProgress: this._activeTransitionProgress,
      activeTransitionMode: this._activeTransitionMode,
      pulseFrame: this._pulseFrame,
      pulseProgress: this._pulseProgress,
      pulseLength: this._pulseLength,
      pulseGap: this._pulseGap,
    })
    this.textBuffer.setStyledText(
      renderGridStyledText(
        grid,
        resolveStateStyleColors({
          state: this._stateColor,
          activeState: this._activeStateColor,
          composite: this._compositeColor,
          transition: this._transitionColor,
          activeTransition: this._activeTransitionColor,
          activeTransitionPulse: this._pulseColor,
          label: this._labelColor,
          noteBorder: this._noteBorderColor,
          noteText: this._noteTextColor,
          noteConnector: this._noteConnectorColor,
          start: this._startColor,
          end: this._endColor,
          choice: this._choiceColor,
        }),
        this._stateColors,
        this._stateBgColors,
      ),
    )
    this.updateTextInfo()
    this.requestRender()
  }
}
