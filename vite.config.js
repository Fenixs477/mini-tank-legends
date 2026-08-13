import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    rollupOptions: {
      input: './index.html'
    },
    emptyOutDir: true,
    assetsInclude: ['**/*.png', '**/*.jpg', '**/*.jpg', '**/*.gif', '**/*.webp', '**/*.json', '**/*.glb', '**/*.gltf']
  },
  publicDir: '.',
  server: {
    host: true,
    port: 5173
  },
  preview: {
    host: true,
    port: 4172
  }
});