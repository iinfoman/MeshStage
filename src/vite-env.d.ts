/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the MeshStage render/conversion service. Optional. */
  readonly VITE_MESHSTAGE_API?: string;
  /**
   * Base URL of an image-to-3D reconstruction service. When set, uploads are
   * sent there and the returned mesh is what the studio shows and exports;
   * when unset, generation stays local and procedural.
   */
  readonly VITE_MESHSTAGE_GEN_API?: string;
  /** Supabase project URL. Enables accounts and server-enforced credits. */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase publishable/anon key. Safe to ship: RLS is what protects data. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
