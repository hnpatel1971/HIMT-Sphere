import app from "./app";
import { logger } from "./lib/logger";
import {
  ensureAccessLogsTable,
  ensureAppSettingsTable,
  ensureContentTokensTable,
  ensureResourceImportJobSchema,
  ensureUserWorkspaceTables,
  scheduleImportRecovery,
} from "./routes/lms";

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
Promise.all([
  ensureAppSettingsTable(),
  ensureAccessLogsTable(),
  ensureContentTokensTable(),
  ensureResourceImportJobSchema(),
  ensureUserWorkspaceTables(),
])
  .catch(err => {
    logger.error({ err }, "[init] DB table initialisation failed — cannot start");
    process.exit(1);
  })
  .then(() => {
    scheduleImportRecovery();
    app.listen(port, (err) => {
      if (err) {
        logger.error({ err }, "Error listening on port");
        process.exit(1);
      }
      logger.info({ port }, "Server listening");
    });
  });
