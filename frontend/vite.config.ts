import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Split Monaco editor into its own chunk (~2.5MB)
          monaco: ['monaco-editor', '@monaco-editor/react'],
          // Split React into its own chunk
          react: ['react', 'react-dom'],
        },
      },
    },
  },
})
