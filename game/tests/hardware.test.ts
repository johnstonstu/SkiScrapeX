import { describe, expect, it } from 'vitest'
import { classifyHardware } from '../src/app/hardware'

const desk = (renderer: string, extra = {}) => classifyHardware({ renderer, touch: false, webgl2: true, cores: 8, memoryGb: 8, ...extra }).level

describe('graphics level from the hardware', () => {
  it('older Intel Macs start on Low', () => {
    expect(desk('ANGLE (Intel Inc., Intel(R) Iris(TM) Plus Graphics 640, OpenGL 4.1)')).toBe('low')
    expect(desk('ANGLE (Intel, ANGLE Metal Renderer: Intel(R) UHD Graphics 630, Unspecified Version)')).toBe('low')
    expect(desk('Intel HD Graphics 6000')).toBe('low')
  })

  it('newer Intel is Medium, Arc is High', () => {
    expect(desk('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('medium')
    expect(desk('ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('high')
  })

  it('Apple silicon and current discrete cards are High', () => {
    expect(desk('ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)')).toBe('high')
    expect(desk('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('high')
    expect(desk('ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('high')
  })

  it('older discrete laptop chips are Medium', () => {
    expect(desk('ANGLE (ATI Technologies Inc., AMD Radeon Pro 560X OpenGL Engine, OpenGL 4.1)')).toBe('medium')
    expect(desk('NVIDIA GeForce GT 750M OpenGL Engine')).toBe('medium')
  })

  it('software rendering, WebGL 1 only and phones are Low', () => {
    expect(desk('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)')).toBe('low')
    expect(desk('Apple M2', { webgl2: false })).toBe('low')
    expect(classifyHardware({ renderer: 'Apple GPU', touch: true, webgl2: true }).level).toBe('low')
  })

  it('a strong chip with little memory or few cores is held to Medium', () => {
    expect(desk('Apple M1', { cores: 4 })).toBe('medium')
    expect(desk('NVIDIA GeForce RTX 3060', { memoryGb: 4 })).toBe('medium')
  })

  it('an unknown chip starts on Medium', () => {
    expect(desk('Some New GPU 9000')).toBe('medium')
  })
})
