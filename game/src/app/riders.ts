/**
 * Starter riders: whole looks to pick from before dropping in, made from the
 * parts every rider has (ui/riderPanel.ts). A rider sets the clothes and the
 * colours of the gear; skis or snowboard is a separate choice. The Rider &
 * gear panel still edits every part afterwards.
 */
import type { Outfit, SkiModel } from '../ui/riderPanel'

export type RiderLook = Omit<Outfit, 'model'>

export interface Rider {
  id: string
  name: string
  /** A few words on who they are. */
  line: string
  look: RiderLook
}

export const RIDERS: Rider[] = [
  {
    id: 'scout',
    name: 'Scout',
    line: 'First chair, every day',
    look: { jacket: '#d42a2f', jacketAccent: '#8f1c20', pants: '#27313f', helmet: '#f2f5f8', gaiter: '#59606b', skis: '#f2b705', skiAccent: '#1b1f24', skiGraphic: 'stripes', jacketStyle: 'shell', pantsStyle: 'baggy', gloves: 'mitt', headwear: 'helmet', backpack: false },
  },
  {
    id: 'juniper',
    name: 'Juniper',
    line: 'Tree lines and thermos tea',
    look: { jacket: '#2e9e4a', jacketAccent: '#27313f', pants: '#8a6243', helmet: '#f2b705', gaiter: '#f2f5f8', skis: '#2e9e4a', skiAccent: '#f2f5f8', skiGraphic: 'stripes', jacketStyle: 'puffer', pantsStyle: 'baggy', gloves: 'mitt', headwear: 'beanie', backpack: true },
  },
  {
    id: 'maverick',
    name: 'Maverick',
    line: 'Lives in the park',
    look: { jacket: '#1b1f24', jacketAccent: '#ff7a2a', pants: '#ff7a2a', helmet: '#1b1f24', gaiter: '#ff7a2a', skis: '#1b1f24', skiAccent: '#ff7a2a', skiGraphic: 'stripes', jacketStyle: 'hoodie', pantsStyle: 'baggy', gloves: 'pipe', headwear: 'beanie', backpack: false },
  },
  {
    id: 'ridge',
    name: 'Ridge',
    line: 'Gates before breakfast',
    look: { jacket: '#2f7fe0', jacketAccent: '#f2f5f8', pants: '#1b1f24', helmet: '#2f7fe0', gaiter: '#1b1f24', skis: '#f2f5f8', skiAccent: '#2f7fe0', skiGraphic: 'stripes', jacketStyle: 'racer', pantsStyle: 'slim', gloves: 'glove', headwear: 'helmet', backpack: false },
  },
  {
    id: 'goldie',
    name: 'Goldie',
    line: 'Bluebird days only',
    look: { jacket: '#f2b705', jacketAccent: '#f2f5f8', pants: '#f2f5f8', helmet: '#e85d9b', gaiter: '#e85d9b', skis: '#e85d9b', skiAccent: '#f2f5f8', skiGraphic: 'stripes', jacketStyle: 'shell', pantsStyle: 'slim', gloves: 'glove', headwear: 'helmet', backpack: false },
  },
  {
    id: 'storm',
    name: 'Storm',
    line: 'Out when the lifts are on wind hold',
    look: { jacket: '#27313f', jacketAccent: '#3fc7c7', pants: '#1b1f24', helmet: '#3fc7c7', gaiter: '#3fc7c7', skis: '#3fc7c7', skiAccent: '#1b1f24', skiGraphic: 'stripes', jacketStyle: 'parkrat', pantsStyle: 'baggy', gloves: 'mitt', headwear: 'cap', backpack: true },
  },
]

const LOOK_KEYS = Object.keys(RIDERS[0].look) as (keyof RiderLook)[]

/** The starter rider this outfit is, or null when it has been changed by hand (the player's own). */
export function riderOf(outfit: Outfit): Rider | null {
  return RIDERS.find((rider) => LOOK_KEYS.every((key) => rider.look[key] === outfit[key])) ?? null
}

/** Put a rider's look on, keeping skis or snowboard as chosen. */
export function wearRider(outfit: Outfit, look: RiderLook): void {
  Object.assign(outfit, look)
}

export type Ride = 'skis' | 'snowboard'

export const rideOf = (outfit: Outfit): Ride => (outfit.model === 'snowboard' ? 'snowboard' : 'skis')

/** Switch between skis and a snowboard; `lastSkis` is the ski model to go back to. */
export function setRide(outfit: Outfit, ride: Ride, lastSkis: SkiModel = 'allMountain'): void {
  if (ride === 'snowboard') outfit.model = 'snowboard'
  else if (outfit.model === 'snowboard') outfit.model = lastSkis === 'snowboard' ? 'allMountain' : lastSkis
}
