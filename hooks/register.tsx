// browzer mod: the artifacts Claude publishes show up in browzer, a real Chromium page in a kitty
// split beside the session. The first one opens the split; the next ones are tabs in it, and a
// republished artifact reloads its tab. Published means the page at claude.ai (option `show`:
// `page`; sign in once, browzer keeps its own profile) or the HTML file Claude wrote (`file`).
//   /browzer URL           open any page there: a URL, a host, a file, or words to search for
//   /browzer               the last artifact of this session again
//   /browzer auto [on|off] whether artifacts open by themselves (kept across sessions)
// Once something was shown, a one-row band above the prompt has `o: open` (the last artifact
// again; also the chord bound to the engine action named by option `action`, so a line in
// keybindings.json makes it a key) and `a: auto on|off`.
// browzer itself: https://github.com/voidesc/browzer (the `browzer` command on PATH, or option `browzer`).
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { launchArgv, openedUrl, publishedUrl, running, tabShowing } from './lib'
import type { Layout } from './lib'

type $ = EngineInterface

const LAYOUTS: Layout[] = ['vsplit', 'hsplit', 'tab', 'window']

/** The options as register read them. */
type Config = { browzer: string; layout: Layout; focus: boolean; action: string }

/** The page this session showed last: what a bare /browzer opens again. */
const last = atom({ plugin: 'browzer', key: 'last' } as const, '')
/** Whether a publish opens by itself: `/browzer auto` flips it and the store keeps it; null = the option. */
const auto = atom({ plugin: 'browzer', key: 'auto' } as const, null)

export const register: Register = (on, options) => {
  const showFile = options.show === 'file'
  const onPublish = options.onPublish !== false
  const layout = LAYOUTS.find(l => l === options.layout) ?? 'vsplit'
  const focus = options.focus === true
  const browzer = typeof options.browzer === 'string' && options.browzer.trim() !== '' ? options.browzer.trim() : 'browzer'
  const action = typeof options.action === 'string' ? options.action.trim() : ''
  const cfg: Config = { browzer, layout, focus, action }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'browzer',
      description: 'Open a page in browzer beside this session (no URL: the last artifact Claude published)',
      argumentHint: '[URL | auto [on|off]]',
      immediate: true,
    })
    const kept = await $.store.get('auto')
    if (typeof kept === 'boolean') await update($, auto, () => kept)

    return next(e)
  })

  on('command.run', { command: 'browzer' }, async ($, e) => {
    const words = e.args.trim().split(/\s+/)
    if (words[0] === 'auto') {
      const was = (await read($, auto)) ?? onPublish
      const now = words[1] === 'on' ? true : words[1] === 'off' ? false : !was
      await setAuto($, now)

      return { text: autoSays(now) }
    }
    const target = e.args.trim() || (await read($, last))
    if (!target) return { text: await launch($, cfg) }
    await update($, last, () => target)

    return { text: await show($, cfg, target) }
  })

  on('tool.call', { tool: 'Artifact' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true) return ran
    let target = openedUrl(e) ?? publishedUrl(e, ran.result)
    if (target && showFile && e.action !== 'open' && e.file_path) {
      // the file as Claude named it, from wherever the session runs: made absolute here
      try {
        target = (await $.fs.stat(e.file_path, { resolve: true })).realPath ?? e.file_path
      } catch {
        target = e.file_path
      }
    }
    if (!target) return ran
    await update($, last, () => target)
    if ((await read($, auto)) ?? onPublish) $.ui.toast(await show($, cfg, target))

    return ran
  }).catch(($, e, next) => next(e))   // whatever goes wrong here, the publish itself stands

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const page = await read($, last)
    if (e.props.hasSurvey || !page) return next(e)
    const isAuto = (await read($, auto)) ?? onPublish
    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box>
        <Text dimColor>browzer </Text>
        <Button key="open" hotkey="o" plain {...(cfg.action ? { action: cfg.action } : {})} onPress={async () => $.ui.toast(await show($, cfg, page))}>
          open
        </Button>
        <Text dimColor> · </Text>
        <Button key="auto" hotkey="a" plain onPress={() => setAuto($, !isAuto)}>
          {isAuto ? 'auto on' : 'auto off'}
        </Button>
      </Box>
    )
  })
}

async function setAuto($: $, now: boolean) {
  await update($, auto, () => now)
  try {
    await $.store.set('auto', now)
  } catch {
    // the session keeps it either way
  }
}

function autoSays(now: boolean) {
  return now ? 'browzer: artifacts open by themselves as Claude publishes them' : 'browzer: artifacts wait for /browzer or the open button'
}

/** Shows `target` in browzer: the tab that has it reloads, a running browzer takes a new tab, else a split opens. */
async function show($: $, cfg: Config, target: string): Promise<string> {
  let up
  try {
    const ls = await $.process.run([cfg.browzer, 'ctl', '--json', 'ls'], { timeoutMs: 10_000 })
    up = running(ls.stdout)
  } catch (error) {
    return `browzer: ${cfg.browzer} did not run (${reason(error)})`
  }
  const hit = tabShowing(up, target)
  try {
    if (hit) {
      const ran = await $.process.run([cfg.browzer, 'ctl', '--instance', String(hit.pid), '--tab', String(hit.tab), 'reload'], { timeoutMs: 15_000 })

      return ran.exitCode === 0 ? 'reloaded in browzer' : `browzer: ${said(ran) || `reload exited ${ran.exitCode}`}`
    }
    const first = up[0]
    if (first) {
      const ran = await $.process.run([cfg.browzer, 'ctl', '--instance', String(first.pid), 'open', '--new-tab', target], { timeoutMs: 60_000 })

      return ran.exitCode === 0 ? `opened in browzer: ${target}` : `browzer: ${said(ran) || `open exited ${ran.exitCode}`}`
    }
  } catch (error) {
    return `browzer: ${reason(error)}`
  }

  return launch($, cfg, target)
}

/** A browzer of its own beside this window, `target` as its first page (none: an empty one). */
async function launch($: $, cfg: Config, target?: string): Promise<string> {
  const windowId = await $.env.get('KITTY_WINDOW_ID')
  if (!windowId) return 'browzer: this session is not in a kitty window; start `browzer` in a terminal and the pages go there'
  const where = cfg.layout === 'tab' ? 'in a new tab' : cfg.layout === 'window' ? 'in a new window' : 'in a split'
  try {
    const ran = await $.process.run(launchArgv({ layout: cfg.layout, focus: cfg.focus, windowId, browzer: cfg.browzer, target }), { timeoutMs: 15_000 })

    return ran.exitCode === 0
      ? `browzer opened ${where}${target ? `: ${target}` : ''}`
      : `browzer: kitty @ launch failed: ${said(ran) || `exit ${ran.exitCode}`} (allow_remote_control in kitty.conf?)`
  } catch (error) {
    return `browzer: kitty @ launch did not run (${reason(error)})`
  }
}

function said(ran: { stdout: string; stderr: string }): string {
  return (ran.stderr.trim() || ran.stdout.trim()).split('\n').at(-1) ?? ''
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
