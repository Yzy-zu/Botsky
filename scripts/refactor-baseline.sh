#!/usr/bin/env bash
set -euo pipefail

# Run the unchanged legacy suite without credentials, host services or writable
# source mounts. Dependency installation must be completed in this worktree.
project_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
baseline_image=${BOTSKY_BASELINE_IMAGE:-node:20-bookworm@sha256:8f693eaa7e0a8e71560c9a82b55fd54c2ae920a2ba5d2cde28bac7d1c01c9ba5}
baseline_output=${BOTSKY_BASELINE_OUTPUT:-/tmp/botsky-v2-baseline.tap}

if [[ -f "$project_dir/.env" ]]; then
    echo 'Refusing baseline: this worktree contains .env.' >&2
    exit 1
fi
if [[ ! -d "$project_dir/node_modules" ]]; then
    echo 'Install dependencies in the isolated worktree first.' >&2
    exit 1
fi

if [[ ${1:-} == --prepare ]]; then
    # ARM64 sqlite3 may compile on installation; build against container glibc,
    # rather than copying a host binary that the container cannot load.
    docker run --rm --user "$(id -u):$(id -g)" --env HOME=/tmp \
        --network none --cap-drop ALL --security-opt no-new-privileges --cpus 1 \
        --mount "type=bind,src=$project_dir,dst=/source,readonly" \
        --mount "type=bind,src=$project_dir/node_modules,dst=/source/node_modules" \
        --workdir /source "$baseline_image" \
        npm rebuild sqlite3 --build-from-source --nodedir=/usr/local
    exit
fi

set +e
docker run --rm --init --network none --cap-drop ALL \
    --security-opt no-new-privileges --memory 1g --cpus 1 --pids-limit 256 \
    --mount "type=bind,src=$project_dir,dst=/source,readonly" \
    --entrypoint /bin/bash "$baseline_image" -c '
        set -euo pipefail
        mkdir -p /home/petrov/botsky /tmp/botsky-data /tmp/botsky-home
        cp -r /source/src /source/test /source/data /source/node_modules /source/scripts /home/petrov/botsky/
        cp /source/package.json /source/package-lock.json /home/petrov/botsky/
        cd /home/petrov/botsky
        node -e '\''require("sqlite3"); console.log("Runtime:", process.version, process.arch)'\''
        env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/botsky-home \
            TZ=America/Mexico_City DATA_DIR=/tmp/botsky-data \
            TMP_DIR=/tmp/botsky-media WEBHOOK_HOST=127.0.0.1 \
            EVOLUTION_API_URL=http://127.0.0.1:59999 \
            EVOLUTION_API_KEY=synthetic-baseline-evolution-key \
            EVOLUTION_INSTANCE=fixture-instance \
            GEMINI_API_KEY=synthetic-baseline-gemini-key \
            GROQ_API_KEY=synthetic-baseline-groq-key \
            timeout --signal=TERM --kill-after=10s 600s \
            node --test --test-reporter=tap test/*.test.js
    ' > "$baseline_output" 2>&1
baseline_exit=$?
set -e
echo "Baseline exit: $baseline_exit; output: $baseline_output"
exit "$baseline_exit"
