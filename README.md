# pixel-at-work

A pixel-art band above the Claude Code prompt that shows what Claude is doing right now: editing, searching, running tests, building, pushing, querying a database, moving containers, thinking. Old computer-science jokes ride on the spinner, and on holidays the band dresses up.

[中文说明](#中文说明)

![at-work in the desktop app](docs/tour.gif)

## What it shows

| When Claude... | the little orange creature... |
|---|---|
| reads or searches | reads a book, or sweeps a magnifying glass over the files |
| edits code, writes docs or LaTeX | types at a screen, or writes on paper |
| runs tests (pytest, jest, cargo test, go test, npm test, ...) | watches test tubes bubble while a checklist fills; a party if they pass, a bug hunt if not |
| builds (make, cargo build, tsc, gradle, npm run build, ...) | runs a conveyor belt and a press; it catches fire if the build fails |
| installs packages (npm, pip, uv, cargo, brew, winget, ...) | catches parcels coming down on parachutes |
| uses git | stamps a commit, sends a push to the cloud, pulls a parcel down, grows a commit graph |
| runs ssh, scp, rsync | carries letters and parcels to a server rack |
| queries a database (psql, sqlite3, mysql, duckdb, ...) | pulls rows out of a database into a table |
| runs docker, podman, kubectl | watches a whale swim by with its containers |
| plans (to-do lists, plan mode) | moves notes across a kanban board |
| asks you a question | holds up a question mark |
| has a call refused | walks into a barrier |
| compacts the context | squeezes a pile of pages into a cube |
| sends a job to the background | goes fishing |
| sends a helper agent | throws papers to a robot; further running calls show up as small helpers at the right |
| thinks | lights a bulb, paces, explains it to a rubber duck, or fills a blackboard, matched to the joke on the spinner |
| waits for you | drinks coffee by day, sleeps at night, stands in the rain if the last turn ended on an API error |

Finished calls pile up as crates at the left, a red one for each failure. The right of the band is Auckland: the Sky Tower, the city lights, the harbour and Rangitoto.

### Holidays

![the band on holidays](docs/holidays.png)

New Year, Spring Festival (from its eve to the Lantern Festival), Dragon Boat Festival, Matariki, Mid-Autumn Festival, Halloween and Christmas, each with its own decorations, a hat for the creature on some, and the Sky Tower lit in the day's colours. Lunar dates and Matariki are tabled up to 2035. Preview one on any day with `/at-work holiday christmas`; `/at-work holiday auto` goes back to the calendar.

## Install

You need a Claude Code build that runs plugin hooks modules (tested with 2.1.286). The pixel art is drawn in the desktop app's Code tab; a terminal session gets a one-line animation instead.

### From the marketplace

```bash
claude plugin marketplace add zhuoxingzhang/pixel-at-work
claude plugin install at-work@pixel-at-work
```

or, inside Claude Code, `/plugin marketplace add zhuoxingzhang/pixel-at-work` and then `/plugin install at-work@pixel-at-work`. The band appears in the next session.

### From a clone

```bash
git clone https://github.com/zhuoxingzhang/pixel-at-work ~/.claude/mods/at-work
```

and point `~/.claude/settings.json` at it with an absolute path (on Windows, for example, `C:/Users/you/.claude/mods/at-work`):

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "/home/you/.claude/mods/at-work"
  }
}
```

For a single session, `claude --plugin-dir ~/.claude/mods/at-work` does the same. Use one way only: two copies would both draw.

### If nothing shows up

Hooks modules may be switched off for your account. Turn them on in the `env` block of `~/.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1"
  }
}
```

## Settings and commands

| | |
|---|---|
| `language` | `auto` (the default) follows the language of your latest prompt and remembers it across sessions; `zh` is Chinese, `en` is English. Set it with `/plugin configure at-work@pixel-at-work`, with `claude plugin install at-work@pixel-at-work --config language=en`, or, for a clone, with `"pluginConfigs": { "at-work": { "options": { "language": "en" } } }` in `~/.claude/settings.json`. |
| `/at-work holiday <name>` | previews a holiday: `newyear`, `spring`, `dragon`, `matariki`, `moon`, `halloween`, `christmas`; `auto` goes back to the calendar, no name lists them. |
| `/at-work image` or `/at-work frame` | how the desktop draws the picture: as an image (the default, which never blinks) or in a frame (a fallback). |

## How it works

One hooks module (`hooks/register.tsx`). It watches tool calls to pick a scene and passes every call on unchanged. On the desktop each scene is an SVG animated by SMIL, so nothing is redrawn frame by frame: the picture changes only when the scene or the width does. A failed build, a failed call, a passed test, a refused call and a finished compaction hold the band for a few seconds; a call that just ended keeps its scene a moment, so quick calls do not flicker through thinking.

Nothing leaves your machine: the plugin makes no network requests and stores only the detected language.

## Development

```bash
claude plugin validate .
claude plugin test .
```

The tests are in `tests/`. The API typings an editor needs are generated by Claude Code (`/plugin-types`); git ignores them, along with `tsconfig.json`.

## License

[MIT](LICENSE)

---

## 中文说明

在 Claude Code 输入框上方放一条像素风动画，实时显示 Claude 正在做什么：改代码、搜索、跑测试、构建、推送、查数据库、搬集装箱、思考……思考时，加载提示里会冒出计算机科学的老梗；逢年过节，整条动画还会换上节日装饰。

### 都有哪些场景

- **读和搜**：看书，或者拿放大镜扫过一排文件。
- **改代码、写文档或 LaTeX**：对着屏幕打字，或者在纸上写。
- **跑测试**（pytest、jest、cargo test、go test、npm test 等）：试管冒泡，清单一格格打勾；通过了放彩带，没过就抓虫。
- **构建**（make、cargo build、tsc、gradle、npm run build 等）：传送带加压机；构建失败时小怪兽着火。
- **装依赖**（npm、pip、uv、cargo、brew、winget 等）：包裹挂着降落伞落下来。
- **git**：盖章提交、推上云端、从云端拉下包裹、长出一棵提交树。
- **ssh、scp、rsync**：往服务器机柜送信、送包裹。
- **数据库**（psql、sqlite3、mysql、duckdb 等）：数据一行行从数据库飞进表格。
- **docker、podman、kubectl**：鲸鱼背着集装箱游过。
- **排计划**（任务清单、plan 模式）：看板上的便签从待办挪到完成。
- **问你问题**：举起问号牌。
- **调用被拒**：撞上栏杆。
- **压缩上下文**：压机把一摞纸压成方块。
- **后台任务**：去钓鱼。
- **派子代理**：把文件扔给小机器人；同时在跑的其他调用会变成右边的小帮手。
- **思考**：点亮灯泡、来回踱步、跟小黄鸭讲解，或者推一黑板公式，跟当轮的梗搭配。
- **等你发话**：白天喝咖啡，晚上睡觉；上一轮因接口出错停下时，头顶一朵雨云。

做完的每一步都会在左边堆成一个箱子，失败的是红箱子。右边是奥克兰：天空塔、城市灯火、港湾和朗伊托托岛。

节日装饰覆盖新年、春节（除夕到元宵）、端午、Matariki、中秋、万圣节、圣诞：各有自己的装饰，有的还给小怪兽戴帽子，天空塔也会亮起节日的颜色。农历日期和 Matariki 列到 2035 年。想提前看，用 `/at-work holiday christmas` 这样的命令，`/at-work holiday auto` 回到按日期显示。

### 安装

需要支持插件钩子模块（hooks modules）的 Claude Code，已在 2.1.286 上测试。像素动画在桌面应用的 Code 标签页里显示，终端里则是一行字符动画。

从插件市场安装：

```bash
claude plugin marketplace add zhuoxingzhang/pixel-at-work
claude plugin install at-work@pixel-at-work
```

也可以在 Claude Code 里输入 `/plugin marketplace add zhuoxingzhang/pixel-at-work`，再输入 `/plugin install at-work@pixel-at-work`。新开一个会话就能看到。

或者克隆到本地，再在 `~/.claude/settings.json` 的 `env` 里把 `CLAUDE_CODE_PLUGIN_DIRS` 设为这个目录的绝对路径（写法见上面的英文部分）。两种方式只用一种，否则会画出两份。

如果什么都没出现，可能是你的账号默认关闭了钩子模块：在 `~/.claude/settings.json` 的 `env` 里加上 `"CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1"`。

### 设置和命令

- `language`：默认 `auto`，跟随你最近一条提示的语言，并跨会话记住；也可以固定成 `zh`（中文）或 `en`（英文）。
- `/at-work holiday <名字>`：预览节日装饰，名字是 `newyear`、`spring`、`dragon`、`matariki`、`moon`、`halloween`、`christmas`；`auto` 回到按日期，不带名字会列出全部。
- `/at-work image` 或 `/at-work frame`：桌面端的画法，默认用图片（切换不闪），小窗模式只作备用。

插件只观察工具调用，不会改动任何调用；不联网，只在本地记住检测到的语言。许可证为 MIT。
