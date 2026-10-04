import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { releasePlan } from '../../scripts/prepare-release.mjs';
import { codeqlFindings } from '../../scripts/check-codeql.mjs';
import { expectedInstallers, collectRelease } from '../../scripts/collect-release.mjs';

const env = { GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'push', GITHUB_RUN_NUMBER: '12', GITHUB_RUN_ATTEMPT: '1' };
test('pushes publish unique prereleases; manual mode still builds without publishing', () => {
  assert.deepEqual(releasePlan('0.2.0', env), { version: '0.2.0-dev.12.1', tag: 'v0.2.0-dev.12.1', publish: true, prerelease: true });
  assert.equal(releasePlan('0.2.0', { ...env, RELEASE_MODE: 'manual' }).publish, false);
  assert.equal(releasePlan('0.2.0', { ...env, GITHUB_RUN_ATTEMPT: '2' }).tag, 'v0.2.0-dev.12.2');
});
test('manual runs can publish stable, prerelease, or build only', () => {
  const manual = { ...env, GITHUB_EVENT_NAME: 'workflow_dispatch', RELEASE_KIND: 'stable', MANUAL_PUBLISH: 'true', RELEASE_MODE: 'manual' };
  assert.deepEqual(releasePlan('0.2.0', manual), { version: '0.2.0', tag: 'v0.2.0', publish: true, prerelease: false });
  assert.equal(releasePlan('0.2.0', { ...manual, MANUAL_PUBLISH: 'false' }).publish, false);
  assert.equal(releasePlan('0.2.0', { ...manual, RELEASE_KIND: 'prerelease' }).prerelease, true);
});
test('release settings reject other branches and unsafe or missing input', () => {
  for (const bad of [{ GITHUB_REF: 'refs/heads/feature' }, { GITHUB_EVENT_NAME: 'pull_request' }, { RELEASE_MODE: 'invalid' }, { GITHUB_RUN_NUMBER: '12\nmalicious=true' }, { GITHUB_RUN_ATTEMPT: '' }, { GITHUB_EVENT_NAME: 'workflow_dispatch', MANUAL_PUBLISH: 'true', RELEASE_KIND: 'wrong' }]) {
    assert.throws(() => releasePlan('0.2.0', { ...env, ...bad }));
  }
  assert.throws(() => releasePlan('0.2.0\nmalicious=true', env));
});
test('CodeQL gate rejects failed/missing analysis and retains injection findings', () => {
  const sarif = results => ({ version: '2.1.0', runs: [{ results }] });
  assert.equal(codeqlFindings(sarif([])).length, 0);
  assert.equal(codeqlFindings(sarif([{ ruleId: 'js/code-injection', level: 'error' }])).length, 1);
  assert.equal(codeqlFindings(sarif([{ suppressions: [{ status: 'underReview' }] }])).length, 1);
  assert.equal(codeqlFindings(sarif([{ suppressions: [{ status: 'accepted' }] }])).length, 0);
  for (const bad of [{}, { version: '2.1.0', runs: [] }, { version: '2.1.0', runs: [{}] }, { version: '2.1.0', runs: [{ results: [], invocations: [{ executionSuccessful: false }] }] }]) assert.throws(() => codeqlFindings(bad));
});
test('release collection requires all four nonempty installers and writes checksums', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'agentbridge-ci-'));
  const version = '0.2.0-dev.12.1';
  const sha = 'a'.repeat(40);
  try {
    await assert.rejects(collectRelease(folder, version, sha), /All four/);
    for (const name of expectedInstallers(version)) await writeFile(path.join(folder, name), `synthetic installer ${name}`);
    const checksums = await collectRelease(folder, version, sha);
    assert.equal(checksums.length, 4);
    assert.match(await readFile(path.join(folder, 'SHA256SUMS.txt'), 'utf8'), /^[a-f0-9]{64}  AgentBridge-/);
    assert.match(await readFile(path.join(folder, 'RELEASE_NOTES.md'), 'utf8'), /unsigned/);
    await writeFile(path.join(folder, expectedInstallers(version)[0]), '');
    await assert.rejects(collectRelease(folder, version, sha), /Empty installer/);
    await assert.rejects(collectRelease(folder, version, 'bad'), /source commit/);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
