import { defineConfig } from 'vite'

export default defineConfig(({ command }) => {
  return {
    // Si estamos construyendo para producción (GitHub Pages), usa '/NASA/', si estamos en desarrollo local/Codespaces, usa '/'
    base: command === 'build' ? '/NASA/' : '/',
  }
})