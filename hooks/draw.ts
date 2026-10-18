// A tiny pixel engine: draws the office into a framebuffer, then encodes it
// as terminal half-block cells (Raster) or as an SVG (desktop, mobile).
//
// The floor plan, like a certain paper company's branch office: the boss has
// a room of his own behind a glass wall (two clocks on the wall behind him, a
// whiteboard beside him), and everyone else works out in the bullpen.
import type { Act, Office, Worker } from '../types'

export type Frame = { w: number; h: number; px: Uint32Array; base: Uint32Array }
export type BoardLine = { label: string; value: string; tone?: 'ok' | 'warn' | 'bad' }

const CELL_W = 30
const CELL_H = 24

const C = {
  wall: 0x3b2e5a,
  wallTrim: 0x22183a,
  carpet: 0x55607a,
  carpetLine: 0x4b556d,
  floor: 0x8a5a3b,
  plank: 0x76492d,
  glass: 0xa5d8f0,
  glassShine: 0xe0f4ff,
  frame: 0x8b93a1,
  deskTop: 0xc58b52,
  deskFront: 0x7a4a2a,
  deskEdge: 0x5a3418,
  bossTop: 0x8b5a2b,
  bossFront: 0x4e2e14,
  monitor: 0x2b2b33,
  rim: 0xd9c27a,
  face: 0x1e1b2e,
  white: 0xf5f5f5,
  dim: 0x9a8fb8,
  green: 0x4ade80,
  yellow: 0xfacc15,
  red: 0xef4444,
  board: 0xf8fafc,
  boardFrame: 0xb8bec8,
  ink: 0x1e3a8a,
  inkOk: 0x15803d,
  inkWarn: 0xb45309,
  inkBad: 0xb91c1c,
}

const HAIR = [0x3b2416, 0x111111, 0xd6a24a, 0x9b3d1e, 0x6b6b6b, 0x2f4fa8, 0xb03a8a]
const SKIN = [0xf2c9a0, 0xd9a173, 0xa8724a, 0x7a4e2e, 0xf7d9bd]
const SHIRT = [0x2563eb, 0x16a34a, 0xdb2777, 0xea580c, 0x0891b2, 0x7c3aed, 0x65a30d, 0xdc2626]

// 3x5 pixel font, rows top to bottom. Zero is square, O is round.
const FONT: Record<string, string> = {
  '0': '111101101101111', '1': '010110010010111', '2': '111001111100111',
  '3': '111001111001111', '4': '101101111001001', '5': '111100111001111',
  '6': '111100111101111', '7': '111001010010010', '8': '111101111101111',
  '9': '111101111001111',
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110',
  E: '111100110100111', F: '111100110100100', G: '011100101101011', H: '101101111101101',
  I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111',
  M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100',
  Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101',
  Y: '101101010010010', Z: '111001010100111',
  '%': '101001010100101', '#': '101111101111101', '?': '111001011000010', '!': '010010010000010',
  '$': '011110010011110', '.': '000000000000010', ':': '000010000010000', '/': '001001010100100',
  '-': '000000111000000', '+': '000010111010000', ' ': '000000000000000',
}

function hash(s: string): number {
  let x = 2166136261
  for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619)
  return x >>> 0
}

function set(f: Frame, x: number, y: number, c: number) {
  x = Math.floor(x)
  y = Math.floor(y)
  if (x < 0 || y < 0 || x >= f.w || y >= f.h) return
  f.px[y * f.w + x] = c
}

function rect(f: Frame, x: number, y: number, w: number, h: number, c: number) {
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) set(f, x + dx, y + dy, c)
}

export function textWidth(s: string) {
  return Math.max(0, s.length * 4 - 1)
}

function text(f: Frame, s: string, x: number, y: number, c: number) {
  for (const ch of s.toUpperCase()) {
    const g = FONT[ch] ?? FONT[' ']
    for (let i = 0; i < 15; i++) if (g[i] === '1') set(f, x + (i % 3), y + Math.floor(i / 3), c)
    x += 4
  }
}

// ---- the floor plan -------------------------------------------------------

export type Plan = {
  w: number
  h: number
  wide: boolean
  wall: number // first row below the wall
  mx: number // the boss's x
  clockOff: number
  board: { x: number; y: number; w: number; h: number; chars: number; lines: number }
  roomEnd: number // the glass wall's first row
  deskTop: number // the bullpen's first row
  cols: number
  rows: number
}

export function plan(width: number, workers: number, boardLines: number): Plan {
  const w = Math.max(64, Math.min(160, width))
  const wide = w >= 120
  const lines = Math.max(1, boardLines)
  let wall: number, board: Plan['board'], mx: number, roomEnd: number
  if (wide) {
    // board on the wall to the left, the boss and his clocks to the right
    const bh = Math.min(6, lines) * 6 + 4
    wall = Math.max(34, bh + 6)
    const bw = Math.min(72, Math.max(64, Math.floor(w * 0.45)))
    board = { x: 4, y: 3, w: bw, h: bh, chars: Math.floor((bw - 4) / 4), lines: Math.min(6, lines) }
    mx = Math.floor(bw + 4 + (w - bw - 4) / 2)
    roomEnd = wall + 15
  } else {
    // a rolling whiteboard stands in front of the boss's desk
    wall = 34
    mx = Math.floor(w / 2)
    const bw = w - 4
    const bh = Math.min(7, lines) * 6 + 4
    board = { x: 2, y: wall + 16, w: bw, h: bh, chars: Math.floor((bw - 4) / 4), lines: Math.min(7, lines) }
    roomEnd = board.y + bh + 4
  }
  const clockOff = Math.max(13, Math.min(22, Math.floor((wide ? w - board.w - 8 : w) / 2) - 10))
  const deskTop = roomEnd + 5
  const cols = Math.max(1, Math.floor((w - 2) / CELL_W))
  const rows = Math.max(1, Math.ceil(workers / cols))
  let h = deskTop + rows * CELL_H + 1
  if (h % 2) h++
  return { w, h, wide, wall, mx, clockOff, board, roomEnd, deskTop, cols, rows }
}

/** The floor under everything: wall, the boss's carpet, the bullpen's planks. */
export function baseColor(p: Plan, y: number): number {
  if (y < p.wall - 1) return C.wall
  if (y === p.wall - 1) return C.wallTrim
  if (y < p.roomEnd) return (y - p.wall) % 4 === 3 ? C.carpetLine : C.carpet
  return (y - p.roomEnd) % 6 === 5 ? C.plank : C.floor
}

function newFrame(p: Plan): Frame {
  const px = new Uint32Array(p.w * p.h)
  for (let y = 0; y < p.h; y++) {
    const c = baseColor(p, y)
    for (let x = 0; x < p.w; x++) px[y * p.w + x] = c
  }
  return { w: p.w, h: p.h, px, base: px.slice() }
}

function levelColor(frac: number) {
  return frac > 0.5 ? C.green : frac > 0.2 ? C.yellow : C.red
}

/** `left` sets colour and blink; `swept` (default `left`) is how far the fill and hand go round. */
function clock(f: Frame, cx: number, cy: number, r: number, left: number | undefined, tick: number, swept = left) {
  const level = left === undefined ? undefined : Math.max(0, Math.min(1, left / 100))
  const frac = swept === undefined ? undefined : Math.max(0, Math.min(1, swept / 100))
  const low = level !== undefined && level < 0.15
  const rim = low && tick % 2 ? C.red : C.rim
  const fill = level === undefined ? 0x555566 : levelColor(level)
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      const d = Math.sqrt(dx * dx + dy * dy)
      if (d > r + 0.3) continue
      if (d > r - 1.2) {
        set(f, cx + dx, cy + dy, rim)
        continue
      }
      let a = Math.atan2(dx, -dy)
      if (a < 0) a += Math.PI * 2
      const on = frac !== undefined && a <= frac * Math.PI * 2
      set(f, cx + dx, cy + dy, on ? fill : C.face)
    }
  for (const [mx, my] of [[0, -1], [1, 0], [0, 1], [-1, 0]])
    set(f, cx + mx * (r - 2), cy + my * (r - 2), C.white)
  const a = frac === undefined ? (tick % 8) * (Math.PI / 4) : frac * Math.PI * 2
  for (let t = 0; t <= r - 2; t += 0.5) set(f, cx + Math.sin(a) * t, cy - Math.cos(a) * t, C.white)
  set(f, cx, cy, C.rim)
}

type Look = { hair: number; skin: number; shirt: number; boss?: boolean; dim?: boolean }

function lookFor(w: Worker, boss = false): Look {
  const h = hash(w.id)
  if (boss) return { hair: 0x222222, skin: SKIN[0], shirt: 0x1f2937, boss: true }
  return {
    hair: HAIR[h % HAIR.length],
    skin: SKIN[(h >>> 4) % SKIN.length],
    shirt: SHIRT[(h >>> 8) % SHIRT.length],
    dim: w.act === 'done',
  }
}

function grey(c: number) {
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255
  const v = Math.round(((r + g + b) / 3) * 0.6 + 40)
  return (v << 16) | (v << 8) | v
}

const SPRITE = [
  '..HHHH..',
  '.HHHHHH.',
  '.HSSSSH.',
  '.SESSES.',
  '.SSSSSS.',
  '..SSSS..',
  '.BBTTBB.',
  'BBBTTBBB',
  'BBBTTBBB',
  'BBBBBBBB',
]

function person(f: Frame, x: number, y: number, look: Look, act: Act, tick: number) {
  const k = (c: number) => (look.dim ? grey(c) : c)
  const bob = act === 'think' || act === 'idle' ? (tick % 4 === 0 ? 1 : 0) : 0
  SPRITE.forEach((row, ry) => {
    for (let rx = 0; rx < 8; rx++) {
      const ch = row[rx]
      let c: number | undefined
      if (ch === 'H') c = look.hair
      else if (ch === 'S') c = look.skin
      else if (ch === 'E') c = act === 'done' ? look.skin : 0x111111
      else if (ch === 'B') c = look.shirt
      else if (ch === 'T') c = look.boss ? (ry === 6 ? C.white : C.red) : look.shirt
      if (c !== undefined) set(f, x + rx, y + ry + (ry < 6 ? bob : 0), k(c))
    }
  })
  if (act === 'done') {
    set(f, x + 2, y + 3, 0x333333)
    set(f, x + 5, y + 3, 0x333333)
  }
  if (look.boss) {
    for (const dx of [1, 3, 4, 6]) set(f, x + dx, y - 1 + bob, C.yellow)
    rect(f, x + 1, y + bob, 6, 1, C.yellow)
  }
  const busy = act === 'type' || act === 'bash' || act === 'plan' || act === 'tool'
  const up = busy ? tick % 2 : 0
  set(f, x + 1, y + 8 + (up ? 0 : 1), k(look.skin))
  set(f, x + 6, y + 8 + (up ? 1 : 0), k(look.skin))
  if (act === 'read') rect(f, x + 2, y + 7, 4, 3, look.dim ? 0xaaaaaa : C.white)
}

function screen(f: Frame, x: number, y: number, act: Act, tick: number, seed: number) {
  const w = 9, h = 5
  const bg: Record<Act, number> = {
    type: 0x1e3a8a, read: 0xf1f5f9, bash: 0x0a0a0a, web: 0x0ea5e9, agent: 0xf97316,
    plan: 0xfef08a, ask: 0x7f1d1d, tool: 0x6d28d9, think: 0x1f2937, idle: 0x111827, done: 0x000000,
  }
  rect(f, x, y, w, h, bg[act])
  if (act === 'type') {
    const cols = [0x93c5fd, 0xfde68a, 0x86efac, 0xf9a8d4]
    for (let i = 0; i < h; i++) {
      const len = 1 + ((seed + tick + i * 3) % 7)
      rect(f, x + 1 + (i % 2), y + i, Math.min(len, w - 2), 1, cols[(i + seed) % 4])
    }
  } else if (act === 'read') {
    for (let i = tick % 2; i < h; i += 2) rect(f, x + 1, y + i, w - 2 - ((i + seed) % 3), 1, 0x94a3b8)
  } else if (act === 'bash') {
    set(f, x + 1, y + 1, C.green)
    set(f, x + 2, y + 2, C.green)
    set(f, x + 1, y + 3, C.green)
    const n = Math.min(4, 1 + (tick % 5))
    rect(f, x + 4, y + 2, n, 1, C.green)
    if (tick % 2) set(f, x + 4 + n, y + 2, C.white)
  } else if (act === 'web') {
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) if (dx * dx + dy * dy <= 5) set(f, x + 4 + dx, y + 2 + dy, 0x22c55e)
    set(f, x + 4 + ((tick % 5) - 2), y + 2, 0x0369a1)
    set(f, x + 4 + ((tick % 5) - 2), y + 1, 0x0369a1)
  } else if (act === 'agent') {
    set(f, x + 4, y + 1, C.white)
    rect(f, x + 3, y + 2, 3, 2, C.white)
    set(f, x + (tick % 2 ? 7 : 1), y + 2, C.white)
  } else if (act === 'plan') {
    for (let i = 0; i < 2; i++) {
      const done = (tick / 2 + i) % 4 < 2
      set(f, x + 1, y + 1 + i * 2, done ? 0x16a34a : 0x444444)
      rect(f, x + 3, y + 1 + i * 2, 5, 1, 0x78716c)
    }
  } else if (act === 'ask') {
    if (tick % 2) text(f, '?', x + 3, y, C.yellow)
  } else if (act === 'tool') {
    for (let i = 0; i < 3; i++) set(f, x + 2 + i * 2, y + 2, tick % 3 === i ? C.white : 0xa78bfa)
  } else if (act === 'think') {
    rect(f, x, y + (tick % h), w, 1, 0x374151)
  } else if (act === 'idle') {
    set(f, x + ((tick + seed) % w), y + ((tick * 2 + seed) % h), 0xfde68a)
  }
}

function monitor(f: Frame, x: number, y: number, act: Act, tick: number, seed: number) {
  rect(f, x, y, 11, 7, C.monitor)
  screen(f, x + 1, y + 1, act, tick, seed)
  rect(f, x + 4, y + 7, 3, 2, C.monitor)
}

function desk(f: Frame, x: number, y: number, w: number, h: number, top = C.deskTop, front = C.deskFront) {
  rect(f, x, y, w, 2, top)
  rect(f, x, y + 2, w, h, front)
  rect(f, x, y + 2 + h, 2, 1, C.deskEdge)
  rect(f, x + w - 2, y + 2 + h, 2, 1, C.deskEdge)
}

function bubble(f: Frame, x: number, y: number, act: Act, tick: number) {
  if (act === 'think') {
    for (let i = 0; i < 3; i++) if (tick % 4 > i) set(f, x + i * 2, y + 4, C.white)
  } else if (act === 'ask') {
    text(f, '?', x + 1, y - (tick % 2), C.yellow)
  } else if (act === 'done') {
    text(f, 'Z', x + 1 + (tick % 2), y, 0x93c5fd)
  } else if (act === 'agent') {
    text(f, '!', x + 1, y - (tick % 2), 0xfb923c)
  }
}

function station(f: Frame, w: Worker, cx: number, cy: number, tick: number) {
  const seed = hash(w.id) % 7
  bubble(f, cx + 6, cy, w.act, tick)
  person(f, cx + 4, cy + 6, lookFor(w), w.act, tick)
  monitor(f, cx + 15, cy + 5, w.act, tick, seed)
  desk(f, cx + 1, cy + 14, CELL_W - 3, 6)
  text(f, '#' + w.num, cx + 3, cy + 17, w.act === 'done' ? 0x8a6a50 : 0xf5deb3)
  if (w.act === 'done') {
    set(f, cx + 22, cy + 18, C.green)
    set(f, cx + 23, cy + 19, C.green)
    set(f, cx + 24, cy + 18, C.green)
    set(f, cx + 25, cy + 17, C.green)
  }
}

function emptyDesk(f: Frame, cx: number, cy: number) {
  rect(f, cx + 15, cy + 9, 11, 5, 0x3a3a44)
  desk(f, cx + 1, cy + 14, CELL_W - 3, 6)
}

function whiteboard(f: Frame, p: Plan, lines: BoardLine[], tick: number) {
  const b = p.board
  rect(f, b.x, b.y, b.w, b.h, C.boardFrame)
  rect(f, b.x + 1, b.y + 1, b.w - 2, b.h - 2, C.board)
  if (!p.wide) {
    // the stand's feet, it rolls
    rect(f, b.x + 4, b.y + b.h, 2, 2, C.frame)
    rect(f, b.x + b.w - 6, b.y + b.h, 2, 2, C.frame)
  }
  // the marker tray with three markers
  rect(f, b.x + 2, b.y + b.h - 1, b.w - 4, 1, C.frame)
  set(f, b.x + 4, b.y + b.h - 2, C.inkBad)
  set(f, b.x + 6, b.y + b.h - 2, C.ink)
  set(f, b.x + 8, b.y + b.h - 2, C.inkOk)
  const tones = { ok: C.inkOk, warn: C.inkWarn, bad: C.inkBad }
  lines.slice(0, b.lines).forEach((line, i) => {
    const y = b.y + 2 + i * 6
    const room = b.chars
    const label = line.label.slice(0, Math.max(0, room - 2))
    const value = line.value.slice(0, Math.max(0, room - label.length - 1))
    text(f, label, b.x + 2, y, C.ink)
    const vx = b.x + 2 + room * 4 - 1 - textWidth(value)
    text(f, value, vx, y, line.tone ? tones[line.tone] : 0x111827)
  })
  if (lines.length === 0) text(f, '/BOARD', b.x + 3, b.y + 2, C.dim)
  // a little squeak of the marker
  if (tick % 10 === 0) set(f, b.x + b.w - 3, b.y + 2, C.inkBad)
}

function glassWall(f: Frame, p: Plan, tick: number) {
  const y = p.roomEnd
  const doorX = p.wide ? p.w - 18 : 4
  for (let x = 0; x < p.w; x++) {
    if (x >= doorX && x < doorX + 10) continue // the open door
    set(f, x, y, C.frame)
    set(f, x, y + 3, C.frame)
    const mullion = x % 12 === 0
    set(f, x, y + 1, mullion ? C.frame : C.glass)
    set(f, x, y + 2, mullion ? C.frame : (x + tick) % 24 < 2 ? C.glassShine : C.glass)
  }
  // the door, swung open against the wall
  rect(f, doorX - 1, y - 6, 1, 10, C.frame)
  rect(f, doorX, y - 6, 1, 6, 0x9a6a3a)
  set(f, doorX + 10, y, C.frame)
  set(f, doorX + 10, y + 3, C.frame)
  rect(f, doorX + 10, y, 1, 4, C.frame)
}

function plant(f: Frame, x: number, y: number) {
  rect(f, x, y + 6, 5, 4, 0xb45309)
  for (const [dx, dy] of [[2, 0], [1, 1], [3, 1], [0, 2], [2, 2], [4, 2], [1, 3], [3, 3], [2, 4], [0, 4], [4, 4], [2, 5]])
    set(f, x + dx, y + dy, (dx + dy) % 2 ? 0x15803d : 0x22c55e)
}

export type Extras = { board: BoardLine[]; handoff?: 'writing' | 'sent' }

export function drawOffice(o: Office, width: number, tick: number, extras: Extras): Frame {
  const p = plan(width, o.workers.length, extras.board.length)
  const f = newFrame(p)
  const mx = p.mx
  const wy = p.wall

  // the two clocks on the wall behind the boss: 5-hour quota and context, each the share used,
  // as Claude's own meters show it; colour and blink follow what is left
  const ccy = wy - 25
  for (const [x, used, label] of [
    [mx - p.clockOff, o.usage.quotaUsed, '5H'],
    [mx + p.clockOff, o.usage.ctxPercent, 'CTX'],
  ] as [number, number | undefined, string][]) {
    const left = used === undefined ? undefined : Math.max(0, 100 - used)
    clock(f, x, ccy, 8, left, tick, used)
    const n = used === undefined ? '--' : Math.round(used) + '%'
    text(f, n, x - Math.floor(textWidth(n) / 2), ccy + 10, left === undefined ? C.dim : levelColor(left / 100))
    text(f, label, x - Math.floor(textWidth(label) / 2), ccy + 16, C.dim)
  }

  whiteboard(f, p, extras.board, tick)

  // the boss at his big desk, in his own room
  const m = o.manager
  bubble(f, mx - 2, wy - 14, m.act, tick)
  person(f, mx - 4, wy - 6, lookFor(m, true), m.act, tick)
  desk(f, mx - 13, wy + 2, 32, 8, C.bossTop, C.bossFront)
  monitor(f, mx + 5, wy - 4, m.act, tick, 3)
  text(f, 'BOSS', mx - 11, wy + 5, C.yellow)
  if (m.act === 'idle') {
    rect(f, mx - 11, wy, 3, 2, C.white)
    set(f, mx - 8, wy, C.white)
    set(f, mx - 10 + (tick % 2), wy - 2 - (tick % 2), 0xcccccc)
  }
  if (extras.handoff === 'writing') {
    // the boss scribbles the handoff memo: a paper flies about
    rect(f, mx - 6 + (tick % 4), wy - 1 - (tick % 2), 3, 2, C.white)
  }
  plant(f, p.wide ? p.w - 7 : p.w - 7, p.wide ? wy + 2 : wy + 1)

  glassWall(f, p, tick)

  // the bullpen
  const slots = p.cols * p.rows
  const x0 = Math.floor((p.w - p.cols * CELL_W) / 2)
  for (let i = 0; i < slots; i++) {
    const cx = x0 + (i % p.cols) * CELL_W
    const cy = p.deskTop + Math.floor(i / p.cols) * CELL_H
    const w = o.workers[i]
    if (w) station(f, w, cx, cy, tick)
    else emptyDesk(f, cx, cy)
  }
  return f
}

// ---- encoders -------------------------------------------------------------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function base64(bytes: Uint8Array): string {
  let out = ''
  let i = 0
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]
    out += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63]
  }
  const rest = bytes.length - i
  if (rest === 1) {
    const n = bytes[i] << 16
    out += B64[n >> 18] + B64[(n >> 12) & 63] + '=='
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8)
    out += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + '='
  }
  return out
}

/** Two pixels per terminal cell: the upper half block, fg on top, bg below. */
export function toCells(f: Frame): { columns: number; rows: number; cells: string } {
  const rows = f.h / 2
  const words = new Uint32Array(f.w * rows * 3)
  let k = 0
  for (let r = 0; r < rows; r++)
    for (let x = 0; x < f.w; x++) {
      words[k++] = 0x2580
      words[k++] = f.px[r * 2 * f.w + x]
      words[k++] = f.px[(r * 2 + 1) * f.w + x]
    }
  return { columns: f.w, rows, cells: base64(new Uint8Array(words.buffer)) }
}

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0')

/** The base layer as a few rects, then only the pixels that differ from it. */
export function toSvg(f: Frame, scale = 4): string {
  const parts: string[] = []
  let y0 = 0
  for (let y = 1; y <= f.h; y++) {
    if (y < f.h && f.base[y * f.w] === f.base[y0 * f.w]) continue
    parts.push(`<rect y="${y0}" width="${f.w}" height="${y - y0}" fill="${hex(f.base[y0 * f.w])}"/>`)
    y0 = y
  }
  const byColor = new Map<number, string[]>()
  for (let y = 0; y < f.h; y++) {
    let x = 0
    while (x < f.w) {
      const i = y * f.w + x
      const c = f.px[i]
      if (c === f.base[i]) {
        x++
        continue
      }
      let run = 1
      while (x + run < f.w && f.px[i + run] === c && f.px[i + run] !== f.base[i + run]) run++
      let list = byColor.get(c)
      if (!list) byColor.set(c, (list = []))
      list.push(`M${x} ${y}h${run}v1h-${run}z`)
      x += run
    }
  }
  for (const [c, d] of byColor) parts.push(`<path fill="${hex(c)}" d="${d.join('')}"/>`)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f.w} ${f.h}" ` +
    `width="${f.w * scale}" height="${f.h * scale}" shape-rendering="crispEdges">` +
    parts.join('') +
    `</svg>`
  )
}
