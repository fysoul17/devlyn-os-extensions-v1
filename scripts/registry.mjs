#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, parseArgs } from "node:util";
import {
  downloadArtifact,
  MAX_BUNDLE_BYTES,
  REGISTRY_REPOSITORY,
  sha256,
  validateCatalog,
  validatePublicationBundle,
  validateSourceArtifactUrl,
  validateSubmission,
} from "devlyn-plugin";

const SUBMISSION = /<!-- devlyn-plugin-submission -->\s*```json\s*([\s\S]*?)\s*```/;
const HELP =
  "registry.mjs validate [--remote] [--base <trusted-checkout>] | publish <GitHub-issue-number> | revoke <publisher.product> <version> <reason>";

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}
function mirrorName(release) {
  return `${release.id}-${release.version}.devlyn-plugin`;
}
function mirrorUrl(release) {
  return `https://raw.githubusercontent.com/${REGISTRY_REPOSITORY}/main/bundles/${mirrorName(release)}`;
}
async function readMirror(path) {
  ensure(
    (await lstat(dirname(path))).isDirectory(),
    "Mirror directory must not be a symbolic link",
  );
  const stat = await lstat(path);
  ensure(
    stat.isFile() && !stat.isSymbolicLink() && stat.size <= MAX_BUNDLE_BYTES,
    "Mirror must be a regular package file at most 4 MiB",
  );
  const bytes = await readFile(path);
  ensure(bytes.length <= MAX_BUNDLE_BYTES, "Mirror exceeds 4 MiB");
  return bytes;
}
export async function mirrorRelease(directory, release, bytes) {
  validateSubmission(release);
  ensure(sha256(bytes) === release.sha256, "Mirror bytes differ from approved digest");
  const folder = resolve(directory, "bundles");
  await mkdir(folder, { recursive: true });
  ensure(
    (await lstat(folder)).isDirectory(),
    "Bundle mirror directory must not be a symbolic link",
  );
  const destination = resolve(folder, mirrorName(release));
  const temporary = resolve(folder, `${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, bytes, { flag: "wx" });
    try {
      await link(temporary, destination);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      ensure(
        (await readMirror(destination)).equals(bytes),
        "Existing mirror is immutable; use a new version",
      );
    }
  } finally {
    await rm(temporary, { force: true });
  }
}
export function readSubmission(issue) {
  ensure(
    issue && issue.state === "open" && !issue.pull_request && typeof issue.body === "string",
    "Submission must be an open GitHub issue",
  );
  ensure(
    Number.isSafeInteger(issue.user?.id) &&
      issue.user.id > 0 &&
      typeof issue.user.login === "string",
    "GitHub issue has no authenticated author identity",
  );
  const matches = [...issue.body.matchAll(new RegExp(SUBMISSION.source, "g"))];
  ensure(matches.length === 1, "Issue must contain exactly one generated submission JSON block");
  const submission = validateSubmission(JSON.parse(matches[0][1]));
  validateSourceArtifactUrl(submission.bundleUrl);
  return submission;
}

function validateState(state) {
  ensure(
    state?.schemaVersion === 1 &&
      Array.isArray(state.publishers) &&
      Array.isArray(state.releases) &&
      Object.keys(state).sort().join() === "publishers,releases,schemaVersion",
    "Invalid registry-state.json",
  );
  const publishers = new Set();
  for (const publisher of state.publishers) {
    ensure(
      publisher &&
        Object.keys(publisher).sort().join() === "githubLogin,githubUserId,id" &&
        typeof publisher.id === "string" &&
        /^[a-z][a-z0-9-]{0,63}$/.test(publisher.id) &&
        Number.isSafeInteger(publisher.githubUserId) &&
        publisher.githubUserId > 0 &&
        typeof publisher.githubLogin === "string" &&
        publisher.githubLogin.length > 0,
      "Invalid publisher identity",
    );
    ensure(!publishers.has(publisher.id), "Duplicate publisher identity");
    publishers.add(publisher.id);
  }
  const releases = new Set();
  for (const release of state.releases) {
    validateSubmission(release);
    ensure(publishers.has(release.id.split(".")[0]), "Release has no registered publisher");
    const key = `${release.id}@${release.version}`;
    ensure(!releases.has(key), "Duplicate historical release");
    releases.add(key);
  }
  return state;
}

export function approveRelease(catalogValue, stateValue, issue, bytes) {
  const catalog = structuredClone(validateCatalog(catalogValue));
  const state = structuredClone(validateState(stateValue));
  const submission = readSubmission(issue);
  const bundle = validatePublicationBundle(bytes);
  ensure(sha256(bytes) === submission.sha256, "Downloaded bundle digest differs from submission");
  ensure(
    bundle.manifest.id === submission.id && bundle.manifest.version === submission.version,
    "Downloaded identity differs from submission",
  );
  ensure(
    !catalog.revoked.some(
      (release) => release.id === submission.id && release.version === submission.version,
    ),
    "This release is revoked; use a new version",
  );
  const publisherId = submission.id.split(".")[0];
  const owner = state.publishers.find((publisher) => publisher.id === publisherId);
  ensure(
    !owner || owner.githubUserId === issue.user.id,
    "Publisher belongs to another GitHub user; identity transfers require separate operator review",
  );
  const existing = state.releases.find(
    (release) => release.id === submission.id && release.version === submission.version,
  );
  ensure(
    !existing || existing.sha256 === submission.sha256,
    "Published versions are immutable: change the version instead of replacing bytes",
  );
  if (!owner)
    state.publishers.push({
      id: publisherId,
      githubUserId: issue.user.id,
      githubLogin: issue.user.login,
    });
  const approvedRelease = { ...submission, bundleUrl: mirrorUrl(submission) };
  if (!existing) state.releases.push(approvedRelease);
  catalog.plugins = catalog.plugins.filter((entry) => entry.manifest.id !== submission.id);
  catalog.plugins.push({
    manifest: bundle.manifest,
    bundleUrl: approvedRelease.bundleUrl,
    sha256: submission.sha256,
  });
  catalog.plugins.sort((a, b) => a.manifest.id.localeCompare(b.manifest.id, "en"));
  return { catalog: validateCatalog(catalog), state: validateState(state) };
}

export function revokeRelease(catalogValue, id, version, reason) {
  const catalog = structuredClone(validateCatalog(catalogValue));
  const existing = catalog.revoked.find(
    (release) => release.id === id && release.version === version,
  );
  ensure(!existing, "Release is already revoked");
  catalog.plugins = catalog.plugins.filter(
    (entry) => entry.manifest.id !== id || entry.manifest.version !== version,
  );
  catalog.revoked.push({ id, version, reason });
  return validateCatalog(catalog);
}

async function atomicJson(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      flag: "wx",
    });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function validateHistory(directory, catalog, state, baseDirectory) {
  const baseCatalog = validateCatalog(
    JSON.parse(await readFile(resolve(baseDirectory, "catalog.json"), "utf8")),
  );
  const baseState = validateState(
    JSON.parse(await readFile(resolve(baseDirectory, "registry-state.json"), "utf8")),
  );
  for (const publisher of baseState.publishers) {
    ensure(
      state.publishers.some(
        (current) => current.id === publisher.id && current.githubUserId === publisher.githubUserId,
      ),
      `Published publisher identity cannot be removed or transferred: ${publisher.id}`,
    );
  }
  for (const release of baseState.releases) {
    ensure(
      state.releases.some((current) => isDeepStrictEqual(current, release)),
      `Published release history cannot be removed or changed: ${release.id}@${release.version}`,
    );
    const path = mirrorName(release);
    const previous = await readMirror(resolve(baseDirectory, "bundles", path));
    ensure(sha256(previous) === release.sha256, `Trusted base mirror digest mismatch: ${path}`);
    const current = await readMirror(resolve(directory, "bundles", path));
    ensure(previous.equals(current), `Published mirror bytes cannot change: ${path}`);
  }
  for (const revoked of baseCatalog.revoked) {
    ensure(
      catalog.revoked.some((current) => isDeepStrictEqual(current, revoked)),
      `Published revocation cannot be removed or changed: ${revoked.id}@${revoked.version}`,
    );
  }
}

export async function main(args, directory = process.cwd()) {
  if (args[0] !== "publish" && args[0] !== "revoke") return operate(args, directory);
  const lockPath = resolve(directory, ".registry.lock");
  const lock = await open(lockPath, "wx").catch((error) => {
    if (error.code === "EEXIST")
      throw new Error(
        "Registry mutation is locked. Inspect .registry.lock and verify that its process has stopped before removing a stale lock.",
      );
    throw error;
  });
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid }));
    return await operate(args, directory);
  } finally {
    await lock.close();
    await rm(lockPath);
  }
}

async function operate(args, directory) {
  const catalogPath = resolve(directory, "catalog.json");
  const statePath = resolve(directory, "registry-state.json");
  const catalog = validateCatalog(JSON.parse(await readFile(catalogPath, "utf8")));
  const state = validateState(JSON.parse(await readFile(statePath, "utf8")));
  if (args[0] === "validate") {
    const { values } = parseArgs({
      args: args.slice(1),
      options: { remote: { type: "boolean" }, base: { type: "string" } },
    });
    if (values.base !== undefined) {
      ensure(values.base.trim(), "--base requires a trusted checkout directory");
      await validateHistory(directory, catalog, state, resolve(values.base));
    }
    const verifiedReleases = new Map();
    for (const release of state.releases) {
      ensure(
        release.bundleUrl === mirrorUrl(release),
        "Release artifacts must use the registry-controlled mirror",
      );
      const localBytes = await readMirror(resolve(directory, "bundles", mirrorName(release)));
      ensure(sha256(localBytes) === release.sha256, "Local mirror digest mismatch");
      const bundle = validatePublicationBundle(localBytes);
      ensure(
        bundle.manifest.id === release.id && bundle.manifest.version === release.version,
        "Local mirror identity differs from release history",
      );
      verifiedReleases.set(`${release.id}@${release.version}`, { release, bundle });
    }
    for (const entry of catalog.plugins) {
      const release = {
        id: entry.manifest.id,
        version: entry.manifest.version,
      };
      ensure(
        entry.bundleUrl === mirrorUrl(release),
        "Catalog artifacts must use the registry-controlled mirror",
      );
      const verified = verifiedReleases.get(`${release.id}@${release.version}`);
      ensure(
        verified &&
          verified.release.sha256 === entry.sha256 &&
          verified.release.bundleUrl === entry.bundleUrl,
        "Catalog entry is absent from immutable release history",
      );
      ensure(
        isDeepStrictEqual(verified.bundle.manifest, entry.manifest),
        "Local mirror manifest mismatch",
      );
      if (values.remote) {
        const bytes = await downloadArtifact(entry.bundleUrl);
        ensure(sha256(bytes) === entry.sha256, "Remote artifact digest mismatch");
        const bundle = validatePublicationBundle(bytes);
        ensure(
          isDeepStrictEqual(bundle.manifest, entry.manifest),
          "Remote artifact manifest mismatch",
        );
      }
    }
    return `Valid catalog: ${catalog.plugins.length} plugins, ${catalog.revoked.length} revoked releases. Plugin code was not executed.`;
  }
  if (args[0] === "publish" && args.length === 2 && /^[1-9]\d{0,9}$/.test(args[1])) {
    const response = await fetch(
      `https://api.github.com/repos/${REGISTRY_REPOSITORY}/issues/${args[1]}`,
      {
        headers: { Accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(15000),
        redirect: "error",
      },
    );
    ensure(response.ok, `GitHub issue lookup failed: HTTP ${response.status}`);
    const issue = await response.json();
    const submission = readSubmission(issue);
    const bytes = await downloadArtifact(submission.bundleUrl);
    const approved = approveRelease(catalog, state, issue, bytes);
    await mirrorRelease(directory, submission, bytes);
    // History first: interruption can be retried without losing the immutable digest.
    await atomicJson(statePath, approved.state);
    await atomicJson(catalogPath, approved.catalog);
    return `Prepared ${submission.id}@${submission.version} and its registry mirror. Review the package/catalog/history diff, run validate, then publish them together through the protected branch. Use validate --remote after publication. No remote files were changed.`;
  }
  if (args[0] === "revoke" && args.length === 4) {
    ensure(
      state.releases.some((release) => release.id === args[1] && release.version === args[2]),
      "Cannot revoke an unknown release",
    );
    await atomicJson(catalogPath, revokeRelease(catalog, args[1], args[2], args[3]));
    return "Revocation prepared locally. Review and publish the catalog; users receive it on their next successful refresh.";
  }
  throw new Error(HELP);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2))
    .then((output) => process.stdout.write(`${output}\n`))
    .catch((error) => {
      process.stderr.write(`registry: ${error.message}\n`);
      process.exitCode = 1;
    });
}
