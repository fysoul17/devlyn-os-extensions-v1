# Devlyn extensions

This public registry distributes free extensions for the proprietary Devlyn OS desktop app. It contains the public SDK source, contracts, release metadata and a small example; it does not contain Devlyn OS source. The SDK is MIT licensed and individual extensions declare their own license.

## Build a plugin

Install the public SDK with Node.js 20+; Devlyn's private source and an npm publishing account are unnecessary:

```sh
npm install -g https://github.com/fysoul17/devlyn-os-extensions-v1/releases/download/sdk-v0.1.0/devlyn-plugin-0.1.0.tgz
devlyn-plugin init my-extension
cd my-extension
```

Set your stable publisher.product ID in `plugin.json`, edit its command skill and explicit `plugin.files.json` asset list, then run `devlyn-plugin validate .` and `devlyn-plugin pack .`. Install the bundle in Devlyn and run it in an unrelated workspace. Upload the exact tested bundle to your public GitHub release and run `devlyn-plugin submit <bundle> --url <release-asset-url>`. The CLI verifies anonymous access and matching bytes before preparing a draft. Review and submit the generated issue from the GitHub account that will own your publisher namespace; include the real Devlyn run result.

Your product source can stay in a private repository. Distribute only its public extension bundle through a separate public release-only repository. Private releases and temporary signed links are rejected: use a stable GitHub release asset or raw-content URL without query parameters. Bundled code and instructions become publicly readable; a proprietary license does not make them confidential. Keep private implementation and secrets in your own service or outside the package. No GitHub token is requested to access private repositories.

The canonical developer kit lives in [sdk/](sdk/), with its own tests, types, schemas and agent instructions. A coding agent can use the CLI directly without MCP setup. The SDK handles packaging and registration; it does not automatically configure product MCP servers in users' agents. From `sdk/`, run `npm test` and `npm pack` to build the independently installable CLI.

Every edit to an installed package requires a new SemVer, even during local development. Reimporting the same version restores only its exact previous bytes.

Operator approval is required before catalog visibility. The issue is your review-status and update channel. Installation and use are anonymous; no Devlyn signup is required. Publisher identity comes from GitHub's numeric account ID, never a badge or identity claim inside a bundle.

The generic Welcome Writer example creates `devlyn-welcome.md` in the selected workspace. It exercises command inputs and local agent execution without external services. Packages are trusted local agent instructions, not sandboxed code.

## Operator release process

The [SDK 0.1.0 release](https://github.com/fysoul17/devlyn-os-extensions-v1/releases/tag/sdk-v0.1.0) and [catalog](https://raw.githubusercontent.com/fysoul17/devlyn-os-extensions-v1/main/catalog.json) are publicly available. SDK releases use GitHub release immutability: stage and verify every asset in a draft before publishing, then use a new version for changes. The protected `main` branch requires the registry CI check and a pull request, including for administrators. npm registry publication is optional later.

```sh
npm ci --ignore-scripts
npm test
node scripts/registry.mjs validate
node scripts/registry.mjs validate --base ../trusted-main-checkout
node scripts/registry.mjs validate --remote
```

For a submitted release:

1. Review the issue author's right to the namespace, product description/license, all bundled instructions and assets, declared prerequisites and actual behavior in a clean disposable workspace. Do not run unknown extension code on a machine with credentials. Do not claim malware scanning or verified-company identity that was not performed.
2. Run `node scripts/registry.mjs publish ISSUE_NUMBER`. The tool reads the issue from this registry, uses GitHub's numeric author ID, verifies the source download and hash, validates its contract and rejects namespace takeover or changed bytes for an old version. It creates an immutable exact-byte mirror in `bundles/` and points the catalog at the registry-controlled mirror. New namespace approval is your explicit operator decision when invoking this command.
3. Review the new mirror, `catalog.json` and `registry-state.json`; run tests and local validation, then land them together through a protected review. Run `validate --remote` after publication to check live delivery. The command prepares local files only; it never commits, pushes, uploads, comments or closes an issue.

Never delete historical identities or release digests from `registry-state.json`, including after revocation. Version identity remains reserved. Numeric account IDs survive GitHub renames. Organization/team ownership and identity transfers require a separately documented operator review; the v1 tool never automatically transfers them.

Before merging, compare against a trusted checkout of the existing `main` with `validate --base <directory>`. This preserves prior publisher numeric IDs, exact release records, revocations and mirror bytes, including inactive releases. Normal `validate` checks only the candidate's consistency. PR CI checks the immutable base commit separately; changes to the validator or workflow still require owner review.

Before approving an update, compare its SemVer with the current catalog release and publish only a newer version. The operator tool checks immutability but does not enforce version ordering; Devlyn clients reject downgrades. To roll back behavior, publish the restored implementation as a new higher version.

Only exact compact SDK `pack` output is accepted for publication. Formatting changes require repacking before submission; a published version's bytes never change. Mutation commands serialize using `.registry.lock`. After a crash, inspect its PID and confirm the process has stopped before manually removing a stale lock; the tool does not guess that a lock is stale.

To revoke a known unsafe version, run `node scripts/registry.mjs revoke publisher.product 1.2.3 'Reason and user action'`, review and publish the catalog. Revocation removes that active release and tells refreshed clients to block it. Offline clients cannot learn a new revocation until they reconnect. Distribute a new version for a fix; never replace the old bytes.

CI tests the public SDK workspace and registry together, validates the catalog and inspects SDK packaging. It uses read-only GitHub permissions, no secrets and no installation scripts; submitted plugin content is parsed and hashed without execution. Do not expose a write-capable `pull_request_target` workflow to submitters.

Only the operator has write access. Protect `main` with required pull requests, the successful `validate` check, resolved conversations, no force pushes or deletions, and enforcement for administrators. While there is one operator, require zero additional approving reviews: GitHub prevents authors from approving their own pull requests. For each catalog change, the operator records the submission issue, exact version and digest, validation and runtime evidence, and the approval decision in the pull request before merging. This is operator curation, not an independent second human approval. When a second maintainer joins, require one approving review; never use routine administrator bypass to satisfy an impossible review requirement.

Paid distribution is a later service: Better Auth for Devlyn-native identity/device authorization, publisher ownership migration, server-owned entitlements, payment webhooks, refunds/revocation and payout onboarding. Select a seller-payout-capable payment provider when implementing that service. Free registry IDs remain stable through that migration; engine OAuth credentials never become marketplace credentials. The current registry provides no checkout or payment enforcement. Extensions using independently billed SaaS must disclose external service costs and required accounts in their listing and instructions. The included Welcome Writer requires no paid external service.
