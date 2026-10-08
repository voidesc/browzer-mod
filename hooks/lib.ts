// The pure parts: what a published artifact's page is, which running browzer already shows a
// page, and the argv that opens a browzer beside the session. Nothing here touches the host.

/** A browzer as `browzer ctl --json ls` lists it. */
export type Instance = { ok?: boolean; pid?: number; ssh?: string | null; tabs?: { index: number; url: string }[] }

export type Layout = 'vsplit' | 'hsplit' | 'tab' | 'window'

/** The page an Artifact call just published: the URL its result carries, for a publish of a page. */
export function publishedUrl(call: { action?: string; asset?: boolean; type_url?: string }, result: unknown): string | undefined {
  const isPublish = call.action === undefined || call.action === 'publish'
  if (!isPublish || call.asset === true) return undefined
  const url = (result as { url?: unknown } | null)?.url

  return typeof url === 'string' && url !== '' ? url : undefined
}

/** The page an Artifact call just showed the person: `open` names an existing artifact. */
export function openedUrl(call: { action?: string; url?: string }): string | undefined {
  return call.action === 'open' && call.url ? call.url : undefined
}

/** The browzers that run here (not through `--ssh`), as `browzer ctl --json ls` answered. */
export function running(lsJson: string): Instance[] {
  let listed: unknown
  try {
    listed = JSON.parse(lsJson)
  } catch {
    return []
  }
  if (!Array.isArray(listed)) return []

  return (listed as Instance[]).filter(one => one.ok === true && typeof one.pid === 'number' && !one.ssh)
}

/** A page as a tab's address names it and as we name it: the same thing, spelled the same. */
export function samePage(tabUrl: string, target: string): boolean {
  return plain(tabUrl) === plain(target)
}

function plain(url: string): string {
  let s = url.startsWith('file://') ? url.slice('file://'.length) : url
  try {
    s = decodeURIComponent(s)
  } catch {
    // a percent sign that is not an escape: as it is
  }
  s = s.replace(/#.*$/, '')
  if (!s.startsWith('/')) s = s.replace(/^https?:\/\//, '').replace(/^www\./, '')

  return s.replace(/\/+$/, '')
}

/** The running browzer and the tab that already shows `target`, if any does. */
export function tabShowing(up: Instance[], target: string): { pid: number; tab: number } | undefined {
  for (const one of up) {
    const tab = one.tabs?.find(t => samePage(t.url, target))
    if (tab) return { pid: one.pid as number, tab: tab.index }
  }

  return undefined
}

/** `kitty @ launch` for a browzer beside the session's window, `target` as its first page. */
export function launchArgv(opts: { layout: Layout; focus: boolean; windowId: string; browzer: string; target?: string }): string[] {
  const argv = ['kitty', '@', 'launch']
  if (opts.layout === 'tab') argv.push('--type=tab')
  else if (opts.layout === 'window') argv.push('--type=os-window')
  else argv.push('--type=window', `--location=${opts.layout}`, `--match=window_id:${opts.windowId}`, `--next-to=id:${opts.windowId}`)
  if (!opts.focus) argv.push('--keep-focus')
  argv.push(opts.browzer)
  if (opts.target) argv.push(opts.target)

  return argv
}
