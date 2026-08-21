/**
 * The whole of Mono's routing.
 *
 * There are exactly two views — the day, and the guide — so this is a hash
 * check rather than a router. The hash is deliberate: it survives a reload,
 * it can be opened in a second tab, and the header entries are real links, so
 * middle-click and "open in new tab" behave the way people expect of a
 * document.
 *
 * Nothing unmounts across a route change. `App` keeps the store hooks running
 * and swaps only what it renders, so a block in flight keeps its timer while
 * you read.
 */

import { useSyncExternalStore } from 'react'

export type Route = 'day' | 'guide'

export const GUIDE_HASH = '#/guide'
export const DAY_HASH = '#/'

const subscribe = (listener: () => void): (() => void) => {
  window.addEventListener('hashchange', listener)
  return () => window.removeEventListener('hashchange', listener)
}

const getSnapshot = (): string => window.location.hash

export function useRoute(): Route {
  // The server snapshot is only here to satisfy the signature; there is no SSR.
  const hash = useSyncExternalStore(subscribe, getSnapshot, () => '')
  return hash === GUIDE_HASH ? 'guide' : 'day'
}
