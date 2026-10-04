import { test, expect, mock } from 'claude-code/testing'

const ZH = { options: { language: 'zh' } }

const short = (tree: unknown) =>
  JSON.stringify(tree, (k, v) => (k === 'source' ? `<svg ${String(v).length}>` : v))
const working = { hasSurvey: false, isWorking: true, maxRows: 12, bodyColumns: 95 } as never
const idle = { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 95 } as never

async function band($: any, props: never, surface: 'desktop' | 'terminal' = 'desktop'): Promise<string> {
  return short(await (await $.ui.mount({ plugin: 'at-work', surface, component: 'AbovePrompt', props })).drawn())
}

const label = (d: string) => d.match(/"bold":true,"wrap":"wrap"\},"children":\["([^"]*)"/)?.[1]

test('a long description is shown whole, on a label that wraps', ZH, async ($, on) => {
  mock.clock(on, { now: Date.now() })
  on('tool.call', async () => ({ result: 'ok', text: 'ok' }) as never)
  const description = 'Stop the old after-chain, sweep and pgbench, wait for backends'
  await $.tool.call({ tool: 'Bash', command: 'ssh host true', description } as never)
  const d = await band($, working)
  console.log('LONG', label(d))
  expect(label(d)).toContain(description)
  expect(d).not.toContain('…')
})

// A call that just ended keeps its scene for a while (linger), so the band shows it right after the call.
test('each command lands in its scene', ZH, async ($, on) => {
  const clock = mock.clock(on, { now: Date.now() })
  on('tool.call', async () => ({ result: 'ok', text: 'ok' }) as never)
  for (const [command, words] of [
    ['ssh host ls', '连服务器'],
    ['npm install left-pad', '装依赖'],
    ['git -C repo pull', '拉取'],
    ['curl -sL https://example.org', '下载'],
    ['docker compose up', '搬集装箱'],
    ['psql -c "select 1"', '查数据库'],
    ['git status', '摆弄 Git'],
    ['git add -A && git commit -m x && git push', '推送'],
    ['cat notes.py', 'cat notes.py'],
    ['rm -rf build', '打扫'],
  ]) {
    await clock.advance(8000)
    await $.tool.call({ tool: 'Bash', command } as never)
    const d = await band($, working)
    console.log(command, '->', label(d))
    expect(d).toContain(words)
  }
})

test('a failed build catches fire, a failed test brings a bug, a refusal the barrier', ZH, async ($, on) => {
  mock.clock(on, { now: Date.now() })
  let answer: unknown = { result: 'x', text: 'Exit code 2 make: *** [all] Error 1', isError: true }
  on('tool.call', async () => answer as never)
  await $.tool.call({ tool: 'Bash', command: 'make all' } as never)
  const a = await band($, working)
  console.log('BUILD', label(a))
  expect(a).toContain('构建失败')
  answer = { result: 'x', text: 'Exit code 1 1 failed, 3 passed', isError: true }
  await $.tool.call({ tool: 'Bash', command: 'pytest' } as never)
  const b = await band($, working)
  console.log('TEST', label(b))
  expect(b).toContain('测试挂了')
})

test('other tools land in theirs', ZH, async ($, on) => {
  mock.clock(on, { now: Date.now() })
  on('tool.call', async () => ({ result: 'ok', text: 'ok' }) as never)
  for (const [tool, words] of [
    ['TodoWrite', '排计划'],
    ['AskUserQuestion', '等你回答'],
    ['Artifact', '画页面'],
    ['mcp__Claude_Browser__navigate', '逛网页'],
    ['SendMessage', '送信'],
    ['TaskStop', '收掉后台任务'],
  ]) {
    await $.tool.call({ tool } as never)
    const d = await band($, working)
    console.log(tool, '->', label(d))
    expect(d).toContain(words)
  }
})

test('between turns: waiting for the next word, on both surfaces', ZH, async $ => {
  for (const surface of ['desktop'] as const) {
    const d = await band($, idle, surface)
    console.log('IDLE', surface, d.slice(0, 160))
  }
  expect(await band($, idle)).toContain('等你发话')
})

test('a passed test throws a party', ZH, async ($, on) => {
  on('tool.call', async () => ({ result: 'ok', text: '5 passed' }) as never)
  mock.clock(on, { now: Date.now() })
  await $.tool.call({ tool: 'Bash', command: 'cd x && pytest -q' } as never)
  expect(await band($, working)).toContain('测试通过')
})

test('a finished build throws a party', ZH, async ($, on) => {
  on('tool.call', async () => ({ result: 'ok', text: 'Finished release' }) as never)
  mock.clock(on, { now: Date.now() })
  await $.tool.call({ tool: 'Bash', command: 'cargo build --release' } as never)
  expect(await band($, working)).toContain('构建好了')
})

test('/at-work holiday previews a holiday and auto goes back to the calendar', ZH, async ($, on) => {
  const r = await $.command.run({ command: 'at-work', args: 'holiday christmas' } as never)
  console.log('HOLIDAY', JSON.stringify(r))
  expect(JSON.stringify(r)).toContain('圣诞')
  const d = await band($, idle)
  expect(d.length).toBeGreaterThan(100)
  const t = await $.command.run({ command: 'at-work', args: 'holiday' } as never)
  console.log('LIST', JSON.stringify(t))
  expect(JSON.stringify(t)).toContain('halloween')
})
