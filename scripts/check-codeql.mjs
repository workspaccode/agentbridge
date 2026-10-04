import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function codeqlFindings(sarif) {
  if (sarif.version !== '2.1.0' || !Array.isArray(sarif.runs) || !sarif.runs.length) throw new Error('Missing valid CodeQL analysis.');
  return sarif.runs.flatMap(run => {
    if (!Array.isArray(run.results)) throw new Error('Analysis has no results array.');
    if (run.invocations?.some(invocation => invocation.executionSuccessful === false)) throw new Error('CodeQL analysis did not complete.');
    return run.results.filter(result => !result.suppressions?.some(suppression => suppression.status === 'accepted'));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const folder = process.argv[2];
  if (!folder) throw new Error('Provide the CodeQL SARIF output directory.');
  const files = (await readdir(folder)).filter(file => file.endsWith('.sarif'));
  if (!files.length) throw new Error('CodeQL produced no SARIF reports; refusing to build.');
  let count = 0;
  for (const file of files) count += codeqlFindings(JSON.parse(await readFile(path.join(folder, file), 'utf8'))).length;
  console.log(`CodeQL: ${count} unsuppressed finding(s). See the Security tab for details.`);
  if (count) process.exitCode = 1;
}
