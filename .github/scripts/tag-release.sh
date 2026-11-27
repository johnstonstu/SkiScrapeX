#!/usr/bin/env bash
# Creates annotated vX.Y.Z release tags. Used by .github/workflows/tag.yml.
#
#   tag-release.sh push BEFORE AFTER
#     Tags AFTER with the version in game/package.json, but only when that
#     version differs from the one at BEFORE (so a push without a bump never
#     tags). BEFORE may be empty or all zeros; AFTER's first parent is used then.
#
#   tag-release.sh backfill "v0.9.35=d3d19ff v0.9.36=69ee94d ..."
#     Tags each listed commit. Each commit must be on origin/main and its
#     game/package.json must hold the version the tag names.
#
# A tag that already exists on origin is left alone. The message is
# "vX.Y.Z: <title>" from the CHANGELOG.md heading "## X.Y.Z (date): Title" at
# that commit, falling back to the PR title or commit subject.
#
# DRY_RUN=1 prints what would be tagged and pushes nothing.

set -euo pipefail

PKG=game/package.json
REMOTE=${REMOTE:-origin}
DRY_RUN=${DRY_RUN:-0}

version_at() {
  # The version string in game/package.json at a commit, or empty.
  git show "$1:$PKG" 2>/dev/null | sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1
}

message_for() {
  local sha=$1 version=$2 title
  local esc=${version//./\\.}
  title=$(git show "$sha:CHANGELOG.md" 2>/dev/null \
    | sed -n "s/^## ${esc} ([^)]*): *//p" | head -n1)
  if [ -z "$title" ]; then
    # Merge commits carry the PR title on the first body line.
    if [ "$(git rev-list --parents -n1 "$sha" | wc -w)" -gt 2 ]; then
      title=$(git log -1 --format=%b "$sha" | sed -n '/./{p;q;}')
    fi
    [ -n "$title" ] || title=$(git log -1 --format=%s "$sha")
  fi
  # Match the existing tags: "v0.9.34: softer snowboard lean".
  printf 'v%s: %s%s\n' "$version" "$(printf '%s' "${title:0:1}" | tr '[:upper:]' '[:lower:]')" "${title:1}"
}

remote_tag_sha() {
  # The commit an existing remote tag points to, or empty.
  local refs peeled
  refs=$(git ls-remote --tags "$REMOTE" "refs/tags/$1" "refs/tags/$1^{}")
  # Annotated tags also list a peeled "^{}" line naming the commit.
  peeled=$(awk -v r="refs/tags/$1^{}" '$2 == r {print $1}' <<<"$refs")
  if [ -n "$peeled" ]; then
    echo "$peeled"
  else
    awk -v r="refs/tags/$1" '$2 == r {print $1}' <<<"$refs"
  fi
}

make_tag() {
  local tag=$1 sha=$2 version=$3 existing msg
  existing=$(remote_tag_sha "$tag")
  if [ -n "$existing" ]; then
    if [ "$existing" = "$sha" ]; then
      echo "$tag already exists on ${sha:0:7}, skipping."
    else
      echo "::warning title=Tag exists elsewhere::$tag already points to ${existing:0:7}, not ${sha:0:7}. Left as it is."
    fi
    return 0
  fi
  msg=$(message_for "$sha" "$version")
  if [ "$DRY_RUN" = 1 ]; then
    echo "Would tag ${sha:0:7} as $tag: \"$msg\""
    return 0
  fi
  git tag -f -a "$tag" -m "$msg" "$sha"
  git push "$REMOTE" "refs/tags/$tag"
  echo "Tagged ${sha:0:7} as $tag: \"$msg\""
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    echo "- \`$tag\` on \`${sha:0:7}\`: $msg" >> "$GITHUB_STEP_SUMMARY"
  fi
}

check_semver() {
  [[ $1 =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "::error::'$1' is not X.Y.Z."; exit 1; }
}

case "${1:-}" in
  push)
    after=$(git rev-parse --verify "${3:?AFTER commit}^{commit}")
    before=${2:-}
    if [ -z "$before" ] || [[ $before =~ ^0+$ ]] || ! git cat-file -e "$before^{commit}" 2>/dev/null; then
      before=$(git rev-parse --verify -q "$after^1" || true)
    fi
    new=$(version_at "$after")
    old=$( [ -n "$before" ] && version_at "$before" || true)
    [ -n "$new" ] || { echo "::error::No version in $PKG at ${after:0:7}."; exit 1; }
    check_semver "$new"
    if [ "$new" = "$old" ]; then
      echo "Version is still $new, nothing to tag."
      exit 0
    fi
    echo "Version ${old:-none} -> $new."
    make_tag "v$new" "$after" "$new"
    ;;
  backfill)
    status=0
    for pair in ${2:?pairs}; do
      tag=${pair%%=*}
      ref=${pair#*=}
      version=${tag#v}
      if [ "$tag" = "$pair" ] || [ "$tag" = "$version" ]; then
        echo "::error::'$pair' should look like v1.2.3=abc1234."; status=1; continue
      fi
      check_semver "$version"
      if ! sha=$(git rev-parse --verify -q "$ref^{commit}"); then
        echo "::error::$tag: commit $ref not found."; status=1; continue
      fi
      if ! git merge-base --is-ancestor "$sha" "$REMOTE/main"; then
        echo "::error::$tag: ${sha:0:7} is not on main."; status=1; continue
      fi
      found=$(version_at "$sha")
      if [ "$found" != "$version" ]; then
        echo "::error::$tag: $PKG at ${sha:0:7} says ${found:-nothing}."; status=1; continue
      fi
      make_tag "$tag" "$sha" "$version"
    done
    exit $status
    ;;
  *)
    echo "usage: $0 push BEFORE AFTER | backfill 'vX.Y.Z=sha ...'" >&2
    exit 2
    ;;
esac
