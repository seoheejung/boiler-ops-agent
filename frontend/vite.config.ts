import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const proxy = { '/api': { target: 'http://127.0.0.1:8000', ws: true } };
const headers = { 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' };
export default defineConfig({ plugins: [react()], server: { proxy, headers, strictPort: true }, preview: { proxy, headers, strictPort: true } });
