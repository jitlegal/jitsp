// Every game the app knows. Adding a game = writing js/games/<id>.js (see GAMES.md) and listing it here.
import jigsaw from './jigsaw.js';
// Optional games load defensively: a missing or broken game file must never take the whole app down.
const load = async (file, name) => { try{ return (await import(file)).default; }catch(e){ console.warn(name + ' unavailable', e); return null; } };
// Ordered by what adults 50+ play most (AARP 2023): puzzle & logic, card & tile, word games.
const [solitaire, sudoku, words, tiles, freecell, memory, trivia] = await Promise.all([load('./solitaire.js', 'Solitaire'), load('./sudoku.js', 'Sudoku'), load('./words.js', 'Word Search'),
  load('./tiles.js', 'Tile Match'), load('./freecell.js', 'FreeCell'), load('./memory.js', 'Memory'), load('./trivia.js', 'Trivia')]);

export const GAMES = [jigsaw, solitaire, tiles, words, sudoku, freecell, memory, trivia].filter(g => g && typeof g.create === 'function' && typeof g.normalize === 'function');
const byId = new Map(GAMES.map(g => [g.id, g]));

/** Links and saves made before games existed have no `g`: they are jigsaw puzzles. */
export const gameOf = recipe => byId.get(recipe && typeof recipe.g === 'string' ? recipe.g : 'jigsaw') || null;
export const getGame = id => byId.get(id) || null;
