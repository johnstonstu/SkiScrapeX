import { escapeHtml } from './format'

/** Full-screen alert when WebGL will not start or the GPU context is lost. */
export function showGraphicsProblem(title: string, detail: string, reload: boolean) {
  const box = document.createElement('div')
  box.className = 'graphics-problem'
  box.setAttribute('role', 'alert')
  box.innerHTML = `<strong>${escapeHtml(title)}</strong><p>${escapeHtml(detail)}</p>`
  if (reload) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = 'Reload'
    button.addEventListener('click', () => location.reload())
    box.append(button)
  }
  document.body.append(box)
}
