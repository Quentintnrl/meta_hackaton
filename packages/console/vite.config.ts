import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The orchestrator runs on 8787; the console only talks to it through /api (also for the SSE stream).
export default defineConfig({
  plugins: [react()],
  server: { port: Number(process.env.CONSOLE_PORT ?? 5173), strictPort: Boolean(process.env.CONSOLE_PORT), proxy: { '/api': { target: process.env.ORCHESTRATOR_URL ?? 'http://localhost:8787', rewrite: p => p.replace(/^\/api/, '') } } },
});
