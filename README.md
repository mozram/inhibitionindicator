Inhibition Indicator
===

Inhibition Indicator adds a `Keep Awake` tile to GNOME Quick Settings. Toggle the tile to manually prevent sleep, or open its menu to see which applications are currently blocking sleep. The application entries are informational because GNOME does not expose a public API for one app to cancel another app's inhibitor.

![Screenshot showing Inhibition Indicator in action](screenshot.png)

## Development

Dev installation
```bash
make install
```

`cli.js` can be used for debugging some parts of the code (because debugging Gnome Extensions is PITA). Run `cli.js` with
```bash
gjs -m cli.js
```

After translatable strings are changed, regenerate the pot files:
```bash
xgettext --from-code=UTF-8 --output=po/inhibitionindicator@monyxie.github.io.pot inhibitionindicator@monyxie.github.io/**/*.js
```

Pack the extension for distribution
```bash
make pack
```

For now, only dev dependencies are defined in `package.json`, and there's no build step.
This project is GPL so there's a restriction on the licenses of the dependencies.
We don't want code of non-compatible licenses make it into the release.

Read the [review guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html#general-guidelines)
before submitting for review on [EGO](https://extensions.gnome.org/).
