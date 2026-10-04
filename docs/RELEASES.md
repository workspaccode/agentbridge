# Automated checks, builds and releases

## What runs

Every push to `main` starts **Build and release**. It runs a reusable security gate before packaging:

| Check | Publication stops when |
| --- | --- |
| Backend tests and release-script tests | Any test fails on Windows, macOS or Linux |
| CodeQL JavaScript/TypeScript `security-extended` | Any unsuppressed finding is reported, or analysis fails/is missing |
| Gitleaks | An exposed secret is found anywhere in the reachable Git history |
| `npm audit` including development/build dependencies | A high or critical known dependency vulnerability is reported, or the audit fails |

Only after all checks pass do four installer jobs run: Windows x64 EXE, macOS Intel x64 DMG, macOS Apple Silicon arm64 DMG, and Linux x64 AppImage. Installers are retained as Actions artifacts for 14 days. All four must succeed before a release can be published.

Automatic pushes publish a **prerelease**, for example `v0.2.0-dev.12.1`. The last two numbers are the workflow run number and attempt. Reruns get distinct versions. Prereleases do not replace the latest stable release. The version embedded in each installer matches its release tag.

The release job verifies the four filenames, creates `SHA256SUMS.txt`, uploads everything to a draft, then publishes it. Only this job has repository write permission; builds do not receive a publishing token. Existing tags/releases are never overwritten. If uploading fails, an incomplete draft may remain: inspect and delete that draft before retrying the same stable version.

## Run manually from GitHub

1. Open [Actions → Build and release](https://github.com/workspaccode/agentbridge/actions/workflows/build-release.yml).
2. Click **Run workflow** and select **main**. Other branches are rejected.
3. Choose **Publish to Releases**:
   - On: publish installers after checks and all builds succeed.
   - Off: build downloadable Actions artifacts without creating a release/tag.
4. Choose **release_kind**:
   - `prerelease`: unique development version for this run; recommended for testing.
   - `stable`: use the exact `package.json` version, for example `v0.2.0`.
5. Click **Run workflow**. After success, open [Releases](https://github.com/workspaccode/agentbridge/releases).

For the next stable release, update `version` in both `package.json` and `package-lock.json`, commit, then run manually with `stable`. Reusing an existing stable tag fails instead of changing published downloads.

## Make publication manual only

Open **Settings → Secrets and variables → Actions → Variables → New repository variable**:

```text
Name:  AGENTBRIDGE_RELEASE_MODE
Value: manual
```

Pushes still scan, test and build, but create no releases. Manual runs can still publish. Delete the variable or set it to `auto` to restore automatic prereleases. Unknown values fail validation.

## Security reports and scheduled scans

**Security and tests** also runs for pull requests to `main`, every Monday at 06:23 UTC, and from its own **Run workflow** button. CodeQL results from trusted runs appear in **Security → Code scanning**. Pull requests from forks are scanned and gated without attempting to upload SARIF using a restricted fork token. Gitleaks redacts secret values in logs; never paste a leaked key into an issue. Remove it from history and revoke it at its provider.

Actions are pinned to commit SHAs; the Gitleaks archive is pinned to a SHA-256 digest. Update these deliberately when upgrading. Weekly scans also recheck the locked dependency versions against the current advisory database.

These checks detect supported code injection patterns, exposed secrets and known dependency vulnerabilities. They cannot guarantee the absence of every vulnerability or identify every malicious AI instruction inside imported transcripts. The app treats transcript content as untrusted text; prompt-injection detection is not a release guarantee.

Checks run **after** a push and cannot undo a commit on `main`. To prevent merging failing changes, enable a GitHub branch ruleset requiring pull requests and these checks. The repository currently does not enforce branch protection; people with direct push permission can change code and workflows. Fork pull requests never run the publishing workflow.

## Requirements and limitations

- GitHub Actions must be enabled, the account must be in good billing standing, and GitHub-hosted runners must be available. At setup time, the previous run could not start because GitHub reported an account billing lock. Resolve that in GitHub account billing before expecting remote builds.
- CodeQL upload must be allowed for the repository. This public repository can use GitHub code scanning; a private copy may need the corresponding GitHub security entitlement.
- Release uploads use the workflow's `GITHUB_TOKEN`; no personal token or external service is needed. Organization policies can restrict token permissions and actions.
- Installers are **unsigned**. Windows code signing, macOS notarization and automatic updating remain unconfigured. SHA-256 checksums verify file integrity, not publisher identity.
- A release does not deploy the Internet relay. Follow [INTERNET.md](INTERNET.md) to run your HTTPS relay.
- Native installers need target-platform runners. Local Linux validation does not establish that macOS and Windows packaging succeeded; check the four jobs on GitHub.

## Local validation

```sh
npm test
npm run test:ci
npm ci --ignore-scripts
npm audit --audit-level=high
```

The release-script tests check automatic/manual publication modes, unsafe inputs, missing/failed CodeQL output, and incomplete installer sets. Gitleaks and CodeQL need their own tools; the workflow runs them independently of npm dependencies.
