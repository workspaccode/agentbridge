import { readFile, appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export function releasePlan(baseVersion, env) {
  if (!/^\d+\.\d+\.\d+$/.test(baseVersion)) throw new Error('package.json must have a stable numeric version, for example 0.2.0.');
  if (env.GITHUB_REF !== 'refs/heads/main') throw new Error('Build and release must run from main.');
  if (!['push', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME)) throw new Error('Unsupported release event.');
  const mode = env.RELEASE_MODE || 'auto';
  if (!['auto', 'manual'].includes(mode)) throw new Error('AGENTBRIDGE_RELEASE_MODE must be auto or manual.');
  const manual = env.GITHUB_EVENT_NAME === 'workflow_dispatch';
  if (manual && !['true', 'false'].includes(env.MANUAL_PUBLISH)) throw new Error('Choose whether to publish.');
  if (manual && !['stable', 'prerelease'].includes(env.RELEASE_KIND)) throw new Error('Choose stable or prerelease.');
  if (!/^[1-9]\d*$/.test(env.GITHUB_RUN_NUMBER || '') || !/^[1-9]\d*$/.test(env.GITHUB_RUN_ATTEMPT || '')) throw new Error('Missing valid GitHub run identifiers.');
  const prerelease = !manual || env.RELEASE_KIND === 'prerelease';
  const version = prerelease ? `${baseVersion}-dev.${env.GITHUB_RUN_NUMBER}.${env.GITHUB_RUN_ATTEMPT}` : baseVersion;
  return { version, tag: `v${version}`, publish: manual ? env.MANUAL_PUBLISH === 'true' : mode === 'auto', prerelease };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { version } = JSON.parse(await readFile('package.json', 'utf8'));
  const plan = releasePlan(version, process.env);
  if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required.');
  await appendFile(process.env.GITHUB_OUTPUT, Object.entries(plan).map(([key, value]) => `${key}=${value}\n`).join(''));
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
    `Version: **${plan.version}**\n\nPublication: **${plan.publish ? 'GitHub Releases' : 'artifacts only'}**\n\nAll security checks and four installer builds must succeed first.\n`);
}
