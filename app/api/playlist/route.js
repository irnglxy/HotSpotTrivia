import { NextResponse } from 'next/server';
import db from '@/lib/db';
import hostAuth from '@/lib/host-auth.cjs';

const authorized = (request) => hostAuth.isAuthorizedCookie(request.headers.get('cookie'));

export async function GET(request) {
  if (!authorized(request)) return NextResponse.json({ error: 'Host sign-in required.' }, { status: 401 });
  const games = db.prepare('SELECT * FROM games ORDER BY display_order ASC, id ASC').all();
  const questions = db.prepare('SELECT * FROM questions ORDER BY id ASC').all();
  return NextResponse.json({ format: 'hotspot-playlist', version: 1, exportedAt: new Date().toISOString(), games: games.map((game) => ({ ...game, questions: questions.filter((question) => question.game_id === game.id).map((question) => { const copy = { ...question }; delete copy.id; delete copy.game_id; return copy; }) })) });
}

export async function POST(request) {
  if (!authorized(request)) return NextResponse.json({ error: 'Host sign-in required.' }, { status: 401 });
  try {
    const playlist = await request.json();
    if (playlist?.format !== 'hotspot-playlist' || !Array.isArray(playlist.games)) throw new Error('That is not a Hot Spot playlist file.');
    const nextOrder = db.prepare('SELECT COALESCE(MAX(display_order), 0) AS current_order FROM games').get().current_order;
    const insertGame = db.prepare('INSERT INTO games (title, game_type, display_order) VALUES (?, ?, ?)');
    const insertQuestion = db.prepare('INSERT INTO questions (game_id, question_text, option_a, option_b, option_c, option_d, correct_answer, correct_number, answer_min, answer_max, answer_step, herd_mode, simon_sequence, autocomplete_answers, scramble_letters, pitch_points, time_limit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    db.transaction(() => playlist.games.forEach((game, gameIndex) => {
      const gameId = insertGame.run(game.title || 'Untitled Game', game.game_type || 'trivia', nextOrder + gameIndex + 1).lastInsertRowid;
      (game.questions || []).forEach((question) => insertQuestion.run(gameId, question.question_text, question.option_a, question.option_b, question.option_c, question.option_d, question.correct_answer, question.correct_number, question.answer_min, question.answer_max, question.answer_step, question.herd_mode || 'most', question.simon_sequence, question.autocomplete_answers, question.scramble_letters, question.pitch_points, question.time_limit || 15));
    }))();
    return NextResponse.json({ success: true, imported: playlist.games.length });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Could not import playlist.' }, { status: 400 });
  }
}
