// at-work: an animation above the prompt that shows what Claude is doing right now (reading, searching, editing,
// running tests, building, installing, git, databases, containers, servers, the web, planning, thinking), and old
// jokes of computer science on the spinner while Claude thinks. Nothing in it belongs to one project, so it can be
// loaded for every session. On the desktop each activity is a pixel-art scene (an SVG 28 pixels high drawn sixteen
// times as large, animated by SMIL in the surface, so nothing is redrawn per frame): the activity on the stage in the
// middle, the turn's finished calls piled up as crates at the left, Auckland's skyline and one small helper per
// further running call at the right. A failed build sets the creature on fire, another failed call brings a bug, a
// passed test a party, a refused call a barrier, a background job a fishing rod, a compaction the press; between
// turns it drinks coffee by day, sleeps by night and stands in the rain after an API error. On holidays (New Year,
// Spring Festival, Dragon Boat, Matariki, Mid-Autumn, Halloween, Christmas) the wings are decorated, the creature
// wears a hat and the Sky Tower is lit in the day's colours. On the terminal a one-line animation redrawn three
// times a second. It only watches: every tool call passes on unchanged.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Act, Crate, LastTurn } from '../types'

const TICK_MS = 300

const running = atom({ plugin: 'at-work', key: 'running' } as const, [])
const frame = atom({ plugin: 'at-work', key: 'frame' } as const, 0)
const steps = atom({ plugin: 'at-work', key: 'steps' } as const, 0)
const turnStart = atom({ plugin: 'at-work', key: 'turnStart' } as const, 0)
const word = atom({ plugin: 'at-work', key: 'word' } as const, 0)
const last = atom({ plugin: 'at-work', key: 'last' } as const, null)
const flash = atom({ plugin: 'at-work', key: 'flash' } as const, null)
const history = atom({ plugin: 'at-work', key: 'history' } as const, [])
const linger = atom({ plugin: 'at-work', key: 'linger' } as const, null)

// How long the scene of a finished call stays before thinking takes over, in ms.
const LINGER_MS = 2500

// Two frames, drawn by double buffering. A new source reloads the surface's frame, which shows nothing until the
// document is in, so a new scene goes into the frame that is out of sight (a box of no height that clips it, still
// laid out, so it loads), and LOAD_MS later the two frames trade places: neither reloads, the cut is clean. A frame
// gets a new picture only when the scene or the width changes; the crates and helpers catch up then.
type Slot = { key: string; svg: string; alt: string }
const slots: Array<Slot | null> = [null, null]
let front = 0
let pending: string | null = null
const LOAD_MS = 400
const swap = atom({ plugin: 'at-work', key: 'swap' } as const, 0)

// How the desktop draws the picture. 'frame' (isInteractive) is a sandboxed frame, which shows nothing while a new
// source loads, so a cut blinks even double-buffered; 'image' is an image, which keeps the old picture until the new
// one is decoded and plays SMIL all the same, so it never blinks. /at-work image|frame switches.
const mode = atom({ plugin: 'at-work', key: 'mode' } as const, 'image')

// A holiday forced by /at-work holiday <name> to preview its decorations; '' follows the calendar.
const holiday = atom({ plugin: 'at-work', key: 'holiday' } as const, '')

// How long an outcome holds the band even while the next call runs, in ms.
const FLASH_MS: Record<string, number> = { fire: 7000, bug: 4500, party: 4500, fish: 3500, deny: 3500 }

type Lang = 'zh' | 'en'

// The band's language: fixed by the `language` option (zh, en), or, with `auto`, the language of the latest prompt,
// kept in the plugin's store across sessions. English until something says otherwise.
let lang: Lang = 'en'
let langFixed = false

/** The Chinese or the English words, by the band's language. */
function say(zh: string, en: string): string {
  return lang === 'zh' ? zh : en
}

/** A label with its words before a colon: Chinese takes a full-width colon. */
function tag(zh: string, en: string, what: string): string {
  return say(`${zh}：${what}`, `${en}: ${what}`)
}

/** The language a prompt is written in: Chinese when it has Chinese characters, English when it has Latin words. */
function langOf(text: string): Lang | null {
  if (/[\u4e00-\u9fff]/.test(text)) return 'zh'
  if (/[A-Za-z]{2,}/.test(text)) return 'en'
  return null
}

// What Claude might be chewing on while it thinks: old jokes of computer science, in Chinese and English, some with
// the thinking scene that fits them (the rubber duck, the blackboard).
const THINK: Array<[string, string, string?]> = [
  ['试图退出 Vim', 'trying to exit Vim'],
  ['给变量起名字', 'naming a variable'],
  ['让缓存失效', 'invalidating the cache'],
  ['排查差一错误', 'hunting an off-by-one error'],
  ['在我机器上是好的', 'it works on my machine'],
  ['向小黄鸭解释代码', 'explaining the code to the rubber duck', 'duck'],
  ['等编译（xkcd 303）', 'waiting for it to compile (xkcd 303)'],
  ['证明 P ≠ NP', 'proving P ≠ NP', 'board'],
  ['判断这一步会不会停机', 'deciding whether this halts', 'board'],
  ['算 0.1 + 0.2', 'computing 0.1 + 0.2', 'board'],
  ['比较 NaN 和 NaN', 'comparing NaN with NaN', 'board'],
  ['躲开闰秒', 'dodging a leap second', 'board'],
  ['换算时区', 'converting time zones', 'board'],
  ['找十亿美元的空指针', 'chasing the billion-dollar null pointer'],
  ['为理解递归先理解递归', 'understanding recursion by first understanding recursion', 'board'],
  ['纠结 Tab 还是空格', 'tabs or spaces?'],
  ['把 bug 说成 feature', 'calling the bug a feature'],
  ['关机再开机', 'turning it off and on again'],
  ['怀疑是 DNS 的锅', "suspecting it's DNS"],
  ['再加一层间接', 'adding another level of indirection'],
  ['用正则解决问题（现在有两个了）', 'solving it with a regex (now there are two problems)'],
  ['翻 man page', 'reading the man page'],
  ['sudo 做个三明治', 'sudo make me a sandwich'],
  ['排队等锁', 'waiting for the lock'],
  ['复现竞态条件', 'reproducing the race condition'],
  ['复制 Stack Overflow 的答案', 'copying from Stack Overflow'],
  ['读祖传代码', 'reading legacy code'],
  ['注释明天再写', 'writing the comments tomorrow'],
  ['数 99 个小 bug', 'counting 99 little bugs in the code'],
  ['等 2038 年', 'waiting for 2038', 'board'],
  ['把 Hello, World! 写对', 'getting Hello, World! right'],
]

/** The joke of prompt w, in the band's language. */
function joke(w: number): string {
  const [zh, en] = THINK[w % THINK.length]
  return say(zh, en)
}

// ---------------------------------------------------------------------------------------------------------------
// Pixel art: a scene is SVG markup over a grid of STAGE x H pixels, drawn between two wings that fill the band.

const STAGE = 80
const H = 28

/** The picture's width in pixels of the art and the widths of its wings. */
type Layout = { W: number; L: number; R: number }

/**
 * The width of the art that fills the band. The band has a height cap (maxRows, 12 rows on a desktop with 95
 * columns across); a picture taller than the cap is shrunk whole and leaves the sides empty, as 104 x 28 did while
 * 208 x 28 filled. So the art is wide enough that the band's full width, at its proportions, stays within maxRows
 * less two rows for the label (a long one wraps rather than ending in an ellipsis), a row taken as 1.7 columns
 * high. When idle it is flatter still (half as tall as the 104-pixel picture).
 */
function layout(columns: number | undefined, rows: number | undefined, idle: boolean): Layout {
  const cols = columns !== undefined && columns > 0 ? columns : 95
  const room = rows !== undefined && rows > 3 ? rows - 2 : 10
  const base = Math.max(104, Math.min(240, Math.ceil((H * cols) / (room * 1.7))))
  const W = idle ? Math.min(320, Math.max(base, 2 * (cols + 9))) : base
  const L = Math.floor((W - STAGE) / 2)
  return { W, L, R: W - STAGE - L }
}
const C = {
  sky: '#161a2b', star: '#4a5578', starHi: '#8b97c4', floor: '#262c44', floorTop: '#39426a',
  o: '#d97757', ol: '#f2b49b', eye: '#2b1b17', white: '#f5f5f5', paper: '#f7f3e8', paperShade: '#c8bfa9',
  ink: '#374151', math: '#2563eb', red: '#ef4444', green: '#4ade80', amber: '#fbbf24', blue: '#60a5fa',
  steel: '#39404f', steelHi: '#59617a', slot: '#232835', screen: '#0b1020', bezel: '#4b5563', glow: '#93c5fd',
  wood: '#8b5a3c', grass: '#22c55e', grassDark: '#15803d', purple: '#a78bfa', gray: '#9aa3b5', cloud: '#e5e7eb',
}
type Pal = Record<string, string>

function rect(x: number, y: number, w: number, h: number, c: string): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"/>`
}

/** Rows of palette letters ('.' is empty) as runs of rectangles at (x, y). */
function sprite(rows: string[], pal: Pal, x = 0, y = 0): string {
  let out = ''
  rows.forEach((row, j) => {
    let i = 0
    while (i < row.length) {
      const ch = row[i]
      if (!pal[ch]) {
        i += 1
        continue
      }
      let k = i
      while (k < row.length && row[k] === ch) k += 1
      out += rect(x + i, y + j, k - i, 1, pal[ch])
      i = k
    }
  })
  return out
}

/** One part shown at a time, each for dur / parts.length seconds, in a loop. */
function frames(parts: string[], dur: number, begin = 0): string {
  return parts
    .map((p, i) => {
      const values = parts.map((_, j) => (j === i ? '1' : '0')).join(';')
      return `<g opacity="${i === 0 ? 1 : 0}"><animate attributeName="opacity" values="${values}" dur="${dur}s"` +
        ` begin="${-begin}s" calcMode="discrete" repeatCount="indefinite"/>${p}</g>`
    })
    .join('')
}

/** Items that appear one per step and stay, held for `hold` steps before the loop starts again. */
function reveal(items: string[], step: number, hold: number): string {
  const n = items.length + hold
  return items
    .map((it, j) => {
      const values = Array.from({ length: n }, (_, f) => (f > j ? '1' : '0')).join(';')
      return `<g opacity="0"><animate attributeName="opacity" values="${values}" dur="${n * step}s"` +
        ` calcMode="discrete" repeatCount="indefinite"/>${it}</g>`
    })
    .join('')
}

/** Content drawn at the origin, moved through the points one step at a time. */
function path(content: string, pts: Array<[number, number]>, dur: number, begin = 0): string {
  const values = pts.map(([x, y]) => `${x} ${y}`).join(';')
  return `<g transform="translate(${pts[0][0]} ${pts[0][1]})"><animateTransform attributeName="transform"` +
    ` type="translate" values="${values}" dur="${dur}s" begin="${-begin}s" calcMode="discrete"` +
    ` repeatCount="indefinite"/>${content}</g>`
}

function line(x0: number, y0: number, x1: number, y1: number, n: number): Array<[number, number]> {
  return Array.from({ length: n + 1 }, (_, i) => [
    Math.round(x0 + ((x1 - x0) * i) / n),
    Math.round(y0 + ((y1 - y0) * i) / n),
  ])
}

/** The night sky and the floor across the whole picture, wings included. */
/** A rectangle coloured by a class of THEME (the fill is the dark theme's, for a renderer without style sheets). */
function crect(x: number, y: number, w: number, h: number, cls: string, fill: string, opacity = 1): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"` +
    `${opacity < 1 ? ` fill-opacity="${opacity}"` : ''} class="${cls}"/>`
}

// The colours that follow the panel: no sky of its own, so the panel's colour shows through; stars, moon and floor
// in neutral tones for a dark panel, and for a light one no stars and a darker moon.
const THEME = '<style>.st{fill:#55534e}.sh{fill:#a19d94}.mo{fill:#fef3c7}.fl{fill:#808080;fill-opacity:.10}' +
  '.ft{fill:#808080;fill-opacity:.35}@media (prefers-color-scheme: light){.st,.sh{display:none}.mo{fill:#d6a838}' +
  '.fl{fill-opacity:.08}.ft{fill-opacity:.3}}</style>'

/** The stars and the floor across the whole picture, wings included, over the panel's own colour. */
function backdrop(w: number): string {
  let s = ''
  for (let x = 2, i = 0; x < w; x += 5 + ((x * 7) % 5), i += 1) {
    const y = 1 + ((x * 13 + i * 5) % 13)
    s += i % 3 === 0
      ? frames([crect(x, y, 1, 1, 'sh', '#a19d94'), crect(x, y, 1, 1, 'st', '#55534e')], 1.6 + (i % 5) * 0.3, (i % 4) * 0.2)
      : crect(x, y, 1, 1, 'st', '#55534e')
  }
  return s + crect(0, 24, w, 4, 'fl', '#808080', 0.1) + crect(0, 24, w, 1, 'ft', '#808080', 0.35)
}

// The little orange creature: 12 x 10 pixels, its feet on the floor when drawn at y = 14.
const BODY = [
  '..LOOOOOOO..',
  '.OOOOOOOOOO.',
  '.OOOOOOOOOO.',
  '.OOOOOOOOOO.',
  'OOOOOOOOOOOO',
  'OOOOOOOOOOOO',
  '.OOOOOOOOOO.',
  '.OOOOOOOOOO.',
]
const LEGS_A = ['.O.O....O.O.', '.O.O....O.O.']
const LEGS_B = ['..O.O..O.O..', '..O.O..O.O..']
const BODY_PAL: Pal = { O: C.o, L: C.ol }

type Mood = 'awake' | 'walk' | 'asleep' | 'reading' | 'typing' | 'hop' | 'panic'

function critter(x: number, y: number, mood: Mood = 'awake'): string {
  let s = sprite(BODY, BODY_PAL, x, y)
  const legs = (rows: string[]) => sprite(rows, BODY_PAL, x, y + 8)
  s += mood === 'walk' || mood === 'panic' ? frames([legs(LEGS_A), legs(LEGS_B)], mood === 'panic' ? 0.25 : 0.5) : legs(LEGS_A)
  const open = rect(x + 3, y + 2, 1, 2, C.eye) + rect(x + 8, y + 2, 1, 2, C.eye)
  const shut = rect(x + 2, y + 3, 2, 1, C.eye) + rect(x + 8, y + 3, 2, 1, C.eye)
  if (mood === 'asleep') s += shut
  else if (mood === 'panic') {
    // eyes wide, mouth open
    s += rect(x + 2, y + 1, 2, 2, C.white) + rect(x + 3, y + 2, 1, 1, C.eye) + rect(x + 8, y + 1, 2, 2, C.white) +
      rect(x + 8, y + 2, 1, 1, C.eye) + rect(x + 5, y + 4, 2, 2, C.eye)
  } else if (mood === 'reading') {
    s += path(rect(3, 2, 1, 2, C.eye) + rect(8, 2, 1, 2, C.eye), [[x, y], [x + 1, y], [x + 2, y], [x + 1, y]], 2.4)
  } else s += frames([open, open, open, open, open, open, open, shut], 3.2)
  if (mood === 'typing') s += frames([rect(x + 12, y + 4, 2, 1, C.o), rect(x + 12, y + 5, 2, 1, C.o)], 0.3)
  s += hat(x, y)
  return mood === 'hop' ? path(s.replace(/x="(\d+)"/g, (_, v) => `x="${Number(v) - x}"`).replace(/y="(\d+)"/g, (_, v) => `y="${Number(v) - y}"`), [[x, y], [x, y - 2], [x, y - 3], [x, y - 2], [x, y], [x, y]], 0.9) : s
}

const ENVELOPE = sprite(['WWWWWW', 'WOWWOW', 'WWOOWW', 'WWWWWW'], { W: C.white, O: C.o })
const PARCEL = sprite(['BBBBBB', 'BTTTTB', 'BBBBBB', 'BBBBBB'], { B: '#b7794a', T: '#e9c46a' })
const CHECK = sprite(['....G', '...G.', 'G.G..', '.G...'], { G: C.green })
const FILE = sprite(['WWWW..', 'WWWWW.', 'WWWWWW', 'WLLLLW', 'WWWWWW', 'WLLLLW', 'WWWWWW'], { W: C.cloud, L: C.gray })
const CLOUD_ROWS = [
  '......WWWW......',
  '....WWWWWWWW....',
  '..WWWWWWWWWWWW..',
  '.WWWWWWWWWWWWWW.',
  'WWWWWWWWWWWWWWWW',
  'WWWWWWWWWWWWWWWW',
  '.WWWWWWWWWWWWWW.',
]
const CLOUD = sprite(CLOUD_ROWS, { W: C.cloud })
const QMARK = ['.QQQ.', 'Q...Q', '...Q.', '..Q..', '.....', '..Q..']

/** Content drawn at the origin, moved to (x, y). */
function shift(x: number, y: number, content: string): string {
  return `<g transform="translate(${x} ${y})">${content}</g>`
}

function laptop(x: number): string {
  return rect(x, 18, 9, 6, C.bezel) + rect(x + 1, 19, 7, 4, C.glow) + rect(x + 2, 20, 3, 1, C.white) +
    rect(x + 2, 22, 4, 1, C.white) + rect(x - 1, 23, 11, 1, C.gray)
}

function rack(x: number): string {
  let s = rect(x, 5, 12, 19, C.steel) + rect(x, 5, 12, 1, C.steelHi) + rect(x, 5, 1, 19, C.steelHi)
  for (let i = 0; i < 5; i += 1) {
    const y = 7 + i * 3
    s += rect(x + 2, y, 8, 2, C.slot)
    s += frames([rect(x + 3, y, 1, 1, C.green), rect(x + 3, y, 1, 1, C.slot)], 0.4 + i * 0.13, i * 0.1)
    s += frames([rect(x + 5, y, 1, 1, C.amber), rect(x + 5, y, 1, 1, C.slot), rect(x + 5, y, 1, 1, C.slot)], 0.9 + i * 0.2, i * 0.3)
  }
  return s
}

function cable(x0: number, x1: number, y: number): string {
  let s = ''
  for (let x = x0; x <= x1; x += 2) s += rect(x, y, 1, 1, C.star)
  return s
}

function scServer(cargo: string, back: boolean): string {
  let s = critter(3, 14) + laptop(17) + rack(64) + cable(27, 63, 22)
  s += path(cargo, line(27, 11, 57, 11, 30), 1.8)
  if (back) s += path(rect(0, 0, 2, 2, C.green), line(61, 16, 28, 16, 33), 1.8, 0.9)
  return s
}

function scPush(): string {
  let s = critter(3, 14, 'typing') + laptop(18) + sprite(['WWWWWWWWWWWWWWWW'], {}) + CLOUD.replace(/x="(\d+)"/g, (_, v) => `x="${Number(v) + 58}"`).replace(/y="(\d+)"/g, (_, v) => `y="${Number(v) + 3}"`)
  s += path(ENVELOPE, line(28, 16, 60, 6, 16), 1.6)
  s += frames(['', '', '', CHECK.replace(/x="(\d+)"/g, (_, v) => `x="${Number(v) + 74}"`).replace(/y="(\d+)"/g, (_, v) => `y="${Number(v) + 11}"`)], 1.6)
  return s
}

function scCommit(): string {
  let s = critter(6, 14)
  for (let i = 0; i < 4; i += 1) s += rect(40 + i, 20 - i, 16, 4, i % 2 ? C.white : C.paper)
  const stamp = (y: number) => rect(46, y, 8, 3, C.red) + rect(49, y - 4, 2, 4, C.wood) + rect(47, y - 6, 6, 2, C.wood)
  s += frames([stamp(7), stamp(11), stamp(14) + CHECK.replace(/x="(\d+)"/g, (_, v) => `x="${Number(v) + 58}"`).replace(/y="(\d+)"/g, (_, v) => `y="${Number(v) + 12}"`)], 1.2)
  return s
}

function scCompile(): string {
  let s = critter(4, 14)
  s += rect(34, 14, 22, 10, '#cbd5e1') + rect(34, 14, 22, 1, '#e2e8f0') + rect(36, 16, 18, 1, '#475569')
  s += frames([rect(37, 20, 1, 1, C.green), rect(37, 20, 1, 1, '#64748b')], 0.5)
  s += frames([rect(40, 20, 1, 1, C.amber), rect(40, 20, 1, 1, '#64748b')], 0.8, 0.2)
  const gearA = rect(44, 8, 1, 5, C.gray) + rect(42, 10, 5, 1, C.gray)
  const gearB = rect(42, 8, 1, 1, C.gray) + rect(46, 8, 1, 1, C.gray) + rect(43, 9, 3, 3, C.gray) + rect(42, 12, 1, 1, C.gray) + rect(46, 12, 1, 1, C.gray)
  s += frames([gearA, gearB], 0.4)
  const pages = [2, 4, 6, 8, 10, 12].map(n => {
    let p = rect(56, 17, n, 6, C.white)
    for (let k = 0; k + 2 < n; k += 3) p += rect(57 + k, 19, 2, 1, C.ink) + rect(57 + k, 21, 2, 1, C.ink)
    return p
  })
  s += frames(pages, 2.4)
  return s
}

function scTex(): string {
  let s = critter(3, 14) + rect(25, 4, 38, 20, C.paperShade) + rect(24, 3, 38, 20, C.paper)
  const words: Array<[number, number, number, string]> = []
  const plan = [[6, 4, 9, 7], [5, 8, 6], [3, 5, 10, 6], [7, 4, 8], [4, 9, 5, 6]]
  plan.forEach((ws, row) => {
    let x = 27
    ws.forEach((w, k) => {
      const color = (row + k) % 4 === 1 ? C.math : row === 0 && k === 0 ? C.red : C.ink
      words.push([x, 6 + row * 3, w, color])
      x += w + 1
    })
  })
  s += reveal(words.map(([x, y, w, c]) => rect(x, y, w, 1, c)), 0.22, 4)
  const pencil = sprite(['..P', '.YY', '.YY', 'YY.', 'YY.', 'K..'], { P: '#f9a8d4', Y: '#facc15', K: '#1f2937' })
  const pts: Array<[number, number]> = []
  const n = words.length + 4
  for (let f = 0; f < n; f += 1) {
    const [x, y, w] = words[Math.min(Math.max(f - 1, 0), words.length - 1)]
    pts.push(f === 0 ? [words[0][0], words[0][1] - 5] : [x + w, y - 5])
  }
  s += path(pencil, pts, n * 0.22)
  return s
}

function scCode(): string {
  let s = critter(3, 14, 'typing')
  s += rect(20, 3, 40, 17, C.bezel) + rect(21, 4, 38, 14, C.screen) + rect(37, 20, 6, 2, C.bezel) + rect(33, 22, 14, 1, C.gray)
  const colors = ['#c084fc', '#86efac', '#93c5fd', '#fca5a5', '#d1d5db', '#fde68a']
  // Line i of the 8-line loop, drawn on screen row r (7 rows fit); one frame per scroll step, no clipping needed.
  const line = (i: number, r: number): string => {
    const y = 5 + r * 2
    const indent = [0, 2, 4, 4, 2, 4, 6, 0][i]
    return rect(23 + indent, y, 4 + ((i * 7) % 9), 1, colors[i % colors.length]) +
      rect(28 + indent + ((i * 7) % 9), y, 3 + ((i * 5) % 7), 1, colors[(i + 3) % colors.length])
  }
  const pages = Array.from({ length: 8 }, (_, f) => {
    let p = ''
    for (let r = 0; r < 7; r += 1) p += line((f + r) % 8, r)
    return p + rect(23 + [0, 2, 4, 4, 2, 4, 6, 0][(f + 6) % 8] + 18, 17, 1, 1, C.white)
  })
  s += frames(pages, 2.4)
  return s
}

function scRead(): string {
  let s = critter(34, 14, 'reading')
  const book = sprite([
    'CCCCCCCCCCCCCCCC',
    'CPPPPPPCCPPPPPPC',
    'CPLLLLPCCPLLLLPC',
    'CPPPPPPCCPPPPPPC',
    'CPLLLPPCCPLLLLPC',
    'CCCCCCCCCCCCCCCC',
  ], { C: '#7c4a2d', P: '#f5f5f4', L: '#a8a29e' }, 32, 18)
  s += book
  s += frames(['', '', rect(40, 13, 1, 5, C.white), rect(42, 14, 1, 4, C.white), ''], 2.0)
  return s
}

function scSearch(): string {
  let s = critter(3, 14)
  for (const x of [20, 30, 40, 50, 60, 70]) s += FILE.replace(/x="(\d+)"/g, (_, v) => `x="${Number(v) + x}"`).replace(/y="(\d+)"/g, (_, v) => `y="${Number(v) + 16}"`)
  const glass = sprite([
    '..RRRR...',
    '.RLLLLR..',
    'RLLWLLLR.',
    'RLLLLLLR.',
    'RLLLLLLR.',
    '.RLLLLR..',
    '..RRRRH..',
    '......HH.',
    '.......HH',
  ], { R: C.glow, L: '#1e3a5f', W: C.white, H: C.wood })
  s += path(glass, line(17, 11, 69, 11, 26), 3.2)
  return s
}

function scPython(): string {
  let s = critter(64, 14, 'hop')
  const wave = [0, -1, 0, 1]
  const bodies = [0, 1, 2, 3].map(f => {
    let b = ''
    for (let k = 0; k < 12; k += 1) {
      const y = 20 + wave[(k + f) % 4]
      b += rect(2 * k, y, 2, 2, k % 3 === 0 ? C.grassDark : C.grass)
    }
    const hy = 19 + wave[(12 + f) % 4]
    b += rect(24, hy, 4, 3, '#16a34a') + rect(26, hy, 1, 1, '#0b0b0b')
    b += f % 2 === 0 ? rect(28, hy + 2, 2, 1, C.red) : ''
    return b
  })
  s += path(frames(bodies, 0.6), line(-30, 0, 34, 0, 32), 4.8)
  return s
}

function scAgent(): string {
  let s = critter(5, 14, 'walk')
  const robot = sprite([
    '....A.....',
    '....A.....',
    '.BBBBBBBB.',
    '.BEBBBBEB.',
    '.BBBBBBBB.',
    '..BBBBBB..',
    'DDDDDDDDDD',
    '.DDDDDDDD.',
    '.D......D.',
    '.D......D.',
  ], { A: C.gray, B: C.blue, E: C.screen, D: '#3b82f6' }, 60, 14)
  s += robot + frames([rect(64, 13, 1, 1, C.amber), rect(64, 13, 1, 1, C.gray)], 0.6)
  const doc = sprite(['WWW.', 'WLLW', 'WWWW', 'WLLW', 'WWWW'], { W: C.white, L: C.gray })
  const pts: Array<[number, number]> = Array.from({ length: 19 }, (_, i) => [19 + 2 * i, 13 - Math.round(7 * Math.sin((Math.PI * i) / 18))])
  s += path(doc, pts, 1.9)
  return s
}

function scWeb(): string {
  let s = critter(5, 14)
  const globe = [0, 1, 2, 3].map(f => {
    let g = ''
    for (let y = 0; y < 16; y += 1) {
      for (let x = 0; x < 16; x += 1) {
        const inside = (x - 7.5) ** 2 + (y - 7.5) ** 2 <= 60
        if (!inside) continue
        const land = (x + 4 * f + ((y * 5) % 7)) % 9 < 3
        g += rect(32 + x, 4 + y, 1, 1, land ? C.grass : '#3b82f6')
      }
    }
    return g
  })
  s += frames(globe, 2.4)
  const orbit: Array<[number, number]> = Array.from({ length: 16 }, (_, i) => [
    40 + Math.round(13 * Math.cos((2 * Math.PI * i) / 16)), 12 + Math.round(5 * Math.sin((2 * Math.PI * i) / 16)),
  ])
  s += path(rect(0, 0, 2, 1, C.amber), orbit, 2.4)
  return s
}

function scThink(): string {
  let s = critter(26, 14)
  const bubble = sprite([
    '...WWWWWWWW...',
    '.WWWWWWWWWWWW.',
    'WWWWWWWWWWWWWW',
    'WWWWWWWWWWWWWW',
    'WWWWWWWWWWWWWW',
    '.WWWWWWWWWWWW.',
    '...WWWWWWWW...',
  ], { W: C.cloud }, 50, 2)
  const bulb = (lit: boolean) => sprite(['.YYY.', 'YYYYY', 'YYYYY', '.YYY.', '.GGG.'], { Y: lit ? '#fde047' : '#9ca3af', G: C.gray }, 54, 3) +
    (lit ? rect(52, 4, 1, 1, '#fde047') + rect(60, 4, 1, 1, '#fde047') + rect(56, 1, 1, 1, '#fde047') : '')
  const dot1 = rect(40, 12, 2, 2, C.cloud)
  const dot2 = rect(44, 9, 3, 3, C.cloud)
  s += frames([
    '',
    dot1,
    dot1 + dot2,
    dot1 + dot2 + bubble + bulb(false),
    dot1 + dot2 + bubble + bulb(true),
    dot1 + dot2 + bubble + bulb(true),
  ], 3.0)
  return s
}

function scSleep(): string {
  let s = critter(30, 14, 'asleep')
  const z = sprite(['ZZZZ', '..Z.', '.Z..', 'ZZZZ'], { Z: C.glow })
  for (let i = 0; i < 3; i += 1) s += path(z, line(44, 13, 52, 1, 6), 2.4, i * 0.8)
  s += rect(60, 18, 6, 6, C.cloud) + rect(66, 19, 2, 1, C.cloud) + rect(67, 20, 1, 2, C.cloud) + rect(66, 22, 2, 1, C.cloud) + rect(61, 18, 4, 1, '#7c4a2d')
  s += frames([rect(62, 15, 1, 2, C.gray) + rect(63, 13, 1, 2, C.gray), rect(63, 15, 1, 2, C.gray) + rect(62, 13, 1, 2, C.gray)], 1.0)
  return s
}

function scMod(): string {
  let s = critter(6, 14, 'typing')
  s += sprite([
    '....PPPP....',
    '....PPPP....',
    'PPPPPPPPPPPP',
    'PPPPPPPPPPPP',
    'PPPPPPPPPPPPP',
    'PPPPPPPPPPPPPP',
    'PPPPPPPPPPPPP',
    'PPPPPPPPPPPP',
    'PPPPPPPPPPPP',
    'PPPPPPPPPPPP',
  ], { P: C.purple }, 42, 10)
  const spark = (x: number, y: number) => rect(x, y - 1, 1, 3, C.amber) + rect(x - 1, y, 3, 1, C.amber)
  s += frames([spark(40, 7) + spark(58, 12), spark(56, 6) + spark(39, 18), spark(48, 4) + spark(60, 20)], 1.2)
  return s
}

function scShell(): string {
  let s = critter(3, 14, 'typing')
  s += rect(20, 3, 42, 19, C.screen) + rect(20, 3, 42, 2, C.bezel)
  s += rect(22, 3, 1, 1, C.red) + rect(24, 3, 1, 1, C.amber) + rect(26, 3, 1, 1, C.green)
  const cmd: string[] = []
  for (let row = 0; row < 5; row += 1) {
    const y = 7 + row * 3
    cmd.push(rect(22, y, 2, 1, C.green))
    cmd.push(rect(25, y, 5 + ((row * 7) % 11), 1, '#d1d5db'))
    cmd.push(rect(32 + ((row * 7) % 11), y, 4 + ((row * 3) % 6), 1, '#9ca3af'))
  }
  s += reveal(cmd, 0.25, 4)
  return s
}

const FLAME_PAL: Pal = { R: '#ef4444', O: '#f97316', Y: '#fde047' }
const FLAMES = [
  ['...R...', '..RR...', '..ROR.R', '.ROOR.R', 'RROYORR', 'ROYYYOR'],
  ['....R..', '...RR..', 'R..ROR.', 'R.ROOR.', 'RROYORR', 'ROYYYOR'],
  ['...R...', '...RR..', '.RROR..', '.ROOOR.', 'RROYYOR', 'ROYYYOR'],
]

/** A flickering flame, 7 x 6 pixels at (x, y). */
function flame(x: number, y: number, dur = 0.36, begin = 0): string {
  return frames(FLAMES.map(rows => sprite(rows, FLAME_PAL, x, y)), dur, begin)
}

/** One-pixel dots along a straight line. */
function dots(x0: number, y0: number, x1: number, y1: number, n: number, c: string): string {
  return line(x0, y0, x1, y1, n).map(([x, y]) => rect(x, y, 1, 1, c)).join('')
}

// A compile failed: the creature runs to and fro with its head on fire, the printer smokes.
function scFire(): string {
  let s = ''
  for (let i = 0; i < 3; i += 1) {
    s += path(rect(0, 0, 3, 3, '#6b7280') + rect(1, 1, 1, 1, '#9ca3af'), line(52 + 3 * i, 12, 48 + 5 * i, 0, 6), 1.8, i * 0.6)
  }
  s += rect(44, 14, 22, 10, '#94a3b8') + rect(44, 14, 22, 1, '#cbd5e1') + rect(46, 16, 18, 1, '#475569')
  s += frames([rect(47, 20, 2, 2, C.red), rect(47, 20, 2, 2, '#64748b')], 0.4)
  s += rect(66, 18, 9, 5, C.white) + rect(67, 20, 5, 1, C.red) + rect(67, 22, 7, 1, C.ink) + flame(67, 12, 0.3, 0.1)
  const runner = critter(0, 0, 'panic') + flame(2, -6, 0.3) + frames([rect(13, 1, 1, 2, C.glow), rect(14, -1, 1, 2, C.glow), ''], 0.6)
  s += path(runner, [...line(4, 14, 30, 14, 13), ...line(30, 14, 4, 14, 13).slice(1, -1)], 2.6)
  return s
}

const BUG = [
  'K...........',
  '.K..RRRRR...',
  '..KRRKRRRRR.',
  'KKKRRRRRRKRR',
  'KKKRRRKRRRRR',
  '.KKRRRRRRRR.',
]

// Another call failed: a bug crawls in, the creature raises the swatter.
function scBug(): string {
  let s = critter(4, 14)
  s += frames([rect(9, 6, 2, 5, C.red) + rect(9, 12, 2, 1, C.red), ''], 0.8)
  const up = rect(17, 8, 1, 9, C.wood) + rect(15, 3, 5, 5, '#38bdf8') + rect(16, 4, 1, 3, '#0c4a6e') + rect(18, 4, 1, 3, '#0c4a6e')
  const down = rect(17, 17, 9, 1, C.wood) + rect(26, 15, 5, 5, '#38bdf8') + rect(27, 16, 3, 1, '#0c4a6e') + rect(27, 18, 3, 1, '#0c4a6e')
  s += frames([up, up, up, down], 1.2)
  const legsA = sprite(['..K..K...K..'], { K: '#1f2937' }, 0, 6)
  const legsB = sprite(['.K..K...K...'], { K: '#1f2937' }, 0, 6)
  const bug = sprite(BUG, { K: '#1f2937', R: '#dc2626' }) + rect(5, 3, 1, 1, '#1f2937') + rect(9, 4, 1, 1, '#1f2937')
  s += path(bug + frames([legsA, legsB], 0.3), line(70, 17, 30, 17, 20), 4.0)
  s += frames([rect(36, 10, 1, 1, C.red) + rect(48, 7, 1, 1, C.red), rect(40, 8, 1, 1, C.red) + rect(55, 11, 1, 1, C.red), ''], 0.9)
  return s
}

// A check passed or a PDF came out: confetti, a cup, the creature hops.
function scParty(): string {
  let s = critter(34, 14, 'hop')
  s += rect(12, 8, 13, 16, C.paper) + rect(12, 8, 13, 3, C.red) + rect(14, 9, 5, 1, C.white)
  for (let k = 0; k < 4; k += 1) s += rect(14, 13 + 2 * k, 9 - (k % 2) * 3, 1, C.ink)
  s += sprite(['....G', '...G.', 'G.G..', '.G...'], { G: '#16a34a' }, 18, 18)
  s += sprite([
    'YYYYYYYYYY',
    'YYYYYYYYYY',
    '.YYYYYYYY.',
    '..YYYYYY..',
    '...YYYY...',
    '....YY....',
    '....YY....',
    '..YYYYYY..',
    '..BBBBBB..',
  ], { Y: '#fbbf24', B: C.wood }, 58, 15)
  s += rect(56, 16, 2, 1, '#fbbf24') + rect(56, 16, 1, 3, '#fbbf24') + rect(68, 16, 2, 1, '#fbbf24') + rect(69, 16, 1, 3, '#fbbf24')
  s += frames([rect(60, 16, 1, 1, C.white), rect(64, 17, 1, 1, C.white), ''], 0.6)
  const colors = ['#f472b6', '#60a5fa', '#fbbf24', '#4ade80', '#a78bfa', '#f87171']
  for (let i = 0; i < 20; i += 1) {
    const x = 3 + ((i * 37) % 75)
    const c = colors[i % colors.length]
    const dur = 1.6 + ((i * 7) % 5) * 0.25
    s += path(frames([rect(0, 0, 1, 2, c), rect(0, 0, 2, 1, c)], 0.3), line(x, -2, x + ((i % 3) - 1) * 3, 23, 12), dur, (i * 0.37) % dur)
  }
  return s
}

// A job went to the background: the creature fishes off a pier, the bobber bobs, now and then a fish jumps.
function scFish(): string {
  let s = rect(0, 23, STAGE, 5, '#1d3557')
  s += frames([
    rect(36, 24, 3, 1, '#457b9d') + rect(58, 26, 4, 1, '#457b9d') + rect(70, 24, 2, 1, '#457b9d'),
    rect(38, 25, 3, 1, '#457b9d') + rect(55, 24, 4, 1, '#457b9d') + rect(73, 26, 2, 1, '#457b9d'),
  ], 1.2)
  s += frames([rect(66, 24, 4, 1, '#fef3c7') + rect(67, 26, 3, 1, '#fde68a'), rect(67, 24, 3, 1, '#fef3c7') + rect(66, 26, 4, 1, '#fde68a')], 1.6)
  s += rect(0, 19, 30, 2, C.wood) + rect(0, 19, 30, 1, '#a0704f')
  for (const x of [2, 13, 24]) s += rect(x, 21, 2, 7, '#5b3a26')
  s += critter(14, 9)
  s += dots(26, 14, 40, 4, 7, '#d6b98c') + rect(26, 14, 2, 1, C.o)
  const bob = (y: number) => dots(40, 4, 51, y - 1, 8, '#8b97c4') + rect(50, y, 3, 1, C.red) + rect(50, y + 1, 3, 1, C.white)
  s += frames([bob(21), bob(21), bob(22), bob(21)], 1.4)
  s += frames(['', '', rect(48, 23, 1, 1, '#a8dadc') + rect(54, 23, 1, 1, '#a8dadc'), ''], 1.4)
  const fish = sprite(['.SSS.S', 'SESSSS', '.SSS.S'], { S: '#94a3b8', E: C.eye })
  const jump: Array<[number, number]> = [
    ...Array.from({ length: 12 }, (): [number, number] => [62, 30]),
    [62, 24], [63, 21], [65, 19], [67, 18], [69, 19], [71, 21], [72, 24], [72, 30],
  ]
  s += path(fish, jump, 4.0)
  return s
}

// Cleaning up: the creature sweeps, dust and paper balls roll into the bin.
function scSweep(): string {
  let s = ''
  for (let i = 0; i < 4; i += 1) {
    s += path(rect(0, 0, 2, 2, i % 2 ? C.gray : C.white), [...line(32, 22, 60, 22, 8), ...line(62, 20, 66, 15, 3)], 2.0, i * 0.5)
  }
  s += rect(61, 13, 12, 2, '#9ca3af') + rect(62, 15, 10, 9, '#6b7280')
  for (const x of [64, 67, 70]) s += rect(x, 17, 1, 5, '#4b5563')
  const sweeper = critter(0, 0, 'walk') + rect(14, -1, 1, 9, C.wood) + rect(12, 8, 6, 2, '#eab308') + rect(12, 9, 6, 1, '#a16207')
  s += path(sweeper, [...line(6, 14, 20, 14, 7), ...line(20, 14, 6, 14, 7).slice(1, -1)], 2.4)
  s += frames([rect(33, 21, 1, 1, C.gray) + rect(35, 19, 1, 1, C.gray), rect(34, 20, 1, 1, C.gray) + rect(31, 18, 1, 1, C.gray), ''], 0.6)
  return s
}

// Writing a memory: a note flies into a jar of glowing memories.
function scMemo(): string {
  let s = critter(8, 14)
  s += rect(44, 9, 20, 15, '#64748b') + rect(45, 9, 18, 14, '#1b2340') + rect(46, 7, 16, 2, '#64748b') + rect(47, 8, 14, 1, '#1b2340')
  s += rect(66, 22, 10, 2, C.wood) + rect(67, 21, 8, 1, '#a0704f')
  const flies: Array<[number, number]> = [[48, 12], [52, 17], [57, 13], [60, 19], [49, 20], [55, 10], [58, 16], [51, 14], [61, 11], [54, 21]]
  flies.forEach(([x, y], i) => {
    s += frames([rect(x, y, 1, 1, '#fde047'), rect(x, y, 1, 1, '#854d0e'), rect(x, y, 1, 1, '#fef08a')], 1.1 + (i % 4) * 0.35, i * 0.27)
  })
  s += rect(46, 11, 1, 6, '#94a3b8')
  const note = rect(0, 0, 5, 4, C.paper) + rect(1, 1, 3, 1, C.ink) + rect(1, 2, 2, 1, C.math)
  const arc: Array<[number, number]> = Array.from({ length: 14 }, (_, i) => [
    20 + Math.round((32 * i) / 13), 14 - Math.round(12 * Math.sin((Math.PI * i) / 13 * 0.85)),
  ])
  s += path(note, [...arc, [52, 30], [52, 30], [52, 30]], 2.4)
  s += frames(['', '', '', '', '', '', '', '', '', '', '', '', '', '', rect(53, 4, 1, 3, '#fde047') + rect(52, 5, 3, 1, '#fde047'), ''], 2.4)
  return s
}

// Tests run: the test tubes bubble and the checklist fills with ticks, one by one.
function scTest(): string {
  let s = critter(4, 14)
  ;['#4ade80', '#60a5fa', '#f472b6'].forEach((c, i) => {
    const x = 21 + i * 6
    const top = 13 + 2 * i
    s += rect(x, 8, 1, 15, C.gray) + rect(x + 4, 8, 1, 15, C.gray) + rect(x + 1, 22, 3, 1, C.gray) + rect(x + 1, top, 3, 22 - top, c)
    for (let k = 0; k < 2; k += 1) s += path(rect(0, 0, 1, 1, C.white), line(x + 1 + 2 * k, 21, x + 2, top, 4), 1.0 + 0.3 * i, k * 0.5 + i * 0.2)
  })
  s += rect(19, 17, 20, 2, C.wood) + rect(20, 19, 1, 5, C.wood) + rect(37, 19, 1, 5, C.wood)
  s += rect(46, 4, 20, 20, C.wood) + rect(47, 6, 18, 17, C.paper) + rect(53, 3, 6, 3, C.gray)
  const ticks: string[] = []
  for (let k = 0; k < 5; k += 1) {
    const y = 8 + k * 3
    s += rect(49, y, 2, 2, C.paperShade) + rect(53, y + 1, 6 + ((k * 3) % 5), 1, C.ink)
    ticks.push(rect(49, y + 1, 1, 1, C.green) + rect(50, y + 2, 1, 1, C.green) + rect(51, y + 1, 1, 1, C.green) + rect(52, y, 1, 1, C.green))
  }
  s += reveal(ticks, 0.45, 3)
  return s
}

// A build runs: blocks ride the belt into the machine, the hammer bangs, parcels come out onto the stack.
function scBuild(): string {
  let s = critter(3, 14)
  s += rect(18, 21, 52, 2, C.steel) + rect(18, 21, 52, 1, C.steelHi)
  s += frames([0, 1, 2].map(o => {
    let b = ''
    for (let x = 18 + o; x < 70; x += 3) b += rect(x, 22, 1, 1, C.slot)
    return b
  }), 0.45)
  for (const x of [20, 32, 44, 56, 67]) s += rect(x, 23, 2, 1, C.gray)
  ;['#c084fc', '#86efac', '#93c5fd'].forEach((c, i) => {
    s += path(rect(0, 0, 4, 4, c) + rect(1, 1, 2, 1, '#1f2937'), line(18, 17, 40, 17, 11), 2.2, (i * 2.2) / 3)
  })
  for (let i = 0; i < 2; i += 1) s += path(PARCEL, line(50, 17, 64, 17, 7), 1.4, i * 0.7)
  s += shift(70, 20, PARCEL) + shift(70, 16, PARCEL)
  // the machine, drawn over the belt so the blocks go in
  s += rect(36, 9, 14, 12, '#475569') + rect(36, 9, 14, 1, '#64748b') + rect(38, 12, 10, 5, C.slot)
  s += frames([rect(40, 14, 2, 1, C.amber), rect(44, 14, 2, 1, C.green)], 0.5)
  const rod = rect(42, 1, 2, 1, C.gray)
  s += frames([
    rod + rect(42, 2, 2, 1, C.gray) + rect(39, 3, 8, 2, C.steelHi),
    rod + rect(42, 2, 2, 5, C.gray) + rect(39, 7, 8, 2, C.steelHi) + rect(37, 6, 1, 1, C.amber) + rect(48, 5, 1, 1, C.amber),
  ], 0.5)
  return s
}

// Packages arrive: parcels float down on parachutes onto the pile.
function scInstall(): string {
  let s = critter(4, 14)
  const chute = (c: string) =>
    sprite(['..CWCW..', '.CWCWCW.', 'CWCWCWCW', 'S......S', '.S....S.', '..S..S..'], { C: c, W: C.white, S: C.gray }) + shift(1, 6, PARCEL)
  const drops = [{ x: 24, c: '#ef4444', dur: 3.0 }, { x: 38, c: '#3b82f6', dur: 3.4 }, { x: 52, c: '#22c55e', dur: 2.8 }]
  drops.forEach(({ x, c, dur }, i) => {
    const pts: Array<[number, number]> = Array.from({ length: 13 }, (_, k): [number, number] => [
      x + (k % 4 === 1 ? 1 : k % 4 === 3 ? -1 : 0), -10 + 2 * k,
    ])
    s += path(chute(c), [...pts, [x, 14], [x, 14]], dur, i * 0.9)
  })
  s += shift(64, 20, PARCEL) + shift(70, 20, PARCEL) + shift(67, 16, PARCEL)
  s += frames([rect(66, 13, 1, 1, C.amber), rect(73, 14, 1, 1, C.amber), ''], 0.9)
  return s
}

// Downloading: a parcel falls from the cloud into the laptop, the bar on its screen fills.
function scPull(): string {
  let s = critter(4, 14) + laptop(24) + shift(46, 1, CLOUD)
  s += rect(25, 19, 7, 4, C.glow) + rect(26, 21, 5, 1, C.bezel)
  s += frames([1, 2, 3, 4, 5].map(n => rect(26, 21, n, 1, C.green)), 1.6)
  s += path(PARCEL, line(50, 8, 26, 13, 8), 1.6)
  s += frames([rect(53, 9, 1, 2, C.white) + rect(52, 10, 3, 1, C.white), ''], 0.8)
  return s
}

// Git: the history grows, a branch leaves and merges back, a tag goes up.
function scGit(): string {
  let s = critter(3, 14)
  const main = '#60a5fa'
  const side = '#c084fc'
  const dot = (x: number, y: number, c: string) => rect(x - 1, y - 1, 3, 3, c) + rect(x, y, 1, 1, C.white)
  s += reveal([
    dot(22, 12, main),
    rect(24, 12, 7, 1, main) + dot(32, 12, main),
    dots(33, 14, 36, 17, 3, side) + dot(38, 18, side),
    rect(34, 12, 9, 1, main) + dot(44, 12, main),
    rect(40, 18, 9, 1, side) + dot(50, 18, side),
    rect(46, 12, 9, 1, main) + dot(56, 12, main),
    dots(52, 17, 60, 13, 4, side) + rect(58, 12, 3, 1, main) + dot(62, 12, C.amber),
    rect(64, 12, 7, 1, main) + dot(72, 12, main) + rect(72, 4, 1, 6, C.gray) + rect(73, 4, 4, 2, C.red),
  ], 0.4, 4)
  return s
}

// A database: the cylinder hums, rows fly over into the result table.
function scDb(): string {
  let s = critter(3, 14)
  for (let k = 0; k < 3; k += 1) {
    const y = 6 + 6 * k
    s += rect(21, y, 14, 1, '#93c5fd') + rect(20, y + 1, 16, 4, '#2563eb') + rect(21, y + 5, 14, 1, '#1d4ed8')
    s += frames([rect(32, y + 2, 1, 1, C.green), rect(32, y + 2, 1, 1, '#1e3a8a')], 0.5 + 0.2 * k, 0.15 * k)
  }
  s += rect(46, 4, 30, 19, C.paper) + rect(46, 4, 30, 3, C.amber)
  for (const x of [56, 66]) s += rect(x, 4, 1, 19, C.paperShade)
  s += reveal([0, 1, 2, 3, 4].map(k => {
    const y = 8 + 3 * k
    return rect(48, y, 6, 1, C.ink) + rect(58, y, 5 + (k % 3), 1, C.math) + rect(68, y, 4 + ((k * 2) % 4), 1, C.ink)
  }), 0.4, 3)
  s += path(rect(0, 0, 4, 1, '#93c5fd'), line(37, 12, 45, 9, 4), 0.8)
  return s
}

// Containers: the whale swims with its stack of containers and blows a spout; the creature watches from the dock.
function scDocker(): string {
  const whale = sprite([
    '.......BBBBBBBBBBBBBBBB........',
    '....BBBBBBBBBBBBBBBBBBBBB.....T',
    '..BBBBBBBBBBBBBBBBBBBBBBBB..TT.',
    '.BBEBBBBBBBBBBBBBBBBBBBBBBBTT..',
    'BBBBBBBBBBBBBBBBBBBBBBBBBBBBT..',
    'BWWWWWBBBBBBBBBBBBBBBBBBBBB....',
    '.WWWWWWWWWWWWWWWWWWWBBBBB......',
  ], { B: '#2496ed', W: '#bae6fd', E: C.eye, T: '#2496ed' })
  const box = (x: number, y: number, c: string) => rect(x, y, 5, 3, c) + rect(x + 2, y, 1, 3, '#1f2937')
  const load = box(8, -3, '#f97316') + box(13, -3, '#22c55e') + box(18, -3, '#eab308') + box(10, -6, '#ef4444') + box(15, -6, '#a855f7')
  let s = path(whale + load, [[12, 17], [12, 18], [12, 18], [12, 17]], 1.8)
  s += rect(0, 23, STAGE, 5, '#1d3557')
  s += frames([
    rect(4, 24, 3, 1, '#457b9d') + rect(40, 26, 4, 1, '#457b9d') + rect(52, 24, 2, 1, '#457b9d'),
    rect(6, 25, 3, 1, '#457b9d') + rect(43, 24, 4, 1, '#457b9d') + rect(50, 26, 2, 1, '#457b9d'),
  ], 1.2)
  s += frames(['', rect(17, 13, 1, 3, '#bae6fd'), rect(17, 11, 1, 3, '#bae6fd') + rect(15, 10, 1, 1, '#bae6fd') + rect(19, 10, 1, 1, '#bae6fd'), ''], 1.6)
  s += rect(58, 19, 22, 2, C.wood) + rect(58, 19, 22, 1, '#a0704f') + rect(60, 21, 2, 7, '#5b3a26') + rect(75, 21, 2, 7, '#5b3a26')
  s += critter(64, 9)
  return s
}

// Planning: notes move across the board from to-do to doing to done.
function scPlan(): string {
  let s = critter(4, 14) + rect(16, 17, 8, 1, C.wood)
  s += rect(24, 3, 52, 20, '#e2e8f0') + rect(24, 3, 52, 1, '#94a3b8')
  for (const x of [41, 58]) s += rect(x, 4, 1, 19, '#94a3b8')
  s += rect(26, 5, 13, 2, '#9ca3af') + rect(43, 5, 13, 2, C.amber) + rect(60, 5, 14, 2, C.green)
  const note = (c: string) => rect(0, 0, 6, 4, c) + rect(1, 1, 4, 1, '#475569')
  s += shift(27, 9, note('#fde68a')) + shift(33, 9, note('#f9a8d4')) + shift(27, 15, note('#a5f3fc'))
  s += shift(61, 9, note('#bbf7d0')) + shift(67, 9, note('#bbf7d0'))
  const pts: Array<[number, number]> = [[33, 15], [33, 15], [37, 13], [41, 12], [46, 12], [46, 12], [46, 12], [50, 12], [55, 13], [61, 15], [61, 15], [61, 15]]
  s += path(note('#fdba74'), pts, 3.6)
  const mark = rect(62, 17, 1, 1, '#15803d') + rect(63, 18, 1, 1, '#15803d') + rect(64, 17, 1, 1, '#15803d') + rect(65, 16, 1, 1, '#15803d')
  s += frames(pts.map((_, i) => (i >= 9 ? mark : '')), 3.6)
  return s
}

// Waiting for an answer: the creature holds up a question mark.
function scAsk(): string {
  let s = critter(26, 14) + rect(38, 17, 9, 1, C.o)
  const sign = rect(0, 0, 11, 9, C.paper) + rect(0, 8, 11, 1, C.paperShade) + sprite(QMARK, { Q: C.o }, 3, 1) + rect(5, 9, 1, 9, C.wood)
  s += path(sign, [[42, 4], [42, 3], [42, 4], [42, 5]], 1.2)
  s += frames(['', rect(22, 6, 1, 3, C.amber) + rect(22, 10, 1, 1, C.amber), ''], 1.5)
  return s
}

// A call was refused: the creature walks into the barrier and backs off.
function scDeny(): string {
  let s = ''
  for (let k = 0; k < 10; k += 1) s += rect(38 + 3 * k, 13, 3, 2, k % 2 ? C.white : C.red)
  s += rect(40, 15, 2, 9, C.gray) + rect(64, 15, 2, 9, C.gray)
  s += rect(74, 11, 1, 13, C.gray)
  s += sprite(['..RRRRR..', '.RRRRRRR.', 'RRRRRRRRR', 'RWWWWWWWR', 'RWWWWWWWR', 'RRRRRRRRR', '.RRRRRRR.', '..RRRRR..'], { R: C.red, W: C.white }, 70, 3)
  const pts: Array<[number, number]> = [...line(6, 14, 26, 14, 10), [24, 14], [25, 14], [22, 14], [22, 14], [22, 14]]
  s += path(critter(0, 0, 'walk'), pts, 2.8)
  const bang = rect(29, 7, 2, 3, C.amber) + rect(29, 11, 2, 1, C.amber)
  s += frames(pts.map((_, i) => (i >= 11 ? bang : '')), 2.8)
  return s
}

const CUBE = rect(0, 0, 6, 6, '#8b5cf6') + rect(0, 0, 6, 1, '#c4b5fd') + rect(1, 2, 4, 1, '#ddd6fe') + rect(1, 4, 3, 1, '#ddd6fe')

// Compacting the context: the press squeezes a pile of pages into a cube, the cubes go on the stack.
function scCompact(): string {
  let s = critter(3, 14)
  s += rect(18, 2, 2, 22, C.steel) + rect(40, 2, 2, 22, C.steel) + rect(18, 2, 24, 2, C.steelHi)
  const phase = (plate: number, top: number, cube: number) => {
    let p = rect(29, 4, 2, plate - 4, C.gray) + rect(21, plate, 18, 2, C.steelHi)
    if (top > 0) for (let y = top; y < 24; y += 2) p += rect(22, y, 16, 1, C.paper) + rect(22, y + 1, 16, 1, C.paperShade)
    if (cube > 0) p += shift(cube, 18, CUBE)
    return p
  }
  s += frames([phase(5, 10, 0), phase(9, 13, 0), phase(13, 16, 0), phase(17, 20, 0), phase(5, 0, 27), phase(5, 0, 48)], 3.0)
  s += shift(60, 18, CUBE) + shift(66, 18, CUBE) + shift(63, 12, CUBE)
  return s
}

// Thinking aloud: the creature explains the problem to a rubber duck, which now and then has an idea.
function scDuck(): string {
  let s = critter(14, 14) + rect(44, 20, 14, 4, C.wood) + rect(44, 20, 14, 1, '#a0704f')
  const duck = sprite(['...YYY..', '...YEYY.', '.OOYYYY.', '...YYY..', '.YYYYYYY', 'YYYYYYYY', '.YYYYYY.'], { Y: '#facc15', E: C.eye, O: '#f97316' })
  s += path(duck, [[47, 13], [47, 13], [47, 12], [47, 13]], 1.0)
  const talk = (n: number) => rect(28, 6, 12, 6, C.cloud) + rect(27, 11, 2, 1, C.cloud) + rect(26, 12, 1, 1, C.cloud) +
    [0, 1, 2].slice(0, n).map(i => rect(30 + 3 * i, 8, 2, 2, C.ink)).join('')
  const quack = rect(52, 4, 7, 7, C.cloud) + rect(51, 10, 1, 2, C.cloud) + rect(55, 5, 1, 3, C.amber) + rect(55, 9, 1, 1, C.amber)
  s += frames(['', talk(1), talk(2), talk(3), talk(3), quack, quack, ''], 4.0)
  return s
}

// Thinking hard: chalk fills the blackboard, the answer gets a box, a little graph appears beside it.
function scBoard(): string {
  let s = critter(4, 14)
  s += rect(22, 2, 54, 19, C.wood) + rect(23, 3, 52, 17, '#1f3d2b') + rect(22, 21, 54, 1, '#5b3a26') + rect(30, 20, 3, 1, C.white)
  const chalk = '#e5e7eb'
  const items: string[] = []
  const ends: Array<[number, number]> = []
  ;[[5, 1, 7, 2, 4], [3, 6, 1, 5], [8, 2, 4, 6], [4, 1, 3]].forEach((ws, r) => {
    let x = 26
    ws.forEach(w => {
      items.push(rect(x, 5 + r * 3, w, 1, w <= 2 ? '#fde68a' : chalk))
      ends.push([x + w, 5 + r * 3])
      x += w + 2
    })
  })
  const pink = '#fca5a5'
  items.push(rect(44, 13, 14, 1, pink) + rect(44, 17, 14, 1, pink) + rect(44, 13, 1, 5, pink) + rect(57, 13, 1, 5, pink) + rect(47, 15, 8, 1, '#fde68a'))
  ends.push([57, 15])
  items.push(rect(63, 5, 3, 3, chalk) + rect(69, 5, 3, 3, chalk) + rect(66, 11, 3, 3, chalk) + rect(66, 6, 3, 1, chalk) + dots(65, 8, 67, 10, 2, chalk) + dots(70, 8, 68, 10, 2, chalk))
  ends.push([72, 8])
  const step = 0.25
  s += reveal(items, step, 6)
  const n = items.length + 6
  const pts: Array<[number, number]> = Array.from({ length: n }, (_, f) => (f === 0 ? [26, 3] : ends[Math.min(f - 1, ends.length - 1)]))
  s += path(rect(0, 0, 2, 1, C.white) + rect(0, 1, 2, 1, C.o), pts.map(([x, y]): [number, number] => [x, y - 2]), n * step)
  return s
}

// Pacing: the creature walks up and down under a question mark while the clock ticks.
function scPace(): string {
  let s = sprite(['..WWWWW..', '.WWWWWWW.', 'WWWWWWWWW', 'WWWWWWWWW', 'WWWWWWWWW', 'WWWWWWWWW', 'WWWWWWWWW', '.WWWWWWW.', '..WWWWW..'], { W: C.cloud }, 64, 3)
  s += rect(68, 7, 1, 1, C.ink)
  s += frames([rect(68, 4, 1, 3, C.ink), rect(69, 7, 3, 1, C.ink), rect(68, 8, 1, 3, C.ink), rect(65, 7, 3, 1, C.ink)], 4.0)
  const walker = critter(0, 0, 'walk') + sprite(QMARK, { Q: C.amber }, 4, -8)
  s += path(walker, [...line(6, 14, 46, 14, 20), ...line(46, 14, 6, 14, 20).slice(1, -1)], 7.6)
  return s
}

// Between turns by day: a cup of coffee, steam curling up, a pot plant.
function scIdle(): string {
  let s = critter(26, 14)
  s += rect(44, 18, 16, 2, C.wood) + rect(46, 20, 1, 4, C.wood) + rect(57, 20, 1, 4, C.wood)
  s += rect(49, 13, 6, 5, C.white) + rect(55, 14, 2, 1, C.white) + rect(56, 15, 1, 1, C.white) + rect(55, 16, 2, 1, C.white) + rect(50, 13, 4, 1, '#7c4a2d')
  const steam = (o: number) => rect(50 + o, 10, 1, 2, C.gray) + rect(51 - o, 8, 1, 2, C.gray) + rect(52 + o, 6, 1, 2, C.gray)
  s += frames([steam(0), steam(1)], 1.0)
  s += rect(65, 19, 6, 5, '#b45309') + sprite(['.G.G.', 'GGGGG', '.GGG.', '..G..'], { G: C.grass }, 65, 15)
  return s
}

// The last turn ended on an API error: a rain cloud over the creature, now and then lightning.
function scRain(): string {
  let s = critter(29, 14) + sprite(CLOUD_ROWS, { W: '#6b7280' }, 27, 1)
  for (let i = 0; i < 6; i += 1) {
    const x = 28 + 3 * i
    s += path(rect(0, 0, 1, 2, '#60a5fa'), line(x, 8, x, x >= 29 && x <= 40 ? 12 : 21, 3), 0.5 + (i % 3) * 0.1, i * 0.13)
  }
  s += rect(23, 23, 5, 1, '#3b82f6') + rect(42, 23, 6, 1, '#3b82f6')
  s += frames(['', '', '', '', '', sprite(['..Y', '.Y.', 'YYY', '.Y.', 'Y..'], { Y: '#fde047' }, 46, 8), ''], 3.5)
  return s
}

// Drawing a page or a chart: the creature paints at the easel, the picture comes together.
function scPaint(): string {
  let s = critter(6, 14) + sprite(['.PPPP.', 'PRPYPP', 'PPBPGP', '.PPPP.'], { P: '#d6b98c', R: C.red, Y: C.amber, B: C.blue, G: C.green }, 18, 17)
  s += rect(39, 18, 1, 6, C.wood) + rect(58, 18, 1, 6, C.wood) + rect(48, 1, 2, 2, C.wood)
  s += rect(37, 3, 24, 15, C.wood) + rect(38, 4, 22, 13, C.white)
  const items = [
    rect(38, 4, 22, 7, '#bfdbfe'),
    rect(53, 5, 4, 4, '#fbbf24') + rect(52, 6, 1, 2, '#fbbf24') + rect(57, 6, 1, 2, '#fbbf24'),
    rect(38, 11, 22, 6, '#86efac'),
    rect(40, 9, 9, 2, '#4ade80') + rect(42, 8, 5, 1, '#4ade80'),
    rect(47, 9, 6, 5, '#f87171') + rect(48, 8, 4, 1, '#b91c1c') + rect(49, 11, 2, 3, '#7c2d12'),
    rect(55, 9, 3, 3, '#16a34a') + rect(56, 12, 1, 3, '#7c4a2d'),
  ]
  const spots: Array<[number, number]> = [[44, 7], [55, 7], [44, 14], [44, 9], [50, 11], [56, 10]]
  s += reveal(items, 0.5, 4)
  const n = items.length + 4
  const pts: Array<[number, number]> = Array.from({ length: n }, (_, f) => (f === 0 ? [38, 2] : spots[Math.min(f - 1, spots.length - 1)]))
  s += path(sprite(['..B', '.W.', 'W..'], { B: '#ec4899', W: C.wood }), pts.map(([x, y]): [number, number] => [x - 2, y - 1]), n * 0.5)
  return s
}

// Sending a message: a paper plane flies into the mailbox and the flag goes up.
function scMail(): string {
  let s = critter(4, 14)
  s += rect(67, 15, 2, 9, C.wood) + rect(62, 9, 12, 6, C.blue) + rect(63, 8, 10, 1, C.blue) + rect(63, 11, 4, 1, C.screen)
  const pts: Array<[number, number]> = Array.from({ length: 16 }, (_, i): [number, number] => [
    16 + Math.round((41 * i) / 15), 13 - Math.round(5 * Math.sin((Math.PI * i) / 15)) - Math.round((3 * i) / 15),
  ])
  s += path(sprite(['W......', 'WWWW...', '.WWWWWW', 'SSSS...'], { W: C.white, S: '#94a3b8' }), pts, 2.4)
  const down = rect(74, 12, 4, 1, C.gray) + rect(77, 12, 1, 2, C.red)
  const up = rect(74, 7, 1, 6, C.gray) + rect(75, 7, 3, 2, C.red)
  s += frames(pts.map((_, i) => (i >= 14 ? up : down)), 2.4)
  return s
}

// Browsing: the cursor moves over the page and clicks the button, then the picture.
function scBrowse(): string {
  let s = critter(4, 14)
  s += rect(22, 2, 54, 21, C.bezel) + rect(22, 2, 54, 3, '#6b7280') + rect(24, 3, 1, 1, C.red) + rect(26, 3, 1, 1, C.amber) + rect(28, 3, 1, 1, C.green)
  s += rect(32, 3, 30, 1, '#e5e7eb') + rect(23, 5, 52, 17, '#f8fafc')
  s += rect(26, 7, 14, 9, '#93c5fd') + rect(28, 12, 4, 4, '#16a34a') + rect(33, 10, 5, 6, '#22c55e')
  s += rect(43, 7, 20, 2, '#334155') + rect(43, 11, 28, 1, C.gray) + rect(43, 13, 24, 1, C.gray) + rect(43, 15, 26, 1, C.gray)
  s += rect(43, 18, 10, 3, C.o) + rect(26, 18, 14, 1, C.gray)
  const pts: Array<[number, number]> = [[60, 12], [56, 14], [52, 16], [48, 19], [48, 19], [48, 19], [44, 16], [38, 13], [32, 10], [32, 10], [32, 10], [40, 8], [50, 9], [60, 12]]
  const ring = (x: number, y: number) => rect(x - 2, y - 2, 1, 1, C.red) + rect(x + 3, y - 2, 1, 1, C.red) + rect(x - 2, y + 3, 1, 1, C.red) + rect(x + 3, y + 3, 1, 1, C.red)
  s += frames(pts.map((_, i) => (i === 4 ? ring(48, 19) : i === 9 ? ring(32, 10) : '')), 4.2)
  s += path(sprite(['K....', 'KK...', 'KWK..', 'KWWK.', 'KWWWK', 'KWKK.', 'K..K.'], { K: '#111827', W: C.white }), pts, 4.2)
  return s
}

// ---------------------------------------------------------------------------------------------------------------
// Holidays: decorations in the wings, a hat on the creature, the Sky Tower lit in the colours of the day.

/** Spring Festival, Dragon Boat Festival and Mid-Autumn Festival by year, as month-day (lunar dates). */
const LUNAR: Record<number, [string, string, string]> = {
  2026: ['02-17', '06-19', '09-25'], 2027: ['02-06', '06-09', '09-15'], 2028: ['01-26', '05-28', '10-03'],
  2029: ['02-13', '06-16', '09-22'], 2030: ['02-03', '06-05', '09-12'], 2031: ['01-23', '06-24', '10-01'],
  2032: ['02-11', '06-12', '09-19'], 2033: ['01-31', '06-01', '09-08'], 2034: ['02-19', '06-20', '09-27'],
  2035: ['02-08', '06-10', '09-16'],
}

/** The Matariki public holiday of Aotearoa by year. */
const MATARIKI: Record<number, string> = {
  2026: '07-10', 2027: '06-25', 2028: '07-14', 2029: '07-06', 2030: '06-21', 2031: '07-11', 2032: '07-02',
  2033: '06-24', 2034: '07-07', 2035: '06-29',
}

const HOLIDAYS: Record<string, { zh: string; en: string; emoji: string }> = {
  newyear: { zh: '新年', en: 'New Year', emoji: '🎆' },
  spring: { zh: '春节', en: 'Spring Festival', emoji: '🧧' },
  dragon: { zh: '端午', en: 'Dragon Boat Festival', emoji: '🐉' },
  matariki: { zh: 'Matariki', en: 'Matariki', emoji: '✨' },
  moon: { zh: '中秋', en: 'Mid-Autumn Festival', emoji: '🥮' },
  halloween: { zh: '万圣节', en: 'Halloween', emoji: '🎃' },
  christmas: { zh: '圣诞', en: 'Christmas', emoji: '🎄' },
}

/**
 * The holiday of a day, if any: New Year's Eve and Day, Spring Festival from its eve to the Lantern Festival, the
 * Dragon Boat Festival and Matariki with a day or two around them, Mid-Autumn from two days before, the week before
 * Halloween, Christmas from 18 to 26 December. Lunar dates and Matariki are listed up to 2035.
 */
function festival(now: Date): string | null {
  const y = now.getFullYear()
  const today = Date.UTC(y, now.getMonth(), now.getDate())
  const near = (md: string | undefined, before: number, after: number): boolean => {
    if (md === undefined) return false
    const day = Date.UTC(y, Number(md.slice(0, 2)) - 1, Number(md.slice(3)))
    return today >= day - before * 864e5 && today <= day + after * 864e5
  }
  const md = (now.getMonth() + 1) * 100 + now.getDate()
  if (md >= 1231 || md <= 101) return 'newyear'
  const l = LUNAR[y]
  if (l !== undefined && near(l[0], 1, 14)) return 'spring'
  if (l !== undefined && near(l[1], 1, 1)) return 'dragon'
  if (l !== undefined && near(l[2], 2, 1)) return 'moon'
  if (near(MATARIKI[y], 2, 2)) return 'matariki'
  if (md >= 1025 && md <= 1031) return 'halloween'
  if (md >= 1218 && md <= 1226) return 'christmas'
  return null
}

/** The holiday the next picture is drawn for, set just before it is drawn; critter, pile and skyline read it. */
let season: string | null = null

/** The creature's hat on a holiday, over its head when the creature stands at (x, y). */
function hat(x: number, y: number): string {
  switch (season) {
    case 'christmas':
      return rect(x + 2, y - 1, 8, 1, C.white) + rect(x + 3, y - 2, 6, 1, C.red) + rect(x + 4, y - 3, 5, 1, C.red) +
        rect(x + 6, y - 4, 3, 1, C.red) + rect(x + 9, y - 5, 2, 2, C.white)
    case 'halloween':
      return rect(x + 1, y - 1, 10, 1, '#4c1d95') + rect(x + 3, y - 2, 6, 1, '#f97316') + rect(x + 4, y - 3, 4, 1, '#4c1d95') +
        rect(x + 5, y - 4, 3, 1, '#4c1d95') + rect(x + 7, y - 5, 2, 1, '#4c1d95')
    case 'newyear':
      return rect(x + 4, y - 1, 4, 1, '#f472b6') + rect(x + 5, y - 2, 2, 1, '#fbbf24') + rect(x + 5, y - 3, 2, 1, '#f472b6') +
        rect(x + 5, y - 4, 2, 1, '#fde047')
    default:
      return ''
  }
}

const PUMPKIN = (lit: boolean) =>
  sprite(['...G...', '.OOOOO.', 'OOYOYOO', 'OOOOOOO', 'OYOYOYO', '.OOOOO.'], { G: '#16a34a', O: '#f97316', Y: lit ? '#fde047' : '#9a3412' }, 0, 18)
const PRESENT = (c: string, r: string) => sprite(['.R..R.', '..RR..', 'CCRRCC', 'CCRRCC', 'CCRRCC'], { C: c, R: r }, 0, 19)
const MOONCAKE = rect(0, 23, 6, 1, '#e5e7eb') + sprite(['.BBBB.', 'BYBBYB', 'BBYYBB', '.BBBB.'], { B: '#b45309', Y: '#fbbf24' }, 0, 19)
const ZONGZI = sprite(['..G..', '.GGG.', 'GYYYG', 'GGGGG'], { G: '#15803d', Y: '#fde68a' }, 0, 20)

/** A holiday's things on the floor of the left wing, each with its width, set out before the usual trees and houses. */
function floorItems(): Array<[string, number]> {
  switch (season) {
    case 'halloween':
      return [[frames([PUMPKIN(true), PUMPKIN(true), PUMPKIN(false)], 1.5), 7], [frames([PUMPKIN(false), PUMPKIN(true), PUMPKIN(true)], 1.7), 7]]
    case 'christmas':
      return [[PRESENT('#ef4444', '#fde047'), 6], [PRESENT('#3b82f6', '#f8fafc'), 6]]
    case 'moon':
      return [[MOONCAKE, 6]]
    case 'dragon':
      return [[ZONGZI, 5], [ZONGZI, 5]]
    default:
      return []
  }
}

/** A red (or orange) lantern hanging on its string from the top, swaying. */
function lantern(x: number, i: number, c: string): string {
  const len = 1 + (i % 3) * 2
  const body = rect(3, 0, 1, len, '#78350f') +
    sprite(['..GGG..', '.RRRRR.', 'RRYRYRR', 'RRYRYRR', 'RRRRRRR', '.RRRRR.', '..GGG..', '...Y...', '..Y.Y..'], { R: c, G: '#facc15', Y: '#fbbf24' }, 0, len)
  return path(body, [[x, 0], [x + 1, 0], [x, 0], [x - 1, 0]], 2.4 + (i % 3) * 0.4, i * 0.3)
}

/** A rocket going up and bursting at (x, y). */
function firework(x: number, y: number, i: number): string {
  const c = ['#f472b6', '#60a5fa', '#fbbf24', '#4ade80'][i % 4]
  const ring = (r: number, col: string) => {
    const d = Math.round(r * 0.7)
    return [[r, 0], [-r, 0], [0, r], [0, -r], [d, d], [-d, d], [d, -d], [-d, -d]].map(([dx, dy]) => rect(x + dx, y + dy, 1, 1, col)).join('')
  }
  const trail = '#fde68a'
  return frames([
    rect(x, y + 9, 1, 1, trail), rect(x, y + 6, 1, 1, trail), rect(x, y + 3, 1, 1, trail), rect(x, y, 1, 1, C.white),
    ring(2, c), ring(3, c) + ring(1, C.white), ring(4, c), ring(5, '#9ca3af'), '', '',
  ], 2.4 + (i % 3) * 0.3, i * 0.7)
}

/** A bat flapping to and fro between a and b. */
function bats(a: number, b: number, i: number): string {
  if (b - a < 14) return ''
  const K = '#7c3aed'
  const bat = frames([sprite(['K.....K', 'KK.K.KK', '..KKK..'], { K }), sprite(['..KKK..', 'KKKKKKK', 'K.....K'], { K })], 0.3)
  const n = 14
  const pts = Array.from({ length: n }, (_, k): [number, number] => [
    a + Math.round(((b - 7 - a) * k) / (n - 1)), 3 + i * 3 + Math.round(2 * Math.sin(k * 1.3)),
  ])
  return path(bat, [...pts, ...pts.slice(1, -1).reverse()], 5 + i, i * 1.1)
}

/** Fairy lights along the top from a to b, the colours chasing along. */
function garland(a: number, b: number): string {
  if (b - a < 6) return ''
  const colors = ['#ef4444', '#fbbf24', '#22c55e', '#3b82f6']
  const bulbs = (p: number) => {
    let s = ''
    for (let x = a + 1, i = 0; x < b - 1; x += 3, i += 1) s += rect(x, 1 + (i % 2), 1, 1, colors[(i + p) % 4])
    return s
  }
  return rect(a, 0, b - a, 1, '#166534') + frames([bulbs(0), bulbs(1), bulbs(2), bulbs(3)], 2.0)
}

/** The nine stars of Matariki twinkling at (x, y), the brightest with a cross. */
function cluster(x: number, y: number): string {
  const stars: Array<[number, number]> = [[0, 3], [2, 1], [4, 2], [5, 0], [7, 1], [6, 4], [9, 3], [3, 5], [8, 6]]
  return stars
    .map(([dx, dy], i) => frames([rect(x + dx, y + dy, 1, 1, '#facc15'), rect(x + dx, y + dy, 1, 1, '#fef3c7'), rect(x + dx, y + dy, 1, 1, '#f59e0b')], 1.2 + (i % 4) * 0.35, i * 0.21))
    .join('') + rect(x + 5, y - 1, 1, 3, '#fde68a') + rect(x + 4, y, 3, 1, '#fde68a')
}

/** How many columns of crates the left wing of width L holds. */
function crateCols(L: number): number {
  return L < 30 ? Math.max(1, Math.min(3, Math.floor((L - 1) / 5))) : Math.min(6, 3 + Math.floor((L - 30) / 15))
}

/** A holiday's decorations in the sky over both wings, clear of the moon, the crates and the Sky Tower. */
function festoon(lay: Layout): string {
  const { W, L } = lay
  const xr = L + STAGE
  const x0 = L - crateCols(L) * 5
  const left: number[] = []
  for (let x = L >= 14 ? 10 : 2; x + 7 < x0; x += 11) left.push(x)
  const right: number[] = []
  for (let x = xr + 12; x + 7 < W; x += 13) right.push(x)
  const slots = [...left, ...right]
  switch (season) {
    case 'spring': return slots.map((x, i) => lantern(x, i, '#dc2626')).join('')
    case 'moon': return slots.map((x, i) => lantern(x, i, '#f97316')).join('')
    case 'newyear': return slots.map((x, i) => firework(x + 3, 5 + (i % 3) * 2, i)).join('')
    case 'halloween': return bats(1, x0 - 1, 0) + bats(xr + 11, W - 1, 1)
    case 'christmas': return garland(0, x0) + garland(xr + 11, W)
    case 'matariki': return right.length > 0 ? cluster(right[0], 1) : left.length > 0 ? cluster(left[0], 1) : ''
    default: return ''
  }
}

/** The Sky Tower's lit ring in the colours of a holiday (two, alternating). */
const GLOW: Record<string, string[]> = {
  christmas: ['#ef4444', '#22c55e'], newyear: ['#fbbf24', '#f8fafc'], spring: ['#ef4444', '#f87171'],
  halloween: ['#f97316', '#7c3aed'], matariki: ['#a78bfa', '#60a5fa'], dragon: ['#22c55e', '#16a34a'], moon: ['#fde68a', '#fbbf24'],
}

/** A dragon boat, head to the left: rowers, a drum and paddles going. */
const DRAGON_BOAT = (() => {
  const seat = (i: number) => 4 + 2 * i + (i >= 3 ? 2 : 0)
  let b = rect(2, 3, 17, 2, '#dc2626') + rect(3, 5, 15, 1, '#991b1b') + rect(0, 0, 3, 2, '#16a34a') + rect(1, 2, 2, 1, '#16a34a') +
    rect(0, 0, 1, 1, '#fde047') + rect(19, 1, 1, 3, '#16a34a') + rect(10, 1, 2, 2, '#b45309')
  for (let i = 0; i < 6; i += 1) b += rect(seat(i), 2, 1, 1, '#fde68a')
  return b + frames([0, 1].map(p => {
    let o = ''
    for (let i = 0; i < 6; i += 1) o += rect(seat(i) + p, 5, 1, 2, '#a0704f')
    return o
  }), 0.5)
})()

const CRATE: Record<string, string> = {
  server: '#60a5fa', upload: '#60a5fa', push: '#a78bfa', commit: '#a78bfa', compile: '#cbd5e1', tex: '#f7f3e8',
  code: '#f59e0b', mod: '#c084fc', read: '#b7794a', search: '#22d3ee', python: '#4ade80', agent: '#3b82f6',
  web: '#2dd4bf', shell: '#9aa3b5', fish: '#38bdf8', sweep: '#a3a3a3', memo: '#fde047',
  test: '#86efac', build: '#94a3b8', install: '#d97706', pull: '#0ea5e9', git: '#f97316', db: '#1d4ed8',
  docker: '#0891b2', plan: '#facc15', ask: '#f472b6', compact: '#8b5cf6', paint: '#ec4899', mail: '#e5e7eb',
  browse: '#14b8a6',
}

// The decorations of a wide left wing, each with its width: a pohutukawa in bloom, a little house, a street lamp, a bush.
const TREE = sprite([
  '..GGRGG..',
  '.GRGGGRG.',
  'GGGGRGGGG',
  'GRGGGGGRG',
  '.GGGRGGG.',
  '..GGGGG..',
  '....T....',
  '....T....',
  '...TT....',
  '....T....',
], { G: '#166534', R: '#dc2626', T: '#7c4a2d' }, 0, 14)
const HOUSE = sprite([
  '.....RR.....',
  '....RRRR....',
  '...RRRRRR...',
  '..RRRRRRRR..',
  '.RRRRRRRRRR.',
  '.WWWWWWWWWW.',
  '.WYYWWWDDWW.',
  '.WYYWWWDDWW.',
  '.WWWWWWDDWW.',
], { R: '#7c2d12', W: '#475569', Y: '#fde68a', D: '#1e293b' }, 0, 15)
const LAMP = sprite(['YYY', '.L.', '.L.', '.L.', '.L.', '.L.', '.L.', '.L.', '.L.', 'LLL'], { Y: '#fde68a', L: '#64748b' }, 0, 14) +
  '<rect x="-1" y="15" width="5" height="2" fill="#fde68a" opacity="0.25"/>'
const BUSH = sprite(['.GGG.', 'GGGGG', 'GGGGG'], { G: '#15803d' }, 0, 21)
const DECOR: Array<[string, number]> = [[TREE, 9], [HOUSE, 12], [LAMP, 3], [BUSH, 5], [TREE, 9], [LAMP, 3], [BUSH, 5]]

/** Content drawn at the origin, moved to (x, 0). */
function at(x: number, content: string): string {
  return `<g transform="translate(${x} 0)">${content}</g>`
}

/**
 * The left wing, L pixels wide: a crescent moon, the turn's finished calls as crates next to the stage (the newest
 * dropping in), and trees, a house and lamps further out when there is room.
 */
function pile(L: number, crates: Crate[]): string {
  const moon = season === 'moon'
    ? sprite(['..MMM..', '.MMMMM.', 'MMMMMMM', 'MMMMMMM', 'MMMMMMM', '.MMMMM.', '..MMM..'], { M: '#fef3c7' }, 2, 1)
    : sprite(['.MMM.', 'MM...', 'M....', 'MM...', '.MMM.'], { M: '#fef3c7' }, 4, 2)
  let s = L >= 14 ? moon.replace(/<rect /g, '<rect class="mo" ') : ''
  const cols = crateCols(L)
  const x0 = L - cols * 5
  // a holiday's things first, then the trees, houses, lamps and bushes over and over
  const extra = floorItems()
  const pick = (k: number) => (k < extra.length ? extra[k] : DECOR[(k - extra.length) % DECOR.length])
  let x = 1
  for (let k = 0; x + pick(k)[1] < x0 - 1; k += 1) {
    const [item, w] = pick(k)
    s += at(x, item)
    x += w + 2 + (k % 3)
  }
  const shown = crates.slice(-cols * 7)
  shown.forEach((c, i) => {
    const x = x0 + (i % cols) * 5
    const y = 21 - Math.floor(i / cols) * 3
    let box = rect(x, y, 4, 3, c.ok ? CRATE[c.kind] ?? C.gray : C.red) + `<rect x="${x}" y="${y + 2}" width="4" height="1" fill="#000" opacity="0.3"/>`
    if (!c.ok) box += rect(x + 1, y, 1, 1, C.eye) + rect(x + 2, y + 1, 1, 1, C.eye) + rect(x + 1, y + 2, 1, 1, C.eye)
    s += i === shown.length - 1
      ? `<g><animateTransform attributeName="transform" type="translate" values="0 -24;0 -16;0 -8;0 0" dur="0.3s"` +
        ` calcMode="discrete" fill="freeze"/>${box}</g>`
      : box
  })
  return s
}

/**
 * The right wing, R pixels wide from x0: Auckland's city centre with the Sky Tower, windows lit and blinking; when
 * there is room, the harbour beyond it with sailboats and Rangitoto on the horizon.
 */
function skyline(x0: number, R: number): string {
  const bld = '#262d48'
  const win = '#fde68a'
  const dim = '#3a4266'
  let s = ''
  const cbd = Math.min(R, 30)
  const blocks: Array<[number, number, number]> = [[0, 15, 3], [3, 18, 3], [10, 13, 3], [13, 17, 3]]
  for (let dx = 16, k = 0; dx + 2 <= cbd; k += 1) {
    const w = 2 + (k % 3)
    blocks.push([dx, 12 + ((k * 5) % 8), Math.min(w, cbd - dx)])
    dx += w + (k % 2)
  }
  for (const [dx, top, w] of blocks) {
    if (dx + w > R) continue
    s += rect(x0 + dx, top, w, 24 - top, bld)
    for (let y = top + 1; y < 23; y += 2) {
      for (let x = 0; x < w; x += 2) {
        const lit = (dx * 7 + y * 3 + x * 5) % 5
        if (lit === 0) s += rect(x0 + dx + x, y, 1, 1, win)
        else if (lit === 1) s += frames([rect(x0 + dx + x, y, 1, 1, win), rect(x0 + dx + x, y, 1, 1, dim)], 2 + (y % 5) * 0.7, x * 0.3)
      }
    }
  }
  if (R > cbd + 4) {
    const hx = x0 + cbd
    const hw = R - cbd
    if (hw >= 26) {
      // Rangitoto: a low, wide cone on the horizon
      const rx = hx + hw - 24
      for (let j = 0; j < 5; j += 1) s += rect(rx + 8 - 2 * j, 19 + j, 8 + 4 * j, 1, '#1f3447')
      s += rect(rx + 10, 18, 4, 1, '#1f3447')
    }
    s += rect(hx, 24, hw, 4, '#1d3557')
    for (let x = hx + 3; x < hx + hw - 3; x += 7) {
      s += frames([rect(x, 25 + (x % 2), 3, 1, '#457b9d'), rect(x + 1, 26 - (x % 2), 3, 1, '#457b9d')], 1.4 + (x % 3) * 0.3)
    }
    for (let x = hx + 6; x + 6 < hx + hw; x += 18) {
      const boat = sprite(['..W...', '..WW..', '..WWW.', '..WWWW', 'HHHHHH', '.HHHH.'], { W: '#e5e7eb', H: '#7c4a2d' })
      s += path(boat, [[x, 18], [x, 19], [x, 19], [x, 18]], 2.2 + (x % 4) * 0.2)
    }
    // the Dragon Boat Festival: a dragon boat races across the harbour, in from the right edge
    if (season === 'dragon' && hw >= 22) s += path(DRAGON_BOAT, line(hx + hw - 1, 20, hx + 1, 20, 24), 9.6)
  }
  const t = x0 + Math.min(7, Math.max(2, R - 5))
  s += rect(t - 1, 21, 4, 3, '#7c849c') + rect(t, 9, 2, 15, '#9aa3b5') + rect(t - 1, 6, 4, 1, '#9aa3b5')
  const glow = GLOW[season ?? '']
  s += rect(t - 2, 7, 6, 1, '#b8c0d4') + (glow ? frames(glow.map(c => rect(t - 2, 8, 6, 1, c)), 1.6) : rect(t - 2, 8, 6, 1, win))
  s += rect(t - 1, 9, 4, 1, '#9aa3b5')
  s += rect(t, 3, 2, 3, '#9aa3b5') + rect(t + 1, 0, 1, 3, '#cbd5e1')
  s += frames([rect(t + 1, 0, 1, 1, C.red), rect(t + 1, 0, 1, 1, '#7f1d1d')], 1.2)
  // New Year: fireworks off the Sky Tower, as Auckland does at midnight
  if (season === 'newyear') s += firework(t + 1, 6, 5) + firework(t + 1, 5, 2)
  return s
}

const MINI = ['.OOOO.', 'OEOOEO', 'OOOOOO', '.OOOO.', '.O..O.']

/** Small helpers in front of the skyline, one per further running call, each carrying a crate of its kind. */
function helpers(kinds: string[], x0: number): string {
  return kinds
    .slice(0, 3)
    .map((k, i) => {
      const body = sprite(MINI, { O: C.o, E: C.eye }) + rect(1, -2, 4, 2, CRATE[k] ?? C.gray)
      const a = x0 + 1 + i * 3
      const b = x0 + 9 + i * 2
      return path(body, [...line(a, 19, b, 19, 4), ...line(b, 19, a, 19, 4).slice(1, -1)], 1.6 + i * 0.3, i * 0.4)
    })
    .join('')
}

const SCENES: Record<string, () => string> = {
  fire: scFire,
  bug: scBug,
  party: scParty,
  fish: scFish,
  sweep: scSweep,
  memo: scMemo,
  server: () => scServer(ENVELOPE, true),
  upload: () => scServer(PARCEL, false),
  push: scPush,
  commit: scCommit,
  compile: scCompile,
  tex: scTex,
  code: scCode,
  read: scRead,
  search: scSearch,
  python: scPython,
  agent: scAgent,
  web: scWeb,
  mod: scMod,
  shell: scShell,
  test: scTest,
  build: scBuild,
  install: scInstall,
  pull: scPull,
  git: scGit,
  db: scDb,
  docker: scDocker,
  plan: scPlan,
  ask: scAsk,
  deny: scDeny,
  compact: scCompact,
  paint: scPaint,
  mail: scMail,
  browse: scBrowse,
  think: scThink,
  duck: scDuck,
  board: scBoard,
  pace: scPace,
  sleep: scSleep,
  idle: scIdle,
  rain: scRain,
}

/** The thinking scene of a turn, matched to its joke: the duck for the duck, the blackboard for theory. */
function thinker(w: number): string {
  return THINK[w % THINK.length][2] ?? ['think', 'pace', 'duck'][w % 3]
}

/** The scene and words between turns: how the last turn ended, coffee by day, sleep by night. */
function rest(done: LastTurn | null, hour: number): { kind: string; label: string } {
  const calm = hour >= 22 || hour < 7 ? 'sleep' : 'idle'
  if (done === null) return { kind: calm, label: say('等你发话', 'Waiting for you') }
  const did = say(`${done.steps} 步，用了 ${mmss(done.seconds)}`, `${done.steps} steps in ${mmss(done.seconds)}`)
  const wait = say('，等你发话', '; waiting for you')
  if (done.reason === 'error') {
    const why = done.error ? say(`（${done.error}）`, ` (${done.error})`) : ''
    return { kind: 'rain', label: tag(`上一轮出错停了${why}`, `Last turn stopped on an error${why}`, did) + wait }
  }
  if (done.reason === 'refusal') return { kind: 'rain', label: tag('上一轮被拒答了', 'Last turn ended in a refusal', did) + wait }
  if (done.reason === 'aborted') return { kind: calm, label: tag('上一轮被你叫停了', 'You stopped the last turn', did) + wait }
  return { kind: calm, label: say(`上一轮 ${did}`, `Last turn: ${did}`) + wait }
}

/**
 * The SVG document: the scene on the stage (clipped to it), the crates at the left, the skyline and helpers at the
 * right. Its own size is 16 times the art, more than any band is wide, so the surface shrinks it to the band's width
 * and keeps its proportions: the picture fills the band exactly.
 */
function picture(kind: string, lay: Layout, crates: Crate[] = [], others: string[] = []): string {
  const { W, L, R } = lay
  const stage = `<defs><clipPath id="stage"><rect x="0" y="0" width="${STAGE}" height="${H}"/></clipPath></defs>` +
    `<g transform="translate(${L} 0)"><g clip-path="url(#stage)">${(SCENES[kind] ?? scThink)()}</g></g>`
  const body = backdrop(W) + pile(L, crates) + skyline(L + STAGE, R) + festoon(lay) + stage + helpers(others, L + STAGE)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W * 16}" height="${H * 16}"` +
    ` shape-rendering="crispEdges" style="background:transparent;color-scheme:light dark">${THEME}${body}</svg>`
}

// ---------------------------------------------------------------------------------------------------------------
// The one-line animation of the terminal.

function track(f: number, left: string, dot: string, right: string, n = 8): string {
  const pos = f % n
  return `${left} ${'·'.repeat(pos)}${dot}${'·'.repeat(n - 1 - pos)} ${right}`
}

function typing(f: number, text: string): string {
  const letters = Array.from(text)
  const k = f % (letters.length + 4)
  return letters.slice(0, Math.min(k, letters.length)).join('') + (f % 2 === 0 ? '▌' : ' ')
}

function scene(kind: string, f: number): string {
  switch (kind) {
    case 'server': return track(f, '💻', '✉', '🗄')
    case 'upload': return track(f, '💻', '📦', '🗄')
    case 'push': return track(f, '📝', '📨', '☁')
    case 'commit': return ['📝 ✓', '📝 ✓✓', '📝 ✓✓✓'][f % 3]
    case 'compile': {
      const k = Math.min(f % 7, 5)
      return `📄 ${'▰'.repeat(k)}${'▱'.repeat(5 - k)} 📕`
    }
    case 'tex': return `✍ ${typing(f, 'X → Y ⊆ XY⁺')}`
    case 'code': return `🔧 ${['◐', '◓', '◑', '◒'][f % 4]} ${typing(f, 'def poll($):')}`
    case 'read': return `📖 ${['(·_· )', '( ·_·)'][Math.floor(f / 2) % 2]}`
    case 'search': return track(f, '', '🔍', '', 9)
    case 'python': {
      const wave = '∿∿∿∿∿∿∿∿'
      const k = f % wave.length
      return `${wave.slice(k)}${wave.slice(0, k)}🐍`
    }
    case 'agent': return ['🧑‍💻 → 🤖', '🧑‍💻 ⇢ 🤖', '🧑‍💻 ⇒ 🤖'][f % 3]
    case 'web': return ['🌍', '🌎', '🌏'][f % 3]
    case 'mod': return ['🧩', '🧩✨', '🧩✨✨'][f % 3]
    case 'shell': return `⌨ $ ${f % 2 === 0 ? '▌' : ' '}`
    case 'fire': return ['🔥(°□°)🔥', ' 🔥(°□°)🔥', '🔥 (°□°) 🔥'][f % 3]
    case 'bug': return track(f, '(ง •̀_•́)ง', '🐛', '', 8)
    case 'party': return ['🎉 ✓', '🎊 ✓', '🎉 ✓✓'][f % 3]
    case 'fish': return `🎣 ${['～～○～', '～～◎～', '～～○～', '～～·～'][f % 4]}`
    case 'sweep': return track(f, '🧹', '·', '🗑', 6)
    case 'memo': return ['📝 → 🫙', '📝 ⇢ 🫙', '📝 ⇒ 🫙✨'][f % 3]
    case 'test': return `🧪 ${'✓'.repeat(f % 5)}${'·'.repeat(4 - (f % 5))}`
    case 'build': return track(f, '🧱', '▸', '📦', 6)
    case 'install': return `${' '.repeat(f % 4)}🪂📦`
    case 'pull': return track(f, '☁', '📦', '💻')
    case 'git': return ['●', '●─●', '●─●─●', '●─●─●─●'][f % 4]
    case 'db': return track(f, '🛢', '▤', '📋', 6)
    case 'docker': return `${['～', '～～', '～～～'][f % 3]}🐳📦`
    case 'plan': return ['📋 ☐☐☐', '📋 ☑☐☐', '📋 ☑☑☐', '📋 ☑☑☑'][f % 4]
    case 'ask': return ['(•_•)?', '(•_•)??', '(•o•)?'][f % 3]
    case 'deny': return ['🚧 (•_•)', '🚧(•_•) ', '🚧 (>_<)'][f % 3]
    case 'compact': return `📚 ${['▓▓▓▓', '▓▓▓', '▓▓', '■'][f % 4]}`
    case 'paint': return ['🎨 ·', '🎨 ··', '🎨 ···🖼'][f % 3]
    case 'mail': return track(f, '(•‿•)', '✈', '📮')
    case 'browse': return `🖱 ${['↖', '↗', '↘', '↙'][f % 4]} 🌐`
    case 'duck': return ['(•‿•) 💬 🦆', '(•‿•) 💬💬 🦆', '(•‿•)    🦆❗'][Math.floor(f / 2) % 3]
    case 'board': return `🧑‍🏫 ${typing(f, 'P ≟ NP ∎')}`
    default: return ['(•‿•)', '(•‿•) ﹒', '(•‿•) ﹒o', '(•‿•) ﹒oO', '(•‿•) ﹒oO 💭'][Math.floor(f / 2) % 5]
  }
}

// ---------------------------------------------------------------------------------------------------------------

function base(p: unknown): string {
  return String(p ?? '').split(/[\\/]/).pop() ?? ''
}

// The label row wraps onto a second row (see layout), so a cut is only a guard against a runaway argument.
function short(text: unknown, n = 100): string {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim()
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

// A shell command by what it does, the first rule that matches wins: the pattern, the scene, the words. A program
// counts where a command starts or after a space or separator, so `notes.py` or `.git/` alone do not count.
const COMMANDS: Array<[RegExp, string, [string, string]]> = [
  [/(^|[\s;&|(])(pytest|jest|vitest|mocha|phpunit|rspec|ctest|tox|nox)(\s|$)|\b(cargo|go|dotnet|deno|bun|swift|mix|npm|pnpm|yarn)( run)? test\b|\bmake (test|check)\b|\bplugin test\b|-m (pytest|unittest)\b|\b(mvn|gradle)\b[^|;&]*\btest\b/, 'test', ['跑测试', 'running tests']],
  [/\b(npm|pnpm|yarn|bun) (install|i|add|ci)\b|\bpip3? install\b|\buv (add|sync|pip install)\b|\bpoetry (add|install)\b|\bcargo (add|install)\b|\bgo (get|install)\b|\b(brew|apt|apt-get|winget|choco|scoop|conda|mamba|dnf|yum|pacman|gem) install\b|\bInstall-Module\b/, 'install', ['装依赖', 'installing packages']],
  [/(^|[\s;&|(])(scp|rsync|sftp)\s/, 'upload', ['传文件', 'copying files over']],
  [/(^|[\s;&|(])ssh\s/, 'server', ['连服务器', 'on the server']],
  [/(^|[\s;&|(])git\s[^|;&]*\bpush\b/, 'push', ['推送', 'pushing']],
  [/(^|[\s;&|(])git\s[^|;&]*\bcommit\b/, 'commit', ['提交', 'committing']],
  [/(^|[\s;&|(])git\s[^|;&]*\b(pull|fetch|clone)\b/, 'pull', ['拉取', 'pulling']],
  [/(^|[\s;&|(])(curl|wget|Invoke-WebRequest|iwr)\s/, 'pull', ['下载', 'downloading']],
  [/(^|[\s;&|(])(docker|podman|kubectl|helm|minikube)\s/, 'docker', ['搬集装箱', 'moving containers']],
  [/(^|[\s;&|(])(psql|pg_dump|pg_restore|pg_ctl|sqlite3|mysql|duckdb|mongosh|redis-cli)(\s|$)/, 'db', ['查数据库', 'querying the database']],
  [/(^|[\s;&|(])(pdflatex|xelatex|lualatex|latexmk|bibtex|biber|tectonic)(\s|$)/, 'compile', ['编译 LaTeX', 'compiling LaTeX']],
  [/(^|[\s;&|(])(make|cmake|ninja|gcc|g\+\+|clang|rustc|javac|tsc|msbuild|mvn|gradle)(\s|$)|\b(cargo|go|dotnet|swift|zig) build\b|\b(npm|pnpm|yarn|bun)( run)? build\b/, 'build', ['构建', 'building']],
  [/(^|[\s;&|(])git\s/, 'git', ['摆弄 Git', 'Git']],
  [/(^|[\s;&|(])(python3?|py|uv run|jupyter)(\s|$)/, 'python', ['跑 Python', 'running Python']],
  [/(^|[\s;&|(])(rm|rmdir|Remove-Item|del)\s|\bDROP (TABLE|DATABASE)\b|\bTRUNCATE\b/, 'sweep', ['打扫', 'cleaning up']],
]

/** The scene and the words of a tool call. */
function classify(e: { tool: string; [argument: string]: unknown }): { kind: string; label: string } {
  const t = e.tool
  if (t === 'Bash' || t === 'PowerShell') {
    const c = String(e.command ?? '')
    // a description says it in a few words; a bare command is code, and only its start reads
    const what = e.description ? short(e.description) : short(c, 60)
    if (e.run_in_background === true) return { kind: 'fish', label: tag('放下鱼竿等结果', 'rod out, waiting', what) }
    const rule = COMMANDS.find(([re]) => re.test(c))
    return rule ? { kind: rule[1], label: tag(rule[2][0], rule[2][1], what) } : { kind: 'shell', label: what }
  }
  if (t === 'Read') {
    const f = base(e.file_path)
    return { kind: 'read', label: /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(f) ? say(`看图 ${f}`, `looking at ${f}`) : say(`读 ${f}`, `reading ${f}`) }
  }
  if (t === 'Grep' || t === 'Glob') return { kind: 'search', label: say(`找 ${short(e.pattern, 60)}`, `searching ${short(e.pattern, 60)}`) }
  if (t === 'ToolSearch') return { kind: 'search', label: say('找工具', 'looking for a tool') }
  if (t === 'Monitor') return { kind: 'fish', label: tag('盯着浮漂', 'watching the float', short(e.description ?? e.command)) }
  if (t === 'ScheduleWakeup') return { kind: 'fish', label: say('定个闹钟，过会儿回来收线', 'alarm set, back later to reel in') }
  if (t === 'TaskOutput') return { kind: 'fish', label: say('看看鱼上钩没', 'checking for a bite') }
  if (t === 'TaskStop' || t === 'KillShell') return { kind: 'sweep', label: say('收掉后台任务', 'stopping a background task') }
  if (t === 'Edit' || t === 'Write' || t === 'NotebookEdit') {
    const p = String(e.file_path ?? e.notebook_path ?? '')
    const f = base(p)
    if (/[\\/]memory[\\/]/.test(p)) return { kind: 'memo', label: say(`记进小本本 ${f}`, `noting it down in ${f}`) }
    if (/[\\/]\.claude[\\/](dev-mods|plugins)[\\/]/.test(p)) return { kind: 'mod', label: say(`捏插件 ${f}`, `tinkering with a plugin: ${f}`) }
    if (/[\\/]\.claude[\\/]skills[\\/]/.test(p)) return { kind: 'mod', label: say(`磨技能书 ${f}`, `polishing a skill: ${f}`) }
    if (/\.(tex|bib|sty|cls)$/.test(f)) return { kind: 'tex', label: say(`写论文 ${f}`, `writing the paper ${f}`) }
    if (/\.(md|markdown|txt|rst|adoc|org)$/i.test(f)) return { kind: 'tex', label: say(`写文档 ${f}`, `writing ${f}`) }
    return { kind: 'code', label: say(`改 ${f}`, `editing ${f}`) }
  }
  if (t === 'Agent' || t === 'Task') return { kind: 'agent', label: tag('派小助手', 'sending a helper', short(e.description)) }
  if (t === 'Workflow') return { kind: 'agent', label: say('派出一队小助手', 'sending out a team of helpers') }
  if (t === 'TodoWrite' || t === 'EnterPlanMode' || t === 'ExitPlanMode' || /^Task(Create|Update|List|Get)$/.test(t)) {
    return { kind: 'plan', label: say('排计划', 'planning') }
  }
  if (t === 'AskUserQuestion') return { kind: 'ask', label: say('等你回答', 'waiting for your answer') }
  if (t === 'Artifact' || /show_widget$/.test(t)) return { kind: 'paint', label: say('画页面', 'drawing a page') }
  if (t === 'SendMessage' || t === 'PushNotification' || /__(send_message|reply|forward|create_draft|update_draft)$/.test(t)) {
    return { kind: 'mail', label: say('送信', 'sending a message') }
  }
  if (/Claude_Browser|claude-in-chrome/.test(t)) return { kind: 'browse', label: say('逛网页', 'browsing') }
  if (t === 'WebFetch' || t === 'WebSearch') return { kind: 'web', label: say('上网查查', 'looking it up online') }
  if (t === 'Skill') return { kind: 'mod', label: tag('翻技能书', 'opening the skill book', short(e.skill, 60)) }
  if (/^Cron|__(create_event|update_event|list_events|suggest_time)$|scheduled_task$/.test(t)) return { kind: 'plan', label: say('排日程', 'scheduling') }
  if (t.startsWith('mcp__')) return { kind: 'web', label: say(`用 ${t.split('__').pop()}`, `using ${t.split('__').pop()}`) }
  return { kind: 'shell', label: t }
}

const COMPILE_FAIL = /^! |Emergency stop|LaTeX Error|Fatal error occurred|Undefined control sequence|no output PDF file produced/m
const PASSED = /Validation passed|\bPASS(ED)?\b|All \d* ?tests? passed|\b0 failed\b/

type Outcome = { ok: boolean; show: { kind: string; label: string } | null }

/** How a call ended, as a crate (fine or broken) and the scene it brings, if any. */
function outcome(kind: string, label: string, r: { isError?: boolean; text?: string; deny?: string } | undefined): Outcome {
  if (r === undefined) return { ok: false, show: null }
  if (r.deny !== undefined) return { ok: false, show: { kind: 'deny', label: tag('被拦下了', 'blocked', label) } }
  const text = r.text ?? ''
  const failed = r.isError === true || /^Exit code [1-9]/.test(text)
  const what = label.replace(/^[^：:]*[：:]\s*/, '')
  if (kind === 'compile') {
    if (failed || COMPILE_FAIL.test(text)) return { ok: false, show: { kind: 'fire', label: say(`编译失败，着火了！${what}`, `compile failed, it's on fire! ${what}`) } }
    if (/Output written on/.test(text)) return { ok: true, show: { kind: 'party', label: say('PDF 出炉了', 'the PDF is out') } }
    return { ok: true, show: null }
  }
  if (kind === 'build') {
    if (failed) return { ok: false, show: { kind: 'fire', label: say(`构建失败，着火了！${what}`, `build failed, it's on fire! ${what}`) } }
    return { ok: true, show: { kind: 'party', label: tag('构建好了', 'built', what) } }
  }
  if (kind === 'test') {
    if (failed) return { ok: false, show: { kind: 'bug', label: tag('测试挂了，抓虫', 'tests failed, bug hunt', what) } }
    return { ok: true, show: { kind: 'party', label: tag('测试通过', 'tests passed', what) } }
  }
  if (failed) return { ok: false, show: { kind: 'bug', label: tag('出错了，抓虫', 'something broke, bug hunt', label) } }
  if ((kind === 'shell' || kind === 'python') && PASSED.test(text)) return { ok: true, show: { kind: 'party', label: tag('通过了', 'passed', label) } }
  if (kind === 'fish') return { ok: true, show: { kind: 'fish', label } }
  return { ok: true, show: null }
}

// When the last tool call started, in ms: an outcome that a later call has passed by does not come back.
let lastStart = 0

/**
 * Shows a scene for at least FLASH_MS of its kind; after that a running call takes the band back, and so does
 * thinking once another call has started in the meantime (else its outcome would return after that call's scene).
 */
async function show($: EngineInterface, f: { kind: string; label: string }): Promise<void> {
  const ms = FLASH_MS[f.kind] ?? 4000
  const setAt = Date.now()
  const until = setAt + ms
  await update($, flash, () => ({ ...f, until }))
  $.clock.after(ms + 50, () => {
    void (async () => {
      const list = await read($, running)
      if (list.length > 0 || lastStart > setAt) await update($, flash, x => (x !== null && x.until === until ? null : x))
    })()
  })
}

/** Brings the hidden frame to the front once its picture had LOAD_MS to load, unless the band wants another by then. */
function flip($: EngineInterface, key: string): void {
  try {
    $.clock.after(LOAD_MS, () => {
      if (pending !== key) return
      if (slots[1 - front]?.key === key) front = 1 - front
      pending = null
      void update($, swap, n => n + 1)
    })
  } catch {
    // no timer while drawing: cut at once, with the blink of a fresh frame
    front = 1 - front
    pending = null
  }
}

/** Keeps the scene of a call that just ended for LINGER_MS, then lets thinking take the band. */
async function stay($: EngineInterface, l: { kind: string; label: string }): Promise<void> {
  const until = Date.now() + LINGER_MS
  await update($, linger, () => ({ ...l, until }))
  $.clock.after(LINGER_MS + 50, () => {
    void update($, linger, x => (x !== null && x.until === until ? null : x))
  })
}

function mmss(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  return s >= 60 ? say(`${Math.floor(s / 60)} 分 ${s % 60} 秒`, `${Math.floor(s / 60)} min ${s % 60} s`) : say(`${s} 秒`, `${s} s`)
}

function hhmm(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Tokens as people say them: 152k. */
function kilo(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
}

let ticker: Timer | null = null

// The API error that ended this turn (rate_limit, overloaded, ...), from classic.StopFailure, until the next prompt.
let oops = ''

/** Starts the frame clock of the terminal's animation unless it runs; a hot reload drops it. */
function tick($: EngineInterface): void {
  if (ticker !== null) return
  ticker = $.clock.every(TICK_MS, () => {
    void update($, frame, f => (f + 1) % 100000)
  })
}

function stop(): void {
  ticker?.cancel()
  ticker = null
}

export const register: Register = (on, options) => {
  const chosen = String(options.language ?? 'auto')
  langFixed = chosen === 'zh' || chosen === 'en'
  if (langFixed) lang = chosen as Lang

  on('session.start', async ($, e, next) => {
    if (!langFixed) {
      const saved = await $.store.get('language')
      if (saved === 'zh' || saved === 'en') lang = saved
    }
    await $.command.register({
      name: 'at-work',
      description: say(
        '/at-work holiday spring|christmas|…|auto 先看节日装饰（不带名字列出全部）；/at-work image|frame 换画法',
        '/at-work holiday spring|christmas|…|auto previews holiday decorations (no name lists them); /at-work image|frame switches the drawing',
      ),
    })
    return next(e)
  })

  on('command.run', { command: 'at-work' }, async ($, e) => {
    const [arg = '', name = ''] = String(e.args ?? '').trim().split(/\s+/)
    if (arg === 'holiday') {
      const names = Object.keys(HOLIDAYS)
      const want = names.includes(name) ? name : ''
      await update($, holiday, () => want)
      const list = names.map(k => say(`${k}（${HOLIDAYS[k].zh}）`, `${k} (${HOLIDAYS[k].en})`)).join(say('、', ', '))
      return {
        text: want
          ? say(`at-work：先按${HOLIDAYS[want].zh}装饰给你看；/at-work holiday auto 回到按日期`,
            `at-work: decorating for ${HOLIDAYS[want].en} now; /at-work holiday auto goes back to the calendar`)
          : say(`at-work：节日装饰按日期自动出现；想先看一眼：/at-work holiday <名字>，可选 ${list}`,
            `at-work: holiday decorations follow the calendar; to preview one: /at-work holiday <name>, one of ${list}`),
      }
    }
    const now = await read($, mode)
    const want = arg === 'image' || arg === 'frame' ? arg : now === 'image' ? 'frame' : 'image'
    await update($, mode, () => want)
    const other = want === 'image' ? 'frame' : 'image'
    return {
      text: say(`at-work：现在用${want === 'image' ? '图片' : '小窗'}模式画动画；/at-work ${other} 换回另一种`,
        `at-work: drawing ${want === 'image' ? 'as an image' : 'in a frame'} now; /at-work ${other} switches back`),
    }
  })

  on('prompt.submit', async ($, e, next) => {
    // with the language on auto, the band speaks the language the person writes in
    const spoken = langFixed ? null : langOf(e.text)
    if (spoken !== null && spoken !== lang) {
      lang = spoken
      await $.store.set('language', spoken)
    }
    await update($, turnStart, () => Date.now())
    await update($, steps, () => 0)
    await update($, running, () => [])
    await update($, history, () => [])
    await update($, flash, () => null)
    await update($, linger, () => null)
    await update($, word, w => w + 1)
    oops = ''
    tick($)
    return next(e)
  })

  // A compaction is a running act of its own (the press), and its result lingers: how far the context shrank.
  on('session.compact', async ($, e, next) => {
    if (e.trigger === 'precompute') return next(e)
    const id = `compact-${Date.now()}`
    const label = `${e.agentId ? say('🤖 小助手 · ', '🤖 helper · ') : ''}${e.trigger === 'auto' ? say('上下文满了，压一压', 'context is full, squeezing it') : say('压缩上下文', 'compacting the context')}`
    await update($, running, list => [...list, { id, kind: 'compact', label, since: Date.now(), isSubagent: Boolean(e.agentId) }])
    tick($)
    try {
      const r = await next(e)
      if (!('skip' in r && r.skip !== undefined) && 'tokensBefore' in r && r.tokensBefore && r.tokensAfter) {
        await stay($, { kind: 'compact', label: tag('上下文压好了', 'context compacted', `${kilo(r.tokensBefore)} → ${kilo(r.tokensAfter)} tokens`) })
      }
      return r
    } finally {
      await update($, running, list => list.filter(a => a.id !== id))
    }
  })

  on('classic.StopFailure', async ($, e, next) => {
    oops = String(e.error ?? '')
    await update($, last, l => (l !== null && l.reason === 'error' ? { ...l, error: oops } : l))
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const { kind, label } = classify(e as unknown as { tool: string; [argument: string]: unknown })
    const id = String(e.tool_use_id ?? `${e.tool}-${Date.now()}`)
    const now = Date.now()
    const act: Act = { id, kind, label, since: now, isSubagent: Boolean((e as { agentId?: string }).agentId) }
    lastStart = now
    await update($, running, list => [...list.filter(a => a.id !== id), act])
    await update($, steps, n => n + 1)
    await update($, flash, f => (f !== null && f.until <= now ? null : f))
    tick($)
    let r: { isError?: boolean; text?: string; deny?: string } | undefined
    try {
      const res = await next(e)
      r = res as unknown as typeof r
      return res
    } finally {
      // the outcome and the lingering scene go first, so the band never passes through thinking in between
      const o = outcome(kind, label, r)
      if (o.show !== null) await show($, o.show)
      await stay($, { kind, label: `${act.isSubagent ? say('🤖 小助手 · ', '🤖 helper · ') : ''}${label}` })
      await update($, running, list => list.filter(a => a.id !== id))
      await update($, history, h => [...h, { kind, ok: o.ok }].slice(-60))
    }
  })

  on('turn.complete', async ($, e, next) => {
    stop()
    await update($, flash, () => null)
    await update($, linger, () => null)
    const started = await read($, turnStart)
    const n = await read($, steps)
    const summary: LastTurn = {
      steps: n,
      seconds: started ? (Date.now() - started) / 1000 : 0,
      reason: e.reason,
      ...(e.reason === 'error' && oops ? { error: oops } : {}),
    }
    await update($, last, () => summary)
    await update($, running, () => [])
    return next(e)
  })

  // The spinner says what Claude chews on while it thinks; while a tool runs, the engine's own words stay.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (e.props.mode !== 'thinking' && e.props.mode !== 'requesting') return next(e)
    const w = await read($, word)
    return next({ ...e, props: { ...e.props, word: joke(w) } })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const list = await read($, running)
    const n = await read($, steps)
    const started = await read($, turnStart)
    const w = await read($, word)
    const done = await read($, last)
    const fl = await read($, flash)
    const lg = await read($, linger)
    const act = list.length > 0 ? list[list.length - 1] : null
    // an outcome holds the band for its while, then until the next call starts
    const out = fl !== null && (fl.until > Date.now() || act === null) ? fl : null
    // a call that just ended keeps its scene a moment, so back-to-back calls do not blink through thinking
    const kept = lg !== null && lg.until > Date.now() ? lg : null
    // a /compact typed between turns runs while the session is not working: the press shows all the same
    const busy = e.props.isWorking || act?.kind === 'compact' || kept?.kind === 'compact'
    const idle = rest(done, new Date().getHours())
    const kind = !busy ? idle.kind : out ? out.kind : act ? act.kind : kept ? kept.kind : thinker(w)
    const label = !busy
      ? idle.label
      : out ? out.label
        : act ? `${act.isSubagent ? say('🤖 小助手 · ', '🤖 helper · ') : ''}${act.label}`
          : kept ? kept.label : `💭 ${joke(w)}…`
    const more = list.length > 1 ? ` (+${list.length - 1})` : ''
    const forced = await read($, holiday)
    const hol = forced !== '' ? forced : festival(new Date())
    season = hol

    if (e.surface === 'desktop') {
      // the scene animates by itself, so this drawing reads no frame counter; the label row follows every change,
      // the picture only a change of scene or width, through the hidden frame (see slots)
      const { Box, Text, Svg } = $.ui.resolve(e)
      const crates = await read($, history)
      await read($, swap)
      const m = await read($, mode)
      const lay = layout(e.props.bodyColumns, e.props.maxRows, !busy)
      const key = `${kind}|${lay.W}|${hol ?? ''}`
      const make = (): Slot => ({ key, svg: picture(kind, lay, crates, list.slice(0, -1).map(a => a.kind)), alt: label })
      const shown = slots[front]
      if (m === 'image') {
        // an image keeps showing the old picture until the new one is in: one image, no buffering
        if (shown === null || shown === undefined || shown.key !== key) slots[front] = make()
        pending = null
      } else if (shown === null || shown === undefined) slots[front] = make()
      else if (shown.key !== key) {
        if (slots[1 - front]?.key !== key) slots[1 - front] = make()
        if (pending !== key) {
          pending = key
          flip($, key)
        }
      } else pending = null
      const picShown = slots[front]
      return (
        <Box flexDirection="column">
          {m === 'image'
            ? picShown ? <Svg key="image" source={picShown.svg} alt={picShown.alt} /> : null
            : [0, 1].map(i => {
              const slot = slots[i]
              return (
                <Box key={`frame${i}`} flexDirection="column" overflow="hidden" {...(i === front ? {} : { height: 0 })}>
                  {slot ? <Svg source={slot.svg} alt={slot.alt} isInteractive /> : null}
                </Box>
              )
            })}
          <Box flexDirection="row" gap={1}>
            <Box flexShrink={1}>
              <Text bold wrap="wrap">
                {label}
                {more}
              </Text>
            </Box>
            {e.props.isWorking && started ? (
              <Box flexShrink={0}>
                <Text dimColor>
                  {say(`· 第 ${n} 步 · ${hhmm(started)} 开始`, `· step ${n} · since ${hhmm(started)}`)}
                </Text>
              </Box>
            ) : null}
          </Box>
        </Box>
      )
    }

    const { Box, Text } = $.ui.resolve(e)
    if (!busy) {
      if (done === null) return next(e)
      return (
        <Box flexDirection="row" gap={1}>
          <Text>
            {kind === 'rain' ? '🌧 (•︵•)' : kind === 'sleep' ? '💤 (－_－)' : '☕ (ᵔᴥᵔ)'}
            {hol ? ` ${HOLIDAYS[hol].emoji}` : ''}
          </Text>
          <Text dimColor wrap="wrap">{label}</Text>
        </Box>
      )
    }
    const f = await read($, frame)
    const elapsed = started ? mmss((Date.now() - started) / 1000) : ''
    return (
      <Box flexDirection="row" gap={1}>
        <Text color="cyan">
          {hol ? `${HOLIDAYS[hol].emoji} ` : ''}
          {scene(kind, f)}
        </Text>
        <Box flexShrink={1}>
          <Text wrap="wrap">
            {label}
            {more}
          </Text>
        </Box>
        <Box flexShrink={0}>
          <Text dimColor>
            {say(`· 第 ${n} 步 · ${elapsed}`, `· step ${n} · ${elapsed}`)}
          </Text>
        </Box>
      </Box>
    )
  })
}
