export interface SourceSymbol {
  name: string
  kind: 'class' | 'function' | 'method'
  /** Inclusive, one-based source lines in this exact file revision. */
  line: number
  endLine: number
}
