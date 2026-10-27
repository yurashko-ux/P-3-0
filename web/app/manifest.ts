import type { MetadataRoute } from "next";

/** Іконка закладки на робочому столі телефону: лого CreSco. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CreSco",
    short_name: "CreSco",
    id: "/admin/journal",
    start_url: "/admin/journal",
    scope: "/",
    display: "standalone",
    background_color: "#103e3b",
    theme_color: "#103e3b",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
