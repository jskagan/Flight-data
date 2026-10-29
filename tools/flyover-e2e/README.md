# Fly-over Drive-import end-to-end check

The one test that runs the REAL Drive-inbox import code in a browser: `showTripsyFlyover`'s
hand-off, watcher, stray-folder gather, Shortcut root adoption, import and folder retire — all
against a fake Drive that answers the real REST calls the page makes (`files.get`, `files.list`
with a `q`, `PATCH` move / rename / trash, `POST` create). `tools/tests/` only asserts on source
patterns and pure helpers; this is where the flow itself is exercised.

```
node tools/flyover-e2e/build.js   # extracts the fly-over section of index.html into harness.html
node tools/flyover-e2e/e2e.mjs    # thirteen scenarios, Playwright's fake clock skips the waits
```

Needs Playwright with Chromium (pre-installed in the cloud sandbox: `require('playwright')`
resolves from anywhere). `harness.html` is a build product and gitignored.

Scenarios (each boots a fresh page): A ordinary hand-off → files arrive → settle → import →
retire; B photos stranded in an older same-named folder are gathered; C a lagging (empty)
listing never trashes a folder with photos in it; D a failed cleanup is retried by the watcher;
E a folder trashed outside the app closes the hand-off; F the Shortcut route (root uploads
adopted, the "No new photos" box only after the grace); G a slow folder lookup cannot start two
imports; H an import interrupted by closing the page finishes on the next open; I an empty
folder just waits, and Cancel closes the hand-off; J the slideshow edit page saves each change with no Save button; K the Music tiles open the Music page, and Change opens the picker; L Preview beside Music plays the whole fly-over; M Segments offers a part or the animated map only.
