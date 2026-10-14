import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({
  // GitHub Pages serves the site from /<repo>/; dev keeps the root path.
  base: command === 'build' ? '/Transformers-Battle-LandingPage/' : '/',
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: { three: ['three'] },
      },
    },
  },
}));
