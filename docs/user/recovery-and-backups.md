# Desktop recovery and backups

Status: current
Owner: product documentation maintainers
Last verified: 2026-09-09
Source of truth: Twine RS desktop settings, story-library backup, and recovery code

This page describes the current Twine RS desktop application. It does not
describe the separate upstream Twine application or browser storage.

## Recovering from damaged settings

Twine RS stores desktop settings in `prefs.json` and `app-prefs.json`. Both
files are in Twine RS's Electron user-data directory, which the application
derives as the operating system's application-data directory plus `twine-rs`.

Use the operating system's normal application-data location rather than
assuming an absolute path:

- On macOS, choose **Go > Go to Folder** in Finder, open
  `~/Library/Application Support`, and look for `twine-rs`.
- On Windows, enter `%APPDATA%` in File Explorer's address bar and look for
  `twine-rs`.
- On Linux, look under the configuration root used by your desktop session,
  commonly `$XDG_CONFIG_HOME` or `~/.config`, for `twine-rs`.

Install packaging and environment configuration can change the parent
application-data directory. Before changing anything, verify that the derived
`twine-rs` folder contains `prefs.json` and `app-prefs.json`.

To try a reversible settings reset:

1. Quit Twine RS completely.
2. Copy the `twine-rs` settings directory to a safe location.
3. In the original directory, rename `prefs.json` and `app-prefs.json`, for
   example to `prefs.json.disabled` and `app-prefs.json.disabled`.
4. Start Twine RS. The application continues with default settings and
   recreates settings files when those settings are saved.

If this does not help, quit Twine RS before restoring the saved files. Renaming
or copying is safer than deleting because it preserves the previous settings
for inspection or restoration.

A settings reset is not a project-data recovery operation. Do not rename,
remove, or replace story-library folders or `.twine.rs` project folders while
resetting settings. Do not change an upstream Twine application-data or story
directory; upstream Twine is a separate product.

## Story-library and backup locations

The default desktop story library is under the operating system's Documents
folder:

```text
Documents/Twine RS/Stories
```

The default backup root is alongside it:

```text
Documents/Twine RS/Backups
```

`Stories` and `Backups` are the English names. Twine RS uses localized leaf
folder names in other languages. The story-library and backup locations can
also be overridden in application settings or for a single command-line
launch, so reveal or confirm the active folders in Twine RS before copying or
restoring data.

Twine RS backs up the desktop story library once during startup and then on a
schedule. The default cadence is 20 minutes. Each backup is a timestamped
directory containing a copy of the story library. By default, Twine RS retains
10 backup directories and removes the oldest backup directories when the limit
is exceeded.

Backups cover the configured story library. A `.twine.rs` project folder
opened from elsewhere is separate project data and should be backed up using
your normal file-backup or source-control workflow.

In **Settings > Backups**, use **Back Up** to request a library backup and
**Reveal** to locate the backup folder. Check that the operation succeeded and
that the expected project is in the backup. Startup continues if a scheduled
backup fails, so the existence of a configured backup folder is not evidence of
a successful copy. Backups exclude cache, scratch, and temporary files; keep
working project data in its intended source and asset directories.

## Restore a project from a backup

There is no automatic backup-restore command. Work from a copy:

1. Quit Twine RS and preserve the affected project and settings before making
   changes. Locate the active story library and backup root; do not assume that
   they still use the default paths.
2. Copy the chosen timestamped backup directory to a recovery location outside
   the configured backup and scratch roots. This prevents retention or scratch
   cleanup from deleting your recovery copy. Keep the original backup intact.
3. Locate the complete `.twine.rs` project in that copy. Preserve `twine.toml`,
   all declared sources, scripts, styles, assets, and hidden `.twine/` metadata.
   For a separately stored project, use its own file backup or source-control
   snapshot instead of assuming it appears in the library backup.
4. Launch with the [isolated recovery folders](#test-with-an-isolated-library)
   below. Open **New Project**, choose the **Import** tab, then select
   **Open Project Folder** in the **Import Source** panel to open the copied project.
   If the backup contains an older HTML story instead, use **Import** in that
   isolated library and review its stories.
   A selected **Replace** entry overwrites the matching library story; do not
   approve it without preserving the existing story.
5. Check passage text, start passage, story format/version, scripts, stylesheet,
   graph layout, assets, and Play/Test. Save and reopen the working copy. Keep
   the damaged original and the untouched backup until recovery is complete.

To restore an entire library at its original location, quit Twine RS, preserve
the current library in a separate directory, and copy the selected backup's
contents into a fresh directory at the confirmed library path. Do not merge
the backup into a damaged library: extra files from the damaged copy may remain.
Preserve newer work separately before replacing it with an older backup.

Opening a backup in an older application also requires the release's
[rollback instructions](../en/src/getting-started/downgrading.md). Restoring
settings alone does not roll back project data.

### Test with an isolated library

A copied project keeps its story identities. Do not open it alongside the
remembered original in your normal library. Quit every running Twine RS
instance, then launch using new, empty, dedicated library, backup, and scratch
directories. For example, substitute your own absolute paths and installed
executable in this command:

```shell
twine-rs --storyLibraryFolderPath="/absolute/recovery/library" --backupFolderPath="/absolute/recovery/backups" --scratchFolderPath="/absolute/recovery/scratch" "/absolute/recovery/Working Copy.twine.rs"
```

The three directories must be distinct and must not contain unrelated files.
Keep the untouched backup and original project outside them. The app remembers
opened project roots in the selected library, so a fresh library prevents it
from loading the original project's remembered entry during the test. Do not
copy the original library's hidden `.twine/native-projects.json` index into this
test library.

These options apply to this launch without changing the saved folder settings.
Repeat them when reopening the recovery copy for verification. After quitting,
a normal launch uses the usual configured folders again. The settings directory
is still shared; avoid changing application preferences during this test.
See [desktop command-line usage](./desktop-command-line.md) for macOS, Windows,
and Linux executable examples.

## Interrupted operations

Twine RS attempts to recover certain interrupted project replacements and
deletions. This transaction recovery is separate from restoring a scheduled
backup and does not repair arbitrary story corruption.

When recovery cannot safely finish, the application reports the affected
operation and may block changes. Preserve the project and any hidden sibling
staging or backup folders. Use the offered **Reveal** and **Retry** actions or
seek support with a redacted error message. Do not delete transaction journals
or hidden recovery folders manually to bypass the block.

## Choose dedicated folders

Never use the story library itself, one of its parents, or an unrelated
data-containing directory as the backup root. Twine RS rejects overlaps between
the active story library and backup folder, but backup retention still removes
old directories from the configured backup root. A poorly chosen root could
therefore put unrelated directories at risk.

Keep the story library, backup root, scratch/cache folder, and unrelated files
in separate directories. The scratch/cache cleanup process also removes old
files from its configured folder; see the
[`desktop command-line guide`](./desktop-command-line.md) before overriding
these paths.

Twine RS does not provide cloud backup or automatic backup restoration.
Periodically copy important `.twine.rs` project folders, the story library, and selected backup
directories to storage you control, and test that you can read those copies.
