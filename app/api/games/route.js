import { NextResponse } from 'next/server';
import db from '@/lib/db';

// POST: Save a new game and its questions
export async function POST(request) {
  try {
    const body = await request.json();
    const { title, questions } = body;

    if (!title || !questions || questions.length === 0) {
      return NextResponse.json({ error: "Title and questions are required." }, { status: 400 });
    }

    const insertGame = db.prepare(`INSERT INTO games (title) VALUES (?)`);
    const gameResult = insertGame.run(title);
    const gameId = gameResult.lastInsertRowid;

    const insertQuestion = db.prepare(`
      INSERT INTO questions (game_id, question_text, option_a, option_b, option_c, option_d, correct_answer, time_limit) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((qs) => {
      for (const q of qs) {
        insertQuestion.run(
          gameId, 
          q.questionText, 
          q.options[0], 
          q.options[1], 
          q.options[2], 
          q.options[3], 
          q.correctAnswer, 
          q.timeLimit
        );
      }
    });

    insertMany(questions);

    return NextResponse.json({ success: true, gameId: gameId }, { status: 201 });

  } catch (error) {
    console.error("Failed to save game:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// GET: Fetch all saved games
export async function GET() {
  try {
    const stmt = db.prepare(`
      SELECT games.id, games.title, COUNT(questions.id) as question_count 
      FROM games 
      LEFT JOIN questions ON games.id = questions.game_id 
      GROUP BY games.id
    `);
    const games = stmt.all();

    return NextResponse.json({ games }, { status: 200 });
  } catch (error) {
    console.error("Failed to fetch games:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}