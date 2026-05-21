#!/bin/bash
set -e
pnpm install --frozen-lockfile
# Run drizzle-kit push non-interactively. Piping empty stdin accepts the
# default "create new column/table" answer for any rename-ambiguity prompts,
# and --force bypasses interactive data-loss confirmations.
yes "" | pnpm --filter db run push-force
