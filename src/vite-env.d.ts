/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the MeshStage render/conversion service. Optional. */
  readonly VITE_MESHSTAGE_API?: string;
  /** Supabase project URL. Enables accounts and server-enforced credits. */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase publishable/anon key. Safe to ship: RLS is what protects data. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
