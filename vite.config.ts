import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  envPrefix: ['VITE_', 'MAINTENANCE_MODE'],
  test: {
    environment: 'jsdom',
    globals: true,
  },
  server: {
      allowedHosts: [
          "5582-180-194-109-208.ngrok-free.app"
      ]
  }
});
