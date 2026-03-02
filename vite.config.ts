import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(() => ({
  server: {
    host: "localhost",
    port: 8080,
    strictPort: true,
    hmr: {
      protocol: "ws",
      host: "localhost",
      port: 8080,
      clientPort: 8080,
      overlay: false,
    },
  },
  plugins: [
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.js",
      registerType: "prompt",
      injectRegister: false,
      manifest: false,
      includeAssets: [
        "images/khulisa-logo.png",
        "images/khulisa-logo-icon.png",
        "sounds/notification.wav",
        "manifest.webmanifest",
      ],
      workbox: {
        cleanupOutdatedCaches: true,
      },
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,webmanifest,wav,woff2}"],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
