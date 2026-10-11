#!/usr/bin/env python3
"""Build step of the Hermes sandbox image (NH-21): Hermes' API server also takes
its key from the X-Hermes-Api-Key header.

Why: OpenShell 0.1.2's gateway removes `Authorization` from every request it
routes to a sandbox service (crates/openshell-server/src/service_routing.rs,
is_gateway_auth_header), and Hermes reads API_SERVER_KEY only from
`Authorization: Bearer`. Through the gateway every /v1 call was a 401.
OpenShell 0.1.3 has a per-service bearer passthrough; drop this patch when the
chart moves there.

What: in gateway/platforms/api_server.py, `_check_auth` gets one more accepted
credential, compared in constant time like the original. `Authorization:
Bearer` keeps working, and a request with neither is still a 401.

    patch-hermes-api-key.py /opt/hermes/gateway/platforms/api_server.py

The build fails (exit 1) unless the anchor line is found exactly once inside
`_check_auth`, and unless the patched method then behaves: it is run here
against the cases at the bottom. Running it on a patched file changes nothing.
"""
import ast
import hmac
import logging
import sys
import textwrap
from typing import Any, Optional

HEADER = "X-Hermes-Api-Key"
MARKER = "# Notch patch (deploy/images/hermes-sandbox/patch-hermes-api-key.py)"
# The last statement before _check_auth gives up: the patch goes right above it.
ANCHOR = '        logger.warning("API server rejected invalid API key: %s", self._request_audit_log_suffix(request))\n'
PATCH = f'''        {MARKER}: OpenShell's gateway
        # strips Authorization on the way to a sandbox service, so the relay sends the key here.
        notch_key = request.headers.get("{HEADER}", "").strip()
        if notch_key and hmac.compare_digest(notch_key.encode(), expected_key.encode()):
            return None
'''


class PatchError(Exception):
    pass


def check_auth_span(source: str) -> tuple[int, int]:
    """First and one-past-last line index of `_check_auth`, which must exist exactly once."""
    found = [
        node
        for node in ast.walk(ast.parse(source))
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == "_check_auth"
    ]
    if len(found) != 1:
        raise PatchError(f"expected one _check_auth, found {len(found)}")
    return found[0].lineno - 1, found[0].end_lineno


def patch(source: str) -> str:
    """The source with the patch in place; unchanged if it already is."""
    lines = source.splitlines(keepends=True)
    start, end = check_auth_span(source)
    body = lines[start:end]
    if any(MARKER in line for line in body):
        return source
    if MARKER in source or HEADER in source:
        raise PatchError(f"{HEADER} is already mentioned outside _check_auth: read the file before patching it")
    at = [i for i, line in enumerate(body) if line == ANCHOR]
    if len(at) != 1:
        raise PatchError(f"expected the anchor line once in _check_auth, found it {len(at)} times: Hermes changed, re-read _check_auth")
    if "hmac.compare_digest(token.encode(), expected_key.encode())" not in "".join(body[: at[0]]):
        raise PatchError("_check_auth no longer compares the bearer token the way this patch assumes")
    return "".join(lines[: start + at[0]]) + PATCH + "".join(lines[start + at[0] :])


class _Headers(dict):
    def get(self, key: str, default: Any = None) -> Any:  # header names are case-insensitive
        return next((v for k, v in self.items() if k.lower() == key.lower()), default)


def verify(source: str) -> None:
    """Runs the patched `_check_auth` itself, cut out of the file, against the cases that matter."""
    start, end = check_auth_span(source)
    method = textwrap.dedent("".join(source.splitlines(keepends=True)[start:end]))
    denied = object()

    class _Profile:
        @staticmethod
        def get() -> None:
            return None

    scope: dict[str, Any] = {"hmac": hmac, "logger": logging.getLogger("patch-check"), "Optional": Optional, "_api_request_profile": _Profile}
    exec(compile(method, "_check_auth", "exec"), scope)  # noqa: S102 - the image's own source, at build time

    class _Server:
        _check_auth = scope["_check_auth"]

        def __init__(self, key: str) -> None:
            self._key = key

        def _expected_api_key(self) -> str:
            return self._key

        @staticmethod
        def _auth_failed_response() -> object:
            return denied

        @staticmethod
        def _request_audit_log_suffix(_request: object) -> str:
            return ""

    key = "ab" * 32
    logging.getLogger("patch-check").disabled = True
    cases: list[tuple[str, dict[str, str], bool]] = [
        ("the key in Authorization", {"Authorization": f"Bearer {key}"}, True),
        (f"the key in {HEADER}", {HEADER: key}, True),
        ("the header in lower case, padded", {HEADER.lower(): f" {key} "}, True),
        ("a wrong Authorization next to the right header", {"Authorization": "Bearer nope", HEADER: key}, True),
        ("no credential", {}, False),
        ("a wrong key in the header", {HEADER: "cd" * 32}, False),
        ("a prefix of the key", {HEADER: key[:-1]}, False),
        ("an empty header", {HEADER: ""}, False),
        ("a non-ASCII header", {HEADER: "ключ"}, False),
        ("the key with a Bearer prefix in the header", {HEADER: f"Bearer {key}"}, False),
    ]
    for name, headers, allowed in cases:
        request = type("Request", (), {"headers": _Headers(headers)})()
        result = _Server(key)._check_auth(request)
        if (result is None) != allowed:
            raise PatchError(f"patched _check_auth is wrong for {name}: {'allowed' if result is None else 'refused'}")
    if "hmac.compare_digest(notch_key.encode(), expected_key.encode())" not in method:
        raise PatchError("the header is not compared in constant time")


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        print(f"usage: {sys.argv[0]} <path to gateway/platforms/api_server.py>", file=sys.stderr)
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
        print(f"patch-hermes-api-key: {exc}", file=sys.stderr)
        return 1
    print(f"patch-hermes-api-key: {path} {'patched' if patched != original else 'already patched'}; {HEADER} accepted, checked")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
