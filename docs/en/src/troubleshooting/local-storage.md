# Inspecting and Preserving Browser Storage

This page applies to browser-local projects in Twine RS. Desktop project folders
and managed Play/Test windows use different storage; see
[project storage](../story-library/location.md) and [desktop backups](backups.md).

## Preserve the current data

Use the same browser profile and the exact editor address you used to write the
story. Browser storage belongs to an origin: changing the protocol, hostname, or
port opens a different storage area. A preview window's storage is not the editor
library. Do not clear site data, uninstall the browser app, or reset the profile
while investigating missing work.

If stories still open, first use **Export Library Archive** on the **Projects**
screen. Keep any separately stored media too; a library archive is not a backup
of external asset files. An HTML archive can be [imported](../story-library/creating.md)
into a separate browser profile to check the recovered stories without replacing
the originals.

For data that the application cannot export:

1. Stop editing and close other Twine RS editor tabs for this origin. Keep one
   editor tab open for inspection.
2. Open the browser's developer tools. In its Storage or Application panel,
   select **Local Storage** for the editor's origin. Inspect it without changing
   values or deleting entries.
3. Save a private copy of all keys and their complete string values, including
   the manifest and any recovery records. To obtain one JSON snapshot, the
   developer-tools console can evaluate this read-only expression in the
   editor page's context:

   ```javascript
   JSON.stringify(Object.fromEntries(Object.entries(localStorage)), null, 2);
   ```

4. Use the console's copy-string/result action to copy the complete result into
   a local text file. Check that the saved file parses as JSON and contains the
   expected keys; copying a shortened on-screen preview is insufficient. Keep
   the editor address and Twine RS version with the snapshot.

The snapshot contains private story text and may contain other application data.
Do not publish it in an issue. It is evidence for recovery, **not an importable
Twine archive**. Do not paste it back into live storage or edit the manifest by
hand. If browser storage access itself fails, preserve the browser profile using
your browser's backup procedure and seek help before resetting it.

## Recognize current and legacy records

Current saves use `twine-story-storage-manifest`, a JSON object with `version: 2`,
a revision, and `stories` and `passages` arrays. Each array entry names the exact
storage `key` of its record; passage entries also identify their story. Follow
those references when inspecting data. Current record keys have the form
`twine-ss-<revision>-<sequence>` and their values are serialized JSON strings.

Older data can use `twine-stories` and `twine-passages` ID lists, with records
named `twine-stories-<id>` and `twine-passages-<id>`. The loader uses the legacy
layout when there is no usable current manifest. Legacy keys may coexist with
current data; their presence does not make them the current saved library.

Missing, malformed, or unreferenced records need investigation. A remaining
`twine-ss-*` record alone does not prove that a complete story can be restored.
Preserve it with the rest of the snapshot. An empty legacy ID list does not prove
that current-format stories are gone.
