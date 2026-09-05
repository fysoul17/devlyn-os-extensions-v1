import { createHash } from "node:crypto";

export const MAX_BUNDLE_BYTES = 4 * 1024 * 1024;
export const REGISTRY_REPOSITORY = "fysoul17/devlyn-os-extensions-v1";
const IDENTIFIER = /^[a-z][a-z0-9-]{0,63}$/;
const PLUGIN_ID = /^[a-z][a-z0-9-]{0,63}\.[a-z][a-z0-9-]{0,63}$/;
const VERSION =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
const HOSTS = new Set([
  "github.com",
  "raw.githubusercontent.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
]);
const ENGINES = new Set(["claude", "codex", "grok", "omp"]);
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}
function object(value, keys, location) {
  requireValue(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${location}: expected an object`,
  );
  const actual = Object.keys(value);
  requireValue(
    actual.length === keys.length && actual.every((key) => keys.includes(key)),
    `${location}: expected exactly ${keys.join(", ")}`,
  );
}
function string(value, max, location) {
  requireValue(
    typeof value === "string" &&
      value.trim().length > 0 &&
      value.length <= max &&
      !/\p{Cc}/u.test(value) &&
      !LONE_SURROGATE.test(value),
    `${location}: expected nonempty text, at most ${max} characters, without controls`,
  );
  return value;
}
function array(value, min, max, location) {
  requireValue(
    Array.isArray(value) && value.length >= min && value.length <= max,
    `${location}: expected ${min}..${max} entries`,
  );
}
function unique(values, location) {
  requireValue(new Set(values).size === values.length, `${location}: duplicate entries`);
}
function identifier(value, location) {
  requireValue(
    typeof value === "string" && IDENTIFIER.test(value),
    `${location}: expected lowercase identifier`,
  );
}
function pluginId(value) {
  requireValue(
    typeof value === "string" && PLUGIN_ID.test(value),
    "id: expected publisher.product (lowercase letters, digits and hyphens)",
  );
}
function version(value) {
  string(value, 64, "version");
  const match = VERSION.exec(value);
  requireValue(
    match?.slice(1, 4).every((part) => BigInt(part) <= 18446744073709551615n),
    "version: expected SemVer without a v prefix",
  );
}
function httpsUrl(value, location) {
  string(value, 2048, location);
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${location}: invalid URL`);
  }
  requireValue(
    url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.hash &&
      !value.includes("#") &&
      !url.port &&
      !value.includes("\\") &&
      !/\s/.test(value),
    `${location}: expected HTTPS URL without credentials, fragment or custom port`,
  );
  return url;
}
export function validateArtifactUrl(value) {
  const url = httpsUrl(value, "bundleUrl");
  requireValue(HOSTS.has(url.hostname), "bundleUrl: use GitHub release or content infrastructure");
  return value;
}
export function validateSourceArtifactUrl(value) {
  validateArtifactUrl(value);
  const url = new URL(value);
  requireValue(
    !value.includes("?") &&
      ((url.hostname === "github.com" &&
        /^\/[^/]+\/[^/]+\/releases\/download\/[^/]+\/[^/]+$/.test(url.pathname)) ||
        (url.hostname === "raw.githubusercontent.com" &&
          /^\/[^/]+\/[^/]+\/[^/]+\/.+/.test(url.pathname))),
    "Submission requires a stable public GitHub release asset or raw content URL without query parameters; do not submit private or signed download links",
  );
  return value;
}
export async function downloadArtifact(url, fetcher = fetch) {
  for (let redirects = 0; redirects <= 5; redirects++) {
    validateArtifactUrl(url);
    const response = await fetcher(url, {
      redirect: "manual",
      credentials: "omit",
      signal: AbortSignal.timeout(15000),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      requireValue(location, "Artifact redirect has no Location");
      url = new URL(location, url).toString();
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Artifact download failed: HTTP ${response.status}`);
    }
    requireValue(response.body, "Artifact response has no body");
    const reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.length;
        requireValue(length <= MAX_BUNDLE_BYTES, "Artifact exceeds 4 MiB");
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    return Buffer.concat(chunks);
  }
  throw new Error("Artifact exceeded five redirects");
}
export function validatePath(value) {
  requireValue(
    typeof value === "string" &&
      value.length > 0 &&
      value.length <= 240 &&
      /^[\x20-\x7e]+$/.test(value) &&
      !/[<>:"|?*\\]/.test(value),
    "file path: expected a portable relative ASCII path (maximum 240 characters)",
  );
  for (const segment of value.split("/")) {
    requireValue(
      segment &&
        !/^[ .]|[ .]$/.test(segment) &&
        !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment),
      `file path: unsafe segment in ${value}`,
    );
  }
  return value;
}
export function validateManifest(value) {
  object(
    value,
    [
      "schemaVersion",
      "id",
      "name",
      "version",
      "description",
      "license",
      "engines",
      "commands",
      "prerequisites",
    ],
    "manifest",
  );
  requireValue(value.schemaVersion === 1, "manifest: unsupported schemaVersion");
  pluginId(value.id);
  version(value.version);
  string(value.name, 80, "name");
  string(value.description, 1000, "description");
  string(value.license, 128, "license");
  array(value.engines, 1, 4, "engines");
  requireValue(
    value.engines.every((engine) => ENGINES.has(engine)),
    "engines: unsupported engine",
  );
  unique(value.engines, "engines");
  array(value.commands, 1, 32, "commands");
  for (const command of value.commands) {
    object(command, ["id", "title", "description", "instructions", "inputs"], "command");
    identifier(command.id, "command.id");
    string(command.title, 80, "command.title");
    string(command.description, 500, "command.description");
    validatePath(command.instructions);
    array(command.inputs, 0, 8, "command.inputs");
    for (const input of command.inputs) {
      object(input, ["id", "label", "type", "required"], "input");
      identifier(input.id, "input.id");
      string(input.label, 80, "input.label");
      requireValue(
        input.type === "text" || input.type === "multiline",
        "input.type: expected text or multiline",
      );
      requireValue(typeof input.required === "boolean", "input.required: expected boolean");
    }
    unique(
      command.inputs.map((input) => input.id),
      "command.inputs",
    );
  }
  unique(
    value.commands.map((command) => command.id),
    "commands",
  );
  array(value.prerequisites, 0, 16, "prerequisites");
  for (const prerequisite of value.prerequisites) {
    object(prerequisite, ["command", "name", "url"], "prerequisite");
    requireValue(
      typeof prerequisite.command === "string" &&
        prerequisite.command.length <= 64 &&
        /^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(prerequisite.command),
      "prerequisite.command: expected a bare executable name",
    );
    string(prerequisite.name, 80, "prerequisite.name");
    httpsUrl(prerequisite.url, "prerequisite.url");
  }
  unique(
    value.prerequisites.map((prerequisite) => prerequisite.command),
    "prerequisites",
  );
  return value;
}
export function validateBundle(value) {
  object(value, ["schemaVersion", "manifest", "files"], "bundle");
  requireValue(value.schemaVersion === 1, "bundle: unsupported schemaVersion");
  validateManifest(value.manifest);
  array(value.files, 1, 256, "files");
  const paths = new Set();
  for (const file of value.files) {
    object(file, ["path", "content"], "file");
    validatePath(file.path);
    requireValue(
      typeof file.content === "string" &&
        Buffer.byteLength(file.content, "utf8") <= 1024 * 1024 &&
        !file.content.includes("\u0000") &&
        !LONE_SURROGATE.test(file.content),
      `file ${file.path}: expected valid UTF-8 text, at most 1 MiB, without NUL`,
    );
    const folded = file.path.toLowerCase();
    requireValue(!paths.has(folded), `files: case-insensitive collision at ${file.path}`);
    paths.add(folded);
  }
  for (const path of paths) {
    const segments = path.split("/");
    while (segments.length > 1) {
      segments.pop();
      requireValue(!paths.has(segments.join("/")), `files: file/directory collision at ${path}`);
    }
  }
  for (const command of value.manifest.commands) {
    requireValue(
      value.files.some((file) => file.path === command.instructions && file.content.trim()),
      `command ${command.id}: instructions must name a nonempty packaged file with matching case`,
    );
  }
  requireValue(
    Buffer.byteLength(JSON.stringify(value), "utf8") <= MAX_BUNDLE_BYTES,
    "bundle exceeds 4 MiB",
  );
  return value;
}
export function parseBundle(raw) {
  requireValue(
    (typeof raw === "string" || raw instanceof Uint8Array) &&
      Buffer.byteLength(raw) <= MAX_BUNDLE_BYTES,
    "bundle exceeds 4 MiB or is not UTF-8 bytes",
  );
  const text =
    typeof raw === "string"
      ? raw
      : new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw);
  return validateBundle(JSON.parse(text));
}
export function validatePublicationBundle(raw) {
  const bundle = parseBundle(raw);
  requireValue(
    Buffer.from(raw).equals(Buffer.from(JSON.stringify(bundle))),
    "Publication requires exact compact pack output; repack from source, then upload and submit the new digest",
  );
  return bundle;
}
export function validateSubmission(value) {
  object(value, ["id", "version", "bundleUrl", "sha256"], "submission");
  pluginId(value.id);
  version(value.version);
  validateArtifactUrl(value.bundleUrl);
  requireValue(
    typeof value.sha256 === "string" && /^[a-f0-9]{64}$/.test(value.sha256),
    "sha256: expected 64 lowercase hexadecimal characters",
  );
  return value;
}
export function validateCatalog(value) {
  object(value, ["schemaVersion", "plugins", "revoked"], "catalog");
  requireValue(value.schemaVersion === 1, "catalog: unsupported schemaVersion");
  array(value.plugins, 0, 256, "catalog.plugins");
  array(value.revoked, 0, 1024, "catalog.revoked");
  for (const entry of value.plugins) {
    object(entry, ["manifest", "bundleUrl", "sha256"], "catalog entry");
    validateManifest(entry.manifest);
    validateSubmission({
      id: entry.manifest.id,
      version: entry.manifest.version,
      bundleUrl: entry.bundleUrl,
      sha256: entry.sha256,
    });
  }
  unique(
    value.plugins.map((entry) => entry.manifest.id),
    "catalog.plugins",
  );
  for (const entry of value.revoked) {
    object(entry, ["id", "version", "reason"], "revoked release");
    pluginId(entry.id);
    version(entry.version);
    string(entry.reason, 1000, "revoked.reason");
  }
  unique(
    value.revoked.map((entry) => `${entry.id}@${entry.version}`),
    "catalog.revoked",
  );
  requireValue(
    !value.plugins.some((entry) =>
      value.revoked.some(
        (revoked) => revoked.id === entry.manifest.id && revoked.version === entry.manifest.version,
      ),
    ),
    "catalog: an active release is revoked",
  );
  requireValue(
    Buffer.byteLength(JSON.stringify(value), "utf8") <= MAX_BUNDLE_BYTES,
    "catalog exceeds 4 MiB",
  );
  return value;
}
export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
