import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    strictPort: true,
    ...(mode === "prototype"
      ? {}
      : {
          proxy: {
            "/api": process.env.HOTEL_DEV_API || "http://127.0.0.1:8080",
          },
        }),
  },
}));
