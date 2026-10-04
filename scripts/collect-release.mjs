import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function expectedInstallers(version) {
  if (!/^\d+\.\d+\.\d+(?:-dev\.[1-9]\d*\.[1-9]\d*)?$/.test(version || '')) throw new Error('Invalid release version.');
  // electron-builder expands the Linux AppImage architecture to x86_64.
  return ['win-x64.exe', 'mac-x64.dmg', 'mac-arm64.dmg', 'linux-x86_64.AppImage'].map(suffix => `AgentBridge-${version}-${suffix}`).sort();
}

export async function collectRelease(folder, version, sha) {
  if (!/^[a-f0-9]{40}$/.test(sha || '')) throw new Error('A full source commit SHA is required.');
  const expected = expectedInstallers(version);
  const files = (await readdir(folder)).filter(file => /\.(exe|dmg|AppImage)$/.test(file)).sort();
  if (JSON.stringify(files) !== JSON.stringify(expected)) throw new Error('Missing, duplicate, or unexpected installers. All four platform builds are required.');
  const checksums = [];
  for (const file of files) {
    const location = path.join(folder, file);
    if (!(await stat(location)).size) throw new Error(`Empty installer: ${file}`);
    checksums.push(`${createHash('sha256').update(await readFile(location)).digest('hex')}  ${file}`);
  }
  await writeFile(path.join(folder, 'SHA256SUMS.txt'), `${checksums.join('\n')}\n`);
  await writeFile(path.join(folder, 'RELEASE_NOTES.md'),
    `AgentBridge ${version}\n\nSource commit: ${sha}\n\n` +
    `Installers: Windows x64 (EXE), macOS Intel and Apple Silicon (DMG), Linux x64 (AppImage).\n\n` +
    `All automated tests, dependency audit, Gitleaks history scan, and CodeQL security checks passed before packaging. ` +
    `SHA256SUMS.txt verifies download integrity. These installers are unsigned; macOS notarization and automatic updates are not configured.\n\n` +
    `Internet sharing requires your own HTTPS relay. See docs/INTERNET.md in the repository.\n`);
  return checksums;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) throw new Error('Provide the installer directory.');
  console.log((await collectRelease(process.argv[2], process.env.RELEASE_VERSION, process.env.GITHUB_SHA)).join('\n'));
}
