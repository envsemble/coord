#!/usr/bin/env node
// The atlas command. Node 24 runs the TypeScript sources directly (type stripping).
import { main } from "../src/main.ts";

process.exitCode = await main(process.argv.slice(2));
