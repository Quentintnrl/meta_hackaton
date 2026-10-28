#!/bin/sh
# Git hook: after each merge or pull, ask Ripple_handoff to write a changelog draft from the new commits.
# Install in the target project:  cp <path to>/content-hook.sh .git/hooks/post-merge && chmod +x .git/hooks/post-merge
# Needs RIPPLE_PROJECT (project id shown in the console URL list) and the orchestrator running. It never blocks the merge.
PORT="${RIPPLE_PORT:-8787}"
[ -z "$RIPPLE_PROJECT" ] && exit 0
curl -s -m 20 -X POST "http://localhost:$PORT/projects/$RIPPLE_PROJECT/content/from-git" \
  -H 'content-type: application/json' -d '{"since":"1 day ago"}' >/dev/null 2>&1 || true
exit 0
