export const languageExtensions = {
  typescript: ['ts', 'tsx', 'mts', 'cts'],
  javascript: ['js', 'jsx', 'mjs', 'cjs'],
  python: ['py', 'pyi'],
  go: ['go'],
  rust: ['rs'],
  java: ['java'],
  ruby: ['rb', 'rake'],
  php: ['php'],
  c_sharp: ['cs'],
  c: ['c'],
  cpp: ['h', 'cc', 'cpp', 'cxx', 'hpp', 'hh', 'hxx'],
  bash: ['sh', 'bash'],
  powershell: ['ps1', 'psm1', 'psd1'],
  lua: ['lua'],
  kotlin: ['kt', 'kts'],
  swift: ['swift'],
  dart: ['dart'],
  html: ['html', 'htm'],
  css: ['css', 'scss', 'less'],
  json: ['json', 'jsonc'],
  yaml: ['yaml', 'yml'],
}

export function sourceLanguage(path: string): string {
  const extension = path.split('.').at(-1)?.toLowerCase() ?? ''
  return (
    Object.entries(languageExtensions).find(([, extensions]) =>
      extensions.includes(extension),
    )?.[0] ?? 'text'
  )
}
