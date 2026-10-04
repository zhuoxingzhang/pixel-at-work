import { test, expect } from 'claude-code/testing'

const ZH = { options: { language: 'zh' } }

const short = (tree: unknown) =>
  JSON.stringify(tree, (k, v) => (k === 'source' ? `<svg ${String(v).length}>` : k === 'alt' ? undefined : v))
const props = { hasSurvey: false, isWorking: true, maxRows: 12, bodyColumns: 95 } as never

test('image by default, two frames after /at-work frame', ZH, async $ => {
  const a = short(await (await $.ui.mount({ plugin: 'at-work', surface: 'desktop', component: 'AbovePrompt', props })).drawn())
  console.log('IMAGE ' + a.slice(0, 260))
  expect(a).not.toContain('isInteractive')
  const r = await $.command.run({ command: 'at-work', args: 'frame' } as never)
  console.log('COMMAND ' + JSON.stringify(r))
  const b = short(await (await $.ui.mount({ plugin: 'at-work', surface: 'desktop', component: 'AbovePrompt', props })).drawn())
  console.log('FRAME ' + b.slice(0, 260))
  expect(b).toContain('frame1')
})
