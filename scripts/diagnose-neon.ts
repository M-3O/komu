import { diagnoseNeonConnectivity } from "../src/test/neon-connectivity-diagnostic";

// Operator-only entrypoint. Do not import from tests or application startup.
const options = process.argv.slice(2);
if (options.some((option) => option !== "--extended-timeouts")) {
  console.error("Unsupported diagnostic option.");
  process.exitCode = 1;
} else {
  // Bounds even native DNS/connection/shutdown stalls; never retries a transaction.
  const watchdog = setTimeout(() => {
    console.error('{"ok":false,"category":"DIAGNOSTIC_DEADLINE_EXCEEDED"}');
    process.exit(1);
  }, 90_000);
  void diagnoseNeonConnectivity(process.env, undefined, options.includes("--extended-timeouts"))
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
      process.exitCode = report.ok ? 0 : 1;
    })
    .catch(() => {
      console.error('{"ok":false,"category":"DIAGNOSTIC_INTERNAL_FAILURE"}');
      process.exitCode = 1;
    })
    // A stuck native DNS/shutdown handle still has a hard bound, but the
    // watchdog alone never keeps a completed diagnostic process alive.
    .finally(() => { watchdog.unref(); });
}
