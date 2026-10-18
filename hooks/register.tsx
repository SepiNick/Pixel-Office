import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface, SessionRateLimit, SessionUsage, TurnUsage } from 'claude-code'

import type { Act, BoardItem, Handoff, Office, Tokens, Usage, Worker } from '../types'
import type { BoardLine } from './draw'
import { drawOffice, toCells, toSvg } from './draw'

const PANE = 'pixel-office'
const TITLE = 'Pixel Office'
const DONE_LINGER_MS = 45_000
const MAX_WORKERS = 12
const HANDOFF_AT = 75 // context percent at which the handoff button turns red

export const BOARD_ITEMS: BoardItem[] = ['cache', 'tokens', 'week', 'cost', 'quota', 'ctx', 'time']
const DEFAULT_BOARD: BoardItem[] = ['cache', 'tokens', 'week', 'cost']

const boss = (): Worker => ({
  id: 'boss', num: 0, label: 'Boss', kind: 'main', act: 'idle',
  detail: 'waiting for you', since: 0, tools: 0,
})
const noTokens = (): Tokens => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0 })

const office = atom({ plugin: 'pixel-office', key: 'office' } as const, {
  manager: boss(),
  workers: [],
  nextNum: 1,
  usage: {},
  tokens: noTokens(),
} as Office)
const tick = atom({ plugin: 'pixel-office', key: 'tick' } as const, 0)
const board = atom({ plugin: 'pixel-office', key: 'board' } as const, DEFAULT_BOARD)
const handoff = atom({ plugin: 'pixel-office', key: 'handoff' } as const, { status: 'idle' } as Handoff)

export const HANDOFF_PROMPT = [
  'We are about to continue this work in a brand-new chat whose context is empty.',
  'Write the handoff that new chat will start from, in Markdown, in the language the user writes in.',
  'Sections, in this order:',
  '## Goal: what the user wants overall.',
  '## Done so far: what is finished, with file paths.',
  '## Current state: what is in progress, half-finished or broken right now.',
  '## Remaining work: a numbered checklist of EVERY task not yet done, in order.',
  '## Decisions and constraints: choices made, user preferences, things to avoid.',
  '## Files to look at first: paths, one line each on why.',
  '## Next steps: the very first concrete actions to take.',
  'Be specific and complete: the new chat sees nothing but this text. Reply with the handoff alone.',
].join('\n')

// ---- what a tool call looks like at a desk --------------------------------

export function actOf(tool: string): Act {
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool)) return 'type'
  if (/^(Read|Grep|Glob|LS|NotebookRead)$/.test(tool)) return 'read'
  if (/^(Bash|BashOutput|KillShell|KillBash|PowerShell|Monitor)$/.test(tool)) return 'bash'
  if (/^(WebFetch|WebSearch)$/.test(tool) || /browser|chrome/i.test(tool)) return 'web'
  if (/^(Agent|Task|SendMessage)$/.test(tool)) return 'agent'
  if (/^(TodoWrite|TaskCreate|TaskUpdate|TaskList|TaskGet|EnterPlanMode|ExitPlanMode)$/.test(tool)) return 'plan'
  if (tool === 'AskUserQuestion') return 'ask'
  return 'tool'
}

const base = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p
const cut = (s: string, n = 48) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

export function detailOf(e: Record<string, unknown>): string {
  const s = (k: string) => (typeof e[k] === 'string' ? (e[k] as string) : undefined)
  const file = s('file_path') ?? s('notebook_path') ?? s('path')
  if (s('command')) return cut(s('command')!.split('\n')[0])
  if (s('description')) return cut(s('description')!)
  if (s('pattern')) return cut(s('pattern')! + (file ? ' in ' + base(file) : ''))
  if (file) return base(file)
  if (s('url')) {
    try {
      return new URL(s('url')!).host
    } catch {
      return cut(s('url')!)
    }
  }
  if (s('query')) return cut(s('query')!)
  return ''
}

const WORDS: Record<Act, string> = {
  think: 'thinking', type: 'editing', read: 'reading', bash: 'running', web: 'browsing',
  agent: 'delegating', plan: 'planning', ask: 'asking you', tool: 'using', idle: 'waiting for you',
  done: 'done',
}

export function sentence(w: Worker): string {
  const verb = WORDS[w.act]
  return w.detail ? `${verb} · ${w.detail}` : verb
}

// ---- figures --------------------------------------------------------------

export function usageFrom(u: Partial<Pick<SessionUsage, 'context' | 'rateLimits' | 'cost' | 'startedAt'>>): Usage {
  const list: SessionRateLimit[] = u.rateLimits ?? []
  const five = list.find(l => l.kind === 'five_hour')
  const week = list.find(l => l.kind === 'seven_day')
  const out: Usage = {
    ctxPercent: u.context?.percent,
    ctxTokens: u.context?.tokens,
    ctxWindow: u.context?.window,
    quotaUsed: five?.percentUsed,
    quotaResetsAt: five?.resetsAt,
    weeklyUsed: week?.percentUsed,
    weeklyResetsAt: week?.resetsAt,
    costUsd: u.cost?.usd,
    startedAt: u.startedAt,
  }
  // keep earlier readings where this measurement has none
  for (const k of Object.keys(out) as (keyof Usage)[]) if (out[k] === undefined) delete out[k]
  return out
}

export function addTokens(t: Tokens, u: TurnUsage | undefined): Tokens {
  if (!u) return t
  return {
    input: t.input + (u.input_tokens ?? 0),
    output: t.output + (u.output_tokens ?? 0),
    cacheRead: t.cacheRead + (u.cache_read_input_tokens ?? 0),
    cacheWrite: t.cacheWrite + (u.cache_creation_input_tokens ?? 0),
    turns: t.turns + 1,
  }
}

export const kTok = (n?: number) =>
  n === undefined
    ? '?'
    : n >= 1_000_000
      ? (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1) + 'M'
      : n >= 1000
        ? Math.round(n / 1000) + 'K'
        : String(n)

const total = (t: Tokens) => t.input + t.output + t.cacheRead + t.cacheWrite
const hitRate = (t: Tokens) => {
  const inAll = t.input + t.cacheRead + t.cacheWrite
  return inAll ? Math.round((t.cacheRead / inAll) * 100) : undefined
}

function hoursUntil(iso: string | undefined, now: number): number | undefined {
  if (!iso) return undefined
  const ms = Date.parse(iso) - now
  return ms > 0 ? ms / 3_600_000 : 0
}

function hm(hours: number | undefined): string {
  if (hours === undefined) return ''
  const m = Math.round(hours * 60)
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m` : `${m}m`
}

const tone = (left: number): BoardLine['tone'] => (left > 50 ? 'ok' : left > 20 ? 'warn' : 'bad')
const money = (usd: number) => (usd >= 100 ? '$' + Math.round(usd) : '$' + usd.toFixed(2))

/** What the whiteboard says, in pixel-font shorthand. */
export function boardLines(items: BoardItem[], o: Office, now: number): BoardLine[] {
  const u = o.usage
  const t = o.tokens
  return items.map((item): BoardLine => {
    switch (item) {
      case 'cache': {
        const hit = hitRate(t)
        return hit === undefined
          ? { label: 'CACHE', value: '--' }
          : { label: 'CACHE', value: `${kTok(t.cacheRead)} ${hit}%`, tone: tone(hit) }
      }
      case 'tokens':
        return { label: 'TOKENS', value: t.turns ? kTok(total(t)) : '--' }
      case 'week': {
        if (u.weeklyUsed === undefined) return { label: 'WEEK', value: '--' }
        const left = Math.max(0, Math.round(100 - u.weeklyUsed))
        const h = hoursUntil(u.weeklyResetsAt, now)
        return { label: 'WEEK', value: `${left}%${h === undefined ? '' : ' ' + Math.ceil(h) + 'H'}`, tone: tone(left) }
      }
      case 'cost':
        return { label: 'COST', value: u.costUsd === undefined ? '--' : money(u.costUsd) }
      case 'quota': {
        if (u.quotaUsed === undefined) return { label: '5H', value: '--' }
        const left = Math.max(0, Math.round(100 - u.quotaUsed))
        const h = hoursUntil(u.quotaResetsAt, now)
        return { label: '5H', value: `${left}%${h === undefined ? '' : ' ' + hm(h).toUpperCase().replace(/M$/, '')}`, tone: tone(left) }
      }
      case 'ctx': {
        if (u.ctxPercent === undefined) return { label: 'CTX', value: '--' }
        const left = Math.max(0, 100 - u.ctxPercent)
        const free = u.ctxWindow !== undefined && u.ctxTokens !== undefined ? u.ctxWindow - u.ctxTokens : undefined
        return { label: 'CTX', value: `${u.ctxPercent}% ${kTok(free)}`, tone: tone(left) }
      }
      case 'time': {
        const h = u.startedAt === undefined ? undefined : (now - u.startedAt) / 3_600_000
        return { label: 'TIME', value: h === undefined ? '--' : hm(h).toUpperCase().replace(/M$/, '') }
      }
    }
  })
}

/** The same figures in words, under the picture. */
export function statLines(o: Office, now: number): string[] {
  const u = o.usage
  const t = o.tokens
  const hit = hitRate(t)
  const lines: string[] = []
  lines.push(
    t.turns
      ? `💾 Cache: ${kTok(t.cacheRead)} read · ${kTok(t.cacheWrite)} written${hit === undefined ? '' : ` · ${hit}% hit rate`}`
      : '💾 Cache: no turn yet',
  )
  lines.push(
    t.turns
      ? `🔢 Tokens: ${kTok(total(t))} in all · ${kTok(t.input)} fresh in · ${kTok(t.output)} out · ${t.turns} turns`
      : '🔢 Tokens: no turn yet',
  )
  if (u.weeklyUsed === undefined) lines.push('⏳ Weekly limit: no reading yet (subscription accounts only)')
  else {
    const h = hoursUntil(u.weeklyResetsAt, now)
    lines.push(
      `⏳ Weekly limit: ${Math.max(0, Math.round(100 - u.weeklyUsed))}% left` +
        (h === undefined ? '' : ` · resets in ${Math.floor(h)}h ${Math.round((h % 1) * 60)}m`),
    )
  }
  if (u.quotaUsed !== undefined) {
    const h = hoursUntil(u.quotaResetsAt, now)
    lines.push(`⏱ 5-hour limit: ${Math.max(0, Math.round(100 - u.quotaUsed))}% left${h === undefined ? '' : ` · resets in ${hm(h)}`}`)
  }
  if (u.ctxPercent !== undefined) {
    const free = u.ctxWindow !== undefined && u.ctxTokens !== undefined ? u.ctxWindow - u.ctxTokens : undefined
    lines.push(`🧠 Context left: ${Math.max(0, 100 - u.ctxPercent)}% (${kTok(free)} of ${kTok(u.ctxWindow)} free)`)
  }
  lines.push(`💸 This session: ${u.costUsd === undefined ? 'no cost yet' : '$' + u.costUsd.toFixed(4)}`)
  return lines
}

export function parseBoard(args: string): BoardItem[] | undefined {
  const alias: Record<string, BoardItem> = {
    cache: 'cache', tokens: 'tokens', token: 'tokens', tok: 'tokens', week: 'week', weekly: 'week',
    cost: 'cost', money: 'cost', quota: 'quota', '5h': 'quota', ctx: 'ctx', context: 'ctx', time: 'time',
  }
  const words = args.toLowerCase().split(/[\s,]+/).filter(Boolean)
  if (words.length === 0) return undefined
  if (words[0] === 'reset' || words[0] === 'default') return DEFAULT_BOARD
  if (words[0] === 'all') return BOARD_ITEMS
  const items = words.map(w => alias[w]).filter((x): x is BoardItem => x !== undefined)
  return [...new Set(items)]
}

// ---- state helpers (top level, so the engine can follow $) ----------------

async function setUsage($: EngineInterface, u: Usage) {
  await update($, office, o => ({ ...o, usage: { ...o.usage, ...u } }))
}

async function refreshUsage($: EngineInterface) {
  try {
    await setUsage($, usageFrom(await $.session.usage()))
  } catch {}
}

async function ensureWorker($: EngineInterface, id: string) {
  const o = await read($, office)
  if (o.workers.some(w => w.id === id)) return
  const info = (await $.agent.list()).find(a => a.id === id)
  const now = await $.clock.now()
  await update($, office, cur => {
    if (cur.workers.some(w => w.id === id)) return cur
    const w: Worker = {
      id,
      num: cur.nextNum,
      label: info?.description || info?.name || 'Agent',
      kind: info?.type ?? 'agent',
      act: 'think',
      detail: '',
      since: now,
      tools: 0,
    }
    return { ...cur, nextNum: cur.nextNum + 1, workers: [...cur.workers, w].slice(-MAX_WORKERS) }
  })
}

async function setWho($: EngineInterface, agentId: string | undefined, patch: Partial<Worker>) {
  await update($, office, o =>
    agentId === undefined
      ? { ...o, manager: { ...o.manager, ...patch } }
      : { ...o, workers: o.workers.map(w => (w.id === agentId ? { ...w, ...patch } : w)) },
  )
}

async function countTool($: EngineInterface, id: string | undefined) {
  await update($, office, o =>
    id === undefined
      ? { ...o, manager: { ...o.manager, tools: o.manager.tools + 1 } }
      : { ...o, workers: o.workers.map(w => (w.id === id ? { ...w, tools: w.tools + 1 } : w)) },
  )
}

async function frame($: EngineInterface) {
  const o = await read($, office)
  const now = await $.clock.now()
  const stale = o.workers.filter(w => w.act === 'done' && now - (w.doneAt ?? now) > DONE_LINGER_MS)
  if (stale.length) {
    const ids = stale.map(w => w.id)
    await update($, office, cur => ({ ...cur, workers: cur.workers.filter(w => !ids.includes(w.id)) }))
  }
  const ho = await read($, handoff)
  const moving =
    o.manager.act !== 'idle' ||
    o.workers.length > 0 ||
    ho.status === 'writing' ||
    (o.usage.ctxPercent ?? 0) > 85 ||
    (o.usage.quotaUsed ?? 0) > 85
  if (moving) await update($, tick, n => (n + 1) % 1_000_000)
}

async function warnIfFull($: EngineInterface) {
  const o = await read($, office)
  const ho = await read($, handoff)
  if ((o.usage.ctxPercent ?? 0) < HANDOFF_AT || ho.warned) return
  await update($, handoff, (h): Handoff => ({ ...h, warned: true }))
  await $.ui.toast(`Context is ${o.usage.ctxPercent}% full: press HANDOFF in Pixel Office, or run /handoff, to carry the work into a new chat`)
}

function stamp(ms: number) {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/** What the new chat is told: short, so it pastes anywhere and passes a shell. */
export function continuePrompt(file: string | undefined, memo: string): string {
  if (!file) return 'Continue the earlier work from this handoff. Do not redo finished work.\n\n' + memo
  return (
    `Continue the work described in ${file} - read that file first, check the files it names, ` +
    'then carry on from its Next steps and Remaining work without redoing finished work'
  )
}

async function copyPrompt($: EngineInterface, surface?: RenderSurface) {
  const ho = await read($, handoff)
  if (!ho.prompt) return
  let copied = false
  try {
    copied = (await $.ui.copy({ text: ho.prompt, surface })).isCopied
  } catch {}
  await update($, handoff, (h): Handoff => ({ ...h, copied }))
  await $.ui.toast(copied ? 'Copied: open a new chat and paste it' : 'Could not reach the clipboard: copy the prompt from the pane')
}

/**
 * The handoff: a fork of this chat writes the memo and it is saved in the
 * project. This chat is left exactly as it is; the prompt that carries the
 * work on is copied, ready to paste into a new chat.
 */
async function doHandoff($: EngineInterface, surface?: RenderSurface): Promise<string> {
  const now0 = await read($, handoff)
  if (now0.status === 'writing') return 'A handoff is already being written.'
  await update($, handoff, (h): Handoff => ({ ...h, status: 'writing', note: undefined }))
  await $.ui.toast('Handoff: the boss is writing the memo for the next chat…')
  const r = await $.model.fork({ prompt: HANDOFF_PROMPT })
  if (!r.isAnswered || !r.text.trim()) {
    const why = r.isAnswered ? 'the memo came back empty' : r.reason
    await update($, handoff, (h): Handoff => ({ ...h, status: 'failed', note: why }))
    await $.ui.toast(`Handoff failed: ${why}`)
    return `Handoff failed: ${why}.`
  }
  let file: string | undefined = `.claude/handoffs/handoff-${stamp(await $.clock.now())}.md`
  try {
    await $.fs.write(file, r.text)
  } catch {
    file = undefined
  }
  const prompt = continuePrompt(file, r.text)
  await update($, handoff, (h): Handoff => ({ ...h, status: 'ready', file, prompt, copied: false, note: undefined }))
  await copyPrompt($, surface)
  return (
    (file ? `Handoff memo saved to ${file}. ` : 'Handoff memo written. ') +
    'This chat is untouched. To go on in a new chat, open one and paste this prompt (it is on your clipboard if the copy worked):\n\n' +
    prompt
  )
}

/** Starts Claude Code in a new terminal window, in this project, with the prompt. */
async function openTerminal($: EngineInterface): Promise<void> {
  const ho = await read($, handoff)
  if (!ho.prompt || !ho.file) {
    await $.ui.toast('Write a handoff first')
    return
  }
  const cwd = await $.session.cwd()
  const isWindows = (await $.env.get('OS')) === 'Windows_NT' || (await $.env.get('COMSPEC')) !== undefined
  // POSIX single-quote every value that goes into a shell string, so a quote in a path cannot break out
  const q = (s: string) => "'" + s.split("'").join(`'"'"'`) + "'"
  const sh = `cd ${q(cwd)} && claude ${q(ho.prompt)}`
  const apple = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const tries: string[][] = isWindows
    ? [
        ['wt.exe', '-d', cwd, 'cmd', '/k', 'claude', ho.prompt],
        ['cmd.exe', '/c', 'start', 'Claude handoff', '/D', cwd, 'cmd', '/k', 'claude', ho.prompt],
      ]
    : (await $.env.get('TERM_PROGRAM')) === 'Apple_Terminal' || (await $.env.get('__CFBundleIdentifier')) !== undefined
      ? [['osascript', '-e', `tell application "Terminal" to do script "${apple(sh)}"`]]
      : [
          ['x-terminal-emulator', '-e', 'bash', '-lc', `${sh}; exec bash`],
          ['gnome-terminal', '--', 'bash', '-lc', `${sh}; exec bash`],
          ['konsole', '-e', 'bash', '-lc', `${sh}; exec bash`],
          ['xterm', '-e', 'bash', '-lc', `${sh}; exec bash`],
        ]
  for (const argv of tries) {
    try {
      const r = await $.process.run(argv, { cwd })
      if (r.exitCode === 0) {
        await $.ui.toast('A new Claude Code is starting in a terminal window with the handoff')
        return
      }
    } catch {}
  }
  await $.ui.toast('Could not open a terminal: paste the prompt into a new chat instead')
}

// ---- the module -----------------------------------------------------------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'office', description: 'Open the 8-bit Pixel Office pane' })
    await $.command.register({
      name: 'board',
      description: "Choose what the boss's whiteboard shows: cache tokens week cost quota ctx time (or all, reset)",
      argumentHint: '[items…]',
    })
    await $.command.register({
      name: 'handoff',
      description: 'Write a handoff memo of the remaining work and copy the prompt that continues it in a new chat (this chat is kept)',
    })
    try {
      const saved = parseBoard(String((await $.store.get('board')) ?? ''))
      if (saved) await update($, board, () => saved)
    } catch {}
    await refreshUsage($)
    $.clock.every(400, () => void frame($))
    void $.ui.open({ id: PANE, title: TITLE })
    return next(e)
  })

  on('command.run', { command: 'office' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE, focus: true })
    return { text: 'Pixel Office is open.' }
  })

  on('command.run', { command: 'board' }, async ($, e) => {
    const items = parseBoard(e.args)
    if (!items) {
      const now = await read($, board)
      return { text: `The whiteboard shows: ${now.join(' ')}. Choose from: ${BOARD_ITEMS.join(' ')} (or all, reset). Example: /board week cost cache` }
    }
    await update($, board, () => items)
    await $.store.set('board', items.join(' '))
    return { text: items.length ? `The whiteboard now shows: ${items.join(' ')}.` : 'The whiteboard is wiped clean.' }
  })

  on('command.run', { command: 'handoff' }, async $ => ({ text: await doHandoff($) }))

  on('session.measure', async ($, e, next) => {
    await setUsage($, usageFrom(e))
    await warnIfFull($)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) {
      await ensureWorker($, e.agentId)
      await setWho($, e.agentId, { act: 'think', detail: '' })
    } else {
      await setWho($, undefined, { act: 'think', detail: cut(e.text.replace(/\s+/g, ' ').trim(), 40), since: await $.clock.now() })
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const id = e.agentId
    if (id !== undefined) await ensureWorker($, id)
    const args = e as unknown as Record<string, unknown>
    const tool = String(e.tool)
    const act = actOf(tool)
    const detail = act === 'tool' ? cut(tool.replace(/^mcp__/, '').replace(/__/g, ' › '), 40) : detailOf(args)
    await setWho($, id, { act, detail })
    await countTool($, id)
    try {
      return await next(e)
    } finally {
      const o = await read($, office)
      const who = id === undefined ? o.manager : o.workers.find(w => w.id === id)
      if (who && who.act !== 'done') await setWho($, id, { act: 'think', detail: '' })
    }
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const out = await next(e)
    await update($, office, o => ({ ...o, tokens: addTokens(o.tokens ?? noTokens(), e.usage) }))
    if (e.agentId !== undefined) {
      await setWho($, e.agentId, { act: 'done', detail: 'finished', doneAt: await $.clock.now() })
    } else {
      await setWho($, undefined, { act: 'idle', detail: 'waiting for you' })
      await refreshUsage($)
      await warnIfFull($)
    }
    return out
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, office, o => ({ ...o, workers: [], manager: boss(), tokens: noTokens(), usage: {} }))
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const o = await read($, office)
    const t = await read($, tick)
    const items = await read($, board)
    const ho = await read($, handoff)
    const now = await $.clock.now()
    const width = e.props.bodyColumns
    const extras = {
      board: boardLines(items, o, now),
      handoff: ho.status === 'writing' ? ('writing' as const) : undefined,
    }
    const stats = statLines(o, now)
    const full = (o.usage.ctxPercent ?? 0) >= HANDOFF_AT
    const hoLabel =
      ho.status === 'writing'
        ? 'HANDOFF: writing the memo…'
        : full
          ? `HANDOFF NOW (context ${o.usage.ctxPercent}% full)`
          : 'HANDOFF to a new chat'
    const hoNote =
      ho.status === 'failed'
        ? `Last handoff failed: ${ho.note ?? 'unknown reason'}`
        : ho.status === 'ready'
          ? `✅ Memo ${ho.file ? 'saved to ' + ho.file : 'written'}. ${ho.copied ? 'Prompt copied: open a new chat and paste it.' : 'Copy the prompt below into a new chat.'} This chat is kept.`
          : undefined
    const surface = e.surface
    const press = () => {
      void doHandoff($, surface)
    }
    const again = () => copyPrompt($, surface)
    const term = () => openTerminal($)
    const ready = ho.status === 'ready' && ho.prompt !== undefined

    const roster = [o.manager, ...o.workers].map(w => ({
      key: 'w-' + w.id,
      head: w.num === 0 ? 'BOSS' : `#${w.num} ${w.kind}`,
      who: w.num === 0 ? '' : cut(w.label, 32),
      what: sentence(w),
      isDone: w.act === 'done',
      agentId: w.num === 0 ? undefined : w.id,
    }))

    if (e.surface === 'terminal') {
      const { Box, Text, Button, Code, Raster } = $.ui.resolve(e)
      const r = toCells(drawOffice(o, width, t, extras))
      return (
        <Box flexDirection="column">
          <Raster key="office" columns={r.columns} rows={r.rows} cells={r.cells} />
          <Button key="handoff" hotkey="h" variant={full ? 'primary' : 'secondary'} label={hoLabel} onPress={press} />
          {hoNote ? <Text dimColor>{hoNote}</Text> : null}
        {ready ? <Code source={ho.prompt ?? ''} /> : null}
        {ready ? <Button key="copy" label="Copy the prompt again" onPress={again} /> : null}
        {ready && ho.file ? <Button key="term" label="Open in a new terminal" onPress={term} /> : null}
          {ready ? <Code source={ho.prompt ?? ''} /> : null}
          {ready ? <Button key="copy" hotkey="c" label="Copy the prompt again" onPress={again} /> : null}
          {ready && ho.file ? <Button key="term" hotkey="t" label="Open in a new terminal" onPress={term} /> : null}
          {stats.map(line => (
            <Text>{line}</Text>
          ))}
          {roster.map(row => (
            <Button key={row.key} plain onPress={() => $.ui.view(row.agentId ? { agentId: row.agentId } : {})}>
              <Text bold>{row.head}</Text> {row.who ? <Text dimColor>{row.who} </Text> : ''}
              <Text dimColor={row.isDone}>— {row.what}</Text>
            </Button>
          ))}
        </Box>
      )
    }

    const { Box, Text, Button, Code, Svg } = $.ui.resolve(e)
    const f = drawOffice(o, Math.min(128, Math.max(64, Math.floor(width * 1.1))), t, extras)
    const alt = `Pixel office: the boss in his room and ${o.workers.length} agents in the bullpen. ${stats.join(' ')}`
    return (
      <Box flexDirection="column">
        {Svg ? <Svg source={toSvg(f, 4)} alt={alt} /> : <Text>{alt}</Text>}
        <Button key="handoff" variant={full ? 'primary' : 'secondary'} label={hoLabel} onPress={press} />
        {hoNote ? <Text dimColor>{hoNote}</Text> : null}
        {ready ? <Code source={ho.prompt ?? ''} /> : null}
        {ready ? <Button key="copy" label="Copy the prompt again" onPress={again} /> : null}
        {ready && ho.file ? <Button key="term" label="Open in a new terminal" onPress={term} /> : null}
        {stats.map(line => (
          <Text>{line}</Text>
        ))}
        {roster.map(row => (
          <Button key={row.key} plain onPress={() => $.ui.view(row.agentId ? { agentId: row.agentId } : {})}>
            <Text bold>{row.head}</Text> {row.who ? <Text dimColor>{row.who} </Text> : ''}
            <Text dimColor={row.isDone}>— {row.what}</Text>
          </Button>
        ))}
      </Box>
    )
  })
}
