import { createApp } from "./api";
import { env } from "./src/library/env";
import { logger } from "./src/library/logger";

const app = createApp();

app.listen(env.port, () => {
  logger.info({ port: env.port, env: env.nodeEnv }, "corporate-mailer escuchando");
});
