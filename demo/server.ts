import index from "./index.html";

// Bun bundles the page and its TypeScript on request. No build step.
const server = Bun.serve({
  port: Number(Bun.env["PORT"] ?? 3000),
  development: true,
  routes: {
    "/": index,
  },
});

console.log(`compstatslib demos: ${server.url}`);
