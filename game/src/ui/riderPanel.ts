import { SKI_GRAPHICS, type SkiGraphic } from '../render/rider/skierView'
import { KEYS, readJson, writeJson } from '../app/storage'
import { createRiderPreview } from './riderPreview'
import type { GloveStyle, Headwear, JacketStyle, PantsStyle } from '../render/rider/riderSkin'

/** Rider customization: colours, kit and ski model. */
export type SkiModel = 'allMountain' | 'park' | 'powder' | 'snowboard'

export interface Outfit {
  jacket: string
  pants: string
  helmet: string
  skis: string
  /** Neck gaiter colour. */
  gaiter: string
  model: SkiModel
  jacketStyle: JacketStyle
  pantsStyle: PantsStyle
  gloves: GloveStyle
  headwear: Headwear
  jacketAccent: string
  skiGraphic: SkiGraphic
  skiAccent: string
  backpack: boolean
}

export const SKI_MODELS: Record<SkiModel, { label: string; note: string; sidecutRadius: number; floatScale: number }> = {
  allMountain: { label: 'All-mountain', note: '14 m sidecut, quick to carve', sidecutRadius: 14, floatScale: 1 },
  park: { label: 'Park twin', note: '18 m sidecut, loose and playful', sidecutRadius: 18, floatScale: 1.05 },
  powder: { label: 'Powder', note: '22 m sidecut, floats in deep snow', sidecutRadius: 22, floatScale: 1.45 },
  snowboard: { label: 'Snowboard', note: '8 m sidecut, quick edge to edge, surfs powder', sidecutRadius: 8, floatScale: 1.35 },
}

export type SkiModelSpec = (typeof SKI_MODELS)[SkiModel]

/** Reward colours, shown locked until earned. */
export const REWARD_COLOURS: { colour: string; unlock: string; label: string }[] = [
  { colour: '#d4a72c', unlock: 'colour:gold', label: 'Gold' },
  { colour: '#b8c2cc', unlock: 'colour:chrome', label: 'Chrome' },
]
const REWARD_GRAPHICS: Record<string, string> = { topo: 'graphic:topo', nugget: 'graphic:nugget' }

export const PALETTE = ['#d42a2f', '#f2b705', '#2f7fe0', '#2e9e4a', '#7b3fbf', '#ff7a2a', '#1b1f24', '#f2f5f8', '#27313f', '#8a6243', '#e85d9b', '#3fc7c7']

export const DEFAULT_OUTFIT: Outfit = { jacket: '#d42a2f', pants: '#27313f', helmet: '#f2f5f8', skis: '#f2b705', gaiter: '#59606b', model: 'allMountain', jacketStyle: 'shell', pantsStyle: 'baggy', gloves: 'mitt', headwear: 'helmet', jacketAccent: '#8f1c20', skiGraphic: 'stripes', skiAccent: '#1b1f24', backpack: false }

export function readOutfit(): Outfit {
  // Saves from before 0.9.20 have `fit` (baggy or slim) instead of garment styles.
  const saved = readJson<Partial<Outfit> & { fit?: 'baggy' | 'slim' }>(KEYS.outfit, {})
  const outfit: Outfit & { fit?: string } = { ...DEFAULT_OUTFIT, ...saved }
  if (!saved.pantsStyle && saved.fit === 'slim') outfit.pantsStyle = 'slim'
  delete outfit.fit
  return outfit
}

export function writeOutfit(outfit: Outfit): void {
  writeJson(KEYS.outfit, outfit)
}

/** Builds the style panel; calls `onChange` with the new outfit after every pick. */
export function createStylePanel(
  panel: HTMLElement,
  outfit: Outfit,
  onChange: (outfit: Outfit) => void,
  unlocked: () => Set<string> = () => new Set(),
  hint: (id: string) => string = () => '',
): { refresh(): void; setVisible(on: boolean): void } {
  let preview: ReturnType<typeof createRiderPreview> | null = null
  let controls: HTMLElement | null = null

  const ensurePreview = () => {
    if (preview) return preview
    const stage = panel.querySelector<HTMLElement>('.rider-stage')
    if (!stage) return null
    preview = createRiderPreview(stage)
    preview.setOutfit(outfit)
    return preview
  }

  const ensureShell = () => {
    if (controls) return
    panel.innerHTML =
      '<header><div><h2>Rider &amp; gear</h2><p class="menu-lead">Tune the look, then check it on the stand.</p></div>' +
      '<button type="button" class="close" aria-label="Close">✕</button></header>' +
      '<div class="menu-layout rider-layout"><div class="rider-stage" aria-hidden="true"></div><div class="style-controls menu-side"></div></div>'
    panel.querySelector('.close')!.addEventListener('click', () => {
      panel.hidden = true
      preview?.stop()
    })
    controls = panel.querySelector('.style-controls')
  }

  const render = () => {
    ensureShell()
    const earned = unlocked()
    const host = controls!
    host.innerHTML = ''
    for (const [key, title] of [
      ['jacket', 'Jacket'],
      ['jacketAccent', 'Jacket panels'],
      ['pants', 'Pants'],
      ['helmet', 'Helmet, beanie or cap'],
      ['gaiter', 'Neck gaiter'],
      ['skis', 'Skis'],
      ['skiAccent', 'Ski graphic colour'],
    ] as const) {
      const row = document.createElement('div')
      row.className = 'style-row'
      row.innerHTML = `<span>${title}</span>`
      const swatches = document.createElement('div')
      swatches.className = 'swatches'
      for (const colour of [...PALETTE, ...REWARD_COLOURS.map((r) => r.colour)]) {
        const reward = REWARD_COLOURS.find((r) => r.colour === colour)
        const swatch = document.createElement('button')
        swatch.type = 'button'
        swatch.style.background = colour
        if (reward && !earned.has(reward.unlock)) {
          swatch.disabled = true
          swatch.classList.add('locked')
          swatch.title = `${reward.label}: ${hint(reward.unlock)}`
          swatches.append(swatch)
          continue
        }
        if (reward) swatch.classList.add('reward')
        swatch.setAttribute('aria-label', `${title} ${reward?.label ?? colour}`)
        swatch.setAttribute('aria-pressed', String(outfit[key] === colour))
        swatch.addEventListener('click', () => {
          outfit[key] = colour
          onChange(outfit)
          render()
        })
        swatches.append(swatch)
      }
      row.append(swatches)
      host.append(row)
    }
    const models = document.createElement('div')
    models.className = 'style-row models'
    models.innerHTML = '<span>Skis or board</span>'
    for (const [id, model] of Object.entries(SKI_MODELS) as [SkiModel, (typeof SKI_MODELS)[SkiModel]][]) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'model'
      button.setAttribute('aria-pressed', String(outfit.model === id))
      button.innerHTML = `<strong>${model.label}</strong><small>${model.note}</small>`
      button.addEventListener('click', () => {
        outfit.model = id
        onChange(outfit)
        render()
      })
      models.append(button)
    }
    host.append(models)
    const toggles: [string, keyof Outfit, [string, string][]][] = [
      ['Jacket style', 'jacketStyle', [['shell', 'Shell'], ['parkrat', 'Park rat'], ['racer', 'Racer'], ['hoodie', 'Hoodie'], ['puffer', 'Puffer']]],
      ['Pants', 'pantsStyle', [['baggy', 'Baggy'], ['slim', 'Slim'], ['race', 'Race']]],
      ['Gloves', 'gloves', [['mitt', 'Mitts'], ['glove', 'Gloves'], ['pipe', 'Pipe gloves']]],
      ['Head', 'headwear', [['helmet', 'Helmet'], ['beanie', 'Beanie'], ['cap', 'Cap']]],
      ['Pack', 'backpack', [['false', 'None'], ['true', 'Backpack']]],
      ['Ski graphic', 'skiGraphic', SKI_GRAPHICS.map((g) => [g, g[0].toUpperCase() + g.slice(1)] as [string, string])],
    ]
    for (const [title, key, options] of toggles) {
      const row = document.createElement('div')
      row.className = 'style-row models'
      row.innerHTML = `<span>${title}</span>`
      for (const [value, label] of options) {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'model'
        button.setAttribute('aria-pressed', String(String(outfit[key]) === value))
        button.innerHTML = `<strong>${label}</strong>`
        const reward = key === 'skiGraphic' ? REWARD_GRAPHICS[value] : undefined
        if (reward && !earned.has(reward)) {
          button.disabled = true
          button.classList.add('locked')
          button.innerHTML = `<strong>${label}</strong><small>${hint(reward)}</small>`
          row.append(button)
          continue
        }
        button.addEventListener('click', () => {
          ;(outfit as unknown as Record<string, string | boolean>)[key] = value === 'true' ? true : value === 'false' ? false : value
          onChange(outfit)
          render()
        })
        row.append(button)
      }
      host.append(row)
    }
    if (!panel.hidden) {
      const live = ensurePreview()
      live?.setOutfit(outfit)
      live?.start()
      live?.resize()
    } else preview?.setOutfit(outfit)
  }

  render()
  return {
    refresh: render,
    setVisible(on: boolean) {
      if (on) {
        const live = ensurePreview()
        live?.setOutfit(outfit)
        live?.start()
        live?.resize()
      } else preview?.stop()
    },
  }
}
