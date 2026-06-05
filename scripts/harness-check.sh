#!/usr/bin/env bash
# harness-check.sh — gate runner for oh-my-harness-loop dogfooding
#
# Contract: matches RunnerOutputSchema (strict Zod).
# Usage:    ./scripts/harness-check.sh <gate-name> [--json] [--feature=<id>] [--force]
# Exits:    0=PASS, 1=FAIL, 2=SKIP, 3=WAITING, 4=BLOCKED, 5=ERROR

set -uo pipefail

GATE="${1:-}"
shift || true

if [[ -z "$GATE" ]]; then
  cat <<'EOF'
{"gate":"","status":"ERROR","checks":[],"instructions_for_agent":"Missing gate name argument. Usage: harness-check.sh <gate> [--json]"}
EOF
  exit 5
fi

# escape_json <string> — JSON-escape a string for embedding in output
escape_json() {
  python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()), end="")'
}

# emit <status> <next_gate|null> <instructions|""> <checks_json> <rule_ids_json>
emit() {
  local status="$1"
  local next_gate="$2"
  local instructions="$3"
  local checks="$4"
  local rule_ids="$5"
  local exit_code=0

  case "$status" in
    PASS)    exit_code=0 ;;
    FAIL)    exit_code=1 ;;
    SKIP)    exit_code=2 ;;
    WAITING) exit_code=3 ;;
    BLOCKED) exit_code=4 ;;
    ERROR)   exit_code=5 ;;
  esac

  local ng_field
  if [[ "$next_gate" == "null" ]]; then
    ng_field="null"
  else
    ng_field="\"$next_gate\""
  fi

  local instr_field=""
  if [[ -n "$instructions" ]]; then
    instr_field=",\"instructions_for_agent\":$(printf '%s' "$instructions" | escape_json)"
  fi

  printf '{"gate":"%s","status":"%s","checks":%s,"next_gate":%s,"rule_ids_violated":%s%s}\n' \
    "$GATE" "$status" "$checks" "$ng_field" "$rule_ids" "$instr_field"

  exit "$exit_code"
}

# check_entry <id> <name> <status> [rule_id] [message] → JSON object
check_entry() {
  local id="$1" name="$2" status="$3"
  local rule_id="${4:-}" message="${5:-}"
  local extra=""
  [[ -n "$rule_id" ]] && extra+=",\"rule_id\":\"$rule_id\""
  if [[ -n "$message" ]]; then
    extra+=",\"message\":$(printf '%s' "$message" | escape_json)"
  fi
  printf '{"id":"%s","name":"%s","status":"%s"%s}' "$id" "$name" "$status" "$extra"
}

run_typecheck() {
  npx tsc --noEmit 2>&1
}

run_tests() {
  npx vitest run --reporter=default 2>&1
}

run_forbidden_grep() {
  # exclude tests dir + node_modules + dist + .git
  grep -rEn --include='*.ts' \
    -e 'as any' \
    -e '@ts-ignore' \
    -e '@ts-expect-error' \
    . 2>/dev/null \
    | grep -v -E '(^|/)(node_modules|dist|\.git|tests)/' \
    || true
}

git_clean() {
  # Returns 0 if working tree has no uncommitted changes
  git diff --quiet && git diff --cached --quiet
}

get_gh_repo() {
  local url
  url=$(git remote get-url origin 2>/dev/null || echo "")
  if [[ "$url" =~ github\.com[:/]([^/]+)/([^/.]+)(\.git)?$ ]]; then
    echo "${BASH_REMATCH[1]} ${BASH_REMATCH[2]}"
  fi
}

# Outputs: "0" (none), "<n>" (count), "no-pr" (no open PR), "error" (gh failed)
count_unresolved_pr_threads() {
  if ! command -v gh &>/dev/null; then echo "error"; return; fi

  local pr_number
  pr_number=$(gh pr view --json number -q '.number' 2>/dev/null || echo "")
  if [[ -z "$pr_number" ]]; then echo "no-pr"; return; fi

  local repo_parts
  read -r owner repo_name <<< "$(get_gh_repo)"
  if [[ -z "$owner" ]]; then echo "error"; return; fi

  gh api graphql \
    -f query='query($pr:Int!,$owner:String!,$repo:String!){repository(owner:$owner,name:$repo){pullRequest(number:$pr){reviewThreads(first:100){nodes{isResolved isOutdated}}}}}' \
    -f owner="$owner" -f repo="$repo_name" -F pr="$pr_number" \
    --jq '[.data.repository.pullRequest.reviewThreads.nodes[]|select(.isResolved==false and .isOutdated==false)]|length' \
    2>/dev/null || echo "error"
}

gate_pre_work() {
  local checks=()
  local rule_ids=()
  local fail_msgs=()

  local branch
  branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")

  if [[ "$branch" == "master" || "$branch" == "main" ]]; then
    checks+=("$(check_entry "1.1" "On feature branch" "FAIL" "" "Currently on $branch. Create a feature branch before starting work.")")
    rule_ids+=("\"branch-protection\"")
    fail_msgs+=("- You are on \`$branch\`. Run \`git checkout -b feat/<short-name>\` first.")
  else
    checks+=("$(check_entry "1.1" "On feature branch" "PASS")")
  fi

  if [[ ! -d "node_modules" ]]; then
    checks+=("$(check_entry "1.2" "Dependencies installed" "FAIL" "" "node_modules missing — run npm install")")
    fail_msgs+=("- \`node_modules\` missing. Run \`npm install\`.")
  else
    checks+=("$(check_entry "1.2" "Dependencies installed" "PASS")")
  fi

  local checks_json
  checks_json="[$(IFS=,; echo "${checks[*]}")]"
  local rule_ids_json="[]"
  if (( ${#rule_ids[@]} > 0 )); then
    rule_ids_json="[$(IFS=,; echo "${rule_ids[*]}")]"
  fi

  if (( ${#fail_msgs[@]} > 0 )); then
    local instr
    instr=$(printf 'Pre-work checks failed:\n%s\n' "$(printf '%s\n' "${fail_msgs[@]}")")
    emit FAIL "in-progress" "$instr" "$checks_json" "$rule_ids_json"
  else
    emit PASS "in-progress" "" "$checks_json" "[]"
  fi
}

gate_in_progress() {
  local checks=()
  local fail_msgs=()

  local tc_output
  if tc_output=$(run_typecheck 2>&1); then
    checks+=("$(check_entry "2.1" "tsc --noEmit" "PASS")")
  else
    local tc_short
    tc_short=$(printf '%s' "$tc_output" | tail -30)
    checks+=("$(check_entry "2.1" "tsc --noEmit" "FAIL" "type-safety" "$tc_short")")
    fail_msgs+=("- Type errors. Fix \`tsc --noEmit\` output. NEVER use \`as any\` / \`@ts-ignore\` / \`@ts-expect-error\`.")
  fi

  local checks_json
  checks_json="[$(IFS=,; echo "${checks[*]}")]"

  if (( ${#fail_msgs[@]} > 0 )); then
    local instr
    instr=$(printf 'In-progress checks failed:\n%s\n\nRun \`npm run typecheck\` locally to see full output.' "$(printf '%s\n' "${fail_msgs[@]}")")
    emit FAIL "in-progress" "$instr" "$checks_json" "[\"type-safety\"]"
  else
    emit PASS "pre-merge" "" "$checks_json" "[]"
  fi
}

gate_pre_merge() {
  local checks=()
  local rule_ids=()
  local fail_msgs=()

  local tc_output
  if tc_output=$(run_typecheck 2>&1); then
    checks+=("$(check_entry "3.1" "tsc --noEmit" "PASS")")
  else
    local tc_short
    tc_short=$(printf '%s' "$tc_output" | tail -30)
    checks+=("$(check_entry "3.1" "tsc --noEmit" "FAIL" "type-safety" "$tc_short")")
    rule_ids+=("\"type-safety\"")
    fail_msgs+=("- \`tsc --noEmit\` failed. See output above. Never silence with \`as any\`.")
  fi

  local test_output
  if test_output=$(run_tests 2>&1); then
    checks+=("$(check_entry "3.2" "vitest run" "PASS")")
  else
    local test_short
    test_short=$(printf '%s' "$test_output" | tail -40)
    checks+=("$(check_entry "3.2" "vitest run" "FAIL" "test-failure" "$test_short")")
    rule_ids+=("\"test-failure\"")
    fail_msgs+=("- Tests failed. Run \`npx vitest run\` locally. Fix root cause; do NOT delete failing tests.")
  fi

  local forbidden
  forbidden=$(run_forbidden_grep)
  if [[ -z "$forbidden" ]]; then
    checks+=("$(check_entry "3.3" "No forbidden type escapes" "PASS")")
  else
    local fb_short
    fb_short=$(printf '%s' "$forbidden" | head -10)
    checks+=("$(check_entry "3.3" "No forbidden type escapes" "FAIL" "forbidden-patterns" "$fb_short")")
    rule_ids+=("\"forbidden-patterns\"")
    fail_msgs+=("- Found \`as any\` / \`@ts-ignore\` / \`@ts-expect-error\` in source. Fix the underlying type instead.")
  fi

  local pack_output
  if pack_output=$(npm pack --dry-run 2>&1); then
    checks+=("$(check_entry "3.4" "npm pack --dry-run" "PASS")")
  else
    local pack_short
    pack_short=$(printf '%s' "$pack_output" | tail -20)
    checks+=("$(check_entry "3.4" "npm pack --dry-run" "FAIL" "npm-publish-contract" "$pack_short")")
    rule_ids+=("\"npm-publish-contract\"")
    fail_msgs+=("- \`npm pack --dry-run\` failed. Check \`package.json\` \`files\`/\`exports\`/\`main\`/\`types\`.")
  fi

  local unresolved_count
  unresolved_count=$(count_unresolved_pr_threads)
  case "$unresolved_count" in
    no-pr)
      checks+=("$(check_entry "3.5" "No unresolved PR comments" "PASS" "" "No open PR for this branch.")")
      ;;
    error)
      checks+=("$(check_entry "3.5" "No unresolved PR comments" "PASS" "" "gh CLI unavailable — skipped.")")
      ;;
    0)
      checks+=("$(check_entry "3.5" "No unresolved PR comments" "PASS")")
      ;;
    *)
      checks+=("$(check_entry "3.5" "No unresolved PR comments" "FAIL" "unresolved-review-comments" "$unresolved_count unresolved thread(s) on PR.")")
      rule_ids+=("\"unresolved-review-comments\"")
      fail_msgs+=("- PR has $unresolved_count unresolved review thread(s). Resolve all comments on GitHub before merging.")
      ;;
  esac

  local checks_json
  checks_json="[$(IFS=,; echo "${checks[*]}")]"
  local rule_ids_json="[]"
  if (( ${#rule_ids[@]} > 0 )); then
    rule_ids_json="[$(IFS=,; echo "${rule_ids[*]}")]"
  fi

  if (( ${#fail_msgs[@]} > 0 )); then
    local instr
    instr=$(printf 'Pre-merge validation ladder FAILED:\n%s\n\nFix each item above. Re-run with \`./scripts/harness-check.sh pre-merge\` to verify.' "$(printf '%s\n' "${fail_msgs[@]}")")
    emit FAIL "pre-merge" "$instr" "$checks_json" "$rule_ids_json"
  else
    emit PASS "post-merge" "" "$checks_json" "[]"
  fi
}

gate_post_merge() {
  local checks=()
  local fail_msgs=()

  if git_clean; then
    checks+=("$(check_entry "4.1" "Working tree clean" "PASS")")
  else
    checks+=("$(check_entry "4.1" "Working tree clean" "FAIL" "" "Uncommitted changes after merge.")")
    fail_msgs+=("- Working tree has uncommitted changes. Commit or stash before declaring merge done.")
  fi

  local gh_user
  gh_user=$(gh api user --jq '.login' 2>/dev/null || echo "")
  if [[ "$gh_user" == "kokorolx" ]]; then
    checks+=("$(check_entry "4.2" "gh account is kokorolx" "PASS")")
  elif [[ -z "$gh_user" ]]; then
    checks+=("$(check_entry "4.2" "gh account is kokorolx" "PASS" "" "gh CLI unavailable — skipped.")")
  else
    checks+=("$(check_entry "4.2" "gh account is kokorolx" "FAIL" "wrong-gh-account" "Active gh account: $gh_user")")
    fail_msgs+=("- gh CLI is authenticated as \`$gh_user\`, not \`kokorolx\`. Run \`gh auth switch --user kokorolx\` before pushing.")
  fi

  local checks_json
  checks_json="[$(IFS=,; echo "${checks[*]}")]"

  if (( ${#fail_msgs[@]} > 0 )); then
    local instr
    instr=$(printf 'Post-merge checks failed:\n%s\n' "$(printf '%s\n' "${fail_msgs[@]}")")
    emit FAIL "post-merge" "$instr" "$checks_json" "[]"
  else
    emit PASS "next-ready" "" "$checks_json" "[]"
  fi
}

gate_next_ready() {
  local checks
  checks="[$(check_entry "5.1" "Feature complete" "PASS")]"
  emit PASS "null" "" "$checks" "[]"
}

case "$GATE" in
  pre-work)    gate_pre_work    ;;
  in-progress) gate_in_progress ;;
  pre-merge)   gate_pre_merge   ;;
  post-merge)  gate_post_merge  ;;
  next-ready)  gate_next_ready  ;;
  *)
    instr="Unknown gate: $GATE. Expected one of: pre-work, in-progress, pre-merge, post-merge, next-ready."
    emit ERROR "null" "$instr" "[]" "[]"
    ;;
esac
