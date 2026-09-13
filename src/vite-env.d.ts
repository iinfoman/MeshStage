/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the MeshStage render/conversion service. Optional. */
  readonly VITE_MESHSTAGE_API?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
