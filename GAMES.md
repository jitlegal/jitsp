# Game plug-in interface

Every game is one ES module in `js/games/<id>.js` with a default export, listed in
`js/games/registry.js`. The shell (`js/main.js`) owns everything shared: home screen, dialogs,
settings, music, sharing (link + QR + postcard), saving, scrapbook, backups and offline support.
A game owns only its play area.

No build step. Third-party code only from a CDN (pinned + SRI). Everything must work offline
once installed, so games should avoid network dependencies.

## The module

```js
export default {
  id: 'solitaire',                 // short, stable: it is stored in links, saves and backups
  name: 'Solitaire', emoji: '🃏',
  blurb: 'Classic patience — tap a card to move it',
  usesPicture: false,              // true → the shell prepares a picture and passes it to load()
  zoomable: false,                 // default; an instance can report otherwise through hooks.onZoomable

  // Choices shown before starting (the shell draws big buttons; values must be JSON-safe).
  options: [{ key:'draw', label:'Turn over', choices:[[1,'One card (easier)'],[3,'Three cards']], default:1 }],

  /** A new game. seed: 31-bit int. opts: chosen options. Must include g: id. Small and JSON-safe. */
  newRecipe(seed, opts) { return { g:'solitaire', s:seed, d:opts.draw }; },

  /** Untrusted recipe from a shared link or backup → a clean recipe, or null if unusable.
   *  Validate every field's type and range; drop anything unknown. Never throw. */
  normalize(r) { … },

  title(recipe),                    // e.g. "Solitaire · deal 4821"
  progressLabel(done, total),       // e.g. "12 of 52 cards home"
  finishText(recipe, seconds, stats) // e.g. "You won in 143 moves and 9 minutes!"

  /** Mount a game into host (an empty, absolutely sized <div>). Returns an instance. */
  create(host, hooks),
};
```

### Instance

```js
{
  async load(recipe, { image, state }),  // state: whatever state() returned earlier, or undefined
  state(),                // JSON-safe snapshot to resume later (called after every change)
  progress(),             // { done, total }
  get done(),             // finished?
  help(),                 // the 💡 "Help me" button (always shown)
  undo?(),                // optional → shows ↩️ Undo
  tidy?(), setPeek?(on),  // optional → shows 🧹 Tidy / 👀 Show picture
  zoomIn?(), zoomOut?(), showAll?(),     // optional zoom controls (shown while zoomable)
  stats?(),               // e.g. { moves } for finishText and the scrapbook
  snapshot?(),            // a canvas picture of the finished game (scrapbook + postcard)
  resize(),               // the play area changed size
  destroy(),              // remove listeners/DOM; the shell empties host afterwards
}
```

### Hooks (from the shell)

```
onProgress(done, total)   update the counter
onChange()                something changed → the shell saves state()
onComplete()              the game is won/finished (call once)
onPlace(last)             a satisfying "it fits" moment → chime/vibrate
onTouch()                 any touch (hides tips)
onZoomable(bool)          show/hide zoom buttons
```

## Rules for every game

- Grandparent-first: touch targets ≥ 44 px (prefer 56+), text ≥ 18 px, high contrast, nothing
  time-pressured, tap-to-act as well as drag, a wobbly tap (≤ 16 px movement) is still a tap,
  Help is always available, Undo where it makes sense.
- Deterministic from the recipe: the same recipe gives the same game on every device (seeded rng).
- `normalize()` treats input as hostile. Text from the recipe is shown with textContent only.
- No `innerHTML` with dynamic data. No network calls. No `Math.random` for anything shareable.
- Saves are per shell: one game in progress at a time. state() must be small (< 50 KB).
