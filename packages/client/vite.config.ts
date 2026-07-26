import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Relative by default so asset references resolve correctly no matter what
// directory index.html is actually served from — local dev and Fly serve at
// their host's root, but itch.io serves each upload from a per-build
// subdirectory (e.g. html-classic.itch.zone/html/<build-id>/), and an
// absolute '/assets/...' reference would skip straight past that and 404.
// Override via VITE_BASE_PATH (see .env.pages) for hosting under a *fixed*
// subpath, e.g. a GitHub Pages project page.
// process.env doesn't see .env.[mode] files here — only loadEnv() does, since
// Vite's automatic .env loading otherwise only feeds import.meta.env for app code.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd());
  return {
    plugins: [react()],
    base: env.VITE_BASE_PATH || './',
  };
});
