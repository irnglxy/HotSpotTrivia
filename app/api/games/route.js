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
          q.timeLimit || 15
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

// GET: Fetch all games or a single game with its questions
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (id) {
      // Fetch single game title
      const game = db.prepare(`SELECT * FROM games WHERE id = ?`).get(id);
      if (!game) {
        return NextResponse.json({ error: "Game not found" }, { status: 404 });
      }

      // Fetch questions for this game
      const questions = db.prepare(`SELECT * FROM questions WHERE game_id = ?`).all(id);

      // Format questions to match our frontend builder state shape
      const formattedQuestions = questions.map(q => ({
        questionText: q.question_text,
        options: [q.option_a, q.option_b, q.option_c, q.option_d],
        correctAnswer: q.correct_answer,
        timeLimit: q.time_limit
      }));

      return NextResponse.json({ game: { id: game.id, title: game.title, questions: formattedQuestions } }, { status: 200 });
    } else {
      // Fetch all games list (summary)
      const games = db.prepare(`
        SELECT games.id, games.title, COUNT(questions.id) as question_count 
        FROM games 
        LEFT JOIN questions ON games.id = questions.game_id 
        GROUP BY games.id
      `).all();

      return NextResponse.json({ games }, { status: 200 });
    }
  } catch (error) {
    console.error("Failed to fetch games:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// DELETE: Delete a game and its questions
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: "Game ID is required." }, { status: 400 });
    }

    // Delete questions first, then the game (or rely on cascade if configured)
    db.prepare(`DELETE FROM questions WHERE game_id = ?`).run(id);
    db.prepare(`DELETE FROM games WHERE id = ?`).run(id);

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Failed to delete game:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// PUT: Update an existing game and its questions
export async function PUT(request) {
  try {
    const body = await request.json();
    const { id, title, questions } = body;

    if (!id || !title || !questions || questions.length === 0) {
      return NextResponse.json({ error: "ID, title, and questions are required." }, { status: 400 });
    }

    // 1. Update game title
    db.prepare(`UPDATE games SET title = ? WHERE id = ?`).run(title, id);

    // 2. Delete old questions for this game and re-insert the updated list
    db.prepare(`DELETE FROM questions WHERE game_id = ?`).run(id);

    const insertQuestion = db.prepare(`
      INSERT INTO questions (game_id, question_text, option_a, option_b, option_c, option_d, correct_answer, time_limit) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((qs) => {
      for (const q of qs) {
        insertQuestion.run(
          id, 
          q.questionText, 
          q.options[0], 
          q.options[1], 
          q.options[2], 
          q.options[3], 
          q.correctAnswer, 
          q.timeLimit || 15
        );
      }
    });

    insertMany(questions);

    return NextResponse.json({ success: true, gameId: id }, { status: 200 });

  } catch (error) {
    console.error("Failed to update game:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}