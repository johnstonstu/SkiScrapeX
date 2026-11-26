/** Elements from index.html the app drives. */
export const $ = <T extends HTMLElement>(selector: string) => document.querySelector(selector) as T

export function getUi() {
  return {
    canvas: $<HTMLCanvasElement>('#view'),
    status: $('#status'),
    title: $('#run-name'),
    speed: $('#speed'),
    speedo: $('#speedo'),
    time: $('#time'),
    best: $('#best'),
    debug: $('#debug'),
    fade: $('#fade'),
    fadeText: $('#fade-text'),
    map: $<HTMLCanvasElement>('#minimap'),
    mapLocation: $('#map-location'),
    mapPanel: $('#map-panel'),
    slopes: $('#slopes'),
    help: $('#help'),
    credits: $('#credits'),
    menu: $('#pause-menu'),
    style: $('#style'),
    settings: $('#settings'),
    challenges: $('#challenges'),
    results: $('#results'),
    titleScreen: $('#title-screen'),
    runCard: $('#run-card'),
    coach: $('#coach'),
    runs: $('#runs'),
    runList: $('#run-list'),
    trailMap: $<HTMLCanvasElement>('#trail-map'),
    trailDetail: $('#trail-detail'),
    ride: $('#ride'),
    rideText: $('#ride-text'),
    trick: $('#trick'),
    hint: $('#hint'),
    version: $('#version'),
    hudVersion: $('#hud-version'),
    weatherCue: $('#weather-cue'),
  }
}

export type Ui = ReturnType<typeof getUi>
