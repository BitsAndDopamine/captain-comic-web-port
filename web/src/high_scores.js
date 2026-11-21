// COMIC.HGH semantics (0x2580): ten descending scores, strict-greater insertion.
// Browser-local JSON replaces DOS file I/O; no original score data is bundled.
export const SCORE_STORAGE_KEY = 'captain-comic.high-scores.v1';
export const SCORE_LIMIT = 10;
export const NAME_LIMIT = 12; // DOS 0Ah buffer max=13 includes the terminating CR.
const validScore = score => Number.isSafeInteger(score) && score >= 0
  && score <= 99_999_900 && score % 100 === 0;
export const cleanName = name => String(name ?? '').replace(/[^\x20-\x7e]|\$/g, '').trim().slice(0, NAME_LIMIT);
const boardName = board => board === 'practice' ? 'practice' : 'normal';

export function isPracticeSetup(options) {
  return Boolean(options && (options.items.length || ['colas', 'weapon', 'shield'].some(key => options[key] !== null)));
}

export class HighScores {
  constructor(storage = null) {
    this.storage = storage;
    this.warning = !storage;
    this.boards = { normal: [], practice: [] };
    try {
      const raw = storage?.getItem(SCORE_STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.version !== 1) throw new Error('Unsupported score data');
      for (const board of ['normal', 'practice']) {
        if (!Array.isArray(data[board])) throw new Error('Invalid score data');
        this.boards[board] = data[board].filter(row => row && typeof row.name === 'string'
          && validScore(row.score) && row.score > 0)
          .map(row => ({ name: cleanName(row.name), score: row.score }))
          .sort((a, b) => b.score - a.score).slice(0, SCORE_LIMIT);
      }
    } catch { this.warning = true; }
  }
  entries(board = 'normal') { return this.boards[boardName(board)].map(row => ({ ...row })); }
  rank(score, board = 'normal') {
    if (!validScore(score) || score === 0) return -1;
    const rows = this.boards[boardName(board)];
    const index = rows.findIndex(row => score > row.score);
    return index >= 0 ? index : rows.length < SCORE_LIMIT ? rows.length : -1;
  }
  add(name, score, board = 'normal') {
    const rank = this.rank(score, board);
    if (rank < 0) return false;
    const rows = this.boards[boardName(board)];
    rows.splice(rank, 0, { name: cleanName(name), score });
    rows.length = Math.min(rows.length, SCORE_LIMIT);
    try {
      if (!this.storage) throw new Error('Storage unavailable');
      this.storage.setItem(SCORE_STORAGE_KEY, JSON.stringify({ version: 1, ...this.boards }));
      this.warning = false;
    } catch { this.warning = true; }
    return true;
  }
}

// Menu state is independent of the DOM so pause/continue/submission are testable.
export class RunMenu {
  constructor(scores) { this.scores = scores; this.reset(); }
  reset() {
    this.mode = 'playing'; this.returnMode = 'playing'; this.board = 'normal';
    this.pending = null; this.finished = false;
  }
  get frozen() { return this.mode !== 'playing'; }
  pause() {
    if (this.mode !== 'playing') return false;
    this.mode = 'paused'; return true;
  }
  resume() {
    if (this.mode !== 'paused') return false;
    this.mode = 'playing'; return true;
  }
  showScores(board = 'normal') {
    if (this.mode === 'name' || this.mode === 'scores') return;
    this.returnMode = this.mode;
    this.board = boardName(board);
    this.mode = 'scores';
  }
  finish(score, practice = false) {
    if (this.finished || this.pending) return false;
    this.returnMode = 'gameOver';
    this.board = practice ? 'practice' : 'normal';
    this.pending = { score, board: this.board };
    this.mode = this.scores.rank(score, this.board) >= 0 ? 'name' : 'scores';
    if (this.mode === 'scores') { this.pending = null; this.finished = true; }
    return true;
  }
  submit(name) {
    if (this.mode !== 'name' || !this.pending) return false;
    this.scores.add(name, this.pending.score, this.pending.board);
    this.pending = null; this.finished = true; this.mode = 'scores';
    return true;
  }
  closeScores() {
    if (this.mode !== 'scores') return false;
    this.mode = this.returnMode === 'gameOver' ? 'playing' : this.returnMode;
    return true;
  }
}
