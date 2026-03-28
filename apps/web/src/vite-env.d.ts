/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_NAKAMA_HOST: string;
  readonly VITE_NAKAMA_PORT: string;
  readonly VITE_NAKAMA_SSL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}