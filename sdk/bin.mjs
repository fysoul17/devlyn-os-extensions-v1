#!/usr/bin/env node
import { main } from "./cli.mjs";

main(process.argv.slice(2))
  .then((output) => process.stdout.write(`${output}\n`))
  .catch((error) => {
    process.stderr.write(`devlyn-plugin: ${error.message}\n`);
    process.exitCode = 1;
  });
