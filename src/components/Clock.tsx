import { format } from 'date-fns'

type Props = { now: number }

export function Clock({ now }: Props) {
  return (
    <div>
      <div className="tnum text-5xl font-light tracking-tight text-bright sm:text-7xl">
        {format(now, 'h:mm')}
        <span className="ml-2 text-xl text-muted sm:ml-3 sm:text-3xl">{format(now, 'a')}</span>
      </div>
      <div className="mt-1 text-sm text-muted">{format(now, 'EEEE d MMMM')}</div>
    </div>
  )
}
