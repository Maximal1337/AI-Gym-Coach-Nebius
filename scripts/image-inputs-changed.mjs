// Whether an image has to be built for a commit (NH-37, D-32): only when one
// of its own inputs changed since the commit the cluster runs it from. A push
// of docs alone then builds nothing, moves no tag and restarts nothing —
// during judging a README fix would otherwise restart prod's relay and both
// gateways (a new sandbox image tag changes each gateway's config).
//
//   node scripts/image-inputs-changed.mjs <image> <commit> [--root deploy]
//
// The deployed commit is the one in the image's `sha-<commit>` tag under
// --root, on the lines bump-image-tag.mjs writes. Prints `changed=true` or
// `changed=false` for $GITHUB_OUTPUT, and why on stderr. Builds whenever it
// can't tell: no `sha-` tag deployed, a commit that isn't in the history, or
// one that isn't an ancestor of <commit>. A change to the workflow alone
// builds nothing.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { rewrite } from "./bump-image-tag.mjs";

/**
 * What each image is built from: its Dockerfile's context and the files it
 * copies. The relay's tests ship in its image but never run there, so a change
 * to them alone doesn't rebuild it — and doesn't restart prod's relay.
 */
export const IMAGE_INPUTS = {
  "notch-relay": ["services/relay", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", ".npmrc", ":(exclude,glob)services/relay/**/*.test.ts"],
  "notch-hermes-sandbox": ["deploy/images/hermes-sandbox"],
};

/**
 * `current` are the image's deployed tags; `git.contains(a, b)` answers "is a
 * an ancestor of b?" (null when it can't tell), `git.changedFiles(from, to,
 * paths)` lists the changed files (null on an error).
 */
export function decide(current, commit, paths, git) {
  if (current.length === 0) return { changed: true, reason: "no deployed tag found" };
  const deployed = new Set();
  for (const tag of current) {
    const m = /^sha-([0-9a-f]{7,40})$/.exec(tag);
    if (!m) return { changed: true, reason: `deployed tag ${tag} names no commit` };
    deployed.add(m[1]);
  }
  for (const from of deployed) {
    if (git.contains(from, commit) !== true) return { changed: true, reason: `${from} isn't in ${commit}'s history` };
    const files = git.changedFiles(from, commit, paths);
    if (files === null) return { changed: true, reason: `couldn't diff ${from}..${commit}` };
    if (files.length) return { changed: true, reason: `${files.length} input(s) changed since ${from}: ${files.slice(0, 5).join(", ")}` };
  }
  return { changed: false, reason: `no input changed since ${[...deployed].join(", ")}` };
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

const realGit = {
  contains(ancestor, descendant) {
    try {
      execFileSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], { stdio: "ignore" });
      return true;
    } catch (e) {
      return e.status === 1 ? false : null;
    }
  },
  changedFiles(from, to, paths) {
    try {
      return git(["diff", "--name-only", from, to, "--", ...paths]).split("\n").filter(Boolean);
    } catch {
      return null;
    }
  },
};

function yamlFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = join(dir, d.name);
    if (d.isDirectory()) return yamlFiles(p);
    return /\.ya?ml$/.test(d.name) ? [p] : [];
  });
}

function main(argv) {
  const args = [...argv];
  const i = args.indexOf("--root");
  const root = i === -1 ? "deploy" : args.splice(i, 2)[1];
  const [image, commit] = args;
  if (!image || !commit || args.length !== 2 || !root) throw new Error("usage: image-inputs-changed.mjs <image> <commit> [--root deploy]");
  const paths = IMAGE_INPUTS[image];
  if (!paths) throw new Error(`unknown image: ${image}`);
  if (!/^[0-9a-f]{7,40}$/.test(commit)) throw new Error(`invalid commit: ${commit}`);
  const current = yamlFiles(root).flatMap((path) => rewrite(readFileSync(path, "utf8"), image, "x").previous);
  const { changed, reason } = decide(current, commit, paths, realGit);
  console.error(`${image}: ${changed ? "build" : "skip"} — ${reason}`);
  console.log(`changed=${changed}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(`error: ${e.message}`);
    process.exit(1);
  }
}
