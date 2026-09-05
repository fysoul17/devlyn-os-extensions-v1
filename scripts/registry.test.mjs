import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { sha256 } from "devlyn-plugin";
import { approveRelease, main, mirrorRelease, readSubmission, revokeRelease } from "./registry.mjs";

const bytes = await readFile(
  new URL("../bundles/devlyn.welcome-0.1.0.devlyn-plugin", import.meta.url),
);
const manifest = JSON.parse(bytes).manifest;
const submission = {
  id: manifest.id,
  version: manifest.version,
  bundleUrl:
    "https://github.com/fysoul17/devlyn-os-extensions-v1/releases/download/devlyn.welcome-v0.1.0/devlyn.welcome-0.1.0.devlyn-plugin",
  sha256: sha256(bytes),
};
const issue = {
  state: "open",
  user: { id: 7436491, login: "fysoul17" },
  body: `<!-- devlyn-plugin-submission -->\n\`\`\`json\n${JSON.stringify(submission)}\n\`\`\``,
};
const empty = { schemaVersion: 1, plugins: [], revoked: [] };
const history = { schemaVersion: 1, publishers: [], releases: [] };

test("approval binds real GitHub numeric owner, exact bytes and immutable history", () => {
  const first = approveRelease(empty, history, issue, bytes);
  assert.equal(first.state.publishers[0].githubUserId, issue.user.id);
  assert.equal(first.catalog.plugins[0].sha256, sha256(bytes));
  assert.equal(
    first.catalog.plugins[0].bundleUrl,
    "https://raw.githubusercontent.com/fysoul17/devlyn-os-extensions-v1/main/bundles/devlyn.welcome-0.1.0.devlyn-plugin",
  );
  assert.notEqual(first.catalog.plugins[0].bundleUrl, submission.bundleUrl);
  assert.equal(first.state.releases[0].bundleUrl, first.catalog.plugins[0].bundleUrl);
  const changedBundle = JSON.parse(bytes);
  changedBundle.files[0].content += "\nDifferent instructions.";
  const changed = Buffer.from(JSON.stringify(changedBundle));
  const altered = structuredClone(issue);
  altered.body = altered.body.replace(sha256(bytes), sha256(changed));
  assert.throws(() => approveRelease(first.catalog, first.state, altered, changed), /immutable/);
  const renamed = {
    ...issue,
    user: { id: issue.user.id, login: "renamed-user" },
  };
  assert.equal(approveRelease(first.catalog, first.state, renamed, bytes).state.releases.length, 1);
  assert.throws(
    () =>
      approveRelease(
        first.catalog,
        first.state,
        { ...issue, user: { id: 98765, login: "fysoul17" } },
        bytes,
      ),
    /another GitHub user/,
  );
  assert.throws(() => approveRelease(empty, history, issue, changed), /digest/);
});

test("registry mirror is exact-byte, immutable and independently validated", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "devlyn-registry-mirror-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const approved = approveRelease(empty, history, issue, bytes);
  await mirrorRelease(directory, submission, bytes);
  await mirrorRelease(directory, submission, bytes);
  const path = join(directory, "bundles", `${manifest.id}-${manifest.version}.devlyn-plugin`);
  assert.deepEqual(await readFile(path), bytes);
  const changed = Buffer.from(`${bytes}\n`);
  await assert.rejects(
    mirrorRelease(directory, { ...submission, sha256: sha256(changed) }, changed),
    /immutable/,
  );
  await writeFile(join(directory, "catalog.json"), JSON.stringify(approved.catalog));
  await writeFile(join(directory, "registry-state.json"), JSON.stringify(approved.state));
  assert.match(await main(["validate"], directory), /Valid catalog/);
  await writeFile(path, changed);
  await assert.rejects(main(["validate"], directory), /Local mirror digest mismatch/);
});

test("registry mirroring refuses a symlinked package directory", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "devlyn-registry-symlink-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const outside = join(directory, "outside");
  const registry = join(directory, "registry");
  await mkdir(outside);
  await mkdir(registry);
  await symlink(outside, join(registry, "bundles"), "dir");
  await assert.rejects(mirrorRelease(registry, submission, bytes), /symbolic link/);
  await assert.rejects(
    readFile(join(outside, `${manifest.id}-${manifest.version}.devlyn-plugin`)),
    /ENOENT/,
  );
});

test("revocation prevents publishing the same release again", () => {
  const first = approveRelease(empty, history, issue, bytes);
  const revoked = revokeRelease(first.catalog, manifest.id, manifest.version, "Unsafe dependency");
  assert.equal(revoked.plugins.length, 0);
  assert.throws(() => approveRelease(revoked, first.state, issue, bytes), /revoked/);
});

test("submission cannot smuggle two payloads or impersonate an issue through a PR", () => {
  assert.throws(() => readSubmission({ ...issue, body: issue.body + issue.body }), /exactly one/);
  assert.throws(() => readSubmission({ ...issue, pull_request: {} }), /open GitHub issue/);
  assert.throws(() => readSubmission({ ...issue, state: "closed" }), /open GitHub issue/);
  assert.throws(
    () =>
      readSubmission({
        ...issue,
        body: issue.body.replace(submission.bundleUrl, `${submission.bundleUrl}?token=secret`),
      }),
    /stable public/,
  );
});

test("a second registry mutation cannot bypass the current operator lock", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "devlyn-registry-lock-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const lock = join(directory, ".registry.lock");
  const bytes = JSON.stringify({ pid: process.pid });
  await writeFile(lock, bytes);
  await assert.rejects(
    main(["revoke", manifest.id, manifest.version, "reason"], directory),
    /locked/,
  );
  assert.equal(await readFile(lock, "utf8"), bytes);
});

test("publish reads the public issue and mirrors only a publicly downloadable matching release", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "devlyn-registry-publish-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, "catalog.json"), JSON.stringify(empty));
  await writeFile(join(directory, "registry-state.json"), JSON.stringify(history));
  let accessible = false;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (String(url).startsWith("https://api.github.com/repos/")) {
      assert.ok(String(url).endsWith("/issues/23"));
      assert.equal(options.headers.Authorization, undefined);
      return Response.json(issue);
    }
    assert.equal(url, submission.bundleUrl);
    assert.equal(options.credentials, "omit");
    return accessible ? new Response(bytes) : new Response("Not Found", { status: 404 });
  });
  await assert.rejects(main(["publish", "23"], directory), /HTTP 404/);
  assert.deepEqual(JSON.parse(await readFile(join(directory, "catalog.json"))), empty);
  await assert.rejects(
    readFile(join(directory, "bundles", `${manifest.id}-${manifest.version}.devlyn-plugin`)),
    /ENOENT/,
  );
  accessible = true;
  assert.match(await main(["publish", "23"], directory), /Prepared/);
  const catalog = JSON.parse(await readFile(join(directory, "catalog.json")));
  const state = JSON.parse(await readFile(join(directory, "registry-state.json")));
  assert.equal(catalog.plugins[0].sha256, sha256(bytes));
  assert.equal(state.publishers[0].githubUserId, issue.user.id);
  assert.deepEqual(
    await readFile(join(directory, "bundles", `${manifest.id}-${manifest.version}.devlyn-plugin`)),
    bytes,
  );
  assert.match(await main(["validate"], directory), /Valid catalog/);
});

test("trusted base comparison rejects coordinated resets and preserves inactive releases", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "devlyn-registry-base-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const base = join(directory, "base");
  const approved = approveRelease(empty, history, issue, bytes);
  const revoked = revokeRelease(approved.catalog, manifest.id, manifest.version, "Unsafe release");
  const writeJson = (path, value) => writeFile(path, JSON.stringify(value));
  await mirrorRelease(base, submission, bytes);
  await writeJson(join(base, "catalog.json"), revoked);
  await writeJson(join(base, "registry-state.json"), approved.state);

  const changes = [
    [
      "coordinated reset",
      async (path) => {
        await writeJson(join(path, "catalog.json"), empty);
        await writeJson(join(path, "registry-state.json"), history);
      },
      /publisher identity/,
    ],
    [
      "publisher transfer",
      async (path) => {
        const state = structuredClone(approved.state);
        state.publishers[0].githubUserId++;
        await writeJson(join(path, "registry-state.json"), state);
      },
      /publisher identity/,
    ],
    [
      "release removal",
      async (path) => {
        await writeJson(join(path, "registry-state.json"), {
          ...approved.state,
          releases: [],
        });
      },
      /release history/,
    ],
    [
      "release digest rewrite",
      async (path) => {
        const state = structuredClone(approved.state);
        state.releases[0].sha256 = "a".repeat(64);
        await writeJson(join(path, "registry-state.json"), state);
      },
      /release history/,
    ],
    [
      "revocation removal",
      async (path) => {
        await writeJson(join(path, "catalog.json"), empty);
      },
      /revocation/,
    ],
    [
      "revocation rewrite",
      async (path) => {
        const catalog = structuredClone(revoked);
        catalog.revoked[0].reason = "Different reason";
        await writeJson(join(path, "catalog.json"), catalog);
      },
      /revocation/,
    ],
    [
      "inactive mirror removal",
      async (path) => {
        await rm(join(path, "bundles", `${manifest.id}-${manifest.version}.devlyn-plugin`));
      },
      /ENOENT/,
    ],
    [
      "inactive mirror rewrite",
      async (path) => {
        await writeFile(
          join(path, "bundles", `${manifest.id}-${manifest.version}.devlyn-plugin`),
          `${bytes}\n`,
        );
      },
      /mirror bytes/,
    ],
    [
      "inactive mirror directory symlink",
      async (path) => {
        await rm(join(path, "bundles"), { recursive: true });
        await symlink(join(base, "bundles"), join(path, "bundles"), "dir");
      },
      /symbolic link/,
    ],
  ];
  for (const [name, mutate, error] of changes) {
    await t.test(name, async () => {
      const candidate = join(directory, name);
      await cp(base, candidate, { recursive: true });
      await mutate(candidate);
      await assert.rejects(main(["validate", "--base", base], candidate), error);
    });
  }

  const candidate = join(directory, "valid-update");
  await cp(base, candidate, { recursive: true });
  const state = structuredClone(approved.state);
  state.publishers[0].githubLogin = "renamed-publisher";
  const updateBundle = JSON.parse(bytes);
  updateBundle.manifest.version = "0.1.1";
  const updateBytes = Buffer.from(JSON.stringify(updateBundle));
  const updateSubmission = {
    ...submission,
    version: "0.1.1",
    bundleUrl: submission.bundleUrl.replaceAll("0.1.0", "0.1.1"),
    sha256: sha256(updateBytes),
  };
  const updateIssue = {
    ...issue,
    body: `<!-- devlyn-plugin-submission -->\n\`\`\`json\n${JSON.stringify(updateSubmission)}\n\`\`\``,
  };
  const update = approveRelease(revoked, state, updateIssue, updateBytes);
  await mirrorRelease(candidate, updateSubmission, updateBytes);
  await writeJson(join(candidate, "catalog.json"), update.catalog);
  await writeJson(join(candidate, "registry-state.json"), update.state);
  assert.match(await main(["validate", "--base", base], candidate), /Valid catalog/);
});

test("new inactive history records must have exact canonical mirrors before their first merge", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "devlyn-registry-orphan-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const base = join(directory, "base");
  const candidate = join(directory, "candidate");
  const approved = approveRelease(empty, history, issue, bytes);
  await mirrorRelease(base, submission, bytes);
  await writeFile(join(base, "catalog.json"), JSON.stringify(approved.catalog));
  await writeFile(join(base, "registry-state.json"), JSON.stringify(approved.state));
  await cp(base, candidate, { recursive: true });
  const state = structuredClone(approved.state);
  const orphan = {
    ...state.releases[0],
    version: "9.9.9",
    bundleUrl: state.releases[0].bundleUrl.replace("0.1.0", "9.9.9"),
  };
  state.releases.push(orphan);
  const saveState = () => writeFile(join(candidate, "registry-state.json"), JSON.stringify(state));
  await saveState();
  await assert.rejects(main(["validate"], candidate), /ENOENT/);
  await assert.rejects(main(["validate", "--base", base], candidate), /ENOENT/);

  const path = join(candidate, "bundles", `${manifest.id}-9.9.9.devlyn-plugin`);
  await writeFile(path, bytes);
  await assert.rejects(main(["validate"], candidate), /identity differs/);
  const bundle = JSON.parse(bytes);
  bundle.manifest.version = "9.9.9";
  const canonical = Buffer.from(JSON.stringify(bundle));
  await writeFile(path, canonical);
  await assert.rejects(main(["validate"], candidate), /digest mismatch/);
  const formatted = Buffer.from(JSON.stringify(bundle, null, 2));
  await writeFile(path, formatted);
  orphan.sha256 = sha256(formatted);
  await saveState();
  await assert.rejects(main(["validate"], candidate), /exact compact pack output/);

  await writeFile(path, canonical);
  orphan.sha256 = sha256(canonical);
  const mirror = orphan.bundleUrl;
  orphan.bundleUrl = submission.bundleUrl;
  await saveState();
  await assert.rejects(main(["validate"], candidate), /registry-controlled mirror/);
  orphan.bundleUrl = mirror;
  await saveState();
  assert.match(await main(["validate"], candidate), /Valid catalog/);
  assert.match(await main(["validate", "--base", base], candidate), /Valid catalog/);
});
