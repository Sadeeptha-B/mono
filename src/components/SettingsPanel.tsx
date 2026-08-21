import { useRef } from 'react'

import { Dialog } from './prompts/Dialog'
import { RegionShapeEditor } from './RegionShapeEditor'
import { fieldClass, GhostButton, labelClass } from './ui'
import { useSession } from '@/store/session'
import type { Settings } from '@/domain/types'

export function SettingsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const settings = useSession((s) => s.session.settings)
  const updateSettings = useSession((s) => s.updateSettings)
  const exportJSON = useSession((s) => s.exportJSON)
  const importJSON = useSession((s) => s.importJSON)
  const fileInput = useRef<HTMLInputElement>(null)

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    updateSettings({ [key]: value } as Partial<Settings>)

  return (
    <Dialog open={open} title="Settings" onDismiss={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass} htmlFor="deep-minutes">
            Deep block
          </label>
          <input
            id="deep-minutes"
            type="number"
            min={5}
            max={180}
            step={5}
            value={settings.deepMinutes}
            onChange={(e) => set('deepMinutes', Number(e.target.value))}
            className={`${fieldClass} tnum`}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="short-minutes">
            Short block
          </label>
          <input
            id="short-minutes"
            type="number"
            min={5}
            max={120}
            step={5}
            value={settings.shortMinutes}
            onChange={(e) => set('shortMinutes', Number(e.target.value))}
            className={`${fieldClass} tnum`}
          />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass} htmlFor="reflect-minutes">
            Priorities timer
          </label>
          <input
            id="reflect-minutes"
            type="number"
            min={1}
            max={30}
            value={settings.reflectMinutes}
            onChange={(e) => set('reflectMinutes', Number(e.target.value))}
            className={`${fieldClass} tnum`}
          />
        </div>
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
              } catch (error) {
                alert(error instanceof Error ? error.message : 'Could not read that file.')
              }
              e.target.value = ''
            }}
          />
        </div>
        <GhostButton type="button" onClick={onClose}>
          Done
        </GhostButton>
      </div>
    </Dialog>
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
  a.download = `mono-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}
