import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "RTG·HUB — Order & Dispatch",
    short_name: "RTG Hub",
    description: "Delivery order management for sales, office manager, and warehouse.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#152238",
    theme_color: "#152238",
    icons: [],
  };
}
