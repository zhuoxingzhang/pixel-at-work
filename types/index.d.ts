/** One tool call that runs now: its id, the scene that draws it, the words beside it and when it started. */
export type Act = { id: string; kind: string; label: string; since: number; isSubagent: boolean }

/**
 * What the band says once a turn is over: its steps and seconds, why it ended (answer, aborted, refusal, error)
 * and, after an API error, which one (rate_limit, overloaded, ...).
 */
export type LastTurn = { steps: number; seconds: number; reason?: string; error?: string }

/** A scene shown after a tool call ended (a failed compile, a passed test), at least until `until`. */
export type Flash = { kind: string; label: string; until: number }

/** One finished tool call of the turn, a crate on the pile at the left: its scene and whether it went well. */
export type Crate = { kind: string; ok: boolean }

/** The scene of a call that just ended, kept until `until` so a quick next call does not pass through thinking. */
export type Linger = { kind: string; label: string; until: number }

declare module 'claude-code' {
  interface PluginState {
    'at-work': {
      running: Act[]
      frame: number
      steps: number
      turnStart: number
      word: number
      last: LastTurn | null
      flash: Flash | null
      history: Crate[]
      linger: Linger | null
      swap: number
      mode: 'image' | 'frame'
      /** A holiday forced by /at-work holiday <name> to preview its decorations; '' follows the calendar. */
      holiday: string
    }
  }
}
