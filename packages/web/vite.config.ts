import { defineConfig } from "vite";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// CRM web — built TWO ways:
//
//  1. Dev SPA (`vite` / `vite serve`) — `index.html` + `src/main.tsx`,
//     mounted at http://localhost:5173 for local development.
//
//  2. Library bundle (`vite build`) — the only artifact that ships
//     inside `.hebbsmod`. Outputs `dist/index.mjs` + `dist/index.css`
//     (non-hashed), which the shell dynamic-imports at runtime via
//     `/modules/crm/ui/index.mjs`. The entry exports the `crmUI`
//     PluginUI from `src/ui.ts`.
//
// Why library mode (vs the standalone SPA bundle):
//   The framework shell already provides React, React Router,
//   QueryClient + the styled scaffold; CRM contributes routes and
//   panels via the `PluginUI` interface from `@boringos/ui`. Shipping
//   a SPA bundle is wasted bytes — the shell only needs the
//   `crmUI` export. Library mode also gives us a stable, non-hashed
//   entry filename (`index.mjs`) so `module.json` → `ui.entry` can
//   reference it without index.html parsing.
//
// React + ReactDOM are marked external — the host provides them.

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    lib: {
      entry: resolve(__dirname, "src/ui.ts"),
      formats: ["es"],
      fileName: () => "index.mjs",
    },
    rollupOptions: {
      // Everything the shell ships is external. The bundle still
      // resolves workspace deps the shell does NOT provide (xyflow,
      // dagre, react-markdown, etc.) by inlining them.
      external: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react-router-dom",
        "@tanstack/react-query",
        "@boringos/ui",
        "@boringos/workflow-ui",
      ],
      output: {
        // Keep the entry filename stable so module.json's ui.entry
        // can point at "./ui/index.mjs" without rewriting it every
        // build. The CSS bundle gets a stable `index.css` name too
        // so the shell's runtime-loader can fetch it at a
        // predictable sibling path without parsing the JS bundle
        // for asset refs.
        entryFileNames: "index.mjs",
        assetFileNames: (info) => {
          // Vite tags the entry CSS as `style.css` by default in
          // lib mode; rename to `index.css` so the shell can
          // GET /modules/<id>/ui/index.css. Other assets (fonts,
          // images) keep the hashed `/assets/` prefix.
          const name = info.name ?? "";
          if (name === "style.css" || name.endsWith(".css")) {
            return "index.css";
          }
          return "assets/[name]-[hash][extname]";
        },
        chunkFileNames: "assets/[name]-[hash].js",
      },
    },
    // Don't blow away module-json or other adjacent fixtures —
    // package.json + module.json live in pkg root, not in dist/.
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5173,
    host: "0.0.0.0",
    allowedHosts: ["crm.boringos.dev"],
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
