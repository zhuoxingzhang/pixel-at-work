import { test, expect, mock } from 'claude-code/testing'

const EN = { options: { language: 'en' } }
const short = (tree: unknown) =>
  JSON.stringify(tree, (k, v) => (k === 'source' ? `<svg ${String(v).length}>` : v))
const working = { hasSurvey: false, isWorking: true, maxRows: 12, bodyColumns: 95 } as never
const idle = { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 95 } as never

async function band($: any, props: never): Promise<string> {
  return short(await (await $.ui.mount({ plugin: 'at-work', surface: 'desktop', component: 'AbovePrompt', props })).drawn())
}

test('in English: commands, tools, outcomes and the idle band', EN, async ($, on) => {
  mock.clock(on, { now: Date.now() })
  let answer: unknown = { result: 'ok', text: 'ok' }
  on('tool.call', async () => answer as never)
  await $.tool.call({ tool: 'Bash', command: 'git -C repo pull' } as never)
  expect(await band($, working)).toContain('pulling: git -C repo pull')
  await $.tool.call({ tool: 'TodoWrite' } as never)
  expect(await band($, working)).toContain('planning')
  answer = { result: 'x', text: 'Exit code 1', isError: true }
  await $.tool.call({ tool: 'Bash', command: 'cargo build' } as never)
  const fire = await band($, working)
  console.log('EN FIRE', fire.match(/"alt":"([^"]*)"/)?.[1])
  expect(fire).toContain("build failed, it's on fire! cargo build")
  expect(await band($, idle)).toContain('Waiting for you')
})

test('in English: the holiday command answers in English', EN, async $ => {
  const r = JSON.stringify(await $.command.run({ command: 'at-work', args: 'holiday halloween' } as never))
  console.log('EN HOLIDAY', r)
  expect(r).toContain('decorating for Halloween')
})
