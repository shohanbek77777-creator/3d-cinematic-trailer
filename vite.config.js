import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
  optimizeDeps: {
    // ffmpeg.wasm spawns its own worker; pre-bundling breaks the worker URL.
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          media: ['mediabunny'],
        },
      },
    },
  },
  worker: { format: 'es' },
});
