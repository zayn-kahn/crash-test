/**
 * The viewer's local server. It answers /data/*.json live from the run logs (web/data.ts), so the page
 * shows past runs and follows a run while it is being written. Local only: the logs stay on this machine.
 *   GET /data/scenarios.json   every prompts/scenarios/<id>/README.md
 *   GET /data/runs.json        one summary per data/runs/<id>.jsonl, newest first
 *   GET /data/runs/<id>.json   every event of one run
 *   GET /data/labels.json      the hand-label samples and answers (labels/)
 *   POST /data/labels/<tag>    save one run's hand label (the #/label page)
 * Run with `pnpm web` from crash-test/.
 */
import { defineConfig, type Plugin } from "vite";
import { labelSets, runEvents, runSummaries, saveLabel, scenarios } from "./data";

function liveData(): Plugin {
  const send = (res: any, body: unknown, code = 200) => {
    res.statusCode = code;
    res.setHeader("content-type", "application/json");
    res.setHeader("cache-control", "no-store");
    res.end(JSON.stringify(body));
  };
  return {
    name: "crash-test-live-data",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split("?")[0] ?? "";
        if (!url.startsWith("/data/")) return next();
        try {
          if (url === "/data/scenarios.json") return send(res, scenarios());
          if (url === "/data/runs.json") return send(res, runSummaries());
          if (url === "/data/labels.json") return send(res, labelSets());
          const lm = url.match(/^\/data\/labels\/([\w.-]+)$/);
          if (lm && req.method === "POST") {
            let body = "";
            req.on("data", (c: Buffer) => (body += c));
            req.on("end", () => {
              try {
                send(res, saveLabel(lm[1], JSON.parse(body || "{}")));
              } catch (err) {
                send(res, { error: String(err) }, 400);
              }
            });
            return;
          }
          const m = url.match(/^\/data\/runs\/([^/]+)\.json$/);
          const ev = m ? runEvents(m[1]) : null;
          return ev ? send(res, ev) : send(res, { error: "not found" }, 404);
        } catch (err) {
          return send(res, { error: String(err) }, 500);
        }
      });
    },
  };
}

export default defineConfig({
  root: import.meta.dirname,
  plugins: [liveData()],
  server: { port: 5173, host: "127.0.0.1" },
});
