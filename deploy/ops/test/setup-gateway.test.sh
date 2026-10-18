#!/usr/bin/env bash
# Runs setup-gateway.sh (NH-33) against a fake gateway: a fake kubectl that
# plays the relay pod and its openshell CLI, keeping the gateway's policy,
# profiles and providers in a directory and logging every change. Needs
# python3 with PyYAML and GNU tar. CI runs it in .github/workflows/ops.yml.
#
#   bash deploy/ops/test/setup-gateway.test.sh
set -euo pipefail
shopt -s inherit_errexit
OPS="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="$(cd "$OPS/../.." && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

failures=0
check() {
  local name="$1"
  shift
  if "$@"; then printf 'ok   %s\n' "$name"; else printf 'FAIL %s\n' "$name"; failures=$((failures + 1)); fi
}
eq() { [[ $1 == "$2" ]] || { printf '     expected %q\n     got      %q\n' "$2" "$1"; return 1; }; }
has() { grep -qF -- "$2" <<< "$1" || { printf '     missing %q in:\n%s\n' "$2" "$1"; return 1; }; }
lacks() { ! grep -qF -- "$2" <<< "$1" || { printf '     unexpected %q in:\n%s\n' "$2" "$1"; return 1; }; }

# The fake: `kubectl -n <ns> exec -i deploy/notch-relay -c relay -- <command…>`.
mkdir -p "$T/bin"
cat > "$T/bin/kubectl" << 'FAKE'
#!/usr/bin/env bash
set -euo pipefail
G="$FAKE_GATEWAY"
while [[ $1 != -- ]]; do shift; done
shift
pod() { sed "s|^/tmp/openshell-setup|$G/pod|" <<< "$1"; }
if [[ $1 == sh ]]; then
  case "$3" in
    *"tar -C /tmp/openshell-setup -xf -"*) rm -rf "$G/pod" && mkdir -p "$G/pod" && tar -C "$G/pod" -xf - ;;
    "cat > /tmp/openshell-setup/"*) cat > "$(pod "${3#cat > }")" ;;
    *) echo "fake kubectl: unexpected sh -c $3" >&2; exit 64 ;;
  esac
  exit 0
fi
[[ $1 == env ]] && shift 3 # env NO_COLOR=1 OPENSHELL_GATEWAY=notch
[[ $1 == openshell ]] || { echo "fake kubectl: unexpected $*" >&2; exit 64; }
shift
case "$1 $2" in
  "policy get")
    [[ -f $G/policy ]] || { echo "no global policy revision found" >&2; exit 1; }
    printf 'Scope:        global\nVersion:      %s\nHash:         abc\nStatus:       Loaded\n---\n' "$(cat "$G/policy.version")"
    # The gateway prints the defaults it fills in, too.
    { cat "$G/policy"; echo "extra_default: true"; } ;;
  "policy set")
    cp "$(pod "$5")" "$G/policy" # policy set --global --policy <file> --yes
    echo $(($(cat "$G/policy.version" 2> /dev/null || echo 0) + 1)) > "$G/policy.version"
    echo "policy set" >> "$G/changes" ;;
  "profile export")
    [[ -f $G/profiles/$3 ]] || { echo "not found" >&2; exit 1; }
    cat "$G/profiles/$3" ;;
  "profile lint") ;;
  "profile import")
    for f in "$(pod "$4")"/*.yaml; do
      id="$(sed -n 's/^id: //p' "$f")"
      [[ ! -f $G/profiles/$id ]] || { echo "already exists" >&2; exit 1; }
      { sed -n '1p' "$f"; echo "resource_version: 1"; sed '1d' "$f"; } > "$G/profiles/$id"
      echo "profile import $id" >> "$G/changes"
    done ;;
  "profile update")
    f="$(pod "$4")" id="$5"
    have="$(sed -n 's/^resource_version: //p' "$G/profiles/$id")"
    [[ $(sed -n 's/^resource_version: //p' "$f") == "$have" ]] || { echo "stale resource_version" >&2; exit 1; }
    { echo "id: $id"; echo "resource_version: $((have + 1))"; grep -v '^resource_version:\|^id:' "$f"; } > "$G/profiles/$id"
    echo "profile update $id" >> "$G/changes" ;;
  "provider list")
    if [[ -s $G/providers ]]; then echo "NAME  TYPE  CREDENTIAL_KEYS  CONFIG_KEYS"; cat "$G/providers"; else echo "No providers found."; fi ;;
  *) echo "fake kubectl: unexpected openshell $*" >&2; exit 64 ;;
esac
FAKE
chmod +x "$T/bin/kubectl"
export PATH="$T/bin:$PATH" FAKE_GATEWAY="$T/gw"
mkdir -p "$T/gw/profiles"
: > "$T/gw/changes"

HOST=abcdefghij0123456789.supabase.co
run() { "$OPS/setup-gateway.sh" "$@" 2>&1; }
changes() { cat "$T/gw/changes"; }
status=0

# A gateway that starts empty: everything goes in; no providers yet.
out="$(run prod "$HOST")" || status=$?
check "an empty gateway: exit 2, done but the providers" eq "$status" 2
check "the policy is set" has "$out" "prod: policy: set"
check "the three profiles are imported" eq "$(grep -c '^profile import' "$T/gw/changes")" 3
check "the placeholders are filled in" has "$(cat "$T/gw/policy")" "host: \"$HOST\""
check "and none is left" lacks "$(cat "$T/gw/policy" "$T"/gw/profiles/*)" "@"
check "a missing provider is named, with where its key goes" has "$out" "provider token-factory: missing — create it with the runbook's step 3"

# A second run changes nothing.
: > "$T/gw/changes"
status=0
out="$(run prod "$HOST")" || status=$?
check "a second run: no change at all" eq "$(changes)" ""
check "it says so" has "$out" "prod: policy: as in Git"
check "for each profile" eq "$(grep -c 'as in Git' <<< "$out")" 4

# With the providers created by hand, it's all in place.
printf 'token-factory  token-factory  1  0\ntavily  tavily  1  0\n' > "$T/gw/providers"
status=0
out="$(run prod "$HOST")" || status=$?
check "providers present: exit 0" eq "$status" 0
printf 'token-factory  token-factory  0  0\ntavily  tavily  1  0\n' > "$T/gw/providers"
status=0
out="$(run prod "$HOST")" || status=$?
check "a provider without its key is flagged" has "$out" "provider token-factory: no credential"
check "and the run says it isn't complete" eq "$status" 2

# A profile changed in Git is updated against the version the gateway has.
cp -r "$REPO/deploy/platform/openshell" "$T/src"
sed -i 's/^description: .*/description: Changed in Git/' "$T/src/profiles/tavily.yaml"
: > "$T/gw/changes"
out="$(SETUP_GATEWAY_SRC="$T/src" run prod "$HOST")" || true
check "a changed profile is updated" eq "$(changes)" "profile update tavily"
check "from the version it had" has "$out" "profile tavily: updated from version 1"
check "and holds the change" has "$(cat "$T/gw/profiles/tavily")" "description: Changed in Git"

# A changed policy is set again; --check only reports.
sed -i 's|/opt/hermes|/opt/hermes2|' "$T/src/sandbox-policy.yaml"
: > "$T/gw/changes"
out="$(SETUP_GATEWAY_SRC="$T/src" run prod "$HOST" --check)" || true
check "--check: nothing changes" eq "$(changes)" ""
check "--check: says what would" has "$out" "prod: policy: differs from Git — would be set"
out="$(SETUP_GATEWAY_SRC="$T/src" run prod "$HOST")" || true
check "a changed policy is set" eq "$(changes)" "policy set"

# Refusals before anything is touched.
: > "$T/gw/changes"
check "an environment other than dev or prod" bash -c "! '$OPS/setup-gateway.sh' staging '$HOST' 2> /dev/null"
check "a host that isn't a Supabase project's" bash -c "! '$OPS/setup-gateway.sh' prod example.com 2> /dev/null"
sed -i 's/^description: .*/description: @UNKNOWN@/' "$T/src/profiles/tavily.yaml"
check "a placeholder nobody fills" bash -c "! SETUP_GATEWAY_SRC='$T/src' '$OPS/setup-gateway.sh' prod '$HOST' 2> /dev/null"
check "and none of them changed anything" eq "$(changes)" ""

if ((failures > 0)); then
  echo "$failures check(s) failed"
  exit 1
fi
echo "all checks passed"
