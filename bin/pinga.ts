#!/usr/bin/env bun
import { runCli } from "../src/cli";

process.exitCode = runCli(process.argv.slice(2));
