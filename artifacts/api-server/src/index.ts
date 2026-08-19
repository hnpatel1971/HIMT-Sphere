import app from "./app";
import { logger } from "./lib/logger";
import { ensureAppSettingsTable } from "./routes/lms";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Ensure the app_settings table exists before accepting requests so that
// credential reads/writes never race against table creation.
ensureAppSettingsTable()
  .catch(err => {
    logger.error({ err }, "[init] app_settings table creation failed — cannot start");
    process.exit(1);
  })
  .then(() => {
    app.listen(port, (err) => {
      if (err) {
        logger.error({ err }, "Error listening on port");
        process.exit(1);
      }
      logger.info({ port }, "Server listening");
    });
  });
