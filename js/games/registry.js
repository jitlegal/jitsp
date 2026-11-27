// Every game the app knows. Adding a game = writing js/games/<id>.js (see GAMES.md) and listing it here.
import jigsaw from './jigsaw.js';
// Optional games load defensively: a missing or broken game file must never take the whole app down.
let solitaire = null;
try{ solitaire = (await import('./solitaire.js')).default; }catch(e){ console.warn('Solitaire unavailable', e); }

export const GAMES = [jigsaw, solitaire].filter(g => g && typeof g.create === 'function' && typeof g.normalize === 'function');
const byId = new Map(GAMES.map(g => [g.id, g]));

/** Links and saves made before games existed have no `g`: they are jigsaw puzzles. */
export const gameOf = recipe => byId.get(recipe && typeof recipe.g === 'string' ? recipe.g : 'jigsaw') || null;
export const getGame = id => byId.get(id) || null;
