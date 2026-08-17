/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Backend ORIGIN when the API is not served from this site's own origin
   * (e.g. "https://center-api.fly.dev"). No trailing slash and no /api suffix -
   * src/lib/api.ts appends that. Leave unset for same-origin deployments: the
   * dev proxy, the desktop shell, or a host that rewrites /api to the backend.
   */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
