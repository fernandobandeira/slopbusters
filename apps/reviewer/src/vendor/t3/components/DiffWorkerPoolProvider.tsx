import { WorkerPoolContext, useWorkerPool } from "@pierre/diffs/react"
import { WorkerPoolManager } from "@pierre/diffs/worker"
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react"
import { useTheme } from "../hooks/useTheme"
import { resolveDiffThemeName, type DiffThemeName } from "../lib/diffRendering"
import { PREFERRED_HIGHLIGHTER } from "../lib/syntaxHighlighting"

export class DiffWorkerError extends Error {
  readonly operation: "create-worker" | "get-render-options" | "set-render-options";
  constructor(params: { operation: DiffWorkerError["operation"]; themeName: DiffThemeName; cause: unknown }) {
    super(`Diff worker operation ${params.operation} failed for theme ${params.themeName}.`, { cause: params.cause });
    this.operation = params.operation;
  }
}

const DIFF_WORKER_IDLE_TTL_MS = 30_000;
let sharedWorkerPool:
  | {
      readonly pool: WorkerPoolManager;
      consumers: number;
      idleTimer: ReturnType<typeof setTimeout> | undefined;
    }
  | undefined;

/** Create workers after a viewer commits, then reuse them across short panel closures. */
function acquireDiffWorkerPool(themeName: DiffThemeName, poolSize: number, createWorker: () => Worker) {
  const entry = (sharedWorkerPool ??= {
    pool: new WorkerPoolManager(
      {
        workerFactory: () => {
          return createWorker();
        },
        poolSize,
        totalASTLRUCacheSize: 240,
      },
      {
        theme: themeName,
        preferredHighlighter: PREFERRED_HIGHLIGHTER,
        tokenizeMaxLineLength: 1_000,
        useTokenTransformer: true,
      },
    ),
    consumers: 0,
    idleTimer: undefined,
  });
  clearTimeout(entry.idleTimer);
  entry.idleTimer = undefined;
  entry.consumers += 1;
  return entry;
}

function DiffWorkerThemeSync({ themeName }: { themeName: DiffThemeName }) {
  const workerPool = useWorkerPool();

  useEffect(() => {
    if (!workerPool) {
      return;
    }

    let operation: DiffWorkerError["operation"] = "get-render-options";
    void (async () => {
      try {
        const current = workerPool.getDiffRenderOptions();
        if (current.theme === themeName) {
          return;
        }

        operation = "set-render-options";
        await workerPool.setRenderOptions({
          ...current,
          theme: themeName,
        });
      } catch (cause) {
        console.error(new DiffWorkerError({ operation, themeName, cause }));
      }
    })();
  }, [themeName, workerPool]);

  return null;
}

// Plain-text views do not queue a highlight task that could retry a blank first render.
function DiffWorkerReady({ children }: { children?: ReactNode }) {
  const workerPool = useWorkerPool();
  const [readyPool, setReadyPool] = useState<WorkerPoolManager>();
  const ready = workerPool
    ? readyPool === workerPool || workerPool.isInitialized() || !workerPool.isWorkingPool()
    : typeof window === "undefined";

  useEffect(() => {
    if (ready || !workerPool) return;

    let mounted = true;
    const finish = () => {
      if (mounted) setReadyPool(workerPool);
    };
    // Failed pools use Pierre's existing main-thread highlighter.
    void workerPool.initialize().then(finish, finish);
    return () => {
      mounted = false;
    };
  }, [ready, workerPool]);

  return ready ? (
    children
  ) : (
    <div
      role="status"
      className="flex min-h-0 flex-1 items-center justify-center p-4 text-xs text-muted-foreground"
    >
      Loading code...
    </div>
  );
}

export function DiffWorkerPoolProvider({ children }: { children?: ReactNode }) {
  const { themeId, createWorker } = useTheme();
  const diffThemeName = resolveDiffThemeName(themeId);
  const workerPoolSize = useMemo(() => {
    const cores =
      typeof navigator === "undefined" ? 4 : Math.max(1, navigator.hardwareConcurrency || 4);
    return Math.max(2, Math.min(6, Math.floor(cores / 2)));
  }, []);
  const workerPool = useSyncExternalStore(
    useCallback(
      (onStoreChange) => {
        if (typeof window === "undefined") return () => {};
        const entry = acquireDiffWorkerPool(diffThemeName, workerPoolSize, createWorker);
        onStoreChange();
        return () => {
          entry.consumers -= 1;
          if (entry.consumers !== 0) return;
          entry.idleTimer = setTimeout(() => {
            entry.idleTimer = undefined;
            entry.pool.terminate();
            if (sharedWorkerPool === entry) sharedWorkerPool = undefined;
          }, DIFF_WORKER_IDLE_TTL_MS);
        };
      },
      [diffThemeName, workerPoolSize, createWorker],
    ),
    () => sharedWorkerPool?.pool,
    () => undefined,
  );

  return (
    <WorkerPoolContext value={workerPool}>
      <DiffWorkerThemeSync themeName={diffThemeName} />
      <DiffWorkerReady>{children}</DiffWorkerReady>
    </WorkerPoolContext>
  );
}
