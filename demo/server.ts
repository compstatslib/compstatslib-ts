import index from "./index.html";

// Bun bundles the page and its TypeScript on request. No build step.
// The per-family fragments are plain HTML, so the server sends them as files.
// Bundling one would wrap it in a page of its own.
const server = Bun.serve({
  port: Number(Bun.env["PORT"] ?? 3000),
  development: true,
  routes: {
    "/": index,
    "/regression.html": new Response(
      Bun.file(new URL("./regression.html", import.meta.url)),
      { headers: { "content-type": "text/html; charset=utf-8" } },
    ),
  },
});

console.log(`compstatslib demos: ${server.url}`);
