declare const __APP_VERSION__: string

/** From game/package.json at build time (vite.config.ts `define`). */
export const VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev'
