from node:24-trixie-slim

workdir /noclip
entrypoint /usr/bin/bash
expose 3000

copy rust/Cargo.lock rust/Cargo.toml /noclip/rust/

run set -eux; \
    DEBIAN_FRONTEND=noninteractive apt-get update; \
    DEBIAN_FRONTEND=noninteractive apt-get install -y \
        rustup git build-essential tmux; \
    rm -rf /var/cache/apt

run set -eux; \
    rustup default stable; \
    rustup target add wasm32-unknown-unknown; \
    cd /noclip/rust; \
    cargo install cargo-run-bin; \
    cargo bin --install

copy package.json pnpm-lock.yaml /noclip/

run set -eux; \
    cd /noclip; \
    corepack enable pnpm; \
    corepack install
