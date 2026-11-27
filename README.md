# Family Jigsaw 🧩

Relaxing jigsaw puzzles made for grandparents: big pieces, tap-to-move, a "Help me" button,
a new painted picture every day, old-time public-domain music, and puzzles you can send to family
by link or QR code.

It is a **static site**: no server, no build step, no accounts, no API keys. It runs on
GitHub Pages or Netlify. Third-party code loads from a CDN, pinned to an exact version and integrity-checked.

## Put it online

**GitHub Pages:** push this folder to a repository, then go to Settings → Pages → *Deploy from a branch* → `main` / root.

**Netlify:** drag this folder onto <https://app.netlify.com/drop> (or connect the repository; leave the build command empty).

Then on the grandparent's tablet or phone, open the site and use **Add to Home Screen**. It then opens
like an app and works offline (except for music and surprise photos).

## What's inside

| Feature | How it works |
|---|---|
| 6 to 1000 pieces | Quick choices (6 / 12 / 24 / 48) or a 100–1000 slider with big ± buttons. Puzzles of 49+ pieces get a larger table: pinch, the mouse wheel or ➕ ➖ to zoom, and drag the empty table to look around. Tap a piece, pan, then tap where it goes |
| Today's puzzle + streak | The date picks a painted scene and piece shapes, so the whole family gets the same puzzle each day |
| Painted pictures | `js/scenes.js` paints detailed scenes in code. They work offline, and a "seed" number makes each one reproducible |
| My own photo | Read straight from the device. It is never uploaded anywhere |
| Surprise photo | Lorem Picsum (Unsplash photographers); free, no key |
| Family album | Optional: put pictures in `photos/` and list them in `photos.json` (see `photos.json.example`) |
| My finished puzzles | A scrapbook stored on the device (IndexedDB) |
| Music | `js/music.js` streams 1900–1925 recordings from the Internet Archive's Great 78 Project (no key needed). Old-record crackle, hiss and rumble are cleaned up live in the browser (`js/restore-worklet.js`). If the archive is unavailable, it plays a generated music box |
| Back up & move | Settings → *Back up or move my puzzles*. Painted puzzles store only their seed, piece positions are packed into bits, and everything is deflated. A backup without personal photos is a short save code / QR, so a scrapbook of 30 puzzles fits in about 1 KB. With photos, it's one small `.jigsaw` file |
| Send to family | The puzzle's "recipe" goes inside the link (`#p=…`). Short links also get a QR code |

## How sharing works (and its limits)

There is no server, so nothing can be "uploaded". Instead, everything the other person needs is put in the link:

- **Painted pictures, today's puzzle, surprise photos, family-album photos:** a short link plus a **QR code**.
  Someone in the same room can scan it with their phone camera.
- **Your own photo:** a small copy of the photo is packed into the link itself (about 40 KB). It works in
  text messages (iMessage, WhatsApp) and email, but it's too big for a QR code. The part after `#` is never
  sent to any web server, so the photo only goes where you send the link.
- **Postcard:** after finishing, send a picture of the completed puzzle with your name, time and a QR code.
- localStorage and IndexedDB only exist on one device, so they keep *your* progress and scrapbook. They
  can't share anything with other people.

## Public-domain music

In the US, sound recordings published before 1926 are public domain as of 2026, and so are songs written before 1931.
The music player only asks the Internet Archive for records dated 1925 or earlier.
Copyright rules differ in other countries.

## Files

```
index.html            page layout
css/app.css           look and feel
js/main.js            screens, menus, sharing, music controls
js/engine.js          the puzzle itself (shapes, zoomable table, drawing, touch)
js/store.js           saving on the device
js/share.js           links, QR codes, postcards
js/backup.js          compact export/import (.jigsaw file or save code)
js/scenes.js          painted pictures
js/music.js           music player
js/restore-worklet.js live 78 rpm noise clean-up (runs on the audio thread)
sw.js, manifest.webmanifest, icons/   home-screen app + offline
```
