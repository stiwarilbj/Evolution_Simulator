import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  base: './',
  plugins: [vue()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'three-core', test: /three\/build\/three\.core\.js$/ },
            { name: 'simulation', test: /\/src\/(engine\/|(?:archive|store|track)\.js$)/ },
          ],
        },
      },
    },
  },
})
