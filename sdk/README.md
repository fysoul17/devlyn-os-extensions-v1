# Devlyn extension developer kit

Build a free agent extension without Devlyn OS source or a Devlyn account. The kit, types and schemas are MIT licensed; this license does not cover Devlyn OS. Your extension can use its own license, including `LicenseRef-Proprietary`. Ship only runtime assets you are authorized to distribute.

The first format contributes commands and small input forms. Devlyn renders them, installs a snapshot and invokes the chosen local agent with your instructions, the selected workspace root and structured inputs. It supplies session output and Stop. Plugin instructions and tools run with that agent's local authority: this is trusted execution, not an OS sandbox. No install hooks, automatic dependency installs, privileged webviews, binary bundles or hosted model runner are provided in v1.

A coding agent can follow `AGENTS.md` and invoke this CLI directly; no MCP setup is required. The SDK defines how a product appears, installs and runs in Devlyn. MCP exposes tools to model clients and does not replace this package contract; this kit does not automatically configure MCP servers in users' agents.

## Five steps

Install the SDK from the public registry's release asset (Node.js 20+):

```sh
npm install -g https://github.com/fysoul17/devlyn-os-extensions-v1/releases/download/sdk-v0.1.0/devlyn-plugin-0.1.0.tgz
devlyn-plugin init my-extension
cd my-extension
# Set your permanent publisher.product ID in plugin.json.
# Edit the skill and add any runtime files to plugin.files.json.
devlyn-plugin validate .
devlyn-plugin pack .
```

1. In Devlyn, open Extensions → Develop → Test a bundle and choose the generated `.devlyn-plugin` file.
2. Review trust, select a workspace, enable the extension and run its command. The starter creates `devlyn-welcome.md` there. Verify that output in an unrelated workspace as well.
3. Put the exact bundle on a public GitHub release. A release-only repository is sufficient; your product source can stay private.
4. Run `devlyn-plugin submit ./your-name.welcome-0.1.0.devlyn-plugin --url https://github.com/YOU/REPO/releases/download/v0.1.0/your-name.welcome-0.1.0.devlyn-plugin`. The CLI downloads anonymously and compares the upload with your local bytes before preparing a draft. Private, missing or changed uploads fail here.
5. Review the printed GitHub issue URL and submit it. Add `--open` to open the draft in your browser. The CLI does not submit the issue or publish your extension. Operator review confirms namespace ownership, behavior and the exact release digest; track approval or requested changes in the issue.

`fysoul17/devlyn-os-extensions-v1` is the configured registry destination. Its public repository and SDK release asset are release prerequisites, not implied by this source checkout. To use the kit before that release, run `npm pack` here and install the resulting tarball with `npm install -g ./devlyn-plugin-0.1.0.tgz`. Distribution through the npm registry can be added later; this workflow does not require an npm publishing account.

## Private products and public distribution

Keep your product repository private and upload only the reviewed `.devlyn-plugin` file to a separate public release-only repository. Use its stable release URL above, or a `raw.githubusercontent.com/OWNER/REPO/REF/PATH` URL, without query parameters. Private releases and temporary signed links cannot be submitted. The CLI and operator never request a GitHub token or access your private repository.

Everything inside a catalog bundle becomes public through the registry mirror and is readable by installed users. `LicenseRef-Proprietary` declares a license; it does not hide code or instructions. Keep confidential implementation and credentials out of the bundle. A public extension can guide the user's already configured local CLI or connect to your authenticated service, with required tools and external costs disclosed. The public catalog does not distribute confidential packages.

The canonical SDK source, schemas and tests live in [`sdk/`](https://github.com/fysoul17/devlyn-os-extensions-v1/tree/main/sdk) in the separate public repository. From that directory, `npm test` and `npm pack` work without Devlyn OS source.

## Contract

`plugin.json` requires exactly: `schemaVersion`, `id`, `name`, `version`, `description`, `license`, `engines`, `commands`, `prerequisites`. The starter shows every field. Each command requires `id`, `title`, `description`, `instructions`, `inputs`. Input types are `text` and `multiline`; values are bounded to 8 KiB UTF-8 each by Devlyn. Each prerequisite declares a bare executable `command`, readable `name`, and HTTPS setup `url`. Devlyn shows missing tools instead of installing them silently.

`plugin.files.json` is an explicit array of file paths. There is no directory scan or glob expansion. Include instruction documents and required text runtime assets only; omit keys, credentials, `.env`, private material and development dependencies. Review the resulting bundle before uploading. Pack rejects symlinks, traversal, nonportable names and path collisions. Limits are 256 files, 1 MiB per UTF-8 file and 4 MiB for the whole serialized bundle. Binary files are not supported. Runtime dependencies must already be available or declared as prerequisites.

Never assume the user's current directory is your package. Read resources from the package root supplied by Devlyn and write product outputs only within the selected workspace. Do not edit the immutable installed package. Read structured input values as data; do not interpolate them into shell commands. Preserve human approval gates and existing workspace files. An extension must never claim publication or success that its tools did not perform.

Never request API keys, passwords or access tokens through command inputs: those values are sent to the selected agent and may appear in its transcript. Use the provider's own sign-in flow or an already authenticated local CLI. Keep confidential service implementation and credentials on your server.

Editor schemas are in `schema/*.schema.json`; use `devlyn-plugin validate` for semantic checks such as cross-file references, collision detection, byte limits and allowed download hosts. Types can be imported with `import type { PluginManifest, PluginBundle, PluginCatalog } from "devlyn-plugin"`. Schemas assist editing; the CLI and native host enforce the complete contract.

For each update, increment SemVer, pack, test, upload a new immutable asset and submit it again. Published id/version bytes cannot be replaced. Removal from discovery and security revocation are different operations; contact the registry through the release issue when an unsafe version must be revoked. Keep the publisher ID when renaming a GitHub account; ownership is tied to the numeric GitHub user ID recorded during review.

Changed bytes always require a new version, including local development before publication: bump `0.1.0` to `0.1.1` before repacking an edit. Reimporting the same version repairs only its exact previously installed bytes.

Publication accepts the exact compact JSON bytes produced by `pack`. Do not pretty-print or modify an uploaded bundle. `validate` identifies noncanonical input and asks you to repack; it never silently changes a release digest. Native local import can reject ambiguous duplicate fields or numeric representations that generic JSON parsers accept.

After review, the operator mirrors the approved bytes into the registry repository. Catalog installations use that mirror, so a publisher deleting or replacing their original upload cannot change an approved installation.

The free v1 has no checkout or paid entitlement API. A free extension may connect to the publisher's independently billed SaaS; clearly disclose external service costs and required accounts in its description and instructions before users run it. A future paid platform will use Better Auth for Devlyn-native publisher/buyer identity and device authorization, with server-owned entitlements, payment events and a provider selected for seller payouts. Do not invent local paid-access checks or request users' engine OAuth tokens.
