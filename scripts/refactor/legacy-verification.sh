#!/usr/bin/env bash
set -euo pipefail

# A second, fully provisioned harness. It never modifies the recorded baseline.
# Build may access package repositories. Runtime has no network/host writes/credentials.
project_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
verification_image=${BOTSKY_LEGACY_VERIFICATION_IMAGE:-botsky/legacy-verification:node20}
verification_output=${BOTSKY_LEGACY_VERIFICATION_OUTPUT:-/tmp/botsky-legacy-verification.tap}
verification_library=${BOTSKY_LEGACY_LIBRARY_SOURCE:-/home/petrov/petrovsky/backend/rikolino_library.js}
verification_stage=$(mktemp -d /tmp/botsky-legacy-harness.XXXXXXXX)
trap 'rm -rf -- "$verification_stage"' EXIT
action=${1:-run}
if [[ "$action" != run ]]; then shift; fi

if [[ "$action" == --prepare ]]; then
    [[ $# == 0 ]] || { echo 'Unexpected build arguments.' >&2; exit 2; }
    [[ -f "$verification_library" && ! -L "$verification_library" ]] || { echo 'Fixture producer source unavailable.' >&2; exit 1; }
    cp -- "$project_dir/package.json" "$project_dir/package-lock.json" "$verification_stage/"
    # Copy ONLY this code file, never the neighboring backend configuration/media/database.
    cp -- "$verification_library" "$verification_stage/rikolino_library.js"
    cat > "$verification_stage/Dockerfile" <<'DOCKERFILE'
FROM node:20-bookworm@sha256:8f693eaa7e0a8e71560c9a82b55fd54c2ae920a2ba5d2cde28bac7d1c01c9ba5
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg ghostscript poppler-utils procps git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN groupadd --gid 1002 petrov && useradd --uid 1002 --gid 1002 --create-home petrov
WORKDIR /opt/botsky-dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm rebuild sqlite3 --build-from-source --nodedir=/usr/local
WORKDIR /home/petrov/petrovsky/backend
RUN npm init -y >/dev/null && npm install --omit=dev --ignore-scripts --save-exact sharp@0.35.3 cheerio@1.2.0 \
    && ln -s /opt/botsky-dependencies/node_modules/sqlite3 node_modules/sqlite3
COPY rikolino_library.js ./rikolino_library.js
RUN node -e 'const s=require("sqlite3");const sharp=require("sharp");require("cheerio");require("./rikolino_library");sharp({create:{width:5,height:5,channels:3,background:"red"}}).png().toBuffer().then(b=>{if(!b.length)process.exit(1)});' \
    && node -e 'const fs=require("node:fs"),crypto=require("node:crypto");const contents=fs.readFileSync("rikolino_library.js");const version=name=>JSON.parse(fs.readFileSync("node_modules/"+name+"/package.json","utf8")).version;fs.writeFileSync("/opt/fixture-provenance.json",JSON.stringify({node:process.version,arch:process.arch,producerSha256:crypto.createHash("sha256").update(contents).digest("hex"),sharp:version("sharp"),cheerio:version("cheerio"),sqlite3:version("sqlite3")}));'
RUN mkdir -p /home/petrov/botsky /tmp/botsky-media /tmp/whatsapp-bot /tmp/botsky-data /tmp/botsky-fixtures \
    && chown -R 1002:1002 /home/petrov/botsky /tmp/botsky-media /tmp/whatsapp-bot /tmp/botsky-fixtures \
    && chmod 0777 /home/petrov/botsky /tmp/botsky-media /tmp/whatsapp-bot /tmp/botsky-fixtures
WORKDIR /home/petrov/botsky
DOCKERFILE
    docker build --tag "$verification_image" "$verification_stage"
    exit
fi

if [[ "$action" == --check ]]; then
    [[ $# == 0 ]] || { echo 'Unexpected check arguments.' >&2; exit 2; }
    docker run --rm --network none --cap-drop ALL --cap-add SETUID --cap-add SETGID --cap-add KILL \
        --security-opt no-new-privileges --memory 1g --pids-limit 256 \
        --entrypoint /bin/bash "$verification_image" -c '
            set -euo pipefail
            for tool in ffmpeg ffprobe gs pdfinfo git pgrep free uptime; do command -v "$tool" >/dev/null; done
            test ! -e /usr/bin/bwrap
            node -e '\''const fs=require("node:fs"),{spawnSync,spawn}=require("node:child_process");const result=spawnSync("id",[],{uid:1002,gid:1002});if(result.status!==0||!result.stdout.toString().includes("1002(petrov)"))throw Error("UID/GID harness unavailable");const child=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{uid:1002,gid:1002,detached:true,stdio:"ignore"});const timer=setTimeout(()=>{console.error("Process-group signal check failed");process.exit(1)},3000);child.once("spawn",()=>{try{process.kill(-child.pid,"SIGKILL")}catch(error){console.error("UID process-group signaling unavailable");process.exit(1)}});child.once("error",()=>process.exit(1));child.once("exit",(code,signal)=>{clearTimeout(timer);if(signal!=="SIGKILL")process.exit(1);process.stdout.write(fs.readFileSync("/opt/fixture-provenance.json"));});'\''
        '
    exit
fi

if [[ "$action" != run && "$action" != --files ]]; then
    echo 'Usage: legacy-verification.sh [--prepare | --check | --files test/name.test.js ...]' >&2
    exit 2
fi
if [[ "$action" == --files && $# == 0 ]]; then echo 'Provide at least one test file.' >&2; exit 2; fi
selected_files=()
for selected in "$@"; do
    [[ "$selected" =~ ^test/[A-Za-z0-9_.-]+\.test\.js$ && -f "$project_dir/$selected" ]] \
        || { echo 'Invalid test selection.' >&2; exit 2; }
    selected_files+=("$selected")
done

mkdir "$verification_stage/source"
# Explicit allowlist: do not mount the workspace root or copy data/.env/node_modules.
cp -r -- "$project_dir/src" "$project_dir/test" "$project_dir/scripts" "$verification_stage/source/"
cp -- "$project_dir/package.json" "$project_dir/package-lock.json" "$verification_stage/source/"
chmod -R a+rX "$verification_stage/source"
cat > "$verification_stage/launch.sh" <<'LAUNCH'
#!/bin/bash
set -euo pipefail
node <<'COPY'
const {spawnSync}=require('node:child_process');
const result=spawnSync('/bin/bash',['-c',`set -euo pipefail
cp -r /source/src /source/test /source/scripts /home/petrov/botsky/
cp /source/package.json /source/package-lock.json /home/petrov/botsky/
ln -s /opt/botsky-dependencies/node_modules /home/petrov/botsky/node_modules
cd /home/petrov/botsky
git init --quiet
mkdir -p data /tmp/botsky-fixtures/fotos /tmp/botsky-fixtures/rikolino
chmod 0777 data /tmp/botsky-fixtures/fotos /tmp/botsky-fixtures/rikolino`],{uid:1002,gid:1002,stdio:'inherit'});
if(result.status!==0)throw Error('Ephemeral fixture setup failed');
COPY
cd /home/petrov/botsky
git config --global --add safe.directory /home/petrov/botsky
# Configuration is derived from literals already committed in tests, never real .env.
node <<'CONFIG'
const fs=require('node:fs');
const adminSource=fs.readFileSync('test/adminXp.test.js','utf8');
const admins=[...adminSource.matchAll(/const admin(?:Jid|Phone) = '(\d+)(?:@s\.whatsapp\.net)?'/g)].map(match=>match[1]);
const groups=[...fs.readFileSync('test/pack.test.js','utf8').matchAll(/const AUTHORIZED_GROUP = '([^']+)'/g)].map(match=>match[1]);
if(!admins.length||!groups.length)throw Error('Test identity literals changed; review fixture extraction');
const configuration={TZ:'America/Mexico_City',DATA_DIR:'/tmp/botsky-data',TMP_DIR:'/tmp/botsky-media',WEBHOOK_HOST:'127.0.0.1',
 EVOLUTION_API_URL:'http://127.0.0.1:59999',EVOLUTION_API_KEY:'synthetic-verification-evolution-key',EVOLUTION_INSTANCE:'fixture-instance',
 GEMINI_API_KEY:'synthetic-verification-gemini-key',GROQ_API_KEY:'synthetic-verification-groq-key',
 ALLOWED_NUMBERS_ADMIN:[...new Set(admins)].join(','),ALLOWED_GROUPS_NORMAL:groups.join(','),ALLOWED_GROUPS_ADMIN:'',
 FOTOS_DIR:'/tmp/botsky-fixtures/fotos',RIKOLINO_DIR:'/tmp/botsky-fixtures/rikolino',
 LEGACY_COMMAND_USAGE_ENABLED:'false',REFRACTOR_CAPTURE_ENABLED:'false'};
fs.writeFileSync('.env',Object.entries(configuration).map(([k,v])=>`${k}=${v}`).join('\n')+'\n',{mode:0o600});
// Snapshot every legacy test process into its own storage, without modifying test code.
fs.writeFileSync('/tmp/verification-preload.cjs',`'use strict';if(process.getuid()===0){const fs=require('node:fs');const dotenv=require('/opt/botsky-dependencies/node_modules/dotenv');Object.assign(process.env,dotenv.parse(fs.readFileSync('/home/petrov/botsky/.env')));const dir='/tmp/botsky-data/test-'+process.pid;fs.mkdirSync(dir,{recursive:true});process.env.DATA_DIR=dir;}`);
CONFIG
# Synthetic configuration was created by root: subprocess UID1002 gets EACCES.
chmod 0600 .env
test ! -e /usr/bin/bwrap
node -e 'require("/opt/botsky-dependencies/node_modules/sqlite3");process.stdout.write(require("node:fs").readFileSync("/opt/fixture-provenance.json"));console.log();'
if [[ $# == 0 ]]; then set -- test/*.test.js; fi
env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/home/petrov \
    TZ=America/Mexico_City DATA_DIR=/tmp/botsky-data TMP_DIR=/tmp/botsky-media \
    NODE_OPTIONS=--require=/tmp/verification-preload.cjs \
    timeout --signal=TERM --kill-after=10s 900s \
    node --test --test-concurrency=1 --test-reporter=tap "$@"
LAUNCH
chmod a+r "$verification_stage/launch.sh"
set +e
docker run --rm --init --network none --cap-drop ALL --cap-add SETUID --cap-add SETGID --cap-add KILL \
    --security-opt no-new-privileges --memory 2g --cpus 1 --pids-limit 256 \
    --mount "type=bind,src=$verification_stage/source,dst=/source,readonly" \
    --mount "type=bind,src=$verification_stage/launch.sh,dst=/launch.sh,readonly" \
    --entrypoint /bin/bash "$verification_image" /launch.sh "${selected_files[@]}" > "$verification_output" 2>&1
verification_exit=$?
set -e
echo "Legacy verification exit: $verification_exit; output: $verification_output"
exit "$verification_exit"
