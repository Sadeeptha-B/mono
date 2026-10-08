/**
 * What All Tasks' tree has open: a new task's or place's field, a rename, a
 * row's `⋯`, a delete asking first. Each names its row by id and is held by
 * the tree, above the rows it edits.
 *
 * The fields are editors, and they keep the rule every editor in Mono keeps:
 * one whose subject vanishes closes, before paint. A rename lasts only while
 * its task is drawn open — a done row has no rename — and a new task's field
 * only while its place is drawn, whether a search hid it or an update from
 * another tab took it. Held up here by id, without the rule the state outlived
 * the row, and when the task came back — its epic reopened, the search
 * cleared — the old editor came back with it. So each is let go during render,
 * and the stale one is never painted and never mounts again on its own.
 *
 * A field is focused by the press that opens it, never by mounting. The two
 * used to be the same thing, and then every other reason a field mounts took
 * focus too: the editor coming back with its task, or a task moved by another
 * tab from one place to another, whose rename unmounts under the old place and
 * mounts under the new, draft and all. So `+ Task` and ✎ ask for their field
 * by key (`focusReturn.ts`), and it is focused after the render that draws it;
 * a field drawn for any other reason is drawn and left alone.
 */

import { useEffect, useRef, useState, type RefObject } from 'react'

import { drawnTask, drawsPlace } from './shown'
import type { ItemKind, TaskTreeNode } from '@/domain/tasks'

export type Editors = ReturnType<typeof useTreeEditors>

export function useTreeEditors(
  shown: readonly TaskTreeNode[],
  root: RefObject<HTMLElement | null>,
) {
  /** The place something new is being written into, if any: what, and what is typed. */
  const [adding, setAdding] = useState<{
    parentId: string
    kind: ItemKind
    title: string
  } | null>(null)
  /** The place being renamed, if any, and its name as typed. */
  const [renamingPlace, setRenamingPlace] = useState<{ id: string; name: string } | null>(null)
  /** The place or task whose `⋯` is open, if any — one at a time. */
  const [menu, setMenu] = useState<string | null>(null)
  /** The place whose delete is asking first, if any. */
  const [confirming, setConfirming] = useState<string | null>(null)
  /** The task being renamed, if any, and its title as typed. */
  const [renaming, setRenaming] = useState<{ taskId: string; title: string } | null>(null)

  // An editor whose subject is no longer drawn closes — see the header.
  if (renaming && drawnTask(shown, renaming.taskId)?.status !== 'open') setRenaming(null)
  if (adding && !drawsPlace(shown, adding.parentId)) setAdding(null)
  if (renamingPlace && !drawsPlace(shown, renamingPlace.id)) setRenamingPlace(null)
  if (confirming !== null && !drawsPlace(shown, confirming)) setConfirming(null)
  if (menu !== null && !drawsPlace(shown, menu) && !drawnTask(shown, menu)) setMenu(null)

  /** Close a row's `⋯`, and whatever it had asking. */
  const closeMenu = () => {
    setMenu(null)
    setConfirming(null)
  }
  const toggleMenu = (id: string) => {
    if (menu === id) return closeMenu()
    setMenu(id)
    setConfirming(null)
  }

  // A press anywhere outside the open popup and its `⋯` closes it. Asked of
  // the path the press took rather than of where its target is now: a button
  // inside the popup is gone from the page by the time the press reaches the
  // document, and a target no longer inside anything reads as outside.
  const openMenu = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (menu === null) return
    const doc = root.current?.ownerDocument
    if (!doc) return
    const onClick = (e: MouseEvent) => {
      if (openMenu.current && !e.composedPath().includes(openMenu.current)) {
        setMenu(null)
        setConfirming(null)
      }
    }
    doc.addEventListener('click', onClick)
    return () => doc.removeEventListener('click', onClick)
  }, [menu, root])

  return {
    adding,
    setAdding,
    renamingPlace,
    setRenamingPlace,
    menu,
    confirming,
    setConfirming,
    renaming,
    setRenaming,
    closeMenu,
    toggleMenu,
    openMenu,
  }
}
