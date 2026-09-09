# Twine RS desktop backups

Desktop Twine RS backs up the configured story library at startup and on a
schedule. The default interval is 20 minutes with 10 retained backup directories.
Use **Settings > Backups > Back Up** for a manual backup and **Reveal** to find
the backup folder. Confirm that the backup succeeded before relying on it.

A project opened from outside the configured library needs its own file backup.
Keep complete `.twine.rs` folders, including assets and hidden `.twine/` metadata.
Browser-local projects do not receive these desktop backups; use
[library exports](../story-library/exporting.md) and
[browser storage preservation](local-storage.md).

To recover, quit Twine RS, preserve the current data, and copy the chosen backup
to a separate recovery location outside the backup and scratch roots. Test the
copy in an isolated recovery library before replacing current work: copies keep
the original story identities and should not be opened alongside the original.
There is no automatic backup-restore command.

See the canonical
[Twine RS desktop recovery and backups guide](https://github.com/twine-rs-labs/twine.rs/blob/main/docs/user/recovery-and-backups.md)
for the complete restoration procedure, settings locations, retention behavior,
and folder safety requirements.
