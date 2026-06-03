#!/usr/bin/env bash
set -uo pipefail

GATE="${1:-}"
shift || true

if [[ -z "$GATE" ]]; then
  echo '{"gate":"","status":"ERROR","checks":[],"instructions_for_agent":"Missing gate name argument."}'
  exit 5
fi

JSON=false
FEATURE=""
TASK=""
FORCE=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --json)        JSON=true; shift ;;
    --feature=*)   FEATURE="${1#*=}"; shift ;;
    --task=*)      TASK="${1#*=}"; shift ;;
    --force)       FORCE=true; shift ;;
    *)             shift ;;
  esac
done

emit() {
  local status="$1"
  local next_gate="$2"
  local instructions="$3"
  local checks="$4"
  local rules="$5"
  printf '{"gate":"%s","status":"%s","checks":%s,"rule_ids_violated":%s,"instructions_for_agent":"%s","next_gate":%s}\n' \
    "$GATE" "$status" "$checks" "$rules" "$instructions" "$next_gate"
  case "$status" in
    PASS)    exit 0 ;;
    FAIL)    exit 1 ;;
    SKIP)    exit 2 ;;
    WAITING) exit 3 ;;
    BLOCKED) exit 4 ;;
    *)       exit 5 ;;
  esac
}

gate_pre_work() {
  emit PASS '"in-progress"' "" "[]" "[]"
}

gate_in_progress() {
  emit PASS '"pre-merge"' "" "[]" "[]"
}

gate_pre_merge() {
  emit PASS '"post-merge"' "" "[]" "[]"
}

gate_post_merge() {
  emit PASS '"next-ready"' "" "[]" "[]"
}

gate_next_ready() {
  emit PASS "null" "" "[]" "[]"
}

case "$GATE" in
  pre-work)    gate_pre_work    ;;
  in-progress) gate_in_progress ;;
  pre-merge)   gate_pre_merge   ;;
  post-merge)  gate_post_merge  ;;
  next-ready)  gate_next_ready  ;;
  *)
    emit ERROR "null" "Unknown gate: $GATE. Expected one of: pre-work, in-progress, pre-merge, post-merge, next-ready." "[]" "[]"
    ;;
esac
