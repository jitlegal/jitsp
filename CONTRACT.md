# Overhaul contract (shared between lead + pair-programmer)

No build step. Our own code = plain ES modules (`<script type="module">`), served as static files
(GitHub Pages / Netlify). No API keys, no accounts, no trackers.
THIRD-PARTY CODE: CDN imports ONLY (user requirement) — pinned exact version + SRI, e.g.
<script src="https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js" integrity="sha384-…" crossorigin="anonymous">.
Never copy/vendor library files into the repo.

## Ownership (do not edit the other person's files)
- LEAD: index.html, css/app.css, js/main.js, js/engine.js, js/share.js, js/store.js, sw.js,
  manifest.webmanifest, icons/, README.md
- PAIR: js/music.js, js/scenes.js, music-test.html, scenes-test.html (test harnesses)

## js/scenes.js  (PAIR)
Procedural, offline, deterministic paintings. Same (id, seed) => same pixels on every device
(only use the seeded rng passed around; no Math.random, no Date, no fonts/text).
```
export const SCENES: Array<{id:string, name:string, emoji:string}>
   // friendly names, at least 8: e.g. mountains, seaside, garden, cottage, night sky,
   // autumn woods, quilt (patchwork), hot-air balloons, lighthouse, birds on a branch, tulip fields
export function paintScene(id:string, seed:number, w=1600, h=1200): HTMLCanvasElement
export function sceneName(id): string
export function pickScene(seed:number): string        // deterministic id from a seed (used by daily puzzle)
```
Design goals for jigsaws: lots of distinct colour regions and detail everywhere (no huge flat
areas), cheerful, high contrast, readable for older eyes. Each paint < 150 ms on a laptop.

## js/music.js  (PAIR)
Public-domain background music, live from Internet Archive (CORS open, no key):
- search: https://archive.org/advancedsearch.php?q=collection:georgeblood AND year:[1900 TO 1925] ...&output=json
  (numFound ~28k; pick random `page`/`start` for variety; can add subject/title filters per station)
- files:  https://archive.org/metadata/{identifier}  -> pick the .mp3; play from
  https://archive.org/download/{identifier}/{encodeURIComponent(name)}
- US public domain rule used: sound recordings published before 1926 (as of 2026). Keep year <= 1925.
Fallback when offline/blocked/errors: a gentle generative "music box" via WebAudio (original, no samples).
```
export const STATIONS: Array<{id:string, name:string, emoji:string, blurb:string}>
   // e.g. 'parlor' (1900-1925 popular songs & dance bands), 'strings' (violin/orchestral/waltz),
   // 'piano', 'musicbox' (offline generative). Choose queries that actually return good results.
export function createMusic({onTrack, onState}): {
  play(stationId?): Promise<void>,   // must be called from a user gesture the first time
  stop(): void, next(): void, toggle(): void,
  setVolume(0..1): void, get volume(), get playing(): boolean, get station(): string
}
onTrack({title, artist, year, url /* archive.org details page */, station})
onState('loading'|'playing'|'paused'|'error'|'offline')
```
Requirements: preload next track; skip tracks that fail or are < 60 s or > 8 min; avoid repeats in a
session; gentle fade in/out (~1.5 s); default volume 0.5; persist on/off + station + volume in
localStorage key 'jig.music'; never autoplay without a prior user gesture; no console errors.

## Engine / main (LEAD) consume these exactly as written above.
