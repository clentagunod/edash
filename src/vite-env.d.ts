/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly MAINTENANCE_MODE?: string;
  readonly VITE_CLOUDINARY_CLOUD_NAME?: string;
  readonly VITE_CLOUDINARY_UPLOAD_PRESET?: string;
  readonly VITE_CLOUDINARY_SIGNATURE_UPLOAD_PRESET?: string;
}

declare module '*.html?raw' {
  const content: string;
  export default content;
}
