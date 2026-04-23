import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  server: {
    port: 5173,
    open: true,
  },
  build: {
    rollupOptions: {
      input: {
        app: 'index.html',
        auth: 'auth.html',
      },
    },
  },
});
