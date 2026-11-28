import type { UiSound } from './engine'

/**
 * The chime for a card popping on screen (trick grades, banked points, gates,
 * finds). `kind` is the card's style class. Crash cards stay silent: the fall
 * itself is the sound.
 */
export function cardSound(title: string, detail: string, kind: string): UiSound | null {
  switch (kind) {
    case 'perfect':
      return 'perfect'
    case 'clean':
      return 'clean'
    case 'sketchy':
      return 'sketchy'
    case 'bank':
      if (title === 'Finish') return 'finish'
      return detail.includes('unlocked') ? 'found' : 'bank'
    case 'crash':
      return title === 'Missed gate' ? 'fail' : null
    default:
      return null
  }
}
