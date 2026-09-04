/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/**
 * Document Picture-in-Picture, which TypeScript's DOM library does not carry.
 *
 * `lib.dom.d.ts` already has `PictureInPictureWindow` and friends — those are
 * the *video* API, a different thing entirely, and none of these names may
 * collide with them.
 *
 * Every option is spelled `| undefined` rather than left bare because this
 * project runs `exactOptionalPropertyTypes`: without it, building the options
 * object from values that might be missing does not typecheck.
 *
 * `documentPictureInPicture` is optional on `Window` on purpose. It is absent
 * outside Chromium, and the whole feature is gated on that being visible in the
 * types rather than remembered at each call site.
 */
interface DocumentPictureInPictureOptions {
  width?: number | undefined
  height?: number | undefined
  disallowReturnToOpener?: boolean | undefined
  preferInitialWindowPlacement?: boolean | undefined
}

interface DocumentPictureInPicture extends EventTarget {
  /** The open mini window, or null. At most one exists per document. */
  readonly window: Window | null
  /** Rejects unless called inside a user gesture, and if one is already open. */
  requestWindow(options?: DocumentPictureInPictureOptions): Promise<Window>
}

interface Window {
  readonly documentPictureInPicture?: DocumentPictureInPicture
}
