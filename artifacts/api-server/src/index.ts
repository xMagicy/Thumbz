import app from "./app";
import { logger } from "./lib/logger";

// Replit injects PORT in production (artifact.toml). In dev workflows or when
// running via plain `pnpm dev` no PORT is set, so fall back to the localPort
// the service is configured for (8080).
const rawPort = process.env["PORT"] ?? "8080";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
