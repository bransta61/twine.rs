# Tagging Stories

Stories can be tagged to help you organize your library. These tags don't
change anything about your stories when they're published[^story-formats].
They're only visible in Twine itself.

A tag always has a name, but it can also have a color if you like from a set of
predetermined ones. Tag colors are only used to help distinguish tags from each
other visually. It's not possible to create custom tag colors, and a particular
tag can only have one color. That is, if you put a red `my-tag` tag on a story,
you can't make that tag be green on a different story[^story-tags].

Twine automatically assigns a color to a tag when you add it, but you can change
it to whatever you like, or remove the color entirely.

Another limitation of tags is that their names are not allowed to contain
spaces. If you try to enter a space for a tag name, then Twine will convert it
to a hyphen for you (i.e. `my tag` becomes `my-tag`).

When a tag is added to your story, it is displayed on its project row or card.

Once tags are added to your stories, you can [filter the _Projects_
screen](viewing.md) using the tag list in the left rail.

## Adding a Tag

Use the tag control on a project row or card. As you type, it suggests tags
already used elsewhere in the library.

## Removing a Tag

Open the same tag control and remove the tag from the project.

## Renaming a Tag

Choose _Story Tags_ in the left rail. A panel above the library lists all tags
used in the library, with up to 50 tags per page. Use _Previous_ and _Next_ for
longer lists. Enter the new name and choose _Rename_ or press Enter. Renaming
changes the tag on every story that uses it, keeping its color and active
library filter. If renaming fails, the panel keeps your draft so you can retry.

Undo and Redo apply within each project's history. If only some projects undo a
rename, both tag names keep their colors, and a selected filter includes both
names while both are in use.

Close the panel with its close button or press Escape while editing a tag name.
Focus returns to _Story Tags_ in the rail.

## Changing a Tag's Color

Use a project's tag control or the _Story Tags_ panel to choose a color. The
color changes everywhere that tag appears in this library.

[^story-formats]:
    Story tags are available to story formats, so it's possible
    that one might change its behavior based on tags applied to stories. But
    this is discouraged so that authors can freely use tags as they like.

[^story-tags]:
    Colors for story tags are a local personalization. They are not
    included in builds or archive files to prevent accidentally overriding
    colors and organization in another library.
