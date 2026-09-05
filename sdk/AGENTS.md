# Build a Devlyn extension

Use only this public kit and the product's own source. Devlyn core source is unnecessary.

1. Run `devlyn-plugin init <new-directory>` and edit its generated manifest and skill. Use a stable `publisher.product` ID and SemVer. All declared fields are required; unknown fields fail validation.
2. Implement a concrete command that performs the product task through the user's local agent. Read package assets from the supplied package root, write output to the supplied workspace root, and treat structured input values as data. Never request API keys, passwords or tokens in command inputs: inputs reach the agent and its transcript. Use the provider's own sign-in flow or an authenticated local CLI. Keep confidential implementation on your server. Preserve approval gates and existing user files.
3. List each runtime text asset in `plugin.files.json`. Never include secrets, private source unrelated to runtime, symlinks, binaries or install hooks. Declare required external executables in prerequisites.
4. Run `devlyn-plugin validate .` and `devlyn-plugin pack .`. Install the generated bundle in Devlyn, run the command in an unrelated workspace, inspect the actual output and verify Stop/error handling. Installation is not execution evidence.
5. Upload only the reviewed bundle bytes to a public GitHub release when authorized. Product source can stay private; bundled assets become public. Use `devlyn-plugin submit <bundle> --url <release-url>` with a stable URL without query parameters. It verifies anonymous access and exact bytes before preparing a review issue. Never supply a private GitHub token or temporary signed URL. Opening a draft is not submitting it. Never send the issue, publish a package, change registry ownership or charge users without the owner's instruction.

There is no plugin sandbox, hosted model runner, direct Tauri API, paid entitlement API or arbitrary custom webview API in v1. Do not emulate unavailable capabilities or modify Devlyn itself to make your extension work.
