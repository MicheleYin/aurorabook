/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SHOW_LOGS?: string;
  readonly VITE_SUPPORT_EMAIL?: string;
  readonly VITE_E2E_MOCK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
