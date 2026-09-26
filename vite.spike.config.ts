import { defineConfig, type Plugin } from "vite";
import { fileURLToPath } from "node:url";

// Dev server for the loading spike (spike/). Serves spike/assets/ as static
// files and counts the bytes it sends for them, because Spark fetches streamed
// chunks from Web Workers where the page's Resource Timing cannot see them.

const ASSET_PATTERN = /\.(spz|rad|radc|ply|sog|glb)(\?|$)/i;

function byteCounter(): Plugin {
  let bytes = 0;
  let requests = 0;
  let rangeRequests = 0;

  return {
    name: "spike-byte-counter",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? "";
        if (url.startsWith("/__spike/stats")) {
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Cache-Control", "no-store");
          res.end(JSON.stringify({ bytes, requests, rangeRequests }));
          return;
        }
        if (url.startsWith("/__spike/reset")) {
          bytes = 0;
          requests = 0;
          rangeRequests = 0;
          res.end("ok");
          return;
        }
        if (!ASSET_PATTERN.test(url)) {
          next();
          return;
        }

        requests++;
        if (req.headers.range) {
          rangeRequests++;
        }
        // Measure cold loads every time.
        res.setHeader("Cache-Control", "no-store");
        const write = res.write.bind(res);
        const end = res.end.bind(res);
        const count = (chunk: unknown) => {
          if (typeof chunk === "string") bytes += Buffer.byteLength(chunk);
          else if (chunk instanceof Uint8Array) bytes += chunk.byteLength;
        };
        res.write = ((chunk: unknown, ...rest: unknown[]) => {
          count(chunk);
          return (write as (...args: unknown[]) => boolean)(chunk, ...rest);
        }) as typeof res.write;
        res.end = ((chunk?: unknown, ...rest: unknown[]) => {
          if (typeof chunk !== "function") count(chunk);
          return (end as (...args: unknown[]) => typeof res)(chunk, ...rest);
        }) as typeof res.end;
        next();
      });
    },
  };
}

export default defineConfig({
  root: fileURLToPath(new URL("./spike", import.meta.url)),
  publicDir: "assets",
  clearScreen: false,
  plugins: [byteCounter()],
  server: {
    port: 5180,
    host: true,
  },
});
