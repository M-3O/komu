import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
const require = createRequire(import.meta.url);
const { verifyWorkerPlan } = require("../../scripts/verify-worker-railpack-plan.cjs") as { verifyWorkerPlan: (plan: unknown) => void };
const config = JSON.parse(readFileSync(new URL("../../railpack.json", import.meta.url), "utf8"));
function safePlan() {
  return { steps: [
    { name: 'install', commands: [{ cmd: config.steps.install.commands[0] }], secrets: [] as string[], variables: {} as Record<string,string> },
    { name: 'build', commands: config.steps.build.commands.map((cmd: string) => ({ cmd })), secrets: [] as string[], variables: {} as Record<string,string> },
    { name: 'prune', commands: [], secrets: [] as string[], variables: {} as Record<string,string> },
  ], deploy: { startCommand: config.deploy.startCommand, variables: { ...config.deploy.variables },
    inputs: [{ step: 'packages:mise', include: ['/mise/shims'] }, { step: 'build', include: ['.'], exclude: ['node_modules'] }, ...config.deploy.inputs.filter((item: unknown) => typeof item === 'object')] } };
}

describe('worker-only Railpack configuration and generated plan guard', () => {
  it('keeps conventional root builders inactive and both Docker fallback pairs available', () => {
    const root = new URL('../../', import.meta.url);
    for (const name of ['Dockerfile', 'dockerfile', 'Containerfile', 'nixpacks.toml', 'Procfile']) {
      expect(existsSync(new URL(name, root)), name).toBe(false);
    }
    for (const name of ['Dockerfile.worker.fallback', 'Dockerfile.worker.fallback.dockerignore', 'deploy/bot/Dockerfile', 'deploy/bot/Dockerfile.dockerignore']) {
      expect(existsSync(new URL(name, root)), name).toBe(true);
    }
  });
  it('pins supported package version and keeps runtime configuration secret-free', () => {
    expect(config.$schema).toBe('https://schema.railpack.com'); expect(config.provider).toBe('node'); expect(config.packages.node).toBe('24');
    expect(config.deploy.variables).toEqual({ NODE_ENV: 'production', PORT: '3001' });
    expect(config.exclude).toEqual(expect.arrayContaining(['.env', '.env.*', '**/.env', '**/.env.*']));
    expect(config.steps.build.commands).not.toContain('...');
    expect(() => verifyWorkerPlan(safePlan())).not.toThrow();
  });
  it.each([
    ['dashboard build', (plan: ReturnType<typeof safePlan>) => { plan.steps[1].commands.push({ cmd: 'npm run build' }); }, 'DASHBOARD_BUILD_PRESENT'],
    ['framework build', (plan: ReturnType<typeof safePlan>) => { plan.steps[1].commands.push({ cmd: 'next build' }); }, 'DASHBOARD_BUILD_PRESENT'],
    ['secrets mount', (plan: ReturnType<typeof safePlan>) => { plan.steps[1].secrets.push('*'); }, 'WORKER_BUILD_SECRETS_PRESENT'],
    ['install generation', (plan: ReturnType<typeof safePlan>) => { plan.steps[0].commands = [{ cmd: 'npm ci' }]; }, 'WORKER_INSTALL_UNSAFE'],
    ['wrapped start', (plan: ReturnType<typeof safePlan>) => { plan.deploy.startCommand = 'npm run bot'; }, 'WORKER_START_UNSAFE'],
    ['wrong port', (plan: ReturnType<typeof safePlan>) => { plan.deploy.variables.PORT = '3000'; }, 'WORKER_RUNTIME_DEFAULTS_INVALID'],
    ['baked credentials', (plan: ReturnType<typeof safePlan>) => { plan.deploy.variables.DATABASE_URL = 'canary-private'; }, 'WORKER_CREDENTIAL_VARIABLE_PRESENT'],
    ['missing engine', (plan: ReturnType<typeof safePlan>) => { plan.deploy.inputs = plan.deploy.inputs.filter((input: { include: string[] }) => !input.include.includes('node_modules/.prisma')); }, 'GENERATED_PRISMA_LAYER_MISSING'],
    ['missing source', (plan: ReturnType<typeof safePlan>) => { plan.deploy.inputs = plan.deploy.inputs.filter((input: { include: string[] }) => !input.include.includes('.')); }, 'WORKER_SOURCE_LAYER_MISSING'],
  ] as const)('rejects %s without executing or exposing plan data', (_name, mutate, code) => {
    const plan = safePlan(); mutate(plan); expect(() => verifyWorkerPlan(plan)).toThrow(code);
  });
});
