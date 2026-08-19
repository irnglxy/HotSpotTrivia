const { createServer } = require('node:http');
const next = require('next');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');

const dev = process.env.NODE_ENV !== 'production';
const hostname = '0.0.0.0'; // Must be 0.0.0.0 for cloud hosting
const port = process.env.PORT || 3000; // Cloud hosts assign a dynamic port

const app = next({ dev, hostname, port });
const handler = app.getRequestHandler();

const db = new Database('database.sqlite');

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((existing) => existing.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn('games', 'game_type', "TEXT DEFAULT 'trivia'");
ensureColumn('games', 'display_order', 'INTEGER');
ensureColumn('questions', 'correct_number', 'REAL');
ensureColumn('questions', 'answer_min', 'REAL');
ensureColumn('questions', 'answer_max', 'REAL');
ensureColumn('questions', 'answer_step', 'REAL');
ensureColumn('questions', 'herd_mode', "TEXT DEFAULT 'most'");
ensureColumn('questions', 'simon_sequence', 'TEXT');

app.prepare().then(() => {
  const httpServer = createServer(handler);
  const io = new Server(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    allowEIO3: true
  });

  // Global Master Party Room State
  const MASTER_ROOM = "PARTY";
  const partyState = {
    hostId: null,
    signupsOpen: true,
    players: [], // { id, name, emoji, color, score }
    status: 'lobby', // 'lobby', 'playing', 'results', 'game-over'
    currentGameId: null,
    gameTitle: null,
    introTimer: null,
    questions: [],
    currentQuestionIndex: 0,
    questionStartTime: null,
    questionTimer: null,
    questionExpired: false,
    answersThisRound: {},
    previousRanks: null,
    pickerRun: null,
    pickerTimer: null,
    lastBreakdown: null,
    lastWinner: null
  };

  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

// Display screen joins the master party room to watch the action
    socket.on('join-display-screen', () => {
      socket.join(MASTER_ROOM);
      // Immediately send current state to the display screen in case a game is already running or in lobby
      socket.emit('master-update', { 
        players: partyState.players, 
        status: partyState.status,
        signupsOpen: partyState.signupsOpen
      });
      if (partyState.status === 'playing' && partyState.questions.length > 0) {
        const q = partyState.questions[partyState.currentQuestionIndex];
        socket.emit('next-question', buildQuestionPayload(partyState, q));
      } else if (partyState.status === 'intro') {
        socket.emit('game-intro', { title: partyState.gameTitle, gameType: partyState.questions[0]?.game_type || 'trivia' });
      } else if (partyState.status === 'answer-reveal' && partyState.lastBreakdown) {
        socket.emit('answer-breakdown', partyState.lastBreakdown);
      } else if (partyState.status === 'results' && partyState.questions.length > 0) {
        const q = partyState.questions[partyState.currentQuestionIndex];
        socket.emit('round-results', buildRoundResultsPayload(partyState, q));
      } else if (partyState.status === 'winner-reveal' && partyState.lastWinner) {
        socket.emit('winner-reveal', partyState.lastWinner);
      } else if (partyState.status === 'game-over') {
        socket.emit('game-over', {
          players: [...partyState.players].sort((a, b) => b.score - a.score)
        });
      } else if (partyState.status === 'picker-selecting' && partyState.pickerRun) {
        socket.emit('player-picker-start', partyState.pickerRun);
      } else if (partyState.status === 'picker-result' && partyState.pickerRun) {
        socket.emit('player-picker-result', { players: partyState.pickerRun.selectedPlayers });
      }
      console.log(`Big Screen Display connected: ${socket.id}`);
    });

    // Host initializes or reconnects to the master lobby
    socket.on('host-master-lobby', () => {
      partyState.hostId = socket.id;
      socket.join(MASTER_ROOM);
      socket.emit('master-update', { 
        players: partyState.players, 
        status: partyState.status,
        signupsOpen: partyState.signupsOpen
      });
      console.log(`Host registered on master lobby.`);
    });

    // Player joins the master lobby once for the whole night
    socket.on('join-master-lobby', ({ playerName, emoji, color, playerKey }, callback) => {
      if (!partyState.signupsOpen) {
        callback({ success: false, error: 'The room is closed for the night.' });
        return;
      }
      socket.join(MASTER_ROOM);
      
      // A browser keeps its player key, so refreshing it updates the same player.
      const existingPlayer = partyState.players.find(p => p.id === socket.id || (playerKey && p.playerKey === playerKey));
      if (existingPlayer) {
        existingPlayer.id = socket.id;
        existingPlayer.name = playerName;
        existingPlayer.emoji = emoji || '🎮';
        existingPlayer.color = color || '#a855f7';
      } else {
        partyState.players.push({
          id: socket.id,
          playerKey,
          name: playerName,
          emoji: emoji || '🎮',
          color: color || '#a855f7',
          score: 0
        });
      }

      // Broadcast updated player list to host and all players
      io.to(MASTER_ROOM).emit('update-players', { players: partyState.players });
      callback({ success: true });
      console.log(`${emoji} ${playerName} joined the master party!`);
    });

    socket.on('set-signups-open', ({ open }, callback) => {
      if (socket.id !== partyState.hostId) return callback?.({ success: false });
      partyState.signupsOpen = Boolean(open);
      if (!partyState.signupsOpen) {
        const playerIds = partyState.players.map((player) => player.id);
        io.to(MASTER_ROOM).emit('room-closed');
        playerIds.forEach((playerId) => io.sockets.sockets.get(playerId)?.leave(MASTER_ROOM));
        partyState.players = [];
        io.to(MASTER_ROOM).emit('update-players', { players: [] });
      } else {
        io.emit('room-opened');
      }
      callback?.({ success: true, signupsOpen: partyState.signupsOpen });
    });

    // Only the host can rename a player from the dashboard.
    socket.on('rename-player', ({ playerId, playerName }, callback) => {
      if (socket.id !== partyState.hostId) {
        callback?.({ success: false, error: 'Only the host can rename players.' });
        return;
      }

      const name = playerName?.trim().slice(0, 15);
      const player = partyState.players.find((candidate) => candidate.id === playerId);
      if (!player || !name) {
        callback?.({ success: false, error: 'Enter a valid player name.' });
        return;
      }

      player.name = name;
      io.to(MASTER_ROOM).emit('update-players', { players: partyState.players });
      callback?.({ success: true });
    });

    // Host selects a game and loads questions, resetting scores for this new game
    socket.on('load-game', ({ gameId }) => {
      partyState.currentGameId = gameId;
      partyState.gameTitle = db.prepare('SELECT title FROM games WHERE id = ?').get(gameId)?.title || 'Next Round';
      
      // Reset all player scores to 0 for this standalone game
      partyState.players.forEach(p => p.score = 0);

      const stmt = db.prepare('SELECT questions.*, games.game_type FROM questions JOIN games ON games.id = questions.game_id WHERE questions.game_id = ?');
      partyState.questions = stmt.all(gameId);
      partyState.currentQuestionIndex = 0;
      partyState.previousRanks = null;
      partyState.status = 'lobby';

      io.to(MASTER_ROOM).emit('game-loaded', { 
        totalQuestions: partyState.questions.length,
        players: partyState.players 
      });
      console.log(`Loaded game ID ${gameId} with ${partyState.questions.length} questions. Scores reset.`);
    });

    // Host clicks "Start Game"
    socket.on('start-game', () => {
      if (partyState.questions.length === 0) return;
      partyState.status = 'intro';
      partyState.currentQuestionIndex = 0;
      partyState.previousRanks = null;
      io.to(MASTER_ROOM).emit('game-intro', { title: partyState.gameTitle, gameType: partyState.questions[0].game_type || 'trivia' });
    });

    socket.on('begin-first-question', () => {
      if (socket.id !== partyState.hostId || partyState.status !== 'intro') return;
      if (partyState.questions[0]?.game_type === 'player-picker') {
        partyState.status = 'picker-setup';
        io.to(MASTER_ROOM).emit('player-picker-setup', { totalPlayers: partyState.players.length });
        return;
      }
      partyState.status = 'playing';
      sendNextQuestion(io, partyState);
    });

    socket.on('start-player-picker', ({ count }, callback) => {
      if (socket.id !== partyState.hostId || partyState.status !== 'picker-setup') {
        callback?.({ success: false, error: 'The picker is not ready to start.' });
        return;
      }
      const selectedCount = Number(count);
      if (!Number.isInteger(selectedCount) || selectedCount < 1 || selectedCount > partyState.players.length) {
        callback?.({ success: false, error: 'Choose a valid number of players.' });
        return;
      }
      const shuffledPlayers = [...partyState.players];
      for (let index = shuffledPlayers.length - 1; index > 0; index--) {
        const randomIndex = Math.floor(Math.random() * (index + 1));
        [shuffledPlayers[index], shuffledPlayers[randomIndex]] = [shuffledPlayers[randomIndex], shuffledPlayers[index]];
      }
      const selectedPlayers = shuffledPlayers.slice(0, selectedCount);
      const eliminatedPlayerIds = shuffledPlayers.slice(selectedCount).map((player) => player.id);
      partyState.status = 'picker-selecting';
      partyState.pickerRun = { players: partyState.players, selectedPlayers, eliminatedPlayerIds, duration: 10000 };
      io.to(MASTER_ROOM).emit('player-picker-start', partyState.pickerRun);
      clearTimeout(partyState.pickerTimer);
      partyState.pickerTimer = setTimeout(() => {
        if (partyState.status !== 'picker-selecting') return;
        partyState.status = 'picker-result';
        io.to(MASTER_ROOM).emit('player-picker-result', { players: selectedPlayers });
      }, 10000);
      callback?.({ success: true });
    });

    // Host ends the question (timer may still be running) and shows answer distribution
    socket.on('reveal-answers', () => {
      revealAnswers(io, partyState);
    });

    socket.on('score-shot-in-the-dark', ({ correctNumber }, callback) => {
      scoreShotInTheDark(io, partyState, correctNumber, socket, callback);
    });

    // Host moves from answer chart to the round leaderboard (non-final questions)
    socket.on('show-scores', () => {
      showScores(io, partyState);
    });

    // After the last question's vote chart, host starts the winner reveal
    socket.on('reveal-winner', () => {
      revealWinner(io, partyState);
    });

    // After the winner is shown, host opens the full standings
    socket.on('show-final-scores', () => {
      showFinalScores(io, partyState);
    });

    // Host closes the final scoreboard and returns every screen to the party lobby
    socket.on('end-game', () => {
      endGame(io, partyState);
    });

    // Host clicks "Next Question"
    socket.on('next-question-btn', () => {
      partyState.currentQuestionIndex++;

      if (partyState.currentQuestionIndex < partyState.questions.length) {
        partyState.status = 'playing';
        sendNextQuestion(io, partyState);
      }
    });

    // Player submits an answer
    socket.on('submit-answer', ({ answer }) => {
      if (partyState.status !== 'playing') return;
      if (partyState.questionExpired) return;
      if (partyState.answersThisRound[socket.id]) return; // prevent double submission

      const q = partyState.questions[partyState.currentQuestionIndex];
      const isShotInTheDark = q.game_type === 'shot-in-the-dark';
      const isFollowTheHerd = q.game_type === 'follow-the-herd';
      const isSimonSays = q.game_type === 'simon-says';
      const numericAnswer = Number(answer);
      if (isShotInTheDark && (!Number.isFinite(numericAnswer) || numericAnswer < q.answer_min || numericAnswer > q.answer_max)) return;
      const simonSequence = isSimonSays ? JSON.parse(q.simon_sequence || '[]') : [];
      if (isSimonSays && (!Array.isArray(answer) || simonSequence.length === 0 || answer.length !== simonSequence.length || answer.some((color) => !['red', 'green', 'blue', 'orange'].includes(color)))) return;

      const timeTaken = (Date.now() - partyState.questionStartTime) / 1000;
      const timeLimit = q.time_limit || 30;
      const isCorrect = isSimonSays
        ? answer.every((color, index) => color === simonSequence[index])
        : !isShotInTheDark && !isFollowTheHerd && answer === q.correct_answer;
      const correctSimonColors = isSimonSays
        ? answer.filter((color, index) => color === simonSequence[index]).length
        : 0;
      const pointsEarned = isSimonSays
        ? (correctSimonColors * 50) + (isCorrect ? 250 + Math.round(250 * Math.max(0, 1 - (timeTaken / timeLimit))) : 0)
        : isCorrect ? Math.round(500 + (500 * Math.max(0, 1 - (timeTaken / timeLimit)))) : 0;

      partyState.answersThisRound[socket.id] = { answer: isShotInTheDark ? numericAnswer : answer, isCorrect, pointsEarned, timeTaken };

      const player = partyState.players.find(p => p.id === socket.id);
      if (player && !isShotInTheDark && !isFollowTheHerd) {
        player.score += pointsEarned;
      }

      // Notify host how many answered (round stays open until the host reveals)
      if (partyState.hostId) {
        io.to(partyState.hostId).emit('player-answered-update', {
          totalAnswers: Object.keys(partyState.answersThisRound).length,
          totalPlayers: partyState.players.length
        });
      }
    });

    socket.on('disconnect', () => {
      console.log(`User disconnected: ${socket.id}`);
      // Optional: keep them in the list or filter them out. 
      // Keeping them allows players to reconnect if their phone refreshes.
    });
  });

  httpServer.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
  });
});

function buildQuestionPayload(partyState, q) {
  return {
    gameType: q.game_type || 'trivia',
    questionNumber: partyState.currentQuestionIndex + 1,
    totalQuestions: partyState.questions.length,
    questionText: q.question_text,
    options: [q.option_a, q.option_b, q.option_c, q.option_d],
    answerMin: q.answer_min,
    answerMax: q.answer_max,
    answerStep: q.answer_step,
    herdMode: q.herd_mode || 'most',
    simonSequenceLength: q.game_type === 'simon-says' ? JSON.parse(q.simon_sequence || '[]').length : undefined,
    timeLimit: q.time_limit || 15,
    isLastQuestion: partyState.currentQuestionIndex === partyState.questions.length - 1
  };
}

function sendNextQuestion(io, partyState) {
  const q = partyState.questions[partyState.currentQuestionIndex];
  const questionIndex = partyState.currentQuestionIndex;

  partyState.previousRanks = partyState.currentQuestionIndex === 0 ? null : buildRankMap(partyState.players);
  partyState.questionStartTime = Date.now();
  clearTimeout(partyState.introTimer);
  partyState.questionExpired = false;
  clearTimeout(partyState.questionTimer);
  partyState.answersThisRound = {};
  partyState.lastBreakdown = null;
  partyState.lastWinner = null;

  io.to("PARTY").emit('next-question', buildQuestionPayload(partyState, q));
  partyState.questionTimer = setTimeout(() => {
    if (partyState.status === 'playing' && partyState.currentQuestionIndex === questionIndex) {
      partyState.questionExpired = true;
      io.to("PARTY").emit('question-time-up');
    }
  }, (q.time_limit || 15) * 1000);
}

function revealAnswers(io, partyState) {
  if (partyState.status !== 'playing') return;
  partyState.questionExpired = true;
  clearTimeout(partyState.questionTimer);

  const q = partyState.questions[partyState.currentQuestionIndex];
  if (q.game_type === 'shot-in-the-dark') {
    partyState.status = 'answer-entry';
    io.to(partyState.hostId).emit('request-correct-number', {
      questionText: q.question_text,
      correctNumber: q.correct_number ?? ''
    });
    return;
  }

  if (q.game_type === 'simon-says') {
    partyState.status = 'answer-reveal';
    const payload = {
      gameType: 'simon-says',
      simonSequence: JSON.parse(q.simon_sequence || '[]'),
      totalAnswers: Object.keys(partyState.answersThisRound).length,
      totalPlayers: partyState.players.length,
      questionNumber: partyState.currentQuestionIndex + 1,
      totalQuestions: partyState.questions.length,
      isLastQuestion: partyState.currentQuestionIndex === partyState.questions.length - 1
    };
    partyState.lastBreakdown = payload;
    io.to('PARTY').emit('answer-breakdown', payload);
    return;
  }

  partyState.status = 'answer-reveal';
  const counts = { A: 0, B: 0, C: 0, D: 0 };
  Object.values(partyState.answersThisRound).forEach((entry) => {
    if (counts[entry.answer] !== undefined) counts[entry.answer]++;
  });

  const isFollowTheHerd = q.game_type === 'follow-the-herd';
  const herdMode = q.herd_mode === 'least' ? 'least' : 'most';
  let winningAnswers = [];
  if (isFollowTheHerd) {
    const selectedCounts = Object.entries(counts).filter(([, count]) => count > 0);
    if (selectedCounts.length > 0) {
      const targetCount = herdMode === 'least'
        ? Math.min(...selectedCounts.map(([, count]) => count))
        : Math.max(...selectedCounts.map(([, count]) => count));
      winningAnswers = selectedCounts
        .filter(([, count]) => count === targetCount)
        .map(([answer]) => answer);

      Object.entries(partyState.answersThisRound).forEach(([playerId, entry]) => {
        if (!winningAnswers.includes(entry.answer)) return;
        const pointsEarned = Math.round(500 + (500 * Math.max(0, 1 - (entry.timeTaken / (q.time_limit || 15)))));
        entry.pointsEarned = pointsEarned;
        const player = partyState.players.find((candidate) => candidate.id === playerId);
        if (player) player.score += pointsEarned;
      });
    }
  }

  const payload = {
    gameType: q.game_type || 'trivia',
    questionText: q.question_text,
    options: [q.option_a, q.option_b, q.option_c, q.option_d],
    counts,
    totalAnswers: Object.keys(partyState.answersThisRound).length,
    totalPlayers: partyState.players.length,
    correctAnswer: q.correct_answer,
    herdMode,
    winningAnswers,
    questionNumber: partyState.currentQuestionIndex + 1,
    totalQuestions: partyState.questions.length,
    isLastQuestion: partyState.currentQuestionIndex === partyState.questions.length - 1
  };

  partyState.lastBreakdown = payload;
  io.to("PARTY").emit('answer-breakdown', payload);
}

function scoreShotInTheDark(io, partyState, correctNumber, socket, callback) {
  if (socket.id !== partyState.hostId) {
    callback?.({ success: false, error: 'Only the host can score this question.' });
    return;
  }
  if (partyState.status !== 'answer-entry') {
    callback?.({ success: false, error: 'This question is no longer waiting for an answer.' });
    return;
  }
  const q = partyState.questions[partyState.currentQuestionIndex];
  const correct = Number(correctNumber);
  if (q.game_type !== 'shot-in-the-dark' || !Number.isFinite(correct)) {
    callback?.({ success: false, error: 'Enter a valid correct number.' });
    return;
  }

  db.prepare('UPDATE questions SET correct_number = ? WHERE id = ?').run(correct, q.id);
  q.correct_number = correct;
  const answerRange = Math.abs(q.answer_max - q.answer_min);
  const rangeTolerance = answerRange * 0.2;
  const correctValueTolerance = Math.abs(correct) * 0.2;
  const scoringTolerance = correctValueTolerance === 0 ? rangeTolerance : Math.min(correctValueTolerance, rangeTolerance);
  const guesses = Object.entries(partyState.answersThisRound).map(([playerId, entry]) => {
    const difference = Math.abs(entry.answer - correct);
    const pointsEarned = difference === 0 ? 1200 : scoringTolerance > 0 && difference <= scoringTolerance ? Math.round(100 + 800 * (1 - difference / scoringTolerance)) : 0;
    entry.pointsEarned = pointsEarned;
    const player = partyState.players.find((candidate) => candidate.id === playerId);
    if (player) player.score += pointsEarned;
    return { playerId, name: player?.name || 'Player', emoji: player?.emoji || '🎮', answer: entry.answer, pointsEarned, difference };
  });

  partyState.status = 'answer-reveal';
  const payload = {
    gameType: 'shot-in-the-dark', questionText: q.question_text, correctNumber: correct,
    guesses, totalAnswers: guesses.length, totalPlayers: partyState.players.length,
    questionNumber: partyState.currentQuestionIndex + 1, totalQuestions: partyState.questions.length,
    isLastQuestion: partyState.currentQuestionIndex === partyState.questions.length - 1
  };
  partyState.lastBreakdown = payload;
  io.to("PARTY").emit('answer-breakdown', payload);
  callback?.({ success: true, payload });
}

function buildRoundResultsPayload(partyState, q) {
  const isLastQuestion = partyState.currentQuestionIndex === partyState.questions.length - 1;
  const currentRanks = buildRankMap(partyState.players);
  return {
    gameType: q.game_type || 'trivia',
    correctAnswer: q.correct_answer,
    options: [q.option_a, q.option_b, q.option_c, q.option_d],
    correctNumber: q.correct_number,
    herdMode: q.herd_mode || 'most',
    simonSequence: q.simon_sequence ? JSON.parse(q.simon_sequence) : [],
    players: partyState.players.map((player) => ({
      ...player,
      rankChange: partyState.previousRanks ? partyState.previousRanks.get(player.id) - currentRanks.get(player.id) : null
    })),
    isLastQuestion,
    isFinalQuestionNext: !isLastQuestion && (partyState.currentQuestionIndex + 1 === partyState.questions.length - 1),
    nextQuestionNumber: partyState.currentQuestionIndex + 2,
    totalQuestions: partyState.questions.length
  };
}

function buildRankMap(players) {
  return new Map([...players]
    .sort((a, b) => b.score - a.score)
    .map((player, index) => [player.id, index + 1]));
}

function showScores(io, partyState) {
  if (partyState.status !== 'answer-reveal') return;
  partyState.status = 'results';

  const q = partyState.questions[partyState.currentQuestionIndex];
  io.to("PARTY").emit('round-results', buildRoundResultsPayload(partyState, q));
}

function buildWinnerPayload(partyState) {
  const ranked = [...partyState.players].sort((a, b) => b.score - a.score);
  const topScore = ranked[0] ? ranked[0].score : 0;
  const winners = ranked.filter((p) => p.score === topScore && ranked.length > 0);
  let previousScore = null;
  let previousPlace = null;
  const podium = ranked
    .map((player, index) => {
      const place = player.score === previousScore ? previousPlace : index + 1;
      previousScore = player.score;
      previousPlace = place;
      return { ...player, place };
    })
    .filter((player) => player.place <= 3);

  return { winners, players: ranked, podium };
}

function revealWinner(io, partyState) {
  if (partyState.status !== 'answer-reveal') return;
  partyState.status = 'winner-reveal';
  partyState.lastWinner = buildWinnerPayload(partyState);
  io.to("PARTY").emit('winner-reveal', partyState.lastWinner);
}

function showFinalScores(io, partyState) {
  if (partyState.status !== 'winner-reveal') return;
  partyState.status = 'game-over';
  io.to("PARTY").emit('game-over', {
    players: [...partyState.players].sort((a, b) => b.score - a.score)
  });
}

function endGame(io, partyState) {
  if (partyState.status !== 'game-over' && partyState.status !== 'picker-result') return;
  partyState.status = 'lobby';
  partyState.currentGameId = null;
  partyState.questions = [];
  partyState.currentQuestionIndex = 0;
  partyState.answersThisRound = {};
  partyState.previousRanks = null;
  partyState.pickerRun = null;
  clearTimeout(partyState.pickerTimer);
  partyState.lastBreakdown = null;
  partyState.lastWinner = null;
  io.to("PARTY").emit('game-ended');
}
