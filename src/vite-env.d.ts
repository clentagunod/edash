/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly MAINTENANCE_MODE?: string;
  readonly VITE_SCHOOL_REGISTRATION_API_URL?: string;
  readonly VITE_CLOUDINARY_CLOUD_NAME?: string;
  readonly VITE_CLOUDINARY_UPLOAD_PRESET?: string;
}

declare module '*.html?raw' {
  const content: string;
  export default content;
}
