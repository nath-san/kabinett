import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter(), tsconfigPaths()],
  ssr: {
    noExternal: [],
  },
  optimizeDeps: {
    exclude: ["better-sqlite3"],
  },
  server: {
    fs: {
      allow: ["../.."],
    },
    proxy: {
      "/api/nm": {
        target: "https://api.nationalmuseum.se",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/nm/, "/api"),
      },
    },
  },
});
