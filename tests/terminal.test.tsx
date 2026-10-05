import { test, expect, mock } from 'claude-code/testing'

// The terminal's picture: a Raster of half-block cells in a terminal with room, the one-line animation in a small
// one, and the `terminalArt` option over both.

const ZH = { options: { language: 'zh' } }
const working = { hasSurvey: false, isWorking: true, maxRows: 20, bodyColumns: 120 } as never
const idle = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120 } as never
const tall = { columns: 120, rows: 45 }
const small = { columns: 120, rows: 30 }

async function band($: any, props: never, viewport: { columns: number; rows: number }): Promise<unknown> {
  return (await $.ui.mount({ plugin: 'at-work', surface: 'terminal', component: 'AbovePrompt', props, viewport })).drawn()
}

/** The props of the Raster in a drawing, wherever it sits: the one object with a `cells` string. */
function raster(tree: unknown): { cells: string; columns: number; rows: number } | null {
  if (tree === null || typeof tree !== 'object') return null
  const o = tree as Record<string, unknown>
  if (typeof o.cells === 'string') return o as unknown as { cells: string; columns: number; rows: number }
  for (const v of Object.values(o)) {
    const r = raster(v)
    if (r !== null) return r
  }
  return null
}

function fromBase64(s: string): Uint8Array {
  const T = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const clean = s.replace(/=+$/, '')
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let k = 0
  for (let i = 0; i + 1 < clean.length; i += 4) {
    const n = (T.indexOf(clean[i]) << 18) | (T.indexOf(clean[i + 1]) << 12) | ((T.indexOf(clean[i + 2] ?? 'A')) << 6) | T.indexOf(clean[i + 3] ?? 'A')
    out[k++] = (n >> 16) & 255
    if (i + 2 < clean.length) out[k++] = (n >> 8) & 255
    if (i + 3 < clean.length) out[k++] = n & 255
  }
  return out
}

/** The cells as rows of glyphs: a space where nothing is drawn, █ where a cell is one colour, ▀ and ▄ otherwise. */
function preview(words: Uint32Array, columns: number, rows: number): string[] {
  const lines: string[] = []
  for (let r = 0; r < rows; r += 1) {
    let line = ''
    for (let c = 0; c < columns; c += 1) {
      const k = 3 * (r * columns + c)
      const [glyph, fg, bg] = [words[k], words[k + 1], words[k + 2]]
      line += glyph === 0x20 ? (bg === 0x01000000 ? ' ' : '█') : glyph === 0x2580 ? (bg === 0x01000000 ? '▀' : '▞') : '▄'
      void fg
    }
    lines.push(line)
  }
  return lines
}

test('a tall terminal gets the picture as a Raster of half-block cells', ZH, async ($, on) => {
  mock.clock(on, { now: Date.now() })
  on('tool.call', async () => ({ result: 'ok', text: 'ok' }) as never)
  await $.tool.call({ tool: 'Bash', command: 'ssh host ls', description: 'list' } as never)
  const d = await band($, working, tall)
  const s = JSON.stringify(d)
  console.log('TREE ' + s.slice(0, 200))
  const r = raster(d)
  expect(r).not.toBeNull()
  expect(r!.columns).toBe(120)
  expect(r!.rows).toBe(14)
  const bytes = fromBase64(r!.cells)
  expect(bytes.length).toBe(120 * 14 * 12)
  const words = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4)
  const glyphs = new Set<number>()
  const colors = new Set<number>()
  for (let k = 0; k < words.length; k += 3) {
    glyphs.add(words[k])
    colors.add(words[k + 1])
    colors.add(words[k + 2])
  }
  for (const g of glyphs) expect([0x20, 0x2580, 0x2584]).toContain(g)
  for (const c of colors) expect(c === 0x01000000 || (c >= 0 && c <= 0xffffff)).toBe(true)
  // the creature's orange, the laptop's glow and the floor are there
  expect(colors.has(0xd97757)).toBe(true)
  expect(colors.has(0x93c5fd)).toBe(true)
  const lines = preview(words, 120, 14)
  for (const l of lines) console.log('|' + l + '|')
  expect(lines.join('\n')).toContain('▀')
  expect(s).toContain('连服务器')
})

test('a small terminal keeps the one-line animation, and a tall one between turns shows the picture', ZH, async ($, on) => {
  mock.clock(on, { now: Date.now() })
  on('tool.call', async () => ({ result: 'ok', text: 'ok' }) as never)
  await $.tool.call({ tool: 'Bash', command: 'ssh host ls' } as never)
  const d = await band($, working, small)
  expect(raster(d)).toBeNull()
  expect(JSON.stringify(d)).toContain('💻')
  const rest = await band($, idle, tall)
  expect(raster(rest)).not.toBeNull()
  expect(JSON.stringify(rest)).toContain('等你发话')
})

test('terminalArt off keeps the line in a tall terminal', { options: { language: 'zh', terminalArt: 'off' } }, async ($, on) => {
  mock.clock(on, { now: Date.now() })
  on('tool.call', async () => ({ result: 'ok', text: 'ok' }) as never)
  await $.tool.call({ tool: 'Bash', command: 'ssh host ls' } as never)
  const d = await band($, working, tall)
  expect(raster(d)).toBeNull()
  expect(JSON.stringify(d)).toContain('💻')
})

test('terminalArt on draws the picture in a small terminal whose band has the rows', { options: { language: 'zh', terminalArt: 'on' } }, async ($, on) => {
  mock.clock(on, { now: Date.now() })
  on('tool.call', async () => ({ result: 'ok', text: 'ok' }) as never)
  await $.tool.call({ tool: 'Bash', command: 'ssh host ls' } as never)
  expect(raster(await band($, working, small))).not.toBeNull()
  const low = { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 120 } as never
  expect(raster(await band($, low, small))).toBeNull()
  const narrow = { hasSurvey: false, isWorking: true, maxRows: 20, bodyColumns: 60 } as never
  expect(raster(await band($, narrow, small))).toBeNull()
})

test('every scene rasterizes, at several moments', ZH, async ($, on) => {
  const clock = mock.clock(on, { now: Date.now() })
  on('tool.call', async () => ({ result: 'ok', text: 'ok' }) as never)
  const commands = ['ssh host ls', 'scp a b:', 'git push', 'git commit -m x', 'pdflatex x.tex', 'pytest', 'npm install', 'git pull', 'docker ps', 'psql -c 1', 'git status', 'rm -rf build', 'python x.py', 'make']
  for (const command of commands) {
    await clock.advance(700)
    await $.tool.call({ tool: 'Bash', command } as never)
    const r = raster(await band($, working, tall))
    expect(r).not.toBeNull()
    expect(fromBase64(r!.cells).length).toBe(120 * 14 * 12)
  }
})
