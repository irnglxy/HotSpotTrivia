import Database from 'better-sqlite3';

// This creates a local file named 'database.sqlite' in your root folder
const db = new Database('database.sqlite');

// Setup tables immediately when the app starts
db.exec(`
  CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT
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
    time_limit INTEGER,
    FOREIGN KEY (game_id) REFERENCES games(id)
  )
`);

export default db;