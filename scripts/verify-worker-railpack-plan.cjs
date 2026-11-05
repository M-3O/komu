// CommonJS CLI runs directly in Node without a loader or package type change.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("node:fs");

/** Inspect generated plans only; never execute commands or inspect process secrets. */
function verifyWorkerPlan(plan) {
  const fail = code => { throw new Error(code); };
  if (!plan || !Array.isArray(plan.steps) || !plan.deploy || !Array.isArray(plan.deploy.inputs)) fail("WORKER_PLAN_INVALID");
  const commandText = step => (step?.commands ?? []).map(command => typeof command === "string" ? command : typeof command.cmd === "string" ? command.cmd : "").join("\n");
  const install = plan.steps.find(step => step.name === "install");
  const build = plan.steps.find(step => step.name === "build");
  if (!install || !build) fail("WORKER_STEPS_MISSING");
  if (!commandText(install).includes("PRISMA_SKIP_POSTINSTALL_GENERATE=true npm ci --include=dev")) fail("WORKER_INSTALL_UNSAFE");
  if (!commandText(build).includes("npm run build:bot")) fail("WORKER_BUILD_MISSING");
  if (plan.steps.some(step => /\bnpm\s+run\s+build(?:\s|$)|\bnext\s+build\b/.test(commandText(step)))) fail("DASHBOARD_BUILD_PRESENT");
  for (const step of plan.steps.filter(step => ["install", "build", "prune"].includes(step.name))) {
    if (!Array.isArray(step.secrets ?? []) || (step.secrets ?? []).length) fail("WORKER_BUILD_SECRETS_PRESENT");
  }
  if (plan.deploy.startCommand !== "exec node --import tsx src/bot/bootstrap.ts") fail("WORKER_START_UNSAFE");
  if (plan.deploy.variables?.PORT !== "3001" || plan.deploy.variables?.NODE_ENV !== "production") fail("WORKER_RUNTIME_DEFAULTS_INVALID");
  const forbidden = /^(DATABASE_URL|KOMU_NEON_TEST_DATABASE_URL|DISCORD_BOT_TOKEN|BOT_MONITORING_SECRET)$/;
  if (Object.keys(plan.deploy.variables ?? {}).some(key => forbidden.test(key)) || plan.steps.some(step => Object.keys(step.variables ?? {}).some(key => forbidden.test(key)))) fail("WORKER_CREDENTIAL_VARIABLE_PRESENT");
  const generated = plan.deploy.inputs.some(layer => layer.step === "build" && (layer.include ?? []).some(path => path === "node_modules/.prisma" || path === "/app/node_modules/.prisma"));
  if (!generated) fail("GENERATED_PRISMA_LAYER_MISSING");
  const source = plan.deploy.inputs.some(layer => layer.step === "build" && (layer.include ?? []).some(path => [".", "/app", "src", "/app/src"].includes(path)));
  if (!source) fail("WORKER_SOURCE_LAYER_MISSING");
}
module.exports = { verifyWorkerPlan };
if (require.main === module) {
  let plan;
  let parsed = false;
  try { plan = JSON.parse(fs.readFileSync(process.argv[2], "utf8")); parsed = true; }
  catch { console.error("WORKER_PLAN_UNREADABLE"); process.exitCode = 1; }
  if (parsed) {
    try { verifyWorkerPlan(plan); console.log("Railpack worker plan checks passed."); }
    catch (error) {
      const safe = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : "WORKER_PLAN_INVALID";
      console.error(safe); process.exitCode = 1;
    }
  }
}
