/**
 * The one thing Mono interrupts you for.
 *
 * Everything else in this app is quiet on purpose — the companion reacts and
 * never interrupts, the plan re-derives without announcing it. This is the
 * exception, because it is the only failure that costs you something you
 * cannot get back by looking at the screen: the browser has refused to write
 * the log, so the day is complete in memory and complete nowhere else.
 *
 * A chip in the header rather than a banner over the day. It has to be visible
 * from wherever you are — both headers carry it — and it has to lead somewhere
 * that can do something about it, which is Settings, where Export lives. The
 * full explanation is there, beside that button; a header has room for the
 * fact and not the argument.
 *
 * It renders nothing at all while saving works, which is nearly always.
 */

import { useStorageHealth } from '@/store/session'

export function StorageWarning({ onOpenSettings }: { onOpenSettings: () => void }) {
  const failedAt = useStorageHealth((s) => s.failedAt)
  if (failedAt === null) return null

  return (
    <button
      type="button"
      onClick={onOpenSettings}
      title="This browser is refusing to save. Open settings to export your history."
      className="rounded-lg border border-commit/60 bg-commit/10 px-3 py-1.5 text-xs text-commit transition hover:bg-commit/20"
    >
      Not saving
    </button>
  )
}
