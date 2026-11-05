import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the app runs on port 5173 and passes /api calls to the backend on port 4000.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:4000' },
  },
});
