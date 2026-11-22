import path from "node:path";
import express from "express";

export function serveFrontend(app, distDir) {
  // Missing release chunks are files, never SPA routes. Do not cache a miss.
  app.use("/assets", express.static(path.join(distDir, "assets"), {
    index: false, immutable: true, maxAge: "1y"
  }), (_req, res) => res.status(404).set("Cache-Control", "no-store").type("text/plain").send("Asset not found."));
  app.use(express.static(distDir, {
    index: false,
    setHeaders(res, filePath) {
      if (filePath.endsWith(".html")) res.setHeader("Cache-Control", "no-store");
    }
  }));
  app.get("/{*splat}", (_req, res) => {
    res.set("Cache-Control", "no-store").sendFile(path.join(distDir, "index.html"));
  });
}
