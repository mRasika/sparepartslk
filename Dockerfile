# Sparepartslk as one Docker image (docs/operations/docker-hosting.md).
#
# One image, three jobs. The stack file (deploy/docker/docker-compose.yml) starts it as:
#   app      node server.js   the website (Next.js standalone server)
#   migrate  migrate          safety copy + database update, then stops
#   jobs     jobs-start       stock check, nightly backup + Neon standby copy, restore commands
#
# No passwords or addresses are inside: every setting comes from the stack when it starts, so the
# same image serves every company. GitHub builds it for ARM on each release tag
# (.github/workflows/docker-image.yml).

# ---- 1. All packages (for building) ----
FROM node:24-bookworm-slim AS deps
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts

# ---- 2. Build the app ----
FROM deps AS build
COPY . .
# The build loads every page and the database/login set-up runs when their files load, so they need
# values. These dummy ones are never used for real and are not in the final image.
ENV NEXT_OUTPUT=standalone \
    NEXT_TELEMETRY_DISABLED=1 \
    DATABASE_URL=postgresql://build:build@localhost:5432/build \
    BETTER_AUTH_SECRET=build-only-not-a-real-secret-0123456789 \
    BETTER_AUTH_URL=http://localhost:3000
RUN pnpm build \
 && cp -r public .next/standalone/ \
 && cp -r .next/static .next/standalone/.next/

# ---- 3. What the database update needs (kept apart so the website stays small) ----
FROM node:24-bookworm-slim AS tools
WORKDIR /tools
# Same versions as pnpm-lock.yaml.
RUN npm init -y >/dev/null \
 && npm install --omit=dev --no-audit --no-fund drizzle-orm@0.45.4 postgres@3.4.9 \
 && npm cache clean --force
COPY drizzle ./drizzle
COPY deploy/docker/migrator/ ./

# ---- 4. The final image ----
FROM node:24-bookworm-slim
ARG TARGETARCH
ARG APP_VERSION=dev
ARG GIT_SHA=unknown

# psql / pg_dump / pg_restore 17 (same version as the database), gpg (backup encryption),
# curl (pings), unzip (rclone below).
# Retries: a download cut short by the network otherwise fails the whole build.
RUN echo 'Acquire::Retries "5";' > /etc/apt/apt.conf.d/80retries \
 && apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg unzip postgresql-common \
 && /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y \
 && apt-get install -y --no-install-recommends postgresql-client-17 \
 && rm -rf /var/lib/apt/lists/*

# rclone (upload to Cloudflare R2): a current release, not Debian's older one (R2 answered
# "501 NotImplemented" to it on the first try).
ARG RCLONE_RELEASE=v1.76.0
RUN case "$TARGETARCH" in \
      arm64) sum=ee169016675e23a69d77240565133ff7dbc9b33d16fa8f7053d4af39f1eaeb78 ;; \
      amd64) sum=b00f00b3266c3764413afe599d3ec316f6f43b3e0ea8a0bc1d186d2133e46df7 ;; \
      *) echo "No rclone for $TARGETARCH" && exit 1 ;; \
    esac \
 && curl -fsSL -o /tmp/rclone.zip \
      "https://downloads.rclone.org/${RCLONE_RELEASE}/rclone-${RCLONE_RELEASE}-linux-${TARGETARCH}.zip" \
 && echo "${sum}  /tmp/rclone.zip" | sha256sum -c - \
 && unzip -q -j /tmp/rclone.zip '*/rclone' -d /usr/local/bin \
 && chmod 755 /usr/local/bin/rclone \
 && rm /tmp/rclone.zip

# supercronic: a small cron made for containers (logs to Portainer, follows TZ).
ARG SUPERCRONIC_VERSION=v0.2.51
RUN case "$TARGETARCH" in \
      arm64) sum=4ae22576a78223d8ccdf5f3b3660a5cbb5288416bf0ca96afc4a36d195932b94 ;; \
      amd64) sum=cc232108374e8e2b537045f2d5eaa1229f619db314c3ba6a14d38b35dc0aa123 ;; \
      *) echo "No supercronic for $TARGETARCH" && exit 1 ;; \
    esac \
 && curl -fsSL -o /usr/local/bin/supercronic \
      "https://github.com/aptible/supercronic/releases/download/${SUPERCRONIC_VERSION}/supercronic-linux-${TARGETARCH}" \
 && echo "${sum}  /usr/local/bin/supercronic" | sha256sum -c - \
 && chmod 755 /usr/local/bin/supercronic

COPY --from=build --chown=node:node /src/.next/standalone /app
COPY --from=tools --chown=node:node /tools /tools
COPY --chmod=755 deploy/docker/bin/ /usr/local/bin/
# No --chmod here: newer BuildKit applies it to the folder too, and a 644 folder can't be opened.
COPY deploy/docker/lib/ /usr/local/lib/sparepartslk/
# A new "backups" volume takes this folder's owner, so the scripts (not root) can write there.
RUN chmod 755 /usr/local/lib/sparepartslk \
 && chmod 644 /usr/local/lib/sparepartslk/* \
 && mkdir /backups && chown node:node /backups

# HOSTNAME: Docker sets it to the container's id, which would make Next listen on the wrong address.
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    APP_VERSION=${APP_VERSION} \
    GIT_SHA=${GIT_SHA}

USER node
WORKDIR /app
EXPOSE 3000
CMD ["node", "server.js"]
