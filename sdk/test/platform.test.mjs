import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { buildBundle, main, starterInstructions, starterManifest } from "../cli.mjs";
import {
  downloadArtifact,
  MAX_BUNDLE_BYTES,
  parseBundle,
  REGISTRY_REPOSITORY,
  sha256,
  validateArtifactUrl,
  validateBundle,
  validateCatalog,
  validateManifest,
  validatePath,
  validatePublicationBundle,
  validateSourceArtifactUrl,
} from "../index.mjs";

function fixture() {
  return {
    schemaVersion: 1,
    manifest: structuredClone(starterManifest),
    files: [{ path: "skills/write-note/SKILL.md", content: starterInstructions }],
  };
}

test("shared public release cases match the native contract", async () => {
  const { cases } = JSON.parse(await readFile(new URL("./contract-cases.json", import.meta.url)));
  const bundle = fixture();
  bundle.manifest.id = "devlyn.welcome";
  const catalog = {
    schemaVersion: 1,
    plugins: [
      {
        manifest: bundle.manifest,
        bundleUrl: `https://raw.githubusercontent.com/${REGISTRY_REPOSITORY}/main/bundles/devlyn.welcome-0.1.0.devlyn-plugin`,
        sha256: sha256(JSON.stringify(bundle)),
      },
    ],
    revoked: [],
  };
  for (const item of cases) {
    const value = structuredClone(item.target === "bundle" ? bundle : catalog);
    for (const patch of item.patches) {
      const keys = patch.pointer.split("/").slice(1);
      const key = keys.pop();
      const parent = keys.reduce((target, key) => target[key], value);
      parent[key] = patch.value;
    }
    const validate = () =>
      item.target === "bundle" ? validateBundle(value) : validateCatalog(value);
    if (item.accepted) assert.doesNotThrow(validate, item.name);
    else assert.throws(validate, undefined, item.name);
  }
});

test("the npm-style executable symlink invokes the CLI", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "devlyn-plugin-bin-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const executable = join(directory, "devlyn-plugin");
  await symlink(fileURLToPath(new URL("../bin.mjs", import.meta.url)), executable);
  const { stdout } = await promisify(execFile)(process.execPath, [executable, "--help"]);
  assert.match(stdout, /devlyn-plugin init/);
});

test("portable manifest accepts all supported engines, proprietary licensing and SemVer prereleases", () => {
  const bundle = fixture();
  bundle.manifest.license = "LicenseRef-Proprietary";
  bundle.manifest.version = "2.0.0-rc.1+build.2026";
  assert.equal(validateBundle(bundle), bundle);
  for (const version of [
    "v1.0.0",
    "1.0",
    "01.0.0",
    "1.0.0-01",
    "1.0.0+",
    "18446744073709551616.0.0",
  ]) {
    assert.throws(() => validateManifest({ ...bundle.manifest, version }), /version/);
  }
});

test("strict contracts reject undeclared execution hooks, invalid fields and duplicate contributions", () => {
  for (const mutate of [
    (b) => {
      b.manifest.install = "curl malicious | sh";
    },
    (b) => {
      b.manifest.engines.push("claude");
    },
    (b) => {
      b.manifest.commands.push(structuredClone(b.manifest.commands[0]));
    },
    (b) => {
      b.manifest.commands[0].inputs.push(structuredClone(b.manifest.commands[0].inputs[0]));
    },
    (b) => {
      b.manifest.commands[0].inputs[0].required = "true";
    },
    (b) => {
      b.manifest.prerequisites.push({
        command: "sh -c",
        name: "Shell",
        url: "https://example.com",
      });
    },
    (b) => {
      b.manifest.name = "\ud800";
    },
    (b) => {
      b.manifest.name = "name\u0085";
    },
    (b) => {
      b.files[0].mode = 0o777;
    },
  ]) {
    const bundle = fixture();
    mutate(bundle);
    assert.throws(() => validateBundle(bundle));
  }
});

test("publication rejects ambiguous JSON parser representations without rewriting their digest", () => {
  const packed = JSON.stringify(fixture());
  assert.equal(validatePublicationBundle(packed).manifest.id, fixture().manifest.id);
  for (const raw of [
    `${packed}\n`,
    packed.replace('"schemaVersion":1', '"schemaVersion":1.0'),
    packed.replace('"schemaVersion":1', '"schemaVersion":0,"schemaVersion":1'),
  ]) {
    assert.throws(() => validatePublicationBundle(raw), /exact compact pack output/);
  }
});

test("archive paths cannot traverse, alias Windows names, or collide on case-insensitive filesystems", () => {
  for (const path of [
    "/tmp/a",
    "../a",
    "a/../b",
    "a/./b",
    "a//b",
    "a\\b",
    "C:/a",
    "a\u0000b",
    "a\nb",
    "NUL.txt",
    "AUX",
    "COM9.js",
    "a./x",
    "a /x",
    "a/.env",
    "a/<b>",
    "한글.md",
  ]) {
    assert.throws(() => validatePath(path), undefined, path);
  }
  for (const path of ["skills/WRITE-NOTE/skill.md", "skills", "skills/write-note/SKILL.md/child"]) {
    const bundle = fixture();
    bundle.files.push({ path, content: "collision" });
    assert.throws(() => validateBundle(bundle), /collision/);
  }
  const bundle = fixture();
  bundle.manifest.commands[0].instructions = "skills/write-note/skill.md";
  assert.throws(() => validateBundle(bundle), /instructions/);
});

test("byte limits, invalid UTF-8, lone surrogates and raw serialized size fail closed", () => {
  const bundle = fixture();
  bundle.files[0].content = "é".repeat(524289);
  assert.throws(() => validateBundle(bundle), /1 MiB/);
  bundle.files[0].content = "\ud800";
  assert.throws(() => validateBundle(bundle), /UTF-8/);
  bundle.files[0].content = "a\u0000b";
  assert.throws(() => validateBundle(bundle), /NUL/);
  assert.throws(() => parseBundle(Buffer.from([0xff])));
  assert.throws(() =>
    parseBundle(
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(fixture()))]),
    ),
  );
  assert.throws(
    () => parseBundle(`${" ".repeat(MAX_BUNDLE_BYTES)}${JSON.stringify(fixture())}`),
    /4 MiB/,
  );
});

test("catalog authenticates artifact host shape and rejects revoked active releases", () => {
  for (const url of [
    "http://github.com/a",
    "https://github.com.evil.test/a",
    "https://user:pass@github.com/a",
    "https://github.com:444/a",
    "https://github.com/a#fragment",
    "https://github.com\\@evil.test/a",
  ]) {
    assert.throws(() => validateArtifactUrl(url), undefined, url);
  }
  const catalog = {
    schemaVersion: 1,
    plugins: [
      {
        manifest: fixture().manifest,
        bundleUrl: "https://github.com/example/releases/download/v1/package.json",
        sha256: "a".repeat(64),
      },
    ],
    revoked: [],
  };
  assert.equal(validateCatalog(catalog), catalog);
  catalog.revoked.push({
    id: catalog.plugins[0].manifest.id,
    version: "0.1.0",
    reason: "Unsafe release",
  });
  assert.throws(() => validateCatalog(catalog), /revoked/);
});

test("developer lifecycle works outside the private repo and excludes unlisted secrets", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "devlyn-plugin-kit-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, "outside-project");
  await main(["init", source]);
  await writeFile(join(source, ".env"), "PRIVATE_KEY=do-not-package");
  await writeFile(join(source, "unlisted-secret.txt"), "also-private");
  assert.match(await main(["validate", source]), /Valid:/);
  const output = join(directory, "release.devlyn-plugin");
  await main(["pack", source, output]);
  const bytes = await readFile(output);
  const bundle = parseBundle(bytes);
  assert.equal(bundle.files.length, 1);
  assert.ok(!bytes.includes(Buffer.from("do-not-package")));
  assert.match(bundle.files[0].content, /workspace root/);
  assert.match(await main(["validate", output]), /Valid:/);
  const result = await main(
    [
      "submit",
      output,
      "--url",
      "https://github.com/example/extensions/releases/download/v0.1.0/release.devlyn-plugin",
    ],
    async () => new Response(bytes),
  );
  assert.match(result, /nothing has been sent or published/);
  const issueUrl = result.split("\n").at(-1);
  const body = new URL(issueUrl).searchParams.get("body");
  assert.ok(body.includes(sha256(bytes)));
  assert.ok(body.includes(bundle.manifest.id));
  await assert.rejects(main(["pack", source, output]), /EEXIST/);
  await assert.rejects(main(["init", source]), /EEXIST/);
});

test("submit rejects inaccessible or mismatched uploads before creating an issue draft", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "devlyn-plugin-submit-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "package.devlyn-plugin");
  const bytes = Buffer.from(JSON.stringify(fixture()));
  await writeFile(path, bytes);
  const url = "https://github.com/example/releases/releases/download/v0.1.0/package.devlyn-plugin";
  const args = ["submit", path, "--url", url, "--open"];
  await assert.rejects(
    main(args, async (_url, options) => {
      assert.equal(options.credentials, "omit");
      assert.equal(options.headers, undefined);
      return new Response("Not Found", { status: 404 });
    }),
    /HTTP 404.*public release-only repository.*source can stay private.*without login/,
  );
  await assert.rejects(
    main(args, async () => new Response("<html>Sign in to GitHub</html>")),
    /Downloaded bytes differ.*public release-only repository/,
  );
  await assert.rejects(
    main(args, async () => new Response(Buffer.concat([bytes, Buffer.from("\n")]))),
    /Downloaded bytes differ/,
  );
  await assert.rejects(
    main(["submit", path, "--url", `${url}?token=private`], async () => {
      assert.fail("A signed source URL must fail before any request");
    }),
    /stable public.*without query parameters/,
  );
});

test("stable public sources allow signed CDN redirects without submitting expiring URLs", async () => {
  const url =
    "https://github.com/example/extensions/releases/download/v0.1.0/package.devlyn-plugin";
  const cdn = "https://release-assets.githubusercontent.com/example/asset?sig=download-signature";
  assert.equal(validateSourceArtifactUrl(url), url);
  const raw = "https://raw.githubusercontent.com/example/extensions/main/package.devlyn-plugin";
  assert.equal(validateSourceArtifactUrl(raw), raw);
  for (const invalid of [
    cdn,
    `${url}?`,
    `${raw}?token=secret`,
    "https://github.com/example/extensions/blob/main/plugin.json",
  ]) {
    assert.throws(() => validateSourceArtifactUrl(invalid), /stable public/);
  }
  const bytes = Buffer.from(JSON.stringify(fixture()));
  let calls = 0;
  const result = await downloadArtifact(url, async (requestUrl, options) => {
    calls++;
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "manual");
    assert.equal(requestUrl, calls === 1 ? url : cdn);
    return calls === 1
      ? new Response(null, { status: 302, headers: { location: cdn } })
      : new Response(bytes);
  });
  assert.deepEqual(result, bytes);
  assert.equal(calls, 2);
  let deniedCalls = 0;
  await assert.rejects(
    downloadArtifact(url, async () => {
      deniedCalls++;
      return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } });
    }),
    /HTTPS/,
  );
  assert.equal(deniedCalls, 1);
  await assert.rejects(
    downloadArtifact(url, async () => new Response(new Uint8Array(MAX_BUNDLE_BYTES + 1))),
    /4 MiB/,
  );
});

test("pack rejects symlinked files and parent directories instead of following them", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "devlyn-plugin-links-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, "plugin");
  await main(["init", source]);
  const external = join(directory, "external");
  await mkdir(external);
  await writeFile(join(external, "secret.txt"), "secret");
  await symlink(external, join(source, "linked"), "dir");
  await writeFile(join(source, "plugin.files.json"), '["linked/secret.txt"]');
  await assert.rejects(buildBundle(source), /symbolic links/);
  await symlink(join(external, "secret.txt"), join(source, "leak.txt"));
  await writeFile(join(source, "plugin.files.json"), '["leak.txt"]');
  await assert.rejects(buildBundle(source), /symbolic links/);
});
