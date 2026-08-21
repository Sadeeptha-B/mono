import { useRef, useState } from 'react'

import { Dialog } from './prompts/Dialog'
import { RegionShapeEditor } from './RegionShapeEditor'
import { GhostButton, labelClass, MinutesInput } from './ui'
import { parseBoundedMinutes } from './minutes'
import { dayKey } from '@/domain/time'
import { useSession } from '@/store/session'
import type { Settings } from '@/domain/types'

export function SettingsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const settings = useSession((s) => s.session.settings)
  const updateSettings = useSession((s) => s.updateSettings)
  const exportJSON = useSession((s) => s.exportJSON)
  const importJSON = useSession((s) => s.importJSON)
  const fileInput = useRef<HTMLInputElement>(null)
  const [importError, setImportError] = useState<string | null>(null)

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    updateSettings({ [key]: value } as Partial<Settings>)

  return (
    <Dialog open={open} title="Settings" onDismiss={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <MinutesField
          id="deep-minutes"
          label="Deep block"
          value={settings.deepMinutes}
          min={5}
          max={180}
          step={5}
          onCommit={(v) => set('deepMinutes', v)}
        />
        <MinutesField
          id="short-minutes"
          label="Short block"
          value={settings.shortMinutes}
          min={5}
          max={120}
          step={5}
          onCommit={(v) => set('shortMinutes', v)}
        />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <MinutesField
          id="reflect-minutes"
          label="Priorities timer"
          value={settings.reflectMinutes}
          min={1}
          max={30}
          step={1}
          onCommit={(v) => set('reflectMinutes', v)}
        />
      </div>

      <div className="mt-5">
        <RegionShapeEditor
          regions={settings.defaultRegions}
          onChange={(defaultRegions) => set('defaultRegions', defaultRegions)}
        />
        <p className="mt-2 text-xs leading-relaxed text-muted">
          This is the shape every day starts with. Changing a single day's hours on the
          timeline only affects that day.
        </p>
      </div>

      <fieldset className="mt-5">
        <legend className={labelClass}>How to fill free time</legend>
        <div className="space-y-2">
          <PolicyOption
            checked={settings.plannerPolicy === 'prefer-deep'}
            onChange={() => set('plannerPolicy', 'prefer-deep')}
            title="Prefer deep blocks"
            detail="Longest blocks first. Leaves more dead time, protects depth."
          />
          <PolicyOption
            checked={settings.plannerPolicy === 'maximise-focus'}
            onChange={() => set('plannerPolicy', 'maximise-focus')}
            title="Fill the most time"
            detail="Packs in the most focus minutes, usually by choosing short blocks."
          />
        </div>
      </fieldset>

      <div className="mt-5 space-y-2.5">
        <Toggle
          checked={settings.soundEnabled}
          onChange={(v) => set('soundEnabled', v)}
          label="Chime when a block ends"
        />
        <Toggle
          checked={settings.notificationsEnabled}
          onChange={(v) => set('notificationsEnabled', v)}
          label="Notify me when the tab is hidden"
        />
        <p className="text-xs leading-relaxed text-muted">
          Background notifications are best-effort — browsers throttle hidden tabs, so one
          can arrive late. Mono always reconciles when you come back.
        </p>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
        <div className="flex gap-2">
          <GhostButton type="button" onClick={() => download(exportJSON())}>
            Export
          </GhostButton>
          <GhostButton type="button" onClick={() => fileInput.current?.click()}>
            Import
          </GhostButton>
          <input
            ref={fileInput}
            type="file"
            accept="application/json"
            className="sr-only"
            onChange={async (e) => {
              const file = e.target.files?.[0]
              if (!file) return
              try {
                importJSON(await file.text())
                setImportError(null)
              } catch (error) {
                // Shown in the panel rather than through `alert`, which stops
                // the ticker dead and puts the one thing that went wrong in the
                // one place you cannot read it next to what you were doing.
                setImportError(
                  error instanceof Error ? error.message : 'Could not read that file.',
                )
              }
              e.target.value = ''
            }}
          />
        </div>
        <GhostButton type="button" onClick={onClose}>
          Done
        </GhostButton>
      </div>

      {importError !== null && (
        <p role="alert" className="mt-3 text-xs leading-relaxed text-commit">
          {importError}
        </p>
      )}
    </Dialog>
  )
}

/**
 * A minutes field wired straight to settings.
 *
 * These write through on every keystroke, and `Number('')` is 0 — so clearing
 * the field used to set a zero-minute block, with `min`/`max` decoration the
 * browser only enforced on its own spinner. Only a value inside the range is
 * committed; the shared input puts anything else back in range on the way out.
 */
function MinutesField({
  id,
  label,
  value,
  min,
  max,
  step,
  onCommit,
}: {
  id: string
  label: string
  value: number
  min: number
  max: number
  step: number
  onCommit: (value: number) => void
}) {
  const [text, setText] = useState(() => String(value))
  const [seen, setSeen] = useState(value)

  // A value changed from elsewhere — an import, or the coercion below — wins
  // over whatever is in the box. (Adjusting state during render, as React
  // documents it, rather than an effect that would paint the stale value.)
  if (value !== seen) {
    setSeen(value)
    setText(String(value))
  }

  return (
    <MinutesInput
      id={id}
      label={label}
      text={text}
      min={min}
      max={max}
      step={step}
      fallback={value}
      onText={(next) => {
        setText(next)
        // Commit as you type, but only while the value makes sense, so the
        // plan updates live without ever seeing a half-typed number.
        const parsed = parseBoundedMinutes(next, min, max)
        if (parsed !== null && parsed !== value) onCommit(parsed)
      }}
    />
  )
}

function PolicyOption({
  checked,
  onChange,
  title,
  detail,
}: {
  checked: boolean
  onChange: () => void
  title: string
  detail: string
}) {
  return (
    <label
      className={[
        'flex cursor-pointer gap-3 rounded-lg border px-3.5 py-3 transition',
        checked ? 'border-deep bg-deep/10' : 'border-line hover:bg-surface-raised',
      ].join(' ')}
    >
      <input
        type="radio"
        name="planner-policy"
        checked={checked}
        onChange={onChange}
        className="mt-1 accent-[var(--color-deep)]"
      />
      <span>
        <span className={`block text-sm ${checked ? 'text-bright' : 'text-body'}`}>
          {title}
        </span>
        <span className="mt-0.5 block text-xs leading-relaxed text-muted">{detail}</span>
      </span>
    </label>
  )
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 text-sm text-body">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-[var(--color-deep)]"
      />
      {label}
    </label>
  )
}

function download(json: string): void {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  // The local day, not the UTC one: exporting at eleven at night should not
  // produce a file stamped tomorrow.
  a.download = `mono-${dayKey(Date.now())}.json`
  a.click()
  // Revoking in the same tick cancels the download in some browsers before it
  // has read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
