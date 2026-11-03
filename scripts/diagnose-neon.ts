import { diagnoseNeonConnectivity, diagnoseProductionNeonConnectivity } from "../src/test/neon-connectivity-diagnostic";
import { diagnoseProductionPrismaStatus } from "../src/test/prisma-status-diagnostic";

// Operator-only entrypoint. Do not import from tests or application startup.
const options = process.argv.slice(2);
const production = options.includes("--production");
const cliStatus = options.includes("--cli-status");
if (options.some((option) => !["--extended-timeouts", "--production", "--cli-status"].includes(option)) ||
    (cliStatus && !production) || (production && options.includes("--extended-timeouts"))) {
  console.error("Unsupported diagnostic option.");
  process.exitCode = 1;
} else {
  // Bounds even native DNS/connection/shutdown stalls; never retries a transaction.
  const watchdog = setTimeout(() => {
    console.error('{"ok":false,"category":"DIAGNOSTIC_DEADLINE_EXCEEDED"}');
    process.exit(1);
  }, 90_000);
  const run = production
    ? diagnoseProductionNeonConnectivity(process.env)
    : diagnoseNeonConnectivity(process.env, undefined, options.includes("--extended-timeouts"));
  void run
    .then(async (report) => {
      const status = production && cliStatus && report.configuration && report.dns &&
        report.identity !== false && report.failure?.category !== "READ_ONLY_CHECK_FAILED"
        ? await diagnoseProductionPrismaStatus(process.env) : null;
      console.log(JSON.stringify({ ...report, cliStatus: status }, null, 2));
      process.exitCode = report.ok && (!status || ["up-to-date", "pending-review"].includes(status.state)) ? 0 : 1;
    })
    .catch(() => {
      console.error('{"ok":false,"category":"DIAGNOSTIC_INTERNAL_FAILURE"}');
      process.exitCode = 1;
    })
    // A stuck native DNS/shutdown handle still has a hard bound, but the
    // watchdog alone never keeps a completed diagnostic process alive.
    .finally(() => { watchdog.unref(); });
}
