# Existing profile reset — 2026-09-10

Explicit user request: reset existing nicknames and avatars too.

- Production store: `/srv/guandan/shared/data/platform.json`.
- Reset 3 ordinary users to paired entries from the current 24-entry library; skipped 99 bot/system users.
- Cleared prior customization marker and any uploaded avatar bytes, allowing the generated-profile source to apply. Users can edit again normally.
- Backup: `/srv/guandan/backups/20260910-existing-profiles-reset/platform.before.json` (private, original bytes); SHA-256 recorded in adjacent manifest.
- Offline tool: `ops/guangzhou/reset-existing-profiles.mjs`; dry-run and isolated fixture passed. Platform service stopped during atomic replacement, then restarted; game service remained running.
- Before restart, full state comparison verified that only allowed profile fields changed. After restart, all 3 paired profiles were verified; wallet, ratings, statistics, matches and history remained unchanged. Startup migration additionally assigned missing account IDs to 3 existing bots and updated their account-ID index; this was not a nickname/avatar reset.
- Platform health endpoint returned OK. No client rebuild/upload required. An already-open client may need reopening to fetch the new profile; historical room/replay snapshots are not rewritten.

Do not rerun this migration without a new explicit reset request. Restore only intended profile fields from the backup if rollback becomes necessary; replacing the whole database later would discard intervening gameplay changes.
