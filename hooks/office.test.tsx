import { describe, expect, test } from 'claude-code/testing'

import { actOf, addTokens, boardLines, detailOf, live, parseBoard, statLines, usageFrom } from './register'
import { drawOffice, plan, toCells, toSvg } from './draw'
import type { Office } from '../types'

const PANE_PROPS = {
  title: 'Pixel Office',
  isFocused: false,
  bodyColumns: 64,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
}

const HOUR = 3_600_000
const NOW = Date.parse('2026-10-18T10:00:00Z')

const sample: Office = {
  manager: { id: 'boss', num: 0, label: 'Boss', kind: 'main', act: 'agent', detail: 'find auth', since: 0, tools: 3 },
  workers: [
    { id: 'a1', num: 1, label: 'find auth code', kind: 'Explore', act: 'read', detail: 'auth.ts', since: 0, tools: 2 },
    { id: 'a2', num: 2, label: 'fix tests', kind: 'general-purpose', act: 'bash', detail: 'npm test', since: 0, tools: 5 },
    { id: 'a3', num: 3, label: 'write docs', kind: 'general-purpose', act: 'done', detail: 'finished', since: 0, tools: 9, doneAt: 1 },
  ],
  nextNum: 4,
  usage: {
    ctxPercent: 63, ctxTokens: 126_000, ctxWindow: 200_000, quotaUsed: 41,
    weeklyUsed: 38, weeklyResetsAt: new Date(NOW + 41 * HOUR).toISOString(), costUsd: 3.1842,
  },
  tokens: { input: 12_000, output: 80_000, cacheRead: 1_200_000, cacheWrite: 140_000, turns: 9 },
}

describe('what each tool looks like', () => {
  test('tools map to desk activities', async () => {
    expect(actOf('Edit')).toBe('type')
    expect(actOf('Grep')).toBe('read')
    expect(actOf('Bash')).toBe('bash')
    expect(actOf('WebSearch')).toBe('web')
    expect(actOf('Agent')).toBe('agent')
    expect(actOf('AskUserQuestion')).toBe('ask')
    expect(actOf('mcp__github__create_issue')).toBe('tool')
    expect(detailOf({ file_path: '/a/b/server.ts' })).toBe('server.ts')
    expect(detailOf({ command: 'npm test\nmore' })).toBe('npm test')
  })
})

describe('the figures', () => {
  test('both rate-limit windows are kept', async () => {
    const u = usageFrom({
      context: { tokens: 50_000, window: 200_000, percent: 25 },
      rateLimits: [{ kind: 'seven_day', percentUsed: 10 }, { kind: 'five_hour', percentUsed: 30 }],
    })
    expect(u.quotaUsed).toBe(30)
    expect(u.weeklyUsed).toBe(10)
    expect('costUsd' in u).toBe(false)
  })

  test('tokens add up across turns', async () => {
    let t = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0 }
    t = addTokens(t, { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20, model: 'm' })
    t = addTokens(t, { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 1, cache_creation_input_tokens: 1, model: 'm' })
    expect(t).toEqual({ input: 11, output: 6, cacheRead: 101, cacheWrite: 21, turns: 2 })
  })

  test('the whiteboard and the words say the same thing', async () => {
    const lines = boardLines(['cache', 'tokens', 'week', 'cost'], sample, NOW)
    expect(lines.map(l => l.label + ' ' + l.value)).toEqual(['CACHE 1.2M 89%', 'TOKENS 1.4M', 'WEEK 38% 41H', 'COST $3.18'])
    const words = statLines(sample, NOW).join('\n')
    expect(words).toContain('38% used · resets in 41h 0m')
    expect(words).toContain('5-hour limit: 41% used')
    expect(words).toContain('Context: 63% used')
    expect(words).toContain('$3.1842')
    expect(words).toContain('89% hit rate')
  })

  test('a window past its reset reads 0% used until the next response says otherwise', async () => {
    const u = live({ quotaUsed: 92, quotaResetsAt: new Date(NOW - 1000).toISOString(), weeklyUsed: 38, weeklyResetsAt: new Date(NOW + HOUR).toISOString() }, NOW)
    expect(u.quotaUsed).toBe(0)
    expect(u.quotaResetsAt).toBeUndefined()
    expect(u.weeklyUsed).toBe(38)
  })

  test('/board takes names and aliases', async () => {
    expect(parseBoard('week $ cost 5h')).toEqual(['week', 'cost', 'quota'])
    expect(parseBoard('')).toBeUndefined()
    expect(parseBoard('reset')).toEqual(['cache', 'tokens', 'week', 'cost'])
  })
})

describe('the bullpen', () => {
  test('one desk per agent: two facing rows up to 8, three rows of small desks past that', async () => {
    expect(plan(130, 0, 4).rows).toBe(0)
    expect(plan(130, 1, 4).rows).toBe(1)
    expect([plan(130, 5, 4).rows, plan(130, 5, 4).cols, plan(130, 5, 4).small]).toEqual([2, 3, false])
    expect([plan(130, 8, 4).rows, plan(130, 8, 4).cols, plan(130, 8, 4).small]).toEqual([2, 4, false])
    expect([plan(130, 9, 4).rows, plan(130, 9, 4).cols, plan(130, 9, 4).small]).toEqual([3, 3, true])
    expect([plan(130, 18, 4).rows, plan(130, 18, 4).cols]).toEqual([3, 6])
    // too narrow for that many across: more rows, never a desk off the edge
    const narrow = plan(64, 8, 4)
    expect(narrow.cols * narrow.cellW).toBeLessThanOrEqual(64)
    expect(narrow.cols * narrow.rows).toBeGreaterThanOrEqual(8)
  })

  test('every agent count draws without spilling past the frame', async () => {
    const board = boardLines(['cache', 'tokens', 'week', 'cost'], sample, NOW)
    for (const n of [0, 1, 2, 5, 8, 9, 12, 18])
      for (const width of [64, 120, 160]) {
        const workers = Array.from({ length: n }, (_, i) => ({ ...sample.workers[i % 3], id: 'w' + i, num: i + 1 }))
        const f = drawOffice({ ...sample, workers }, width, 3, { board })
        expect(f.px.length).toBe(f.w * f.h)
      }
  })
})

describe('the pixels', () => {
  test('narrow and wide offices pack into cells and an svg', async () => {
    const board = boardLines(['cache', 'tokens', 'week', 'cost'], sample, NOW)
    for (const width of [64, 120]) {
      const f = drawOffice(sample, width, 3, { board })
      const p = plan(width, 3, board.length)
      expect(f.w).toBe(p.w)
      expect(f.h % 2).toBe(0)
      expect(p.board.chars).toBeGreaterThanOrEqual(14)
      const r = toCells(f)
      expect(r.rows).toBe(f.h / 2)
      expect(toSvg(f).length).toBeLessThan(131_072)
    }
  })
})

describe('the pane', () => {
  test('a subagent shows up at a desk, with the handoff button, on every surface', async ($, on) => {
    on('agent.list', async () => ({
      value: [{ id: 'a1', description: 'find auth code', type: 'Explore', status: 'running' as const }],
    }))
    on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
    on('clock.now', async () => ({ value: NOW }))
    await $.turn.start({ text: '', turnId: 't1', agentId: 'a1' })
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({
        plugin: 'pixel-office',
        surface,
        component: 'Pane',
        requestId: 'pixel-office',
        props: PANE_PROPS,
      })
      expect(await ui.find({ text: /find auth code/ })).toBeDefined()
      expect(await ui.find({ key: 'handoff' })).toBeDefined()
      expect(await ui.find({ text: /This session/ })).toBeDefined()
      expect(await ui.find({ type: surface === 'terminal' ? 'Raster' : 'Svg' })).toBeDefined()
      await ui.unmount()
    }
  })
})

describe('the handoff', () => {
  test('writes the memo, copies the prompt, and keeps this chat', async ($, on) => {
    const written: string[] = []
    const copied: string[] = []
    const ran: string[] = []
    on('clock.now', async () => ({ value: NOW }))
    on('model.fork', async () => ({
      value: { isAnswered: true, text: '## Goal\nShip it\n## Next steps\n1. test', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
    }))
    on('fs.write', async (_$, e) => {
      written.push(String((e as { path?: string }).path ?? JSON.stringify(e)))
      return { value: undefined }
    })
    on('ui.copy', async (_$, e) => {
      copied.push(e.text)
      return { value: { isCopied: true } }
    })
    on('ui.toast', async () => ({ value: {} }))
    on('command.run', async (_$, e) => {
      ran.push(e.command)
      return { text: '' }
    })
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'pixel-office', surface, component: 'Pane', requestId: 'pixel-office', props: PANE_PROPS })
      await ui.press({ key: 'handoff' })
      expect(await ui.find({ key: 'copy' })).toBeDefined()
      expect(await ui.find({ text: /This chat is kept/ })).toBeDefined()
      await ui.unmount()
    }
    expect(written.length).toBe(2)
    expect(copied[0]).toContain('.claude/handoffs/handoff-')
    expect(ran).not.toContain('clear')
  })
})
