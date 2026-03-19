# ── Patched PostgreSQL 16 image ────────────────────────────────────────────────
# Base: postgres:16-alpine (Alpine 3.23)
#
# What apk upgrade fixes (verified by build output):
#   ✅ CVE-2026-22184  zlib 1.3.1-r2 → 1.3.2-r0
#   ✅ CVE-2026-27171  zlib 1.3.1-r2 → 1.3.2-r0
#   ✅ apk-tools / libapk upgraded to 3.0.5-r0
#
# Remaining CVEs that CANNOT be fixed via apk upgrade:
#   ⛔ golang/stdlib ~20 CVEs — embedded in pre-compiled Go binaries (not an
#      Alpine package). Requires the upstream postgres:16-alpine image to be
#      rebuilt with a newer Go compiler. These do not affect the PostgreSQL
#      server itself; they affect Go-based tooling compiled into the image.
#   ⛔ busybox  CVE-2025-60876  — no r31+ package available in Alpine 3.23 yet
#   ⛔ openldap CVE-2026-22185  — no 2.6.11+ package available in Alpine 3.23 yet
#
# For production: use a managed database service (AWS RDS, Cloud SQL, etc.)
# or watch https://github.com/docker-library/postgres for the next rebuild.
# ────────────────────────────────────────────────────────────────────────────────

FROM postgres:16-alpine

RUN apk update && apk upgrade --no-cache && rm -rf /var/cache/apk/*
