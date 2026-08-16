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
    players: [], // { id, name, emoji, color, score }
    status: 'lobby', // 'lobby', 'playing', 'results', 'game-over'
    currentGameId: null,
    questions: [],
    currentQuestionIndex: 0,
    questionStartTime: null,
    answersThisRound: {}
  };

  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

// Display screen joins the master party room to watch the action
    socket.on('join-display-screen', () => {
      socket.join(MASTER_ROOM);
      // Immediately send current state to the display screen in case a game is already running or in lobby
      socket.emit('master-update', { 
        players: partyState.players, 
        status: partyState.status 
      });
      if (partyState.status === 'playing' && partyState.questions.length > 0) {
        const q = partyState.questions[partyState.currentQuestionIndex];
        socket.emit('next-question', {
          questionNumber: partyState.currentQuestionIndex + 1,
          totalQuestions: partyState.questions.length,
          questionText: q.question_text,
          options: [q.option_a, q.option_b, q.option_c, q.option_d],
          timeLimit: q.time_limit || 15
        });
      }
      console.log(`Big Screen Display connected: ${socket.id}`);
    });

    // Host initializes or reconnects to the master lobby
    socket.on('host-master-lobby', () => {
      partyState.hostId = socket.id;
      socket.join(MASTER_ROOM);
      socket.emit('master-update', { 
        players: partyState.players, 
        status: partyState.status 
      });
      console.log(`Host registered on master lobby.`);
    });

    // Player joins the master lobby once for the whole night
    socket.on('join-master-lobby', ({ playerName, emoji, color }, callback) => {
      socket.join(MASTER_ROOM);
      
      // Check if player already exists by socket or name, update or push
      const existingPlayer = partyState.players.find(p => p.id === socket.id);
      if (existingPlayer) {
        existingPlayer.name = playerName;
        existingPlayer.emoji = emoji || '🎮';
        existingPlayer.color = color || '#a855f7';
      } else {
        partyState.players.push({
          id: socket.id,
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

    // Host selects a game and loads questions, resetting scores for this new game
    socket.on('load-game', ({ gameId }) => {
      partyState.currentGameId = gameId;
      
      // Reset all player scores to 0 for this standalone game
      partyState.players.forEach(p => p.score = 0);

      const stmt = db.prepare('SELECT * FROM questions WHERE game_id = ?');
      partyState.questions = stmt.all(gameId);
      partyState.currentQuestionIndex = 0;
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
      partyState.status = 'playing';
      partyState.currentQuestionIndex = 0;
      sendNextQuestion(io, partyState);
    });

    // Host clicks "Next Question"
    socket.on('next-question-btn', () => {
      partyState.currentQuestionIndex++;

      if (partyState.currentQuestionIndex < partyState.questions.length) {
        partyState.status = 'playing';
        sendNextQuestion(io, partyState);
      } else {
        partyState.status = 'game-over';
        io.to(MASTER_ROOM).emit('game-over', {
          players: [...partyState.players].sort((a, b) => b.score - a.score)
        });
      }
    });

    // Player submits an answer
    socket.on('submit-answer', ({ answer }) => {
      if (partyState.status !== 'playing') return;
      if (partyState.answersThisRound[socket.id]) return; // prevent double submission

      const q = partyState.questions[partyState.currentQuestionIndex];
      const timeTaken = (Date.now() - partyState.questionStartTime) / 1000;
      const timeLimit = q.time_limit || 15;

      const isCorrect = answer === q.correct_answer;
      let pointsEarned = 0;

      if (isCorrect) {
        const speedFactor = Math.max(0, (1 - (timeTaken / timeLimit)));
        pointsEarned = Math.round(500 + (500 * speedFactor));
      }

      partyState.answersThisRound[socket.id] = { answer, isCorrect, pointsEarned };

      const player = partyState.players.find(p => p.id === socket.id);
      if (player) {
        player.score += pointsEarned;
      }

      // Notify host how many answered
      if (partyState.hostId) {
        io.to(partyState.hostId).emit('player-answered-update', {
          totalAnswers: Object.keys(partyState.answersThisRound).length,
          totalPlayers: partyState.players.length
        });
      }

      // If everyone answered, end round early
      if (Object.keys(partyState.answersThisRound).length === partyState.players.length) {
        endRound(io, partyState);
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

function sendNextQuestion(io, partyState) {
  const q = partyState.questions[partyState.currentQuestionIndex];
  
  partyState.questionStartTime = Date.now();
  partyState.answersThisRound = {};

  io.to("PARTY").emit('next-question', {
    questionNumber: partyState.currentQuestionIndex + 1,
    totalQuestions: partyState.questions.length,
    questionText: q.question_text,
    options: [q.option_a, q.option_b, q.option_c, q.option_d],
    timeLimit: q.time_limit || 15
  });

  // Timer loop for timeout
  const timeLimitMs = (q.time_limit || 15) * 1000;
  setTimeout(() => {
    if (partyState.status === 'playing' && partyState.currentQuestionIndex === partyState.questions.indexOf(q)) {
      endRound(io, partyState);
    }
  }, timeLimitMs);
}

function endRound(io, partyState) {
  if (partyState.status !== 'playing') return;
  partyState.status = 'round-over';

  const q = partyState.questions[partyState.currentQuestionIndex];

  io.to("PARTY").emit('round-results', {
    correctAnswer: q.correct_answer,
    players: partyState.players
  });
}