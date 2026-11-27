/**
 * Phone screen helpers: fullscreen (Android and desktop; iPhone Safari has no
 * fullscreen for pages, the home-screen app is the way there) and a wake lock
 * so the screen does not dim mid-run with no touches on it.
 */

type WebkitDocument = Document & { webkitFullscreenEnabled?: boolean; webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> }
type WebkitElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> }

export function fullscreenSupported(): boolean {
  const doc = document as WebkitDocument
  return Boolean(doc.fullscreenEnabled || doc.webkitFullscreenEnabled)
}

export function isFullscreen(): boolean {
  const doc = document as WebkitDocument
  return Boolean(doc.fullscreenElement || doc.webkitFullscreenElement)
}

/** Enter or leave fullscreen. Must run inside a tap or click. */
export async function toggleFullscreen(): Promise<void> {
  const doc = document as WebkitDocument
  const root = document.documentElement as WebkitElement
  try {
    if (isFullscreen()) await (doc.exitFullscreen?.() ?? doc.webkitExitFullscreen?.())
    else await (root.requestFullscreen?.({ navigationUI: 'hide' }) ?? root.webkitRequestFullscreen?.())
  } catch (error) {
    // The browser can refuse (no user gesture, embedded frame); the button just stays off.
    console.warn('Fullscreen request failed', error)
  }
}

export function onFullscreenChange(listener: (on: boolean) => void): void {
  const fire = () => listener(isFullscreen())
  document.addEventListener('fullscreenchange', fire)
  document.addEventListener('webkitfullscreenchange', fire)
}

/**
 * Keep the screen on while wanted. The browser drops the lock when the tab is
 * hidden, so it is taken again on return.
 */
export function createScreenWake() {
  let wanted = false
  let sentinel: WakeLockSentinel | null = null
  let pending = false

  const acquire = async () => {
    if (!('wakeLock' in navigator) || sentinel || pending || document.visibilityState !== 'visible') return
    pending = true
    try {
      sentinel = await navigator.wakeLock.request('screen')
      sentinel.addEventListener('release', () => (sentinel = null))
      // Released while the request was in flight.
      if (!wanted) await release()
    } catch (error) {
      // Refused in battery saver or without permission: the screen may dim, nothing else changes.
      console.warn('Screen wake lock request failed', error)
    } finally {
      pending = false
    }
  }
  const release = async () => {
    const held = sentinel
    sentinel = null
    try {
      await held?.release()
    } catch (error) {
      console.warn('Screen wake lock release failed', error)
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (wanted && document.visibilityState === 'visible') void acquire()
  })

  return {
    /** Cheap to call every frame: only a change does anything. */
    set(next: boolean) {
      if (next === wanted) return
      wanted = next
      if (wanted) void acquire()
      else void release()
    },
  }
}
