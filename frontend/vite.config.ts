import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Keep the app shell's shared React runtime in a stable chunk. Monaco is
        // reached only through the lazy EditorPanel boundary and is intentionally
        // left to Rollup's dynamic-import chunking.
        onlyExplicitManualChunks: true,
        manualChunks: {
          // Split React into its own chunk
          react: ['react', 'react-dom'],
        },
      },
    },
  },
})
