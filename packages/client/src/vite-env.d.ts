/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SERVER_URL: string;
  // How the lobby offers itself for sharing: a copyable URL ('link') or just
  // the bare code ('code', for the itch.io embed). Unset falls back to
  // detecting whether we're framed. See .env.pages / .env.itch.
  readonly VITE_INVITE_MODE?: 'link' | 'code';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
