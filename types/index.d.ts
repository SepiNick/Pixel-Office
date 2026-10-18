export type Act =
  | 'think'
  | 'type'
  | 'read'
  | 'bash'
  | 'web'
  | 'agent'
  | 'plan'
  | 'ask'
  | 'tool'
  | 'idle'
  | 'done'

export type Worker = {
  id: string
  num: number
  label: string
  kind: string
  act: Act
  detail: string
  since: number
  doneAt?: number
  tools: number
}

export type Usage = {
  ctxPercent?: number
  ctxTokens?: number
  ctxWindow?: number
  quotaUsed?: number
  quotaResetsAt?: string
  weeklyUsed?: number
  weeklyResetsAt?: string
  costUsd?: number
  startedAt?: number
}

/** Token totals of the session, every loop's turns summed (main and agents). */
export type Tokens = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  turns: number
}

/** What the whiteboard in the boss's office shows, top to bottom. */
export type BoardItem = 'cache' | 'tokens' | 'week' | 'cost' | 'quota' | 'ctx' | 'time'

export type Office = {
  manager: Worker
  workers: Worker[]
  nextNum: number
  usage: Usage
  tokens: Tokens
}

export type Handoff = {
  status: 'idle' | 'writing' | 'ready' | 'failed'
  /** Where the memo was saved, relative to the project. */
  file?: string
  /** What to paste into the new chat. */
  prompt?: string
  copied?: boolean
  note?: string
  warned?: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'pixel-office': { office: Office; tick: number; board: BoardItem[]; handoff: Handoff }
  }
}
