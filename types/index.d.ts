declare module 'claude-code' {
  interface PluginState {
    browzer: { last: string; auto: boolean | null }
  }
}
