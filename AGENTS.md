# Public registry operations

This repository contains the public extension SDK and distribution data. Never copy proprietary Devlyn OS code, credentials or customer files into it. SDK source and tests belong in `sdk/` and must work without a private checkout.

Use the published `devlyn-plugin` schema and validators. Do not execute submitted plugin content during validation. Review code manually and use a disposable environment without credentials for runtime checks.

`registry.mjs publish` prepares local catalog/history files after checking a real submission issue, publisher identity and artifact hash. Only invoke it after the operator authorizes that exact release. Do not commit, push, publish SDKs/assets, submit issues or send comments merely because a tool produced a draft.

Preserve immutable release history and publisher numeric GitHub IDs. Never transfer identity, change bytes for a published id/version, remove a revocation or silently reset corrupt registry data. Explain errors and stop. Publish the reviewed local bundle mirror, catalog and history together after tests, local validation and protected review. Check remote digests after publication; a new mirror is not publicly downloadable before its commit lands.
