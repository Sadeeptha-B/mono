/**
 * The contract guard.
 *
 * Every case here is a way the extension could be told to block something it
 * should not, or told to block it forever. That is the asymmetry the whole
 * design turns on: failing to block costs one block, and blocking wrongly costs
 * the user their browser with no running app to explain why. So the tests are
 * mostly rejections, and the one thing every rejection has in common is that it
 * returns `null` rather than "keep whatever you had".
 */

import { describe, expect, it } from 'vitest'

import {
  BLOCKING_CHANNEL,
  MAX_BLOCK_MS,
  MAX_CLOCK_SKEW_MS,
  NOT_RUNNING,
  readBlockingIntent,
  readBlockingRequest,
} from './blocking'


const NOW = new Date(2026, 7, 20, 14, 0, 0).getTime()

const running = (patch: Record<string, unknown> = {}) => ({
  channel: BLOCKING_CHANNEL,
  v: 1,
  running: true,
  segmentId: 'seg-1',
  endsAt: NOW + 45 * 60_000,
  startedAt: NOW - 5 * 60_000,
  blockKind: 'deep',
  purpose: 'Rewrite the planner docs',
  ...patch,
})

describe('readBlockingIntent', () => {
  it('reads a running block', () => {
    expect(readBlockingIntent(running(), NOW)).toEqual({
      channel: BLOCKING_CHANNEL,
      v: 1,
      running: true,
      segmentId: 'seg-1',
      endsAt: NOW + 45 * 60_000,
      startedAt: NOW - 5 * 60_000,
      blockKind: 'deep',
      purpose: 'Rewrite the planner docs',
    })
  })

  it('reads the idle intent', () => {
    expect(readBlockingIntent({ channel: BLOCKING_CHANNEL, v: 1, running: false }, NOW)).toEqual(
      NOT_RUNNING,
    )
  })

  /**
   * An idle intent names the block the publisher believes stopped, so a stale
   * Mono tab announcing the end of a block that finished ten minutes ago cannot
   * tear down rules for the one running now.
   */
  it('reads the segment an idle intent says has stopped', () => {
    expect(
      readBlockingIntent(
        { channel: BLOCKING_CHANNEL, v: 1, running: false, stoppedSegmentId: 'seg-1' },
        NOW,
      ),
    ).toEqual({ channel: BLOCKING_CHANNEL, v: 1, running: false, stoppedSegmentId: 'seg-1' })
  })

  /**
   * Read leniently, and it has to be. An idle nobody can qualify must still be
   * able to stop blocking — refusing it here would be a way to stay blocked.
   */
  it.each([
    ['absent', {}],
    ['null', { stoppedSegmentId: null }],
    ['empty', { stoppedSegmentId: '' }],
    ['the wrong type', { stoppedSegmentId: 7 }],
  ])('folds a stopped segment that is %s to an unconditional stop', (_label, extra) => {
    expect(
      readBlockingIntent({ channel: BLOCKING_CHANNEL, v: 1, running: false, ...extra }, NOW),
    ).toEqual(NOT_RUNNING)
  })

  it('accepts a block with no purpose, which is what the priorities timer is', () => {
    const intent = readBlockingIntent(running({ blockKind: 'reflect', purpose: null }), NOW)
    expect(intent?.running === true && intent.purpose).toBeNull()
  })

  it.each([
    ['not an object', 42],
    ['null', null],
    ['another channel entirely', { ...running(), channel: 'someone.else' }],
    ['no channel', { v: 1, running: false }],
  ])('ignores %s', (_label, value) => {
    expect(readBlockingIntent(value, NOW)).toBeNull()
  })

  // The version is what makes the two halves independently deployable: the
  // extension sits behind a store review and is always the older of the two, so
  // a `v` it has never heard of has to mean stop rather than guess.
  it.each([2, 0, '1', undefined])('refuses contract version %s', (v) => {
    expect(readBlockingIntent({ ...running(), v }, NOW)).toBeNull()
  })

  it('refuses a running flag that is neither true nor false', () => {
    expect(readBlockingIntent({ ...running(), running: 'yes' }, NOW)).toBeNull()
  })

  describe('the two time bounds, which are the load-bearing ones', () => {
    it('refuses an endsAt that has already passed', () => {
      // A stale message that overtook a newer one. Honouring it would arm an
      // alarm for a moment that has been and gone, and the rules would stay up.
      expect(readBlockingIntent(running({ endsAt: NOW - 1 }), NOW)).toBeNull()
    })

    it('refuses an endsAt of exactly now', () => {
      expect(readBlockingIntent(running({ endsAt: NOW }), NOW)).toBeNull()
    })

    it('refuses an endsAt beyond the clamp', () => {
      expect(readBlockingIntent(running({ endsAt: NOW + MAX_BLOCK_MS + 1 }), NOW)).toBeNull()
    })

    it('accepts an endsAt exactly at the clamp', () => {
      // The two clamps compose, which is the point of the second one: a block
      // ending four hours from now can only have begun now, because a wider
      // span than that is refused whichever end you measure from.
      expect(
        readBlockingIntent(running({ endsAt: NOW + MAX_BLOCK_MS, startedAt: NOW }), NOW),
      ).not.toBeNull()
    })

    it.each([Infinity, NaN, 'soon', null])('refuses a non-finite endsAt: %s', (endsAt) => {
      expect(readBlockingIntent(running({ endsAt }), NOW)).toBeNull()
    })
  })

  /**
   * `startedAt` is what lets two running intents be ordered, which is the whole
   * of the extension's defence against a stale tab arming a block that is over.
   * A running intent that cannot be ordered is refused rather than guessed at:
   * softening this to "assume it is old" or "assume it is new" would each pick
   * one of the two failures the field exists to remove.
   */
  describe('startedAt, the ordering token', () => {
    it.each([
      ['absent', { startedAt: undefined }],
      ['null', { startedAt: null }],
      ['a string', { startedAt: '2026-08-20T13:55:00Z' }],
      ['Infinity', { startedAt: Infinity }],
      ['NaN', { startedAt: NaN }],
    ])('refuses a startedAt that is %s', (_label, patch) => {
      expect(readBlockingIntent(running(patch), NOW)).toBeNull()
    })

    it('accepts the ordinary case: a block that began a few minutes ago', () => {
      expect(readBlockingIntent(running({ startedAt: NOW - 5 * 60_000 }), NOW)).not.toBeNull()
    })

    /**
     * Held to the same standard as `endsAt`, because a later start outranks an
     * earlier one. A block claiming to have begun in the future would outrank
     * every block that has actually happened, and keep that rank until the clock
     * caught up with the claim.
     */
    describe('a start that has not happened yet', () => {
      it('refuses one beyond the skew allowance', () => {
        expect(
          readBlockingIntent(running({ startedAt: NOW + MAX_CLOCK_SKEW_MS + 1 }), NOW),
        ).toBeNull()
      })

      it('accepts one inside it, which is a clock corrected backwards', () => {
        expect(
          readBlockingIntent(running({ startedAt: NOW + MAX_CLOCK_SKEW_MS }), NOW),
        ).not.toBeNull()
      })

      it('keeps the allowance far below any real block', () => {
        expect(MAX_CLOCK_SKEW_MS).toBeLessThan(20 * 60_000)
      })
    })

    it('refuses a block that ends at the moment it began', () => {
      // Not a block anyone can sit through, so not a block that can be running.
      const endsAt = NOW + 45 * 60_000
      expect(readBlockingIntent(running({ startedAt: endsAt, endsAt }), NOW)).toBeNull()
    })

    it('refuses a block that ends before it began', () => {
      expect(readBlockingIntent(running({ startedAt: NOW + 46 * 60_000 }), NOW)).toBeNull()
    })

    /**
     * The clamp measured from the other side. Without this, "bounded" would be
     * true of the end instant and false of the token that orders it — a start
     * arbitrarily far in the past would sail through every other check.
     */
    describe('the span between the two', () => {
      it('refuses one wider than the clamp', () => {
        const endsAt = NOW + 60_000
        expect(
          readBlockingIntent(running({ startedAt: endsAt - MAX_BLOCK_MS - 1, endsAt }), NOW),
        ).toBeNull()
      })

      it('accepts one exactly at the clamp', () => {
        const endsAt = NOW + 60_000
        expect(
          readBlockingIntent(running({ startedAt: endsAt - MAX_BLOCK_MS, endsAt }), NOW),
        ).not.toBeNull()
      })
    })
  })

  it.each([
    ['an unknown block kind', { blockKind: 'epic' }],
    ['a missing block kind', { blockKind: undefined }],
    ['an empty segment id', { segmentId: '' }],
    ['a non-string segment id', { segmentId: 7 }],
    ['a purpose that is not a string', { purpose: { text: 'no' } }],
  ])('refuses %s', (_label, patch) => {
    expect(readBlockingIntent(running(patch), NOW)).toBeNull()
  })

  // Mono's own blocks are minutes long, so the clamp constrains nothing a user
  // can do. It exists for the case where the page sending this is not Mono.
  it('holds the clamp well above any real block', () => {
    expect(MAX_BLOCK_MS).toBeGreaterThan(2 * 60 * 60_000)
  })
})

describe('readBlockingRequest', () => {
  it('reads republish', () => {
    expect(readBlockingRequest({ channel: BLOCKING_CHANNEL, v: 1, request: 'republish' })).toEqual({
      channel: BLOCKING_CHANNEL,
      v: 1,
      request: 'republish',
    })
  })

  it('reads endBlockEarly with the segment it names', () => {
    expect(
      readBlockingRequest({
        channel: BLOCKING_CHANNEL,
        v: 1,
        request: 'endBlockEarly',
        segmentId: 'seg-1',
      }),
    ).toEqual({ channel: BLOCKING_CHANNEL, v: 1, request: 'endBlockEarly', segmentId: 'seg-1' })
  })

  /**
   * Refused rather than softened into "whatever is running". No version of the
   * extension has ever shipped, so there is nothing older to be compatible
   * with, and the fallback would leave open the one hole the field closes: a
   * request delivered late ending a block the user had only just started.
   */
  it.each([
    ['absent', {}],
    ['null', { segmentId: null }],
    ['the wrong type', { segmentId: 42 }],
    ['empty', { segmentId: '' }],
  ])('refuses an end request whose segment id is %s', (_label, extra) => {
    expect(
      readBlockingRequest({
        channel: BLOCKING_CHANNEL,
        v: 1,
        request: 'endBlockEarly',
        ...extra,
      }),
    ).toBeNull()
  })

  it.each([
    ['an unknown request', { channel: BLOCKING_CHANNEL, v: 1, request: 'unblockEverything' }],
    ['an intent, which is the other direction', { channel: BLOCKING_CHANNEL, v: 1, running: false }],
    ['a future version', { channel: BLOCKING_CHANNEL, v: 2, request: 'republish' }],
  ])('refuses %s', (_label, value) => {
    expect(readBlockingRequest(value)).toBeNull()
  })
})
