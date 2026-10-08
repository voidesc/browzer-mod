import type { On, RenderElement } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { launchArgv, publishedUrl, running, samePage, tabShowing } from '../hooks/lib'

const PAGE = 'https://claude.ai/artifact/abc123'
const LS = ['browzer', 'ctl', '--json', 'ls']
const SPLIT = ['kitty', '@', 'launch', '--type=window', '--location=vsplit', '--match=window_id:7', '--next-to=id:7', '--keep-focus', 'browzer']

type Run = { exitCode: number; stdout: string; stderr: string; isStdoutTruncated: boolean; isStderrTruncated: boolean }
const ok = (stdout = ''): Run => ({ exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })

/** A command as typed at the prompt, for the test's engine `$`. */
const typed = (command: string, args: string) => ({ command, args, origin: { kind: 'composer' } as const, presentation: { isFullscreen: false, columns: 120 } })

/** A desktop with kitty and browzer: what `ls` answers is the test's to set; every argv run is kept. */
function desktop(on: On, it: { ls?: () => string; kitty?: boolean; refuses?: string } = {}) {
  const runs: string[][] = []
  const toasts: string[] = []
  mock.env(on, it.kitty === false ? {} : { KITTY_WINDOW_ID: '7' })
  on('process.run', ($, e) => {
    runs.push([...e.argv])
    const isLs = e.argv.length === LS.length && e.argv.every((a, i) => a === LS[i])

    return { value: ok(isLs ? (it.ls?.() ?? '[]') : '') }
  })
  on('ui.toast', ($, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => e)
  const store = new Map<string, unknown>()
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => {
    store.set(e.key, e.value)

    return { value: undefined }
  })
  on('tool.call', ($, e) => (e.tool === 'Artifact' && it.refuses !== undefined && e.file_path === it.refuses ? { deny: 'refused' } : { result: { url: PAGE, version: '3', title: 'Plan' } }))

  return { runs, toasts, store }
}

test('lib: a publish names its page, other calls do not', () => {
  expect(publishedUrl({}, { url: PAGE })).toBe(PAGE)
  expect(publishedUrl({ action: 'publish' }, { url: PAGE })).toBe(PAGE)
  expect(publishedUrl({ action: 'list' }, { url: PAGE })).toBeUndefined()
  expect(publishedUrl({ asset: true }, { url: PAGE })).toBeUndefined()
  expect(publishedUrl({}, 'published')).toBeUndefined()
  expect(publishedUrl({}, null)).toBeUndefined()
})

test('lib: only browzers of this machine count, and a tab is found by its page', () => {
  const ls = JSON.stringify([
    { ok: true, pid: 4, ssh: 'box', tabs: [{ index: 1, url: PAGE }] },
    { ok: false, pid: 5 },
    { ok: true, pid: 9, tabs: [{ index: 1, url: 'about:blank' }, { index: 2, url: `${PAGE}/` }] },
  ])
  const up = running(ls)
  expect(up.map(one => one.pid)).toEqual([9])
  expect(tabShowing(up, PAGE)).toEqual({ pid: 9, tab: 2 })
  expect(tabShowing(up, 'https://claude.ai/artifact/other')).toBeUndefined()
  expect(running('not json')).toEqual([])
  expect(running('{"ok":true}')).toEqual([])
})

test('lib: the same page spelled by a tab and by us', () => {
  expect(samePage('file:///w/my%20plan.html', '/w/my plan.html')).toBe(true)
  expect(samePage('https://claude.ai/artifact/abc#top', 'claude.ai/artifact/abc/')).toBe(true)
  expect(samePage('https://claude.ai/artifact/abc', 'https://claude.ai/artifact/abcd')).toBe(false)
  expect(samePage('http://localhost:3000/', 'localhost:3000')).toBe(true)
})

test('lib: the launch line per layout and focus', () => {
  expect(launchArgv({ layout: 'vsplit', focus: false, windowId: '7', browzer: 'browzer', target: PAGE })).toEqual([...SPLIT, PAGE])
  expect(launchArgv({ layout: 'hsplit', focus: true, windowId: '7', browzer: '/opt/browzer' })).toEqual([
    'kitty', '@', 'launch', '--type=window', '--location=hsplit', '--match=window_id:7', '--next-to=id:7', '/opt/browzer',
  ])
  expect(launchArgv({ layout: 'tab', focus: false, windowId: '7', browzer: 'browzer' })).toEqual(['kitty', '@', 'launch', '--type=tab', '--keep-focus', 'browzer'])
  expect(launchArgv({ layout: 'window', focus: false, windowId: '7', browzer: 'browzer' })).toEqual(['kitty', '@', 'launch', '--type=os-window', '--keep-focus', 'browzer'])
})

test('a published artifact opens a split when no browzer runs, and /browzer shows it again', async ($, on) => {
  const { runs, toasts } = desktop(on)

  const out = await $.tool.call({ tool: 'Artifact', file_path: 'plan.html' })
  expect(out.deny).toBeUndefined()
  expect(runs).toEqual([LS, [...SPLIT, PAGE]])
  expect(toasts).toEqual([`browzer opened in a split: ${PAGE}`])

  const again = await $.command.run(typed('browzer', ''))
  expect(again.text).toBe(`browzer opened in a split: ${PAGE}`)
  expect(runs.at(-1)).toEqual([...SPLIT, PAGE])
})

test('a running browzer takes a new tab; a republish reloads the tab it has', async ($, on) => {
  let tabs = [{ index: 1, url: 'about:blank' }]
  const { runs, toasts } = desktop(on, { ls: () => JSON.stringify([{ ok: true, pid: 9, tabs }]) })

  await $.tool.call({ tool: 'Artifact', action: 'publish', file_path: '/w/plan.html' })
  expect(runs.at(-1)).toEqual(['browzer', 'ctl', '--instance', '9', 'open', '--new-tab', PAGE])

  tabs = [...tabs, { index: 2, url: PAGE }]
  await $.tool.call({ tool: 'Artifact', file_path: '/w/plan.html', url: PAGE })
  expect(runs.at(-1)).toEqual(['browzer', 'ctl', '--instance', '9', '--tab', '2', 'reload'])
  expect(toasts).toEqual([`opened in browzer: ${PAGE}`, 'reloaded in browzer'])
})

test('/browzer URL opens that page; an open of an existing artifact shows it too', async ($, on) => {
  const { runs } = desktop(on, { ls: () => JSON.stringify([{ ok: true, pid: 9, tabs: [] }]) })

  const said = await $.command.run(typed('browzer', ' localhost:3000 '))
  expect(said.text).toBe('opened in browzer: localhost:3000')
  expect(runs.at(-1)).toEqual(['browzer', 'ctl', '--instance', '9', 'open', '--new-tab', 'localhost:3000'])

  await $.tool.call({ tool: 'Artifact', action: 'open', url: 'https://claude.ai/artifact/zzz' })
  expect(runs.at(-1)).toEqual(['browzer', 'ctl', '--instance', '9', 'open', '--new-tab', 'https://claude.ai/artifact/zzz'])
})

test('other Artifact calls, a refused publish and a failed one are left alone', async ($, on) => {
  const { runs } = desktop(on, { refuses: '/w/no.html' })

  await $.tool.call({ tool: 'Artifact', action: 'list' })
  await $.tool.call({ tool: 'Artifact', file_path: '/w/no.html' })
  await $.tool.call({ tool: 'Artifact', url: PAGE, file_path: '/w/x.png', asset: true })
  expect(runs).toEqual([])
})

test('a bare /browzer with nothing published opens an empty browzer; outside kitty it says so', async ($, on) => {
  const { runs } = desktop(on)
  const empty = await $.command.run(typed('browzer', ''))
  expect(empty.text).toBe('browzer opened in a split')
  expect(runs).toEqual([SPLIT])
})

test('outside kitty, with no browzer running, the mod says what to do', async ($, on) => {
  const { runs, toasts } = desktop(on, { kitty: false })
  await $.tool.call({ tool: 'Artifact', file_path: 'plan.html' })
  expect(runs).toEqual([LS])
  expect(toasts[0]).toContain('not in a kitty window')
})

test('options: onPublish off leaves publishes alone but remembers them; layout and command are used', { options: { onPublish: false, layout: 'tab', browzer: '/opt/browzer' } }, async ($, on) => {
  const runs: string[][] = []
  mock.env(on, { KITTY_WINDOW_ID: '7' })
  on('process.run', ($, e) => {
    runs.push([...e.argv])

    return { value: ok('[]') }
  })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => e)
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('tool.call', () => ({ result: { url: PAGE, version: '1' } }))

  await $.tool.call({ tool: 'Artifact', file_path: 'plan.html' })
  expect(runs).toEqual([])
  const said = await $.command.run(typed('browzer', ''))
  expect(said.text).toBe(`browzer opened in a new tab: ${PAGE}`)
  expect(runs).toEqual([['/opt/browzer', 'ctl', '--json', 'ls'], ['kitty', '@', 'launch', '--type=tab', '--keep-focus', '/opt/browzer', PAGE]])
})

test('option show=file: the HTML file Claude wrote, made absolute', { options: { show: 'file' } }, async ($, on) => {
  const { runs } = desktop(on)
  on('fs.stat', ($, e) => ({ value: { kind: 'file', size: 1, mtimeMs: 0, isLink: false, realPath: `/home/me/scratch/${e.path.split('/').at(-1)}` } }))

  await $.tool.call({ tool: 'Artifact', file_path: 'plan.html' })
  expect(runs.at(-1)).toEqual([...SPLIT, '/home/me/scratch/plan.html'])
})

test('/browzer auto turns the automatic opening off and on, and the store keeps it', async ($, on) => {
  const { runs, store } = desktop(on)

  const off = await $.command.run(typed('browzer', 'auto off'))
  expect(off.text).toContain('wait')
  await $.tool.call({ tool: 'Artifact', file_path: 'plan.html' })
  expect(runs).toEqual([])
  expect(store.get('auto')).toBe(false)

  const back = await $.command.run(typed('browzer', 'auto'))
  expect(back.text).toContain('by themselves')
  expect(store.get('auto')).toBe(true)
  await $.tool.call({ tool: 'Artifact', file_path: 'plan.html' })
  expect(runs).toEqual([LS, [...SPLIT, PAGE]])

  const again = await $.command.run(typed('browzer', ''))
  expect(again.text).toBe(`browzer opened in a split: ${PAGE}`)
})

test('a stored auto off is read when the session starts', async ($, on) => {
  const { runs, store } = desktop(on)
  store.set('auto', false)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Artifact', file_path: 'plan.html' })
  expect(runs).toEqual([])
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the band appears once a page was shown, opens it again and flips auto on ${surface}`, async ($, on) => {
    const runs: string[][] = []
    const toasts: string[] = []
    mock.env(on, { KITTY_WINDOW_ID: '7' })
    on('process.run', ($, e) => {
      runs.push([...e.argv])

      return { value: ok('[]') }
    })
    on('ui.toast', ($, e) => {
      toasts.push(e.text)

      return { value: undefined }
    })
    on('store.get', () => ({ value: undefined }))
    on('store.set', () => ({ value: undefined }))
    on('tool.call', () => ({ result: { url: PAGE, version: '1' } }))
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)

      return h(Text, {}, 'the engine drew this') as RenderElement
    })
    const band = {
      plugin: 'browzer',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
    } as const

    const quiet = await $.ui.mount(band)
    expect(await quiet.find({ type: 'Button' })).toBeUndefined()
    expect(await quiet.find({ type: 'Text', text: 'the engine drew this' })).toBeDefined()
    await quiet.unmount()

    await $.tool.call({ tool: 'Artifact', file_path: 'plan.html' })
    runs.length = 0
    const ui = await $.ui.mount(band)
    expect(await ui.find({ type: 'Button', text: 'open' })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: 'auto on' })).toBeDefined()
    await ui.press({ key: 'open' })
    expect(runs).toEqual([LS, [...SPLIT, PAGE]])
    expect(toasts.at(-1)).toBe(`browzer opened in a split: ${PAGE}`)
    await ui.press({ key: 'auto' })
    expect(await ui.find({ type: 'Button', text: 'auto off' })).toBeDefined()
  })
}
