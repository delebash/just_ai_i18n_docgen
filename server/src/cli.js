// SPDX-License-Identifier: MIT
// just-ai-i18n-docgen — the CLI door. The port of cli.py. Thin by design: every decision
// lives in service.js, shared verbatim with the workspace API, so a report and an escalation
// can never drift between doors.
//
//   node server/src/cli.js [--data-dir D] translate config.json            translate what changed, then check
//   node server/src/cli.js translate config.json --force    re-translate everything
//   node server/src/cli.js translate config.json --probe    second pass, flag disagreements
//   node server/src/cli.js translate config.json --no-confirm
//   node server/src/cli.js check config.json                check files on disk, NO engine.
//                                                           Run this before you ship.
//   node server/src/cli.js escalate config.json <preset-id> re-do ONLY flagged keys
//   node server/src/cli.js accept config.json k1,k2 --by me record findings as reviewed-correct
//   node server/src/cli.js extract config.json              docs front-matter -> locale keys
//   node server/src/cli.js extract config.json --check      fail if stale, write nothing
//
// `--data-dir` is the main parser's option, so it comes before the command (as argparse).

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { bootLlmStack, seedLlmStack } from "./app.js";
import { runExtract } from "./extract.js";
import { fmtFixed, pyStrip } from "./jsonio.js";
import { acceptKeys, Project, runCheck, runEscalate, runTranslate } from "./service.js";

const PROG = "just-ai-i18n-docgen";
const USAGE = `usage: ${PROG} [-h] [--data-dir DATA_DIR] {translate,check,escalate,accept,extract} ...`;

const COMMANDS = {
  translate: { positionals: ["config"], options: { force: { type: "boolean" }, probe: { type: "boolean" }, "no-confirm": { type: "boolean" } } },
  check: { positionals: ["config"], options: {} },
  escalate: { positionals: ["config", "preset_id"], options: {} },
  accept: { positionals: ["config", "keys"], options: { by: { type: "string" } } },
  extract: { positionals: ["config"], options: { check: { type: "boolean" } } },
};

class UsageError extends Error {}

/** argparse's shape: [--data-dir D] <command> <positionals…> [options]. */
export function parseCli(argv) {
  const args = [...argv];
  let dataDir = null;
  while (args.length && args[0].startsWith("--")) {
    const a = args.shift();
    if (a === "--data-dir") {
      if (!args.length) throw new UsageError("argument --data-dir: expected one argument");
      dataDir = args.shift();
    } else if (a.startsWith("--data-dir=")) dataDir = a.slice("--data-dir=".length);
    else if (a === "-h" || a === "--help") throw new UsageError(null);
    else throw new UsageError(`unrecognized arguments: ${a}`);
  }
  const command = args.shift();
  if (!command) throw new UsageError("the following arguments are required: command");
  const spec = COMMANDS[command];
  if (!spec) {
    throw new UsageError(`argument command: invalid choice: '${command}' (choose from ${Object.keys(COMMANDS).map((c) => `'${c}'`).join(", ")})`);
  }
  let parsed;
  try {
    parsed = parseArgs({ args, options: spec.options, allowPositionals: true, strict: true });
  } catch (e) {
    throw new UsageError(e.message);
  }
  if (parsed.positionals.length < spec.positionals.length) {
    throw new UsageError(`the following arguments are required: ${spec.positionals.slice(parsed.positionals.length).join(", ")}`);
  }
  if (parsed.positionals.length > spec.positionals.length) {
    throw new UsageError(`unrecognized arguments: ${parsed.positionals.slice(spec.positionals.length).join(" ")}`);
  }
  const out = { command, dataDir, ...Object.fromEntries(spec.positionals.map((n, i) => [n, parsed.positionals[i]])) };
  for (const [k, v] of Object.entries(parsed.values)) out[k] = v;
  if (command === "accept" && out.by === undefined) out.by = process.env.JUST_AI_I18N_DOCGEN_REVIEWER ?? "";
  return out;
}

const monotonic = () => performance.now() / 1000;

/** Returns the exit code. */
export async function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseCli(argv);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    if (e.message) {
      process.stderr.write(`${USAGE}\n${PROG}: error: ${e.message}\n`);
      return 2;
    }
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  // The CLI door boots the SAME stack the server does — makeSend resolves presets through
  // the shared stores, which do not exist until storage is configured.
  await bootLlmStack(args.dataDir);
  seedLlmStack();

  const project = new Project(args.config);
  if (project.inferred.length) console.log(`Read from ${project.paths.sourceLanguage}.json: ${project.inferred.join(", ")}`);

  if (args.command === "translate") {
    const started = monotonic();
    const result = await runTranslate(project, { force: !!args.force, probe: !!args.probe, noConfirm: !!args["no-confirm"] });
    console.log(`Elapsed ${fmtFixed(monotonic() - started, 1)}s`);
    const check = runCheck(project);
    return result.hardFailures || check.failed ? 1 : 0;
  }
  if (args.command === "check") return runCheck(project).failed ? 1 : 0;
  if (args.command === "escalate") {
    const started = monotonic();
    await runEscalate(project, args.preset_id);
    console.log(`Elapsed ${fmtFixed(monotonic() - started, 1)}s`);
    return runCheck(project).failed ? 1 : 0;
  }
  if (args.command === "accept") {
    const keys = args.keys
      .split(",")
      .map((k) => pyStrip(k))
      .filter((k) => k);
    acceptKeys(project, keys, { by: args.by });
    return 0;
  }
  if (args.command === "extract") {
    const result = runExtract(project, { check: !!args.check });
    return result.stale ? 1 : 0;
  }
  return 2; // unreachable: the command is required
}

const isEntry = (() => {
  try {
    return realpathSync(process.argv[1] ?? "") === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (isEntry) process.exit(await main());
