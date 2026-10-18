#!/usr/bin/env python3
"""YAML comparisons for setup-gateway.sh (NH-33): is what an OpenShell gateway
holds the same as the file in Git?

  gateway-yaml.py policy <file>    stdin: `openshell policy get --global --full`
  gateway-yaml.py profile <file>   stdin: `openshell profile export <id>`
  gateway-yaml.py id <file>        the profile's id
  gateway-yaml.py version          stdin: an export; its resource_version

policy and profile exit 0 when the gateway has everything the file says, 1
otherwise. The gateway's copy may carry more — fields it fills with their
defaults — so it's compared as a superset; the policy's network rules must be
the same set.
"""
import sys

import yaml


def covers(want, have):
    """Whether `have` holds everything `want` does."""
    if isinstance(want, dict):
        return isinstance(have, dict) and all(k in have and covers(v, have[k]) for k, v in want.items())
    if isinstance(want, list):
        return isinstance(have, list) and len(want) == len(have) and all(covers(w, h) for w, h in zip(want, have))
    return want == have


def loaded_policy(text):
    """The policy after the CLI's header (Scope, Version, Hash…) and its `---` line; None when there's none."""
    lines = text.splitlines()
    if "---" not in lines:
        return None
    return yaml.safe_load("\n".join(lines[lines.index("---") + 1:]))


def main(argv):
    if len(argv) == 3 and argv[1] == "policy":
        want = yaml.safe_load(open(argv[2], encoding="utf-8"))
        have = loaded_policy(sys.stdin.read())
        same = have is not None and covers(want, have) and set(want.get("network_policies", {})) == set(have.get("network_policies", {}))
        return 0 if same else 1
    if len(argv) == 3 and argv[1] == "profile":
        want = yaml.safe_load(open(argv[2], encoding="utf-8"))
        want.pop("resource_version", None)
        have = yaml.safe_load(sys.stdin.read()) or {}
        return 0 if covers(want, have) else 1
    if len(argv) == 3 and argv[1] == "id":
        print(yaml.safe_load(open(argv[2], encoding="utf-8"))["id"])
        return 0
    if len(argv) == 2 and argv[1] == "version":
        print(int((yaml.safe_load(sys.stdin.read()) or {})["resource_version"]))
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
