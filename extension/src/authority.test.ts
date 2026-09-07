/**
 * The authority table, as a table.
 *
 * Every case here is a way one Mono tab could have unblocked a block another
 * tab was running. That was a real hole and not a theoretical one: idle used to
 * be anonymous, an unqualified stop stopped everything, and a message the worker
 * could not read became an unqualified stop. Two tabs hold two independent
 * stores, so all three were reachable from an ordinary second tab.
 *
 * `decideIntent` is pure precisely so this file can exist without a browser. The
 * side effects it implies — storage, rules, the alarm — are covered separately
 * in `background.test.ts`; what is checked here is only the judgement.
 */

import { describe, expect, it } from 'vitest'

import { BLOCKING_CHANNEL, type BlockingIntent } from '@/contract/blocking'
import { applicableLease, decideIntent, type Publisher } from './authority'
import type { ArmedBlock, PublisherLease } from './state'

const NOW = new Date(2026, 7, 20, 14, 0, 0).getTime()

const block = (segmentId: string, startedAt: number): ArmedBlock => ({
  channel: BLOCKING_CHANNEL,
  v: 1,
  running: true,
  segmentId,
  endsAt: startedAt + 45 * 60_000,
  startedAt,
  blockKind: 'deep',
  purpose: 'Rewrite the planner docs',
})

const stop = (stoppedSegmentId: string | null): BlockingIntent => ({
  channel: BLOCKING_CHANNEL,
  v: 1,
  running: false,
  stoppedSegmentId,
})

/** What the worker is handed when the message could not be read at all. */
const UNREADABLE = null

const from = (documentId: string | null, tabId: number | null = 1): Publisher => ({
  documentId,
  tabId,
})

const A = from('doc-a', 1)
const B = from('doc-b', 2)
const ANONYMOUS = from(null, 3)

const armed = block('seg-a', NOW)
const later = block('seg-b', NOW + 60_000)
const earlier = block('seg-0', NOW - 60_000)

/** The lease `doc-a` would hold after arming `armed`. */
const leaseA: PublisherLease = { segmentId: 'seg-a', documentId: 'doc-a', tabId: 1 }

describe('a running intent', () => {
  it('arms when nothing is armed, and the sender takes the lease', () => {
    expect(
      decideIntent({ armed: null, lease: null, incoming: armed, sender: A }),
    ).toEqual({
      verdict: 'arm',
      block: armed,
      lease: { segmentId: 'seg-a', documentId: 'doc-a', tabId: 1 },
    })
  })

  /**
   * The re-arming path, and it has to stay open. A page that reloads mid-block
   * republishes the block it rehydrated, and a worker Chrome killed in the
   * meantime knows nothing about it — refusing a repeat of what is already
   * armed would mean blocking silently stops after any reload.
   */
  it('accepts the same block again and moves the lease to whoever said so', () => {
    expect(decideIntent({ armed, lease: leaseA, incoming: armed, sender: B })).toEqual({
      verdict: 'arm',
      block: armed,
      lease: { segmentId: 'seg-a', documentId: 'doc-b', tabId: 2 },
    })
  })

  /**
   * A segment's start and end are replayed off Mono's log and never change, so
   * a "repeat" that disagrees about either is not this block being republished.
   * The only thing claiming an armed block's name for a later end could buy is
   * a longer one.
   */
  it.each([
    ['a different end', { endsAt: NOW + 4 * 60 * 60_000 }],
    ['a different start', { startedAt: NOW - 60_000 }],
  ])('ignores the armed segment republished with %s', (_label, patch) => {
    const impostor = { ...armed, ...patch }
    expect(decideIntent({ armed, lease: leaseA, incoming: impostor, sender: B })).toEqual({
      verdict: 'ignore',
      because: 'contradicts-armed',
    })
  })

  it('accepts a block that began later than the one armed', () => {
    expect(decideIntent({ armed, lease: leaseA, incoming: later, sender: B })).toEqual({
      verdict: 'arm',
      block: later,
      lease: { segmentId: 'seg-b', documentId: 'doc-b', tabId: 2 },
    })
  })

  /**
   * The stale-tab case. A tab still holding a block that has been replaced can
   * republish it — on its own reload, or when the worker asks everyone to say
   * where they stand — and arming it would throw away the block the user is
   * actually sitting through.
   */
  it('ignores a block that began earlier than the one armed', () => {
    expect(decideIntent({ armed, lease: leaseA, incoming: earlier, sender: B })).toEqual({
      verdict: 'ignore',
      because: 'not-newer',
    })
  })

  it('ignores a different block that claims the same instant', () => {
    const twin = block('seg-twin', NOW)
    expect(decideIntent({ armed, lease: leaseA, incoming: twin, sender: B })).toEqual({
      verdict: 'ignore',
      because: 'not-newer',
    })
  })

  it('does not need a lease to displace one, only a later start', () => {
    // The lease orders nothing. It decides who may be vague, and a running
    // intent is never vague.
    expect(decideIntent({ armed, lease: leaseA, incoming: later, sender: ANONYMOUS })).toEqual({
      verdict: 'arm',
      block: later,
      lease: null,
    })
  })

  it('records no lease for a sender Chrome could not identify', () => {
    const decision = decideIntent({ armed: null, lease: null, incoming: armed, sender: ANONYMOUS })
    expect(decision).toEqual({ verdict: 'arm', block: armed, lease: null })
  })
})

describe('a named stop', () => {
  /**
   * Self-scoping, so no publisher check is needed. Naming the block bounds what
   * the message can do rather than proving who sent it: it can do nothing at all
   * to a block it has not heard of, which is what makes it safe from any sender.
   */
  it('disarms the block it names, whoever sent it', () => {
    expect(decideIntent({ armed, lease: leaseA, incoming: stop('seg-a'), sender: B })).toEqual({
      verdict: 'disarm',
    })
  })

  it('is ignored when it names a block that is not the one armed', () => {
    expect(decideIntent({ armed, lease: leaseA, incoming: stop('seg-old'), sender: A })).toEqual({
      verdict: 'ignore',
      because: 'names-another-block',
    })
  })

  it('disarms when nothing is armed, which costs nothing and tidies up', () => {
    expect(
      decideIntent({ armed: null, lease: null, incoming: stop('seg-a'), sender: A }),
    ).toEqual({ verdict: 'disarm' })
  })
})

describe('an unqualified message', () => {
  const anonymous = stop(null)

  it.each([
    ['an anonymous stop', anonymous],
    ['a message that could not be read', UNREADABLE],
  ])('ignores %s from a document that holds no lease', (_label, incoming) => {
    expect(decideIntent({ armed, lease: leaseA, incoming, sender: B })).toEqual({
      verdict: 'ignore',
      because: 'not-the-publisher',
    })
  })

  it.each([
    ['an anonymous stop', anonymous],
    ['a message that could not be read', UNREADABLE],
  ])('honours %s from the document holding the lease', (_label, incoming) => {
    expect(decideIntent({ armed, lease: leaseA, incoming, sender: A })).toEqual({
      verdict: 'disarm',
    })
  })

  /**
   * Chrome clears session storage on a browser restart, an extension reload, an
   * update and a disable/enable. Any of those can leave a block armed from local
   * storage with no living publisher behind it, and the first page to load is
   * then the best evidence anyone has about whether that block is still real.
   */
  it('honours an anonymous stop when no lease was recorded at all', () => {
    expect(decideIntent({ armed, lease: null, incoming: anonymous, sender: A })).toEqual({
      verdict: 'disarm',
    })
  })

  /**
   * The partial-write case, and the reason a lease names its segment. Arming a
   * block and recording its publisher are two writes; if the second fails, the
   * stored lease still names the *previous* block. A bare document id would
   * leave that previous owner in authority over a block it has never heard of —
   * the original cross-tab failure, rebuilt. Naming the segment makes the stale
   * lease inert instead, which fails open.
   */
  it('treats a lease naming another block as no lease', () => {
    const stale: PublisherLease = { segmentId: 'seg-gone', documentId: 'doc-a', tabId: 1 }

    expect(decideIntent({ armed, lease: stale, incoming: anonymous, sender: A })).toEqual({
      verdict: 'disarm',
    })
    // And it buys its holder nothing over the block it does not name.
    expect(decideIntent({ armed, lease: stale, incoming: anonymous, sender: B })).toEqual({
      verdict: 'disarm',
    })
  })

  it('ignores one from a sender with no identity while a lease is held', () => {
    // Absence cannot match absence. A message Chrome could not attribute is not
    // thereby the holder of anything.
    expect(decideIntent({ armed, lease: leaseA, incoming: anonymous, sender: ANONYMOUS })).toEqual({
      verdict: 'ignore',
      because: 'not-the-publisher',
    })
  })

  it('disarms when nothing is armed, so a stray rule still goes', () => {
    expect(
      decideIntent({ armed: null, lease: leaseA, incoming: UNREADABLE, sender: B }),
    ).toEqual({ verdict: 'disarm' })
  })
})

describe('applicableLease', () => {
  it('is the lease when it names the armed block', () => {
    expect(applicableLease(armed, leaseA)).toBe(leaseA)
  })

  it.each([
    ['nothing is armed', null, leaseA],
    ['no lease was recorded', armed, null],
    ['the lease names another block', armed, { ...leaseA, segmentId: 'seg-gone' }],
  ])('is nobody when %s', (_label, arm, lease) => {
    expect(applicableLease(arm, lease)).toBeNull()
  })
})

/**
 * The failure this whole file exists for, written out as the sequence that
 * produced it. Before the publisher check, every step but the last was the same
 * and the last one disarmed.
 */
describe('the second-tab failure, end to end', () => {
  it('survives a fresh tab that reconstructed an empty day', () => {
    // Tab A starts a block. Its localStorage write failed, which Mono tolerates.
    expect(decideIntent({ armed: null, lease: null, incoming: armed, sender: A })).toEqual({
      verdict: 'arm',
      block: armed,
      lease: leaseA,
    })

    // Tab B loads, rehydrates nothing, and says so on the way in.
    expect(decideIntent({ armed, lease: leaseA, incoming: stop(null), sender: B })).toEqual({
      verdict: 'ignore',
      because: 'not-the-publisher',
    })
  })

  it('survives a stale tab republishing a block whose endsAt has passed', () => {
    // The stale intent fails validation — an expired block is not a block — and
    // reaches the decision as an unreadable message rather than as a stop.
    expect(decideIntent({ armed, lease: leaseA, incoming: UNREADABLE, sender: B })).toEqual({
      verdict: 'ignore',
      because: 'not-the-publisher',
    })
  })

  it('still lets the tab actually running the block end it', () => {
    expect(decideIntent({ armed, lease: leaseA, incoming: stop('seg-a'), sender: A })).toEqual({
      verdict: 'disarm',
    })
  })
})
