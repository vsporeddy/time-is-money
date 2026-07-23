import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Root '/' for local dev, itch.io, and Fly — override via VITE_BASE_PATH
// (see .env.pages) for hosting under a subpath, e.g. a GitHub Pages project page.
// process.env doesn't see .env.[mode] files here — only loadEnv() does, since
// Vite's automatic .env loading otherwise only feeds import.meta.env for app code.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd());
  return {
    plugins: [react()],
    base: env.VITE_BASE_PATH || '/',
  };
});
