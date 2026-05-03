import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { toNodeHandler } from "better-auth/node";
import router from "./routes";
import { auth } from "./lib/auth";
import { logger } from "./lib/logger";
import { startScheduler } from "./lib/scheduler";

const app: Express = express();

// We sit behind the Replit reverse proxy. Without trust proxy = 1, req.ip
// resolves to the proxy address and our per-IP rate limiters would key
// every request to the same bucket — 429 storm for all users at once.
// `1` (count one hop) is the safe default; we never expose the API
// directly. express-rate-limit also requires this for accurate keying.
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());

// Better Auth handler — must be registered BEFORE express.json() because
// the body parser would consume the request body and break Better Auth's
// internal stream reading. Express 5 wildcard syntax: "*splat".
app.all("/api/auth/*splat", toNodeHandler(auth));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// Boot the background scheduler (YouTube trending sync, etc.).
// Safe no-op when YOUTUBE_API_KEY is missing.
startScheduler();

export default app;
