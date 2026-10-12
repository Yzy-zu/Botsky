#!/usr/bin/env bash
set -euo pipefail

# A new run, separate from the immutable Phase 0 baseline. Compile the native
# driver INSIDE the disposable container; never replace the host test binding.
project_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
regression_image=${BOTSKY_BASELINE_IMAGE:-node:20-bookworm@sha256:8f693eaa7e0a8e71560c9a82b55fd54c2ae920a2ba5d2cde28bac7d1c01c9ba5}
regression_output=${BOTSKY_BASELINE_OUTPUT:-/tmp/botsky-v2-phase2-legacy.tap}
if [[ -f "$project_dir/.env" || ! -d "$project_dir/node_modules" ]]; then
    echo 'Refusing regression: isolated checkout without .env and installed dependencies required.' >&2
    exit 1
fi
set +e
docker run --rm --init --network none --cap-drop ALL \
    --security-opt no-new-privileges --memory 1g --cpus 1 --pids-limit 256 \
    --mount "type=bind,src=$project_dir,dst=/source,readonly" \
    --entrypoint /bin/bash "$regression_image" -c '
        set -euo pipefail
        mkdir -p /home/petrov/botsky /tmp/botsky-data /tmp/botsky-home
        cp -r /source/src /source/test /source/data /source/node_modules /source/scripts /home/petrov/botsky/
        cp /source/package.json /source/package-lock.json /home/petrov/botsky/
        cd /home/petrov/botsky
        npm rebuild sqlite3 --build-from-source --nodedir=/usr/local
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
    ' > "$regression_output" 2>&1
regression_exit=$?
set -e
echo "Legacy regression exit: $regression_exit; output: $regression_output"
exit "$regression_exit"
