import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { toNodeHandler } from "better-auth/node";
import router from "./routes";
import { auth } from "./lib/auth";
import { logger } from "./lib/logger";
import { startScheduler } from "./lib/scheduler";

const app: Express = express();

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
