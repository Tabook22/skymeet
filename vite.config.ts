import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/skymeet/",
  server: {
    proxy: {
      "/skymeet/api": {
        target: "http://127.0.0.1:8000",
        rewrite: (path) => path.replace("/skymeet", ""),
      },
    },
  },
  build: { chunkSizeWarningLimit: 1100 },
});
