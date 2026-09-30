// Points the cluster manifests at a newly built image (NH-37, D-32). Only CI
// runs this, after green tests: it is the one thing that changes an image tag.
//
//   node scripts/bump-image-tag.mjs <image> <tag> [--commit <sha>] [--root deploy]
//
// Every YAML line under --root (default deploy/) that ends with the marker
// `# image-tag: <image>` gets <tag> as its value, e.g. in
// deploy/notch/base/kustomization.yaml:
//
//     newTag: sha-0123456789ab # image-tag: notch-relay
//
// With --commit, the tags are `sha-<commit>` and the bump never goes
// backwards: when a slower run for an older commit finishes after a newer one
// has already deployed, the manifests keep the newer tag. Prints what changed.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const TAG = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
const IMAGE = /^[a-z0-9][a-z0-9._-]{0,127}$/;

const markerLine = (image) =>
  new RegExp(`^(\\s*(?:-\\s+)?[A-Za-z0-9_.-]+:\\s*)("?)([^"#\\s]*)\\2(\\s+# image-tag: ${image.replace(/[.]/g, "\\.")})\\s*$`);

/** Rewrites the marked lines in one file's text. */
export function rewrite(text, image, tag) {
  if (!IMAGE.test(image)) throw new Error(`invalid image name: ${image}`);
  if (!TAG.test(tag)) throw new Error(`invalid tag: ${tag}`);
  const re = markerLine(image);
  const previous = [];
  let marked = 0;
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/).map((line) => {
    const m = re.exec(line);
    if (!m) return line;
    marked++;
    previous.push(m[3]);
    return `${m[1]}${m[2]}${tag}${m[2]}${m[4]}`;
  });
  return { text: lines.join(eol), marked, previous };
}

/**
 * Whether to deploy `commit` over the currently deployed `current` tag.
 * `contains(a, b)` answers "is commit a already part of commit b's history?"
 * and returns null when it can't tell (e.g. an unknown commit).
 */
export function shouldBump(current, commit, contains) {
  const m = /^sha-([0-9a-f]{7,40})$/.exec(current ?? "");
  if (!m) return true; // nothing built deployed yet ("unbuilt")
  if (commit.startsWith(m[1]) || m[1].startsWith(commit)) return false; // same commit
  const already = contains(commit, m[1]);
  return already !== true;
}

function gitContains(ancestor, descendant) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], { stdio: "ignore" });
    return true;
  } catch (e) {
    return e.status === 1 ? false : null;
  }
}

function yamlFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = join(dir, d.name);
    if (d.isDirectory()) return yamlFiles(p);
    return /\.ya?ml$/.test(d.name) ? [p] : [];
  });
}

function main(argv) {
  const args = [...argv];
  const opt = (name) => {
    const i = args.indexOf(name);
    if (i === -1) return undefined;
    const [, value] = args.splice(i, 2);
    if (!value) throw new Error(`${name} needs a value`);
    return value;
  };
  const commit = opt("--commit");
  const root = opt("--root") ?? "deploy";
  const [image, tag] = args;
  if (!image || !tag || args.length !== 2) throw new Error("usage: bump-image-tag.mjs <image> <tag> [--commit <sha>] [--root deploy]");
  if (commit && !/^[0-9a-f]{7,40}$/.test(commit)) throw new Error(`invalid commit: ${commit}`);

  const files = yamlFiles(root).map((path) => ({ path, text: readFileSync(path, "utf8") }));
  const current = files.flatMap((f) => rewrite(f.text, image, tag).previous);
  if (current.length === 0) throw new Error(`no line marked "# image-tag: ${image}" under ${root}/`);

  let changed = false;
  if (commit && !current.every((c) => shouldBump(c, commit, gitContains))) {
    console.log(`${image}: ${current.join(", ")} already includes ${commit}; left as is`);
  } else {
    for (const f of files) {
      const r = rewrite(f.text, image, tag);
      if (r.marked === 0 || r.text === f.text) continue;
      writeFileSync(f.path, r.text);
      changed = true;
      console.log(`${f.path}: ${image} ${r.previous.join(", ")} → ${tag}`);
    }
    if (!changed) console.log(`${image}: already ${tag}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(`error: ${e.message}`);
    process.exit(1);
  }
}
