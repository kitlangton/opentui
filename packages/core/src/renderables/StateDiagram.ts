import { ANSI } from "../ansi.js"
import { BorderChars, type BorderCharacters, type BorderStyle } from "../lib/border.js"
import { StyledText } from "../lib/styled-text.js"
import { RGBA, parseColor, type ColorInput } from "../lib/RGBA.js"
import { stringWidth } from "../platform/runtime.js"
import type { TextChunk } from "../text-buffer.js"
import { type RenderContext } from "../types.js"
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

type FadeStep = 1 | 2 | 3 | 4 | 5
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
type Rgb = readonly [number, number, number]

type StateStyleColors = Required<Record<BaseStateCellStyle, RGBA>> &
  Required<Record<TransitionFadeStyle, RGBA>> &
  Required<Record<ActiveTransitionFadeStyle, RGBA>> &
  Required<Record<ActiveTransitionPulseFadeStyle, RGBA>>

interface StateCell {
  char: string
  style?: StateCellStyle
  stateId?: string
  bgStateId?: string
}

interface StateGrid {
  rows: StateCell[][]
}

type StatePathPoint = readonly [number, number]

interface BoxBounds {
  id: string
  left: number
  top: number
  width: number
  height: number
  centerX: number
  centerY: number
}

interface StateLayout {
  bounds: Map<string, BoxBounds>
  sizes: Map<string, { width: number; height: number; lines: string[] }>
  compositeBounds: Map<string, BoxBounds>
  noteBounds: StateNoteBounds[]
}

interface StateNoteBounds extends BoxBounds {
  note: StateDiagramNote
  lines: string[]
}

const DEFAULT_DIRECTION = "LR" satisfies StateDiagramDirection
const DEFAULT_MIN_STATE_GAP = 5
const DEFAULT_BORDER_STYLE = "rounded" satisfies BorderStyle
const DEFAULT_ARROW_HEAD_STYLE = "filled" satisfies StateDiagramArrowHeadStyle
const DEFAULT_PULSE_LENGTH = 5
const DEFAULT_PULSE_GAP = 14
const STATE_COLOR_LEVEL_SEPARATOR = "::cell:"
const STATE_COLOR_LEVEL_COUNT = 6
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
} as const satisfies Record<BaseStateCellStyle, Rgb>
const FADE_STEPS = [1, 2, 3, 4, 5] as const satisfies readonly FadeStep[]
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
  ...FADE_STEPS.flatMap(
    (step) =>
      [
        `stateActiveTransitionFade${step}`,
        `activeStateActiveTransitionFade${step}`,
        `compositeActiveTransitionFade${step}`,
        `startActiveTransitionFade${step}`,
        `endActiveTransitionFade${step}`,
        `choiceActiveTransitionFade${step}`,
      ] as StateCellStyle[],
  ),
])
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

function ansiFg(rgb: Rgb): string {
  return `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`
}

function rgba(rgb: Rgb): RGBA {
  return RGBA.fromInts(rgb[0], rgb[1], rgb[2], 255)
}

function mixChannel(left: number, right: number, amount: number): number {
  return Math.round(left + (right - left) * amount)
}

function mixRgb(left: Rgb, right: Rgb, amount: number): Rgb {
  return [
    mixChannel(left[0], right[0], amount),
    mixChannel(left[1], right[1], amount),
    mixChannel(left[2], right[2], amount),
  ]
}

function createAnsiFadeTheme(source: FadeSourceStyle, from: Rgb, to: Rgb): Record<TransitionFadeStyle, string> {
  return Object.fromEntries(
    FADE_STEPS.map((step) => [
      `${source}TransitionFade${step}`,
      ansiFg(mixRgb(from, to, step / (FADE_STEPS.length + 1))),
    ]),
  ) as Record<TransitionFadeStyle, string>
}

function createAnsiActiveTransitionFadeTheme(
  source: FadeSourceStyle,
  from: Rgb,
  to: Rgb,
): Record<ActiveTransitionFadeStyle, string> {
  return Object.fromEntries(
    FADE_STEPS.map((step) => [
      `${source}ActiveTransitionFade${step}`,
      ansiFg(mixRgb(from, to, step / (FADE_STEPS.length + 1))),
    ]),
  ) as Record<ActiveTransitionFadeStyle, string>
}

function createAnsiActiveTransitionPulseTheme(
  from: Rgb,
  to: Rgb,
): Record<"activeTransitionPulse" | ActiveTransitionPulseFadeStyle, string> {
  return {
    activeTransitionPulse: ansiFg(to),
    ...Object.fromEntries(
      FADE_STEPS.map((step) => [
        `activeTransitionPulseFade${step}`,
        ansiFg(mixRgb(from, to, step / (FADE_STEPS.length + 1))),
      ]),
    ),
  } as Record<"activeTransitionPulse" | ActiveTransitionPulseFadeStyle, string>
}

function blendColor(from: RGBA, to: RGBA, amount: number): RGBA {
  const [fromR, fromG, fromB, fromA] = from.toInts()
  const [toR, toG, toB, toA] = to.toInts()
  return RGBA.fromInts(
    mixChannel(fromR, toR, amount),
    mixChannel(fromG, toG, amount),
    mixChannel(fromB, toB, amount),
    mixChannel(fromA, toA, amount),
  )
}

function normalizeStateColorLevel(level: number): number {
  return Math.max(0, Math.min(STATE_COLOR_LEVEL_COUNT - 1, Math.round(level)))
}

export function stateDiagramStateColorKey(stateId: string, level: number): string {
  return `${stateId}${STATE_COLOR_LEVEL_SEPARATOR}${normalizeStateColorLevel(level)}`
}

function baseStateColorKey(stateId: string): string {
  const index = stateId.lastIndexOf(STATE_COLOR_LEVEL_SEPARATOR)
  return index === -1 ? stateId : stateId.slice(0, index)
}

function stateMappedColor(
  colors: ReadonlyMap<string, RGBA> | undefined,
  stateId: string | undefined,
): RGBA | undefined {
  if (!stateId) return undefined
  return colors?.get(stateId) ?? colors?.get(baseStateColorKey(stateId))
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
  if (stateColor) return stateColor
  return style ? colors[style] : undefined
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
  return value === undefined || !Number.isFinite(value) ? undefined : Math.trunc(value)
}

function normalizePulseProgress(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined
  return Math.max(0, Math.min(1, value))
}

function normalizeActiveTransitionMode(
  value: StateDiagramActiveTransitionMode | undefined,
): StateDiagramActiveTransitionMode {
  return value === "fade" ? "fade" : "reveal"
}

function normalizePositiveInt(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.max(1, Math.trunc(value))
}

function normalizePulseLength(value: number | undefined): number {
  return normalizePositiveInt(value, DEFAULT_PULSE_LENGTH)
}

function normalizePulseGap(value: number | undefined): number {
  return normalizePositiveInt(value, DEFAULT_PULSE_GAP)
}

function splitLines(value: string): string[] {
  return value.split(/<br\s*\/?>/i).map((line) => line.trim())
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
  return { rows: Array.from({ length: height }, () => Array.from({ length: width }, () => ({ char: " " }))) }
}

function mergeLineGlyph(left: string, right: string): string | undefined {
  const connections = (char: string): JunctionDirection[] | undefined => {
    if (char === "─") return ["left", "right"]
    if (char === "│") return ["up", "down"]
    if (char === "╭") return ["right", "down"]
    if (char === "╮") return ["left", "down"]
    if (char === "╰") return ["right", "up"]
    if (char === "╯") return ["left", "up"]
    if (char === "┬") return ["left", "right", "down"]
    if (char === "┴") return ["left", "right", "up"]
    if (char === "├") return ["up", "down", "right"]
    if (char === "┤") return ["up", "down", "left"]
    if (char === "┼") return ["left", "right", "up", "down"]
    return undefined
  }

  const leftConnections = connections(left)
  const rightConnections = connections(right)
  if (!leftConnections || !rightConnections) return undefined
  return junctionGlyph(new Set([...leftConnections, ...rightConnections]))
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
  if (y < 0 || y >= grid.rows.length || x < 0 || x >= grid.rows[y]!.length) return
  const existing = grid.rows[y]![x]!
  const shouldMerge = isTransitionDrawingStyle(existing.style) && isTransitionDrawingStyle(style)
  grid.rows[y]![x] = {
    char: shouldMerge ? (mergeLineGlyph(existing.char, char) ?? char) : char,
    style,
    stateId,
    bgStateId,
  }
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
  let offset = 0
  for (const char of text) {
    setCell(grid, x + offset, y, char, style, stateId, bgStateId)
    offset += visualLength(char)
  }
}

function computeRanks(diagram: StateDiagram): Map<string, number> {
  const ranks = new Map<string, number>()
  const outgoing = new Map<string, string[]>()
  for (const transition of diagram.transitions) {
    const list = outgoing.get(transition.from) ?? []
    list.push(transition.to)
    outgoing.set(transition.from, list)
  }

  const first = diagram.states.find((state) => state.kind === "start")?.id ?? diagram.states[0]?.id
  if (!first) return ranks
  ranks.set(first, 0)
  const queue = [first]
  while (queue.length > 0) {
    const id = queue.shift()!
    const rank = ranks.get(id) ?? 0
    for (const to of outgoing.get(id) ?? []) {
      const nextRank = rank + 1
      if ((ranks.get(to) ?? Number.POSITIVE_INFINITY) <= nextRank) continue
      ranks.set(to, nextRank)
      queue.push(to)
    }
  }

  for (const state of diagram.states) {
    if (!ranks.has(state.id)) ranks.set(state.id, ranks.size)
  }
  return ranks
}

function outgoingTransitions(diagram: StateDiagram): Map<string, StateDiagramTransition[]> {
  const outgoing = new Map<string, StateDiagramTransition[]>()
  for (const transition of diagram.transitions) {
    const list = outgoing.get(transition.from) ?? []
    list.push(transition)
    outgoing.set(transition.from, list)
  }
  return outgoing
}

function reaches(diagram: StateDiagram, from: string, target: string): boolean {
  const outgoing = outgoingTransitions(diagram)
  const visited = new Set<string>()
  const stack = [from]
  while (stack.length > 0) {
    const id = stack.pop()!
    if (id === target) return true
    if (visited.has(id)) continue
    visited.add(id)
    for (const transition of outgoing.get(id) ?? []) stack.push(transition.to)
  }
  return false
}

function hasReverseTransition(diagram: StateDiagram, transition: StateDiagramTransition): boolean {
  return diagram.transitions.some((other) => other.from === transition.to && other.to === transition.from)
}

function computeMainPath(diagram: StateDiagram): string[] {
  const outgoing = outgoingTransitions(diagram)
  const start = diagram.states.find((state) => state.kind === "start")?.id ?? diagram.states[0]?.id
  if (!start) return []

  const path = [start]
  const visited = new Set(path)
  let current = start
  while (true) {
    const candidates = (outgoing.get(current) ?? []).filter((transition) => !visited.has(transition.to))
    if (candidates.length === 0) break
    const next =
      candidates.find((transition) => diagram.states.find((state) => state.id === transition.to)?.kind === "end") ??
      candidates.find((transition) => !reaches(diagram, transition.to, current)) ??
      candidates.find((transition) => !hasReverseTransition(diagram, transition))
    if (!next) break
    path.push(next.to)
    visited.add(next.to)
    current = next.to
  }

  return path
}

function stateSize(state: StateDiagramState): { width: number; height: number; lines: string[] } {
  if (state.kind !== "state") return { width: 1, height: 1, lines: [state.label] }
  const lines = splitLines(state.label)
  const innerWidth = Math.max(...lines.map(visualLength), 1)
  return { width: innerWidth + 4, height: lines.length + 2, lines }
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

function noteLines(note: StateDiagramNote): string[] {
  const lines = note.lines.flatMap(splitLines).map((line) => line.trim())
  return lines.length > 0 ? lines : [""]
}

function noteSize(note: StateDiagramNote): { width: number; height: number; lines: string[] } {
  const lines = noteLines(note)
  const innerWidth = Math.max(...lines.map(visualLength), 1)
  return { width: innerWidth + 4, height: lines.length + 2, lines }
}

function emptyLayout(
  bounds: Map<string, BoxBounds>,
  sizes: Map<string, { width: number; height: number; lines: string[] }>,
): StateLayout {
  return { bounds, sizes, compositeBounds: new Map(), noteBounds: [] }
}

function shiftBounds(bounds: Iterable<BoxBounds>, dx: number, dy: number): void {
  for (const bound of bounds) {
    bound.left += dx
    bound.top += dy
    bound.centerX += dx
    bound.centerY += dy
  }
}

function uniqueBounds(...bounds: Iterable<BoxBounds>[]): BoxBounds[] {
  return [...new Set(bounds.flatMap((group) => [...group]))]
}

function normalizeLayout(layout: StateLayout): void {
  const allBounds = uniqueBounds(layout.bounds.values(), layout.compositeBounds.values(), layout.noteBounds)
  if (allBounds.length === 0) return
  const minX = Math.min(0, ...allBounds.map((bound) => bound.left))
  const minY = Math.min(0, ...allBounds.map((bound) => bound.top))
  if (minX === 0 && minY === 0) return
  shiftBounds(allBounds, -minX, -minY)
}

function addCompositeBounds(diagram: StateDiagram, layout: StateLayout): void {
  const statesByParent = new Map<string, string[]>()
  const compositesByParent = new Map<string, StateDiagramCompositeState[]>()
  for (const state of diagram.states) {
    if (!state.parentId) continue
    const states = statesByParent.get(state.parentId) ?? []
    states.push(state.id)
    statesByParent.set(state.parentId, states)
  }
  for (const composite of diagram.composites) {
    if (!composite.parentId) continue
    const composites = compositesByParent.get(composite.parentId) ?? []
    composites.push(composite)
    compositesByParent.set(composite.parentId, composites)
  }

  const addComposite = (composite: StateDiagramCompositeState): BoxBounds | undefined => {
    const existing = layout.compositeBounds.get(composite.id)
    if (existing) return existing

    for (const child of compositesByParent.get(composite.id) ?? []) addComposite(child)

    const childBounds = [
      ...(statesByParent.get(composite.id) ?? []),
      ...(compositesByParent.get(composite.id) ?? []).map((child) => child.id),
    ]
      .map((id) => layout.bounds.get(id))
      .filter((bound): bound is BoxBounds => Boolean(bound))
    if (childBounds.length === 0) return undefined

    const left = Math.min(...childBounds.map((bound) => bound.left)) - 2
    const top = Math.min(...childBounds.map((bound) => bound.top)) - 2
    const right = Math.max(...childBounds.map((bound) => bound.left + bound.width)) + 2
    const bottom = Math.max(...childBounds.map((bound) => bound.top + bound.height)) + 2
    const width = Math.max(right - left, visualLength(composite.label) + 5)
    const bound = {
      id: composite.id,
      left,
      top,
      width,
      height: bottom - top,
      centerX: left + Math.floor(width / 2),
      centerY: top + Math.floor((bottom - top) / 2),
    }
    layout.compositeBounds.set(composite.id, bound)
    layout.bounds.set(composite.id, bound)
    return bound
  }

  for (const composite of diagram.composites) addComposite(composite)
}

function addNoteBounds(diagram: StateDiagram, layout: StateLayout): void {
  const compositeIds = new Set(diagram.composites.map((composite) => composite.id))
  const avoidBounds = [...layout.bounds.values()].filter((bound) => !compositeIds.has(bound.id))
  const noteBounds: StateNoteBounds[] = []

  for (const [index, note] of diagram.notes.entries()) {
    const target = layout.bounds.get(note.target)
    if (!target) continue
    const size = noteSize(note)
    noteBounds.push(placeNote(note, index, target, size, avoidBounds, noteBounds))
  }

  layout.noteBounds = noteBounds
}

function intersects(left: number, top: number, width: number, height: number, bound: BoxBounds, padding = 1): boolean {
  return (
    left < bound.left + bound.width + padding &&
    left + width + padding > bound.left &&
    top < bound.top + bound.height + padding &&
    top + height + padding > bound.top
  )
}

function createNoteBound(
  note: StateDiagramNote,
  index: number,
  left: number,
  top: number,
  size: { width: number; height: number; lines: string[] },
): StateNoteBounds {
  return {
    id: `${note.target}-note-${index}`,
    left,
    top,
    width: size.width,
    height: size.height,
    centerX: left + Math.floor(size.width / 2),
    centerY: top + Math.floor(size.height / 2),
    note,
    lines: size.lines,
  }
}

function placeNote(
  note: StateDiagramNote,
  index: number,
  target: BoxBounds,
  size: { width: number; height: number; lines: string[] },
  avoidBounds: readonly BoxBounds[],
  existingNotes: readonly StateNoteBounds[],
): StateNoteBounds {
  const gap = 4
  const baseLeft = note.position === "right" ? target.left + target.width + gap : target.left - size.width - gap
  const baseTop = target.centerY - Math.floor(size.height / 2)
  const topOffsets = [0, -(size.height + 2), target.height + 2, -(size.height * 2 + 4), target.height + size.height + 4]
  const collides = (left: number, top: number) => {
    for (const bound of avoidBounds) {
      if (bound.id !== target.id && intersects(left, top, size.width, size.height, bound)) return true
    }
    for (const bound of existingNotes) {
      if (intersects(left, top, size.width, size.height, bound)) return true
    }
    return false
  }

  for (const offset of topOffsets) {
    const top = baseTop + offset
    if (!collides(baseLeft, top)) return createNoteBound(note, index, baseLeft, top, size)
  }

  const shiftedLeft =
    note.position === "right"
      ? Math.max(...avoidBounds.map((bound) => bound.left + bound.width), target.left + target.width) + gap
      : Math.min(...avoidBounds.map((bound) => bound.left), target.left) - size.width - gap
  return createNoteBound(note, index, shiftedLeft, baseTop + target.height + 1, size)
}

function belongsToComposite(
  id: string,
  compositeId: string,
  statesById: Map<string, StateDiagramState>,
  compositesById: Map<string, StateDiagramCompositeState>,
): boolean {
  let parentId = statesById.get(id)?.parentId ?? compositesById.get(id)?.parentId

  while (parentId) {
    if (parentId === compositeId) return true
    parentId = compositesById.get(parentId)?.parentId
  }

  return false
}

function expandCompositeBoundsForNotes(diagram: StateDiagram, layout: StateLayout): void {
  const statesById = new Map(diagram.states.map((state) => [state.id, state]))
  const compositesById = new Map(diagram.composites.map((composite) => [composite.id, composite]))

  for (const composite of [...diagram.composites].reverse()) {
    const bound = layout.compositeBounds.get(composite.id)
    if (!bound) continue

    const descendantNotes = layout.noteBounds.filter((noteBound) =>
      belongsToComposite(noteBound.note.target, composite.id, statesById, compositesById),
    )
    if (descendantNotes.length === 0) continue

    const childBounds = [bound, ...descendantNotes]
    const noteTop = Math.min(...childBounds.map((child) => child.top), bound.top)
    const noteBottom = Math.max(...childBounds.map((child) => child.top + child.height), bound.top + bound.height)
    const left = Math.min(...childBounds.map((child) => child.left)) - 2
    const top = noteTop < bound.top ? noteTop - 1 : bound.top
    const right = Math.max(...childBounds.map((child) => child.left + child.width)) + 2
    const bottom = noteBottom > bound.top + bound.height ? noteBottom + 1 : bound.top + bound.height

    bound.left = left
    bound.top = top
    bound.width = Math.max(right - left, visualLength(composite.label) + 5)
    bound.height = bottom - top
    bound.centerX = bound.left + Math.floor(bound.width / 2)
    bound.centerY = bound.top + Math.floor(bound.height / 2)
  }
}

function boundsIntersect(left: BoxBounds, right: BoxBounds): boolean {
  return intersects(left.left, left.top, left.width, left.height, right, 0)
}

function separateExternalBoundsFromComposites(diagram: StateDiagram, layout: StateLayout): void {
  const statesById = new Map(diagram.states.map((state) => [state.id, state]))
  const compositesById = new Map(diagram.composites.map((composite) => [composite.id, composite]))

  for (const composite of diagram.composites) {
    const compositeBound = layout.compositeBounds.get(composite.id)
    if (!compositeBound) continue

    for (const state of diagram.states) {
      if (belongsToComposite(state.id, composite.id, statesById, compositesById)) continue
      const bound = layout.bounds.get(state.id)
      if (!bound || !boundsIntersect(bound, compositeBound)) continue

      const dx = compositeBound.left + compositeBound.width + 4 - bound.left
      if (dx <= 0) continue
      const leftThreshold = bound.left
      const boundsToShift: BoxBounds[] = []

      for (const candidate of diagram.states) {
        if (belongsToComposite(candidate.id, composite.id, statesById, compositesById)) continue
        const candidateBound = layout.bounds.get(candidate.id)
        if (candidateBound && candidateBound.left >= leftThreshold) boundsToShift.push(candidateBound)
      }

      for (const candidate of diagram.composites) {
        if (candidate.id === composite.id || belongsToComposite(candidate.id, composite.id, statesById, compositesById))
          continue
        const candidateBound = layout.compositeBounds.get(candidate.id)
        if (candidateBound && candidateBound.left >= leftThreshold) boundsToShift.push(candidateBound)
      }

      shiftBounds(uniqueBounds(boundsToShift), dx, 0)
    }
  }
}

function finalizeLayout(diagram: StateDiagram, layout: StateLayout): StateLayout {
  if (diagram.composites.length === 0 && diagram.notes.length === 0) return layout
  addCompositeBounds(diagram, layout)
  normalizeLayout(layout)
  addNoteBounds(diagram, layout)
  expandCompositeBoundsForNotes(diagram, layout)
  separateExternalBoundsFromComposites(diagram, layout)
  normalizeLayout(layout)
  return layout
}

function createLayout(
  diagram: StateDiagram,
  options: Required<Pick<StateDiagramRenderOptions, "borderStyle" | "minStateGap">>,
): StateLayout {
  if (diagram.direction === "LR" || diagram.direction === "RL") {
    return finalizeLayout(diagram, createHorizontalLayout(diagram, options))
  }

  const ranks = computeRanks(diagram)
  const byRank = new Map<number, StateDiagramState[]>()
  for (const state of diagram.states) {
    const rank = ranks.get(state.id) ?? 0
    const list = byRank.get(rank) ?? []
    list.push(state)
    byRank.set(rank, list)
  }

  const rankKeys = [...byRank.keys()].sort((a, b) => a - b)
  const sizes = new Map(diagram.states.map((state) => [state.id, stateSize(state)]))
  const bounds = new Map<string, BoxBounds>()

  const singleColumnCenter = Math.max(
    0,
    ...rankKeys.flatMap((rank) => {
      const states = byRank.get(rank)!
      return states.length === 1 ? [Math.floor(sizes.get(states[0]!.id)!.width / 2)] : []
    }),
  )
  let y = 0
  for (const rank of rankKeys) {
    const states = byRank.get(rank)!
    const rowHeight = Math.max(...states.map((state) => sizes.get(state.id)!.height))
    let x = 0
    for (const state of states) {
      const size = sizes.get(state.id)!
      const top = y + Math.floor((rowHeight - size.height) / 2)
      const left = states.length === 1 ? singleColumnCenter - Math.floor(size.width / 2) : x
      bounds.set(state.id, {
        id: state.id,
        left,
        top,
        width: size.width,
        height: size.height,
        centerX: left + Math.floor(size.width / 2),
        centerY: top + Math.floor(size.height / 2),
      })
      x += size.width + options.minStateGap + 8
    }
    y += rowHeight + 4
  }

  return finalizeLayout(diagram, emptyLayout(bounds, sizes))
}

function createHorizontalLayout(
  diagram: StateDiagram,
  options: Required<Pick<StateDiagramRenderOptions, "borderStyle" | "minStateGap">>,
): StateLayout {
  const sizes = new Map(diagram.states.map((state) => [state.id, stateSize(state)]))
  const bounds = new Map<string, BoxBounds>()
  const statesById = new Map(diagram.states.map((state) => [state.id, state]))
  const mainPath = computeMainPath(diagram)
  const mainIds = new Set(mainPath)
  const baselineY = 1
  let x = 0

  for (const id of mainPath) {
    const state = statesById.get(id)
    const size = sizes.get(id)
    if (!state || !size) continue
    const top = state.kind === "state" ? baselineY - Math.floor(size.height / 2) : baselineY
    bounds.set(id, {
      id,
      left: x,
      top,
      width: size.width,
      height: size.height,
      centerX: x + Math.floor(size.width / 2),
      centerY: top + Math.floor(size.height / 2),
    })
    x += size.width + options.minStateGap + 8
  }

  const branchesByParent = new Map<string, string[]>()
  for (const transition of diagram.transitions) {
    if (!mainIds.has(transition.from) || mainIds.has(transition.to)) continue
    const list = branchesByParent.get(transition.from) ?? []
    if (!list.includes(transition.to)) list.push(transition.to)
    branchesByParent.set(transition.from, list)
  }

  for (const [parentId, branchIds] of branchesByParent) {
    const parent = bounds.get(parentId)
    if (!parent) continue
    const branchGap = 4
    const branchSizes = branchIds.map((id) => sizes.get(id)!).filter(Boolean)
    const totalWidth =
      branchSizes.reduce((sum, size) => sum + size.width, 0) + Math.max(0, branchSizes.length - 1) * branchGap
    let left = parent.centerX - Math.floor(totalWidth / 2)
    for (const branchId of branchIds) {
      if (bounds.has(branchId)) continue
      const size = sizes.get(branchId)
      if (!size) continue
      const top = baselineY + 5
      bounds.set(branchId, {
        id: branchId,
        left,
        top,
        width: size.width,
        height: size.height,
        centerX: left + Math.floor(size.width / 2),
        centerY: top + Math.floor(size.height / 2),
      })
      left += size.width + branchGap
    }
  }

  const ranks = computeRanks(diagram)
  const fallbackStates = diagram.states.filter((state) => !bounds.has(state.id))
  for (const state of fallbackStates) {
    const size = sizes.get(state.id)!
    const rank = ranks.get(state.id) ?? bounds.size
    const top = baselineY + 5
    const left = rank * (size.width + options.minStateGap + 8)
    bounds.set(state.id, {
      id: state.id,
      left,
      top,
      width: size.width,
      height: size.height,
      centerX: left + Math.floor(size.width / 2),
      centerY: top + Math.floor(size.height / 2),
    })
  }

  const minX = Math.min(0, ...[...bounds.values()].map((bound) => bound.left))
  if (minX < 0) {
    for (const bound of bounds.values()) {
      bound.left -= minX
      bound.centerX -= minX
    }
  }

  return emptyLayout(bounds, sizes)
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

function stateColorLevelForCell(bounds: BoxBounds, x: number, y: number, border = false): number {
  const halfWidth = Math.max(1, (bounds.width - 1) / 2)
  const halfHeight = Math.max(1, (bounds.height - 1) / 2)
  const dx = (x - bounds.centerX) / halfWidth
  const dy = (y - bounds.centerY) / halfHeight
  const distance = Math.sqrt(dx * dx + dy * dy)
  const level = normalizeStateColorLevel((1 - Math.min(1, distance)) * (STATE_COLOR_LEVEL_COUNT - 1))
  return border ? Math.min(1, level) : level
}

function stateColorKeyForCell(bounds: BoxBounds, stateId: string, x: number, y: number, border = false): string {
  return stateDiagramStateColorKey(stateId, stateColorLevelForCell(bounds, x, y, border))
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

  setBorderCell(bounds.left, bounds.top, chars.topLeft)
  setBorderCell(bounds.left + bounds.width - 1, bounds.top, chars.topRight)
  setBorderCell(bounds.left, bounds.top + bounds.height - 1, chars.bottomLeft)
  setBorderCell(bounds.left + bounds.width - 1, bounds.top + bounds.height - 1, chars.bottomRight)
  for (let x = bounds.left + 1; x < bounds.left + bounds.width - 1; x++) {
    setBorderCell(x, bounds.top, chars.horizontal)
    setBorderCell(x, bounds.top + bounds.height - 1, chars.horizontal)
  }
  for (let y = bounds.top + 1; y < bounds.top + bounds.height - 1; y++) {
    setBorderCell(bounds.left, y, chars.vertical)
    setBorderCell(bounds.left + bounds.width - 1, y, chars.vertical)
  }
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
  setCell(grid, bounds.left, bounds.top, chars.topLeft, style, stateId)
  setCell(grid, bounds.left + bounds.width - 1, bounds.top, chars.topRight, style, stateId)
  setCell(grid, bounds.left, bounds.top + bounds.height - 1, chars.bottomLeft, style, stateId)
  setCell(grid, bounds.left + bounds.width - 1, bounds.top + bounds.height - 1, chars.bottomRight, style, stateId)
  for (let x = bounds.left + 1; x < bounds.left + bounds.width - 1; x++) {
    setCell(grid, x, bounds.top, chars.horizontal, style, stateId)
    setCell(grid, x, bounds.top + bounds.height - 1, chars.horizontal, style, stateId)
  }
  for (let y = bounds.top + 1; y < bounds.top + bounds.height - 1; y++) {
    setCell(grid, bounds.left, y, chars.vertical, style, stateId)
    setCell(grid, bounds.left + bounds.width - 1, y, chars.vertical, style, stateId)
  }
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

function drawHorizontalRamp(
  grid: StateGrid,
  fromX: number,
  toX: number,
  y: number,
  direction: 1 | -1,
  startDistance: number,
  fadeSource: FadeSourceStyle,
  active: boolean,
  fadeFromSource: boolean,
  path?: StatePathPoint[],
): void {
  let distance = startDistance
  for (let x = fromX; direction === 1 ? x <= toX : x >= toX; x += direction) {
    setPathCell(grid, path, x, y, "─", transitionFadeStyle(fadeSource, distance, active, fadeFromSource))
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
  fadeSource: FadeSourceStyle,
  active: boolean,
  fadeFromSource: boolean,
  path?: StatePathPoint[],
): void {
  let distance = startDistance
  for (let y = fromY; direction === 1 ? y <= toY : y >= toY; y += direction) {
    setPathCell(grid, path, x, y, "│", transitionFadeStyle(fadeSource, distance, active, fadeFromSource))
    distance += 1
  }
}

function drawRightDeparture(
  grid: StateGrid,
  bounds: BoxBounds,
  fadeSource: FadeSourceStyle,
  active: boolean,
  fadeFromSource: boolean,
  path?: StatePathPoint[],
): void {
  if (bounds.width <= 1 || bounds.height <= 1) return
  setPathCell(
    grid,
    path,
    bounds.left + bounds.width - 1,
    bounds.centerY,
    BorderChars.rounded.leftT,
    transitionFadeStyle(fadeSource, 0, active, fadeFromSource),
  )
}

function drawBottomDeparture(
  grid: StateGrid,
  bounds: BoxBounds,
  x: number,
  fadeSource: FadeSourceStyle,
  active: boolean,
  fadeFromSource: boolean,
  path?: StatePathPoint[],
): void {
  if (bounds.width <= 1 || bounds.height <= 1) return
  setPathCell(
    grid,
    path,
    x,
    bounds.top + bounds.height - 1,
    BorderChars.rounded.topT,
    transitionFadeStyle(fadeSource, 0, active, fadeFromSource),
  )
}

function drawTopDeparture(
  grid: StateGrid,
  bounds: BoxBounds,
  x: number,
  fadeSource: FadeSourceStyle,
  active: boolean,
  fadeFromSource: boolean,
  path?: StatePathPoint[],
): void {
  if (bounds.width <= 1 || bounds.height <= 1) return
  setPathCell(
    grid,
    path,
    x,
    bounds.top,
    BorderChars.rounded.bottomT,
    transitionFadeStyle(fadeSource, 0, active, fadeFromSource),
  )
}

function arrowHeadChar(style: StateDiagramArrowHeadStyle, direction: "right" | "left" | "up" | "down"): string {
  if (style === "line") {
    if (direction === "right") return "→"
    if (direction === "left") return "←"
    if (direction === "up") return "↑"
    return "↓"
  }

  if (direction === "right") return "▶"
  if (direction === "left") return "◀"
  if (direction === "up") return "▲"
  return "▼"
}

function drawHorizontal(
  grid: StateGrid,
  from: BoxBounds,
  to: BoxBounds,
  label: string,
  transition: StateDiagramTransition,
  diagram: StateDiagram,
  fadeSource: FadeSourceStyle,
  feedbackLaneY: number,
  arrowHeadStyle: StateDiagramArrowHeadStyle,
  active: boolean,
  fadeFromSource: boolean,
  path?: StatePathPoint[],
): void {
  if (transition.from === transition.to) {
    drawSelfTransition(grid, from, label, fadeSource, arrowHeadStyle, active, fadeFromSource, path)
    return
  }

  const leftToRight = from.centerX <= to.centerX
  const targetState = diagram.states.find((state) => state.id === transition.to)
  const targetIsChoice = targetState?.kind === "choice" || isHiddenCompositeMarker(targetState)
  if (!leftToRight) {
    drawBottomFeedback(
      grid,
      from,
      to,
      label,
      fadeSource,
      feedbackLaneY,
      arrowHeadStyle,
      targetIsChoice,
      active,
      fadeFromSource,
      path,
    )
    return
  }

  if (from.centerY !== to.centerY) {
    drawVerticalElbowTransition(
      grid,
      from,
      to,
      label,
      hasReverseTransition(diagram, transition),
      fadeSource,
      arrowHeadStyle,
      targetIsChoice,
      active,
      fadeFromSource,
      path,
    )
    return
  }

  const y = from.centerY
  const lineStyle = transitionLineStyle(active)
  drawRightDeparture(grid, from, fadeSource, active, fadeFromSource, path)
  const startX = from.left + from.width
  const endX = to.left - 1
  const startDistance = from.width <= 1 || from.height <= 1 ? 0 : 1
  drawHorizontalRamp(
    grid,
    startX,
    targetIsChoice ? endX : endX - 1,
    y,
    1,
    startDistance,
    fadeSource,
    active,
    fadeFromSource,
    path,
  )
  if (targetIsChoice) addPathPoint(path, to.left, y)
  else setPathCell(grid, path, endX, y, arrowHeadChar(arrowHeadStyle, "right"), lineStyle)
  if (label) {
    const text = splitLines(label)[0] ?? ""
    const labelX = Math.min(startX, endX) + Math.max(1, Math.floor(Math.abs(endX - startX - visualLength(text)) / 2))
    setText(grid, labelX, Math.max(0, y - 1), text, transitionLabelStyle(active))
  }
}

function drawSelfTransition(
  grid: StateGrid,
  bounds: BoxBounds,
  label: string,
  fadeSource: FadeSourceStyle,
  arrowHeadStyle: StateDiagramArrowHeadStyle,
  active: boolean,
  fadeFromSource: boolean,
  path?: StatePathPoint[],
): void {
  if (bounds.width <= 1 || bounds.height <= 1) return

  const lineStyle = transitionLineStyle(active)
  const sourceX = bounds.left + Math.max(2, Math.floor(bounds.width / 3))
  const bottomY = bounds.top + bounds.height - 1
  const railY = bottomY + 2
  const targetX = Math.max(sourceX + 3, bounds.left + Math.min(bounds.width - 3, Math.ceil((bounds.width * 2) / 3)))

  drawBottomDeparture(grid, bounds, sourceX, fadeSource, active, fadeFromSource, path)
  setPathCell(grid, path, sourceX, bottomY + 1, "│", transitionFadeStyle(fadeSource, 1, active, fadeFromSource))
  setPathCell(grid, path, sourceX, railY, "╰", lineStyle)
  for (let x = sourceX + 1; x < targetX; x++) setPathCell(grid, path, x, railY, "─", lineStyle)
  setPathCell(grid, path, targetX, railY, "╯", lineStyle)
  setPathCell(grid, path, targetX, bottomY + 1, arrowHeadChar(arrowHeadStyle, "up"), lineStyle)

  if (label) setText(grid, targetX + 2, bottomY + 1, splitLines(label)[0] ?? "", transitionLabelStyle(active))
}

function outsideBottomY(bounds: BoxBounds): number {
  return bounds.top + bounds.height
}

function drawBottomFeedback(
  grid: StateGrid,
  from: BoxBounds,
  to: BoxBounds,
  label: string,
  fadeSource: FadeSourceStyle,
  railY: number,
  arrowHeadStyle: StateDiagramArrowHeadStyle,
  targetIsChoice: boolean,
  active: boolean,
  fadeFromSource: boolean,
  path?: StatePathPoint[],
): void {
  const lineStyle = transitionLineStyle(active)
  const sourceX = from.centerX
  const targetX = to.width > 1 ? (sourceX > to.centerX ? to.left + 1 : to.left + to.width - 2) : to.centerX
  const sourceBottomY = outsideBottomY(from)
  const targetBottomY = outsideBottomY(to)
  const startDistance = from.width <= 1 || from.height <= 1 ? 0 : 1

  drawBottomDeparture(grid, from, sourceX, fadeSource, active, fadeFromSource, path)
  drawVerticalRamp(grid, sourceX, sourceBottomY, railY - 1, 1, startDistance, fadeSource, active, fadeFromSource, path)
  setPathCell(grid, path, sourceX, railY, sourceX > targetX ? "╯" : "╰", lineStyle)
  if (sourceX !== targetX) {
    const horizontalStep = sourceX < targetX ? 1 : -1
    for (let x = sourceX + horizontalStep; x !== targetX; x += horizontalStep) {
      setPathCell(grid, path, x, railY, "─", lineStyle)
    }
  }
  setPathCell(grid, path, targetX, railY, sourceX > targetX ? "╰" : "╯", lineStyle)
  for (let y = railY - 1; y > targetBottomY; y--) setPathCell(grid, path, targetX, y, "│", lineStyle)
  setPathCell(grid, path, targetX, targetBottomY, targetIsChoice ? "│" : arrowHeadChar(arrowHeadStyle, "up"), lineStyle)
  if (targetIsChoice) addPathPoint(path, to.left, to.top)

  if (label) {
    const text = splitLines(label)[0] ?? ""
    const labelX =
      Math.min(sourceX, targetX) + Math.max(1, Math.floor((Math.abs(sourceX - targetX) - visualLength(text)) / 2))
    setText(grid, labelX, Math.max(0, railY - 1), text, transitionLabelStyle(active))
  }
}

function drawVerticalElbowTransition(
  grid: StateGrid,
  from: BoxBounds,
  to: BoxBounds,
  label: string,
  hasReverse: boolean,
  fadeSource: FadeSourceStyle,
  arrowHeadStyle: StateDiagramArrowHeadStyle,
  targetIsChoice: boolean,
  active: boolean,
  fadeFromSource: boolean,
  path?: StatePathPoint[],
): void {
  const lineStyle = transitionLineStyle(active)
  const topToBottom = from.centerY < to.centerY
  const offset = hasReverse ? (topToBottom ? -2 : 2) : 0
  const startX = from.centerX + offset
  const endX = to.centerX + offset
  const startY = topToBottom ? from.top + from.height : from.top - 1
  const endY = topToBottom ? to.top - 1 : to.top + to.height
  const verticalStep = topToBottom ? 1 : -1
  const startDistance = from.width <= 1 || from.height <= 1 ? 0 : 1

  if (topToBottom) {
    drawBottomDeparture(grid, from, startX, fadeSource, active, fadeFromSource, path)
  } else {
    drawTopDeparture(grid, from, startX, fadeSource, active, fadeFromSource, path)
  }

  if (startY !== endY)
    drawVerticalRamp(
      grid,
      startX,
      startY,
      endY - verticalStep,
      verticalStep,
      startDistance,
      fadeSource,
      active,
      fadeFromSource,
      path,
    )

  if (startX !== endX) {
    const horizontalStep = startX < endX ? 1 : -1
    setPathCell(
      grid,
      path,
      startX,
      endY,
      topToBottom ? (startX < endX ? "╰" : "╯") : startX < endX ? "╭" : "╮",
      lineStyle,
    )
    for (let x = startX + horizontalStep; x !== endX; x += horizontalStep) {
      setPathCell(grid, path, x, endY, "─", lineStyle)
    }
  }

  const targetChar = targetIsChoice
    ? startX === endX
      ? "│"
      : topToBottom
        ? "┬"
        : "┴"
    : arrowHeadChar(arrowHeadStyle, topToBottom ? "down" : "up")
  setPathCell(grid, path, endX, endY, targetChar, lineStyle)
  if (targetIsChoice) addPathPoint(path, to.left, to.top)
  if (label) {
    const text = splitLines(label)[0] ?? ""
    if (topToBottom) {
      const labelX = hasReverse || endX < startX ? startX - visualLength(text) - 2 : startX + 2
      setText(grid, labelX, Math.min(startY + 1, endY), text, transitionLabelStyle(active))
    } else {
      const labelX =
        Math.min(startX, endX) + Math.max(1, Math.floor((Math.abs(endX - startX) - visualLength(text)) / 2))
      setText(grid, startX === endX ? startX + 3 : labelX, Math.max(0, startY), text, transitionLabelStyle(active))
    }
  }
}

function drawVertical(
  grid: StateGrid,
  from: BoxBounds,
  to: BoxBounds,
  label: string,
  fadeSource: FadeSourceStyle,
  arrowHeadStyle: StateDiagramArrowHeadStyle,
  targetIsChoice: boolean,
  active: boolean,
  fadeFromSource: boolean,
  path?: StatePathPoint[],
): void {
  const lineStyle = transitionLineStyle(active)
  const topToBottom = from.centerY <= to.centerY
  const x = from.centerX
  const startY = topToBottom ? from.top + from.height : from.top - 1
  const endY = topToBottom ? to.top - 1 : to.top + to.height
  const step = topToBottom ? 1 : -1
  const startDistance = from.width <= 1 || from.height <= 1 ? 0 : 1

  if (topToBottom) {
    drawBottomDeparture(grid, from, x, fadeSource, active, fadeFromSource, path)
  } else {
    drawTopDeparture(grid, from, x, fadeSource, active, fadeFromSource, path)
  }

  if (startY !== endY)
    drawVerticalRamp(grid, x, startY, endY - step, step, startDistance, fadeSource, active, fadeFromSource, path)
  setPathCell(
    grid,
    path,
    x,
    endY,
    targetIsChoice ? "│" : arrowHeadChar(arrowHeadStyle, topToBottom ? "down" : "up"),
    lineStyle,
  )
  if (targetIsChoice) addPathPoint(path, to.left, to.top)
  if (label) setText(grid, x + 2, Math.min(startY, endY) + 1, splitLines(label)[0] ?? "", transitionLabelStyle(active))
}

type JunctionDirection = "left" | "right" | "up" | "down"

function connectionDirection(from: BoxBounds, to: BoxBounds): JunctionDirection {
  const deltaX = to.centerX - from.centerX
  const deltaY = to.centerY - from.centerY
  if (Math.abs(deltaX) >= Math.abs(deltaY) && deltaX !== 0) return deltaX > 0 ? "right" : "left"
  if (deltaY !== 0) return deltaY > 0 ? "down" : "up"
  return "right"
}

function junctionGlyph(connections: Set<JunctionDirection>): string {
  const left = connections.has("left")
  const right = connections.has("right")
  const up = connections.has("up")
  const down = connections.has("down")

  if (left && right && up && down) return "┼"
  if (left && right && down) return "┬"
  if (left && right && up) return "┴"
  if (up && down && right) return "├"
  if (up && down && left) return "┤"
  if (left && right) return "─"
  if (up && down) return "│"
  if (right && down) return "╭"
  if (left && down) return "╮"
  if (right && up) return "╰"
  if (left && up) return "╯"
  if (left || right) return "─"
  if (up || down) return "│"
  return "┼"
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

    const connections = new Set<JunctionDirection>()
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
      junctionGlyph(connections),
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

    const connections = new Set<JunctionDirection>()
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
      junctionGlyph(connections),
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
  const distanceLevel = distance === 0 ? 6 : Math.max(1, Math.min(5, 6 - Math.ceil((distance / radius) * 5)))
  const edgeLevel = Math.max(1, Math.min(6, Math.ceil(((edgeDistance + 1) / (radius + 1)) * 6)))
  const glyphLevel = char === "─" || char === "│" ? 6 : 4
  const level = Math.min(distanceLevel, edgeLevel, glyphLevel)

  return { style: ACTIVE_TRANSITION_PULSE_STYLES[level - 1]!, level }
}

function setActiveTransitionPulseCell(
  grid: StateGrid,
  x: number,
  y: number,
  distance: number,
  radius: number,
  edgeDistance: number,
): void {
  const cell = grid.rows[y]?.[x]
  if (!cell || cell.char === " " || !isActiveTransitionStyle(cell.style)) return

  const pulse = activeTransitionPulseCellStyle(distance, radius, edgeDistance, cell.char)
  if (activeTransitionPulseStyleLevel(cell.style) > pulse.level) return
  cell.style = pulse.style
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

  const before = Math.floor((pulseLength - 1) / 2)
  const after = pulseLength - before - 1
  const radius = Math.max(1, before, after)
  const drawPulseCenter = (centerIndex: number) => {
    for (let distance = -before; distance <= after; distance++) {
      const pathIndex = centerIndex + distance
      if (pathIndex < 0 || pathIndex >= pathLength) continue
      const point = activeTransitionPathPointAt(paths, pathIndex)
      if (!point) continue
      const [x, y] = point
      const edgeDistance = Math.min(pathIndex, pathLength - 1 - pathIndex)
      setActiveTransitionPulseCell(grid, x, y, Math.abs(distance), radius, edgeDistance)
    }
  }

  if (pulseProgress !== undefined) {
    const travelLength = pathLength - 1 + before + after
    drawPulseCenter(Math.round(pulseProgress * travelLength) - before)
    return
  }

  const phase = (((pulseFrame! % pulseGap) + pulseGap) % pulseGap) - pulseLength

  for (let centerIndex = phase; centerIndex < pathLength + radius; centerIndex += pulseGap) {
    drawPulseCenter(centerIndex)
  }
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

function expandCompositeBoundsForFeedback(
  diagram: StateDiagram,
  bounds: Map<string, BoxBounds>,
  compositeBounds: Map<string, BoxBounds>,
  feedbackLaneY: number,
): void {
  if (diagram.direction !== "LR" && diagram.direction !== "RL") return

  const statesById = new Map(diagram.states.map((state) => [state.id, state]))
  const compositesById = new Map(diagram.composites.map((composite) => [composite.id, composite]))

  for (const composite of diagram.composites) {
    const compositeBound = compositeBounds.get(composite.id)
    if (!compositeBound) continue

    const hasInternalFeedback = diagram.transitions.some((transition) => {
      if (!belongsToComposite(transition.from, composite.id, statesById, compositesById)) return false
      if (!belongsToComposite(transition.to, composite.id, statesById, compositesById)) return false
      const from = bounds.get(transition.from)
      const to = bounds.get(transition.to)
      return Boolean(from && to && from.centerX > to.centerX)
    })
    if (!hasInternalFeedback) continue

    const bottom = Math.max(compositeBound.top + compositeBound.height, feedbackLaneY + 2)
    compositeBound.height = bottom - compositeBound.top
    compositeBound.centerY = compositeBound.top + Math.floor(compositeBound.height / 2)
  }
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
  const { bounds, sizes, compositeBounds, noteBounds } = createLayout(diagram, { borderStyle, minStateGap })
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
    if (diagram.direction === "LR" || diagram.direction === "RL")
      drawHorizontal(
        grid,
        from,
        to,
        transition.label,
        transition,
        diagram,
        fadeSource,
        feedbackLaneY,
        arrowHeadStyle,
        active,
        fadeFromSource,
        activePath,
      )
    else
      drawVertical(
        grid,
        from,
        to,
        transition.label,
        fadeSource,
        arrowHeadStyle,
        targetIsChoice,
        active,
        fadeFromSource,
        activePath,
      )

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
  return grid.rows
    .map((row) =>
      row
        .map((cell) => cell.char)
        .join("")
        .trimEnd(),
    )
    .join("\n")
    .trimEnd()
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
  for (let rowIndex = 0; rowIndex < grid.rows.length; rowIndex++) {
    const row = grid.rows[rowIndex]!
    let rowEnd = row.length
    while (rowEnd > 0 && row[rowEnd - 1]?.char === " ") rowEnd -= 1

    let currentStyle: StateCellStyle | undefined
    let currentStateId: string | undefined
    let currentBgStateId: string | undefined
    let currentText = ""
    const flush = () => {
      if (!currentText) return
      onRun(currentText, currentStyle, currentStateId, currentBgStateId)
      currentText = ""
    }

    for (let x = 0; x < rowEnd; x++) {
      const cell = row[x]!
      const stateId = useStateRuns ? cell.stateId : undefined
      const bgStateId = useStateRuns ? cell.bgStateId : undefined
      if (cell.style !== currentStyle || stateId !== currentStateId || bgStateId !== currentBgStateId) {
        flush()
        currentStyle = cell.style
        currentStateId = stateId
        currentBgStateId = bgStateId
      }
      currentText += cell.char
    }

    flush()
    if (rowIndex < grid.rows.length - 1) onLineEnd()
  }
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

function colorsEqual(left?: RGBA, right?: RGBA): boolean {
  if (!left || !right) return left === right
  return left.equals(right)
}

function normalizeStateColors(value: StateDiagramStateColors | undefined): Map<string, RGBA> {
  const colors = new Map<string, RGBA>()
  if (!value) return colors

  const entries = value instanceof Map ? value.entries() : Object.entries(value)
  for (const [stateId, color] of entries) {
    if (color !== undefined) colors.set(stateId, parseColor(color))
  }

  return colors
}

function stateColorMapsEqual(left: ReadonlyMap<string, RGBA>, right: ReadonlyMap<string, RGBA>): boolean {
  if (left.size !== right.size) return false
  for (const [stateId, color] of left) {
    if (!colorsEqual(color, right.get(stateId))) return false
  }
  return true
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
    this._stateColors = normalizeStateColors(options.stateColors)
    this._stateBgColors = normalizeStateColors(options.stateBgColors)
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
    const next = normalizeStateColors(value)
    if (stateColorMapsEqual(this._stateColors, next)) return
    this._stateColors = next
    this.invalidateDiagram()
  }

  set stateBgColors(value: StateDiagramStateColors | undefined) {
    const next = normalizeStateColors(value)
    if (stateColorMapsEqual(this._stateBgColors, next)) return
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
