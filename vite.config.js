import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:3001',
    },
  },
  preview: {
    proxy: {
      '/api': 'http://127.0.0.1:3001',
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('recharts') || id.includes('/d3-')) return 'charts';
            if (id.includes('react') || id.includes('scheduler')) return 'react-vendor';
            if (id.includes('lucide-react')) return 'icons';
          }
          return undefined;
        },
      },
    },
  },
});
