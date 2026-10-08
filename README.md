# browzer mod

A Claude Code mod: the artifacts Claude publishes open in
[browzer](https://github.com/voidesc/browzer), a real Chromium page in a kitty
split beside the session. The first artifact opens the split, the next ones are
tabs in it, and a republished artifact reloads its tab, so the page Claude is
working on is always in view. `/browzer URL` puts any page there: a URL, a
host, a file, or words to search for; a bare `/browzer` shows the last artifact
again.

## Install

[browzer](https://github.com/voidesc/browzer) on `PATH`, kitty with
`allow_remote_control yes`, Claude Code 2.1.287 or newer. At the prompt of a
terminal session:

```
/plugin install browzer --marketplace voidesc/browzer-mod
```

Answer `y` to add the marketplace, then pick the user scope.

## Options

In `/config` under browzer: **What to show**, `page` (the artifact at claude.ai;
sign in once, browzer keeps a profile of its own) or `file` (the HTML file
Claude wrote); **Open on publish**; **Where it opens** when no browzer runs yet
(`vsplit`, `hsplit`, a kitty `tab`, an OS `window`); **Take the keyboard** (off:
the focus stays with Claude); **browzer command** when it is not the one on
`PATH`.

## License

MIT.
