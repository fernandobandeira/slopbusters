import type { Dispatch, SetStateAction } from 'react'
import type { useFileContext } from './diff/useFileContext'
import { CONTEXT_STEP, MAX_CONTEXT } from './diff/displayContext'

interface ContextProps {
  fileContext: ReturnType<typeof useFileContext>
  contextLines: Map<string, number>
  setContextLines: Dispatch<SetStateAction<Map<string, number>>>
}

/** The header actions of a PR file: fold expanded lines, add context, and mark it viewed. */
export function FileContextActions({
  fileId,
  path,
  canExpand,
  expanded,
  onCollapseLines,
  fileContext,
  contextLines,
  setContextLines,
  viewed,
  toggleFile,
}: ContextProps & {
  fileId: string
  path: string
  canExpand: boolean
  expanded: boolean
  onCollapseLines: (fileId: string) => void
  viewed: boolean
  toggleFile: (fileId: string) => void
}) {
  return (
    <div className="file-context-actions">
      {expanded && (
        <button
          type="button"
          title="Fold the unchanged lines you expanded back into their separators"
          onClick={() => {
            onCollapseLines(fileId)
          }}
        >
          Collapse lines
        </button>
      )}
      <ContextButtons
        fileId={fileId}
        canExpand={canExpand}
        fileContext={fileContext}
        contextLines={contextLines}
        setContextLines={setContextLines}
      />
      <label className="file-viewed">
        <input
          type="checkbox"
          aria-label={`Viewed ${path}`}
          checked={viewed}
          onChange={() => {
            toggleFile(fileId)
          }}
        />
        Viewed
      </label>
    </div>
  )
}

/** Adds or resets lines of surrounding context on every section of the file at once. */
function ContextButtons({
  fileId,
  canExpand,
  fileContext,
  contextLines,
  setContextLines,
}: ContextProps & { fileId: string; canExpand: boolean }) {
  const context = contextLines.get(fileId) ?? 0
  return (
    <>
      <button
        type="button"
        disabled={fileContext.isLoading(fileId) || !canExpand || context >= MAX_CONTEXT}
        title={fileContext.error(fileId) ?? 'Expand unchanged lines around these sections'}
        onClick={() =>
          void fileContext
            .load(fileId)
            .then(() => {
              setContextLines((values) =>
                new Map(values).set(
                  fileId,
                  Math.min(MAX_CONTEXT, (values.get(fileId) ?? 0) + CONTEXT_STEP),
                ),
              )
            })
            .catch(() => {})
        }
      >
        {fileContext.isLoading(fileId) ? 'Loading…' : `+${CONTEXT_STEP} context`}
      </button>
      {context > 0 && (
        <button
          type="button"
          onClick={() => {
            setContextLines((values) => {
              const next = new Map(values)
              next.delete(fileId)
              return next
            })
          }}
        >
          Reset
        </button>
      )}
    </>
  )
}
