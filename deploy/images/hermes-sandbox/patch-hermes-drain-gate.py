#!/usr/bin/env python3
"""Build step of the Hermes sandbox image (NH-22): NemoClaw's cron-restore drain
gate is switched off.

Why: the Hermes in NemoClaw's image refuses new turns ("Gateway is draining
existing work", HTTP 503) while `nemoclaw_cron_restore_drain_requested()` says
so, and that function says so unless /sandbox/.nemoclaw is a directory owned by
root:root that nobody else can write. NemoClaw's own installer arranges that.
On a Kubernetes workspace volume everything under /sandbox belongs to the
sandbox's user — the volume is seeded by an init container running as that
user, and nothing in the pod runs as root — so the gate read "drain" from the
first second to the last and every turn was a 503 (seen in the spike).

The marker it guards belongs to NemoClaw's sandbox rebuild, which restores cron
jobs and holds dispatch until they are checked. Notch doesn't run that rebuild,
and the cron toolset is off (D-29). Hermes' own drain marker,
$HERMES_HOME/.drain_request.json, is untouched and keeps working.

What: in gateway/drain_control.py the function returns False before it looks
at the filesystem.

    patch-hermes-drain-gate.py /opt/hermes/gateway/drain_control.py

The build fails (exit 1) unless the function is found exactly once and still
is the ownership check this patch was written against, `drain_requested()`
still asks it, and the patched pair then behaves: both are run here. Running
it on a patched file changes nothing.
"""
import ast
import sys
import textwrap
from typing import Any, Optional

GATE = "nemoclaw_cron_restore_drain_requested"
CALLER = "drain_requested"
MARKER = "# Notch patch (deploy/images/hermes-sandbox/patch-hermes-drain-gate.py)"
# What makes the gate the one described above; without these it's a different function.
EXPECTED_IN_GATE = ("_NEMOCLAW_CRON_RESTORE_DRAIN_PATH", "metadata.st_uid != 0")
PATCH = f'''{MARKER}: on a Kubernetes
# volume /sandbox/.nemoclaw can never be root's, so this gate read "drain" for ever and every turn
# was a 503. Notch has no NemoClaw rebuild that would set the marker.
return False
'''


class PatchError(Exception):
    pass


def function(source: str, name: str) -> ast.FunctionDef:
    """The module-level function `name`, which must exist exactly once."""
    found = [node for node in ast.parse(source).body if isinstance(node, ast.FunctionDef) and node.name == name]
    if len(found) != 1:
        raise PatchError(f"expected one {name}(), found {len(found)}")
    return found[0]


def text_of(source: str, node: ast.FunctionDef) -> str:
    return "".join(source.splitlines(keepends=True)[node.lineno - 1 : node.end_lineno])


def patch(source: str) -> str:
    """The source with the patch in place; unchanged if it already is."""
    gate = function(source, GATE)
    body = text_of(source, gate)
    caller = text_of(source, function(source, CALLER))
    if f"{GATE}()" not in caller:
        raise PatchError(f"{CALLER}() no longer asks {GATE}(): Hermes changed, re-read gateway/drain_control.py")
    if MARKER in body:
        return source
    if MARKER in source:
        raise PatchError(f"the patch marker is outside {GATE}(): read the file before patching it")
    missing = [s for s in EXPECTED_IN_GATE if s not in body]
    if missing:
        raise PatchError(f"{GATE}() no longer has {' and '.join(missing)}: NemoClaw changed the gate, re-read it")
    has_docstring = isinstance(gate.body[0], ast.Expr) and isinstance(getattr(gate.body[0], "value", None), ast.Constant)
    if not has_docstring or len(gate.body) < 2:
        raise PatchError(f"{GATE}() no longer starts with a docstring followed by code")
    first = gate.body[1]
    lines = source.splitlines(keepends=True)
    return "".join(lines[: first.lineno - 1]) + textwrap.indent(PATCH, " " * first.col_offset) + "".join(lines[first.lineno - 1 :])


def verify(source: str) -> None:
    """Runs the patched gate and `drain_requested()`, cut out of the file, with Hermes' own marker stubbed."""
    operator = {"active": False}

    def operator_drain_requested(*, home: Any = None) -> bool:
        return operator["active"]

    class _NoFilesystem:
        def __getattr__(self, name: str) -> Any:
            raise PatchError(f"the patched gate still reaches for the filesystem ({name})")

    scope: dict[str, Any] = {
        "Optional": Optional,
        "Path": _NoFilesystem,
        "_NEMOCLAW_CRON_RESTORE_DRAIN_PATH": _NoFilesystem(),
        "operator_drain_requested": operator_drain_requested,
    }
    for name in (GATE, CALLER):
        exec(compile(text_of(source, function(source, name)), name, "exec"), scope)  # noqa: S102 - the image's own source, at build time
    if scope[GATE]() is not False:
        raise PatchError(f"patched {GATE}() doesn't return False")
    if scope[CALLER](home=None) is not False:
        raise PatchError(f"{CALLER}() still reports a drain with no marker of Hermes' own")
    operator["active"] = True
    if scope[CALLER](home=None) is not True:
        raise PatchError(f"{CALLER}() no longer honours Hermes' own drain marker")


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        print(f"usage: {sys.argv[0]} <path to gateway/drain_control.py>", file=sys.stderr)
        return 2
    path = argv[0]
    try:
        with open(path, encoding="utf-8") as f:
            original = f.read()
        patched = patch(original)
        compile(patched, path, "exec")
        verify(patched)
        if patched != original:
            with open(path, "w", encoding="utf-8", newline="") as f:
                f.write(patched)
    except (OSError, SyntaxError, PatchError) as exc:
        print(f"patch-hermes-drain-gate: {exc}", file=sys.stderr)
        return 1
    print(f"patch-hermes-drain-gate: {path} {'patched' if patched != original else 'already patched'}; {GATE}() is off, checked")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
