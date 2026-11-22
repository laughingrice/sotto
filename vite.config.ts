import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], build: { manifest: 'asset-manifest.json', rollupOptions: { input: { main: 'index.html', redirect: 'redirect.html', dropboxRedirect: 'dropbox-redirect.html' } } } });
