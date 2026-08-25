import Database from 'better-sqlite3';

// Local development uses the project file; Render can point this at its persistent disk.
const db = new Database(process.env.DATABASE_PATH || 'database.sqlite');

// Setup tables immediately when the app starts
db.exec(`
  CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    game_type TEXT DEFAULT 'trivia'
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER,
    question_text TEXT,
    option_a TEXT,
    option_b TEXT,
    option_c TEXT,
    option_d TEXT,
    correct_answer TEXT,
    correct_number REAL,
    answer_min REAL,
    answer_max REAL,
    answer_step REAL,
    herd_mode TEXT DEFAULT 'most',
    simon_sequence TEXT,
    autocomplete_answers TEXT,
    scramble_letters TEXT,
    pitch_points INTEGER,
    timeline_items TEXT,
    timeline_top_label TEXT,
    timeline_bottom_label TEXT,
    time_limit INTEGER,
    FOREIGN KEY (game_id) REFERENCES games(id)
  )
`);

const ensureColumn = (table, column, definition) => {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((existing) => existing.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
};

ensureColumn('games', 'game_type', "TEXT DEFAULT 'trivia'");
ensureColumn('games', 'display_order', 'INTEGER');
ensureColumn('questions', 'correct_number', 'REAL');
ensureColumn('questions', 'answer_min', 'REAL');
ensureColumn('questions', 'answer_max', 'REAL');
ensureColumn('questions', 'answer_step', 'REAL');
ensureColumn('questions', 'herd_mode', "TEXT DEFAULT 'most'");
ensureColumn('questions', 'simon_sequence', 'TEXT');
ensureColumn('questions', 'autocomplete_answers', 'TEXT');
ensureColumn('questions', 'scramble_letters', 'TEXT');
ensureColumn('questions', 'pitch_points', 'INTEGER');
ensureColumn('questions', 'timeline_items', 'TEXT');
ensureColumn('questions', 'timeline_top_label', 'TEXT');
ensureColumn('questions', 'timeline_bottom_label', 'TEXT');

export default db;
