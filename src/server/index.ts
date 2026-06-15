import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { api } from "./routes.js";
import { bootstrapDatabase } from "./db/bootstrap.js";
import { env } from "./env.js";

bootstrapDatabase();

const app = new Hono();

app.use("*", logger());
app.use(
  "/api/*",
  cors({
    origin: env.clientOrigin,
    credentials: true
  })
);

app.route("/api", api);

app.use("/assets/*", serveStatic({ root: "./dist/client" }));
app.use("*", serveStatic({ path: "./dist/client/index.html" }));

serve(
  {
    fetch: app.fetch,
    hostname: env.host,
    port: env.port
  },
  (info) => {
    console.log(`HappyChat 服务已启动：http://${info.address}:${info.port}`);
  }
);
