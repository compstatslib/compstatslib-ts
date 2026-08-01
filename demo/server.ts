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
    "/logit.html": new Response(
      Bun.file(new URL("./logit.html", import.meta.url)),
      { headers: { "content-type": "text/html; charset=utf-8" } },
    ),
    "/ttest.html": new Response(
      Bun.file(new URL("./ttest.html", import.meta.url)),
      { headers: { "content-type": "text/html; charset=utf-8" } },
    ),
    "/sampling.html": new Response(
      Bun.file(new URL("./sampling.html", import.meta.url)),
      { headers: { "content-type": "text/html; charset=utf-8" } },
    ),
    "/sampleci.html": new Response(
      Bun.file(new URL("./sampleci.html", import.meta.url)),
      { headers: { "content-type": "text/html; charset=utf-8" } },
    ),
    "/pca.html": new Response(
      Bun.file(new URL("./pca.html", import.meta.url)),
      { headers: { "content-type": "text/html; charset=utf-8" } },
    ),
    "/matrixinverse.html": new Response(
      Bun.file(new URL("./matrixinverse.html", import.meta.url)),
      { headers: { "content-type": "text/html; charset=utf-8" } },
    ),
    "/scatter3d.html": new Response(
      Bun.file(new URL("./scatter3d.html", import.meta.url)),
      { headers: { "content-type": "text/html; charset=utf-8" } },
    ),
    "/moderation3d.html": new Response(
      Bun.file(new URL("./moderation3d.html", import.meta.url)),
      { headers: { "content-type": "text/html; charset=utf-8" } },
    ),
    // Plotly is served as its own file, once, and reached as window.Plotly.
    "/plotly.min.js": new Response(
      Bun.file(
        new URL(
          "../node_modules/plotly.js-dist-min/plotly.min.js",
          import.meta.url,
        ),
      ),
      { headers: { "content-type": "text/javascript; charset=utf-8" } },
    ),
    // The 3D library, bundled live from src with Plotly left external. The
    // page bundler cannot serve this: it inlines dynamic imports, so a static
    // import of src/3d.ts in main.ts would put all of Plotly's 7 MB into the
    // page script on every request. Bundling here keeps the demo on live
    // source; the bare plotly import inside stays unresolved and unused,
    // because the page passes window.Plotly through the plotly option.
    "/3d-lib.js": async () => {
      const built = await Bun.build({
        entrypoints: [new URL("../src/3d.ts", import.meta.url).pathname],
        target: "browser",
        format: "esm",
        external: ["plotly.js-dist-min"],
      });
      const output = built.outputs[0];
      if (output === undefined) {
        return new Response("3d bundle failed", { status: 500 });
      }
      return new Response(output, {
        headers: { "content-type": "text/javascript; charset=utf-8" },
      });
    },
  },
});

console.log(`compstatslib demos: ${server.url}`);
