/**
 * The cat, pixel by pixel.
 *
 * Everything the creature looks like is authored here as text. One character
 * per pixel, one string per row, so a new pose is drawn rather than derived —
 * which is the whole reason for moving off the parametric one-line character.
 * Ears, tails and squints are things you can see in the source.
 *
 * Two layers make up a frame:
 *
 *  - a **body**, a full {@link SPRITE_W}x{@link SPRITE_H} grid: silhouette,
 *    ears, tail. Posture lives here, so a mood is free to change the whole
 *    outline rather than nudge one.
 *  - a **face**, a small grid stamped onto the body at the mood's own offset.
 *    Eyes and nose only. Faces are shared between bodies — a blink is a blink
 *    whether the cat is sitting up or loafed — and they are the cheapest thing
 *    to animate, which is why they carry most of the life.
 *
 * Both are keyed records rather than loose exports, so `sprite.test.ts` and
 * the preview script pick up a new pose without being told about it. A frame
 * nobody remembered to check is the one with the short row in it.
 *
 * Palette characters:
 *   `.` transparent   `f` fur          `s` fur, in shadow
 *   `a` accent (the mood's colour: inner ear, tail tip)
 *   `e` eye           `h` eye highlight   `n` nose (also the mood's colour)
 *   `p` a heart, and `w` paper — the two things here that are not the animal
 *
 * The cat is a flat cream silhouette apart from `s`, which does two jobs: the
 * tail draped over a sleeping cat, and the markings it earns over a day. There
 * is no rim shading anywhere, on purpose — at this size a one-pixel shadow
 * reads as a rendering fault rather than as volume.
 */

export const SPRITE_W = 24
export const SPRITE_H = 16

/** A grid of palette characters, one string per row. */
export type Grid = readonly string[]

export const TRANSPARENT = '.'

/**
 * Every posture the cat has.
 *
 * They are all the same animal seen from the front, so what separates them is
 * height, width, ear angle and where the tail is — not a change of viewpoint.
 * That constraint is what keeps seven poses recognisable as one creature.
 */
export const BODIES = {
  /**
   * Sitting up, ears forward, tail curled. The pose everything else is a
   * departure from, and the one on screen most: idle covers every phase where
   * Mono is waiting on the user rather than counting anything down.
   */
  sit: [
    '.....f........f.........',
    '....faf......faf........',
    '...faaaf....faaaf.......',
    '...ffffffffffffff.......',
    '..ffffffffffffffff......',
    '..ffffffffffffffff......',
    '..ffffffffffffffff......',
    '..ffffffffffffffff......',
    '..ffffffffffffffff..fa..',
    '..ffffffffffffffff..ff..',
    '.ffffffffffffffffff.ff..',
    '.ffffffffffffffffff.ff..',
    '.fffffffffffffffffffff..',
    '.ffffffffffffffffffff...',
    '.fffffffffffffffffff....',
    '..ffff..fffff..ffff.....',
  ],

  /**
   * Leaning in: the head is bigger and the body barely shows, which is how a
   * front-facing creature gets closer to you without turning. Ears up, tail
   * mostly hidden behind it. The only pose that looks about to speak, worn
   * while Mono is asking what the block is for.
   */
  lean: [
    '.....f........f.........',
    '....faf......faf........',
    '...faaaf....faaaf.......',
    '..ffffffffffffffff......',
    '.ffffffffffffffffff.....',
    '.ffffffffffffffffff.....',
    '.ffffffffffffffffff.....',
    '.ffffffffffffffffff.....',
    '.ffffffffffffffffff.....',
    '.ffffffffffffffffff.....',
    '.ffffffffffffffffff.....',
    '..ffffffffffffffff......',
    '..ffffffffffffffff..fa..',
    '..ffffffffffffffff..ff..',
    '..ffffffffffffffffffff..',
    '...ffff..fffff..ffff....',
  ],

  /**
   * One ear up, the other folded over. Asymmetry is the whole trick: a tilted
   * head is unavailable head-on, but an ear that has stopped agreeing with the
   * other one reads as a creature part-way through a thought. Worn while the
   * priorities timer runs.
   */
  curl: [
    '.....f..................',
    '....faf.................',
    '...faaaf.....faaf.......',
    '...ffffffffffffff.......',
    '..ffffffffffffffff......',
    '..ffffffffffffffff......',
    '..ffffffffffffffff......',
    '..ffffffffffffffff......',
    '..ffffffffffffffff......',
    '..ffffffffffffffff..fa..',
    '.ffffffffffffffffff.ff..',
    '.ffffffffffffffffff.ff..',
    '.fffffffffffffffffff.f..',
    '.ffffffffffffffffffff...',
    '.fffffffffffffffffff....',
    '..ffff..fffff..ffff.....',
  ],

  /**
   * The loaf: head sunk into the shoulders, ears eased outward, tail curled
   * tight at the back. Lower and wider than the sit, which is what makes it
   * read as settled rather than merely still. This is the block pose.
   */
  loaf: [
    '........................',
    '....f..........f........',
    '...faf........faf.......',
    '..faaaf......faaaf......',
    '..ffffffffffffffff......',
    '..ffffffffffffffff......',
    '..ffffffffffffffff......',
    '..ffffffffffffffff......',
    '..ffffffffffffffff......',
    '.ffffffffffffffffff.....',
    '.ffffffffffffffffff.....',
    '.fffffffffffffffffff....',
    '.fffffffffffffffffff.fa.',
    '.fffffffffffffffffff.ff.',
    '.ffffffffffffffffffffff.',
    '..ffff..fffff..ffff.....',
  ],

  /**
   * Chest up, ears at full height, tail straight in the air. Held for a second
   * or two when a block lands and never otherwise, so it is allowed to be the
   * loudest pose in the set.
   */
  perk: [
    '.....f........f.........',
    '....faf......faf........',
    '....faf......faf........',
    '...faaaf....faaaf.......',
    '...ffffffffffffff.......',
    '..ffffffffffffffff......',
    '..ffffffffffffffff......',
    '..ffffffffffffffff..fa..',
    '..ffffffffffffffff..ff..',
    '..ffffffffffffffff..ff..',
    '...ffffffffffffff...ff..',
    '...ffffffffffffff...ff..',
    '..ffffffffffffffff..ff..',
    '..ffffffffffffffffffff..',
    '..ffffffffffffffff......',
    '...ffff..fffff..ffff....',
  ],

  /**
   * Spread out along the ground, tail stretched away to the right. Four rows
   * shorter than the sit and four wider, which is the whole of what "off duty"
   * looks like from the front. Worn on a break.
   */
  sprawl: [
    '........................',
    '........................',
    '........................',
    '........................',
    '....f..........f........',
    '...faf........faf.......',
    '..faaaf......faaaf......',
    '..ffffffffffffffff......',
    '..ffffffffffffffff......',
    '..ffffffffffffffff......',
    '..ffffffffffffffff......',
    '.fffffffffffffffffff....',
    'ffffffffffffffffffffff..',
    'ffffffffffffffffffffff..',
    'ffffffffffffffffffffffa.',
    '.ffff..fffff..ffffff....',
  ],

  /**
   * Curled into a ball with the tail laid across it and the ears folded flat —
   * flat enough that the coloured inner ear disappears entirely, which is the
   * one thing no other pose does. Nobody is home. This is what Mono comes back
   * to after the machine slept.
   */
  ball: [
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '....ff........ff........',
    '..ffffffffffffffff......',
    '..ffffffffffffffff......',
    '..ffffffffffffffff......',
    '.fffffffffffffffffff....',
    'ffffffffffffffffffffff..',
    'ffassssssssssssssfffff..',
    '.ffffffffffffffffffff...',
    '..ffffffffffffffff......',
  ],
} satisfies Record<string, Grid>

export type BodyName = keyof typeof BODIES

/**
 * Faces, stamped onto whichever body is current.
 *
 * Ten wide by four tall, aligned so the eyes land on the same columns in every
 * body, whatever the head is doing. The highlight sits to the right of both
 * pupils rather than mirrored, so the light in the room has one direction.
 *
 * The blank third row is the gap between eye and nose. It is load-bearing:
 * with the nose one row up, tight under the eyes, the whole face reads as a
 * scowl.
 *
 * Stamping the face one column left or right is also how the cat looks at
 * your cursor — see `gaze` in `PixelCat.tsx`. Nothing here has to know.
 */
export const FACES = {
  open: ['.eh....eh.', '.ee....ee.', '..........', '....nn....'],

  blink: ['..........', '.ee....ee.', '..........', '....nn....'],

  /** Half again as wide as open. Attention, not surprise. */
  wide: ['eeh....eeh', 'eee....eee', '..........', '....nn....'],

  /**
   * Both eyes shifted a column off-centre with the glint moved to the other
   * side, so the cat is looking somewhere that is not you. The nose stays put:
   * the eyes moved, not the head.
   */
  aside: ['he....he..', 'ee....ee..', '..........', '....nn....'],

  /** Narrowed to a slot. Wider than the open eye and only one pixel tall. */
  squint: ['..........', 'eee....eee', '..........', '....nn....'],

  /** Both eyes arched shut. The pleased face. */
  happy: ['.e......e.', 'e.e....e.e', '..........', '....nn....'],

  /** Eyes gone entirely. A blink out of the squint, which is already a slot. */
  shut: ['..........', '..........', '..........', '....nn....'],
} satisfies Record<string, Grid>

export type FaceName = keyof typeof FACES

/**
 * A heart, for when the cat is being petted.
 *
 * Five by five is the smallest a heart can be and still read as one — three by
 * three came out as a shrug. It is drawn in the sprite's own coordinates at an
 * offset the mood chooses, because where the empty air above the cat is
 * depends on how tall the cat is.
 */
export const SPARK: Grid = ['.p.p.', 'ppppp', 'ppppp', '.ppp.', '..p..']

/**
 * The note, which is the purpose you named held where you can see it.
 *
 * Only the poses that can be holding one declare somewhere to put it, and it
 * only appears when a block actually has a purpose. The words are not on it —
 * they are under the timer, where they belong, and repeating them on a card
 * six pixels wide would be saying the same thing twice and reading neither.
 * What the card is for is the fact of it: you named something, and the cat is
 * sitting with it.
 *
 * Edged in fur-shadow rather than ink. An ink border put the highest-contrast
 * thing on the screen on the cat during a block, which is the one time it is
 * supposed to be the least interesting thing on the screen.
 */
export const NOTE: Grid = ['ssssss', 'swwwws', 'sweews', 'ssssss']

/**
 * Markings, earned by banking blocks. See `markTierFor` in `cat.ts`.
 *
 * Stamped at each pose's own `marks` anchor, which is a patch of solid flank —
 * where a tabby's stripes actually are, and the one part of the animal that
 * stays broad and unobstructed whatever it is doing. Nothing is ever taken
 * away: the day only adds.
 */
export const MARKINGS: readonly Grid[] = [
  ['.s.s.', '.s.s.', '.....'],
  ['s.s.s', 's.s.s', 's.s.s'],
]
