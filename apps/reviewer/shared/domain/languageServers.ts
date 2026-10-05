export interface LanguageServerConfig {
  language: string
  extensions: string[]
  /** Empty disables this server. Commands run directly, without a shell. */
  command: string
  args: string[]
}

export interface LanguageServerStatus extends LanguageServerConfig {
  available: boolean
  detail: string
}
