const { createServer } = require('node:http');
const next = require('next');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');
const fs = require('node:fs');
const wordListPath = require('word-list').default;
const hostAuth = require('./lib/host-auth.cjs');

// Kept server-side so the browser never has to download the dictionary.
const dictionaryWords = new Set(fs.readFileSync(wordListPath, 'utf8').split(/\r?\n/).map((word) => word.trim().toLowerCase()).filter(Boolean));
const normalizeOpenTriviaAnswer = (answer) => String(answer || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');

function groupOpenTriviaAnswers(answers) {
  const groups = new Map();
  Object.values(answers).forEach((entry) => {
    const answer = String(entry.answer || '').trim();
    const key = normalizeOpenTriviaAnswer(answer);
    if (!key) return;
    const group = groups.get(key) || { key, answer, count: 0 };
    group.count += 1;
    groups.set(key, group);
  });
  return [...groups.values()].sort((a, b) => b.count - a.count || a.answer.localeCompare(b.answer));
}

const dev = process.env.NODE_ENV !== 'production';
const hostname = '0.0.0.0'; // Must be 0.0.0.0 for cloud hosting
const port = process.env.PORT || 3000; // Cloud hosts assign a dynamic port
const appReleaseId = (() => {
  try {
    return fs.readFileSync('.next/BUILD_ID', 'utf8').trim();
  } catch {
    return process.env.RENDER_GIT_COMMIT || 'development';
  }
})();

const app = next({ dev, hostname, port });
const handler = app.getRequestHandler();

const db = new Database(process.env.DATABASE_PATH || 'database.sqlite');

// A new persistent disk starts with an empty SQLite file. Create the base
// schema before applying the incremental column migrations below.
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
    scoring_margin REAL,
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
ensureColumn('questions', 'scoring_margin', 'REAL');
ensureColumn('questions', 'herd_mode', "TEXT DEFAULT 'most'");
ensureColumn('questions', 'simon_sequence', 'TEXT');
ensureColumn('questions', 'autocomplete_answers', 'TEXT');
ensureColumn('questions', 'scramble_letters', 'TEXT');
ensureColumn('questions', 'pitch_points', 'INTEGER');
ensureColumn('questions', 'timeline_items', 'TEXT');
ensureColumn('questions', 'timeline_top_label', 'TEXT');
ensureColumn('questions', 'timeline_bottom_label', 'TEXT');

app.prepare().then(() => {
  const httpServer = createServer(handler);
  const io = new Server(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    allowEIO3: true
  });

  // Global Master Party Room State
  const MASTER_ROOM = "PARTY";
  // Only the host and display render the live player roster. Keeping them in a
  // separate room avoids broadcasting a growing list to every player's phone.
  const CONTROL_ROOM = "PARTY_CONTROLS";
  const partyState = {
    hostId: null,
    signupsOpen: true,
    players: [], // { id, name, emoji, color, score }
    removedPlayerKeys: new Set(),
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
    sliderDraftsThisRound: {},
    scrambleWordsThisRound: {},
    pitchScores: { A: 0, B: 0 },
    previousRanks: null,
    pickerRun: null,
    pickerTimer: null,
    lastBreakdown: null,
    lastWinner: null
  };

  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);
    const hostEvents = new Set(['host-master-lobby', 'set-signups-open', 'rename-player', 'remove-player', 'load-game', 'start-game', 'begin-first-question', 'start-pitch-question', 'start-player-picker', 'reveal-answers', 'score-shot-in-the-dark', 'score-open-trivia', 'show-scores', 'reveal-winner', 'reveal-pitch-winner', 'show-final-scores', 'end-game', 'return-to-library', 'next-question-btn']);
    socket.use(([event], next) => {
      if (hostEvents.has(event) && event !== 'host-master-lobby' && socket.id !== partyState.hostId) return;
      next();
    });

// Display screen joins the master party room to watch the action
    socket.on('join-display-screen', () => {
      socket.join(MASTER_ROOM);
      socket.join(CONTROL_ROOM);
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
      if (!hostAuth.isAuthorizedCookie(socket.handshake.headers.cookie)) {
        socket.emit('host-authorization-failed');
        return;
      }
      partyState.hostId = socket.id;
      socket.join(MASTER_ROOM);
      socket.join(CONTROL_ROOM);
      socket.emit('master-update', { 
        players: partyState.players, 
        status: partyState.status,
        signupsOpen: partyState.signupsOpen
      });
      if (partyState.status === 'pitch-options-entry') {
        const q = partyState.questions[partyState.currentQuestionIndex];
        socket.emit('request-pitch-options', { questionText: q?.question_text, options: [q?.option_a || '', q?.option_b || ''] });
      }
      console.log(`Host registered on master lobby.`);
    });

    // Player joins the master lobby once for the whole night
    socket.on('join-master-lobby', ({ playerName, emoji, color, playerKey }, callback) => {
      if (!partyState.signupsOpen) {
        callback({ success: false, error: 'The room is closed for the night.' });
        return;
      }
      if (playerKey && partyState.removedPlayerKeys.has(playerKey)) {
        callback?.({ success: false, error: 'You have been removed from this game night.' });
        return;
      }
      socket.join(MASTER_ROOM);
      socket.emit('app-release', { releaseId: appReleaseId });
      
      // A browser keeps its player key, so refreshing it updates the same player.
      const existingPlayer = partyState.players.find(p => p.id === socket.id || (playerKey && p.playerKey === playerKey));
      if (existingPlayer) {
        const previousSocketId = existingPlayer.id;
        if (previousSocketId !== socket.id) {
          if (partyState.answersThisRound[previousSocketId]) {
            partyState.answersThisRound[socket.id] = partyState.answersThisRound[previousSocketId];
            delete partyState.answersThisRound[previousSocketId];
          }
          if (partyState.scrambleWordsThisRound[previousSocketId]) {
            partyState.scrambleWordsThisRound[socket.id] = partyState.scrambleWordsThisRound[previousSocketId];
            delete partyState.scrambleWordsThisRound[previousSocketId];
          }
        }
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

      // Player phones do not render the full roster, so only update the host
      // and display screens. This keeps signup traffic manageable at scale.
      io.to(CONTROL_ROOM).emit('update-players', { players: partyState.players });
      syncPlayerToCurrentState(socket, partyState);
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
        partyState.removedPlayerKeys.clear();
        io.to(CONTROL_ROOM).emit('update-players', { players: [] });
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
      io.to(CONTROL_ROOM).emit('update-players', { players: partyState.players });
      callback?.({ success: true });
    });

    socket.on('remove-player', ({ playerId }, callback) => {
      if (socket.id !== partyState.hostId) {
        callback?.({ success: false, error: 'Only the host can remove players.' });
        return;
      }
      const player = partyState.players.find((candidate) => candidate.id === playerId);
      if (!player) {
        callback?.({ success: false, error: 'That player is no longer in the room.' });
        return;
      }

      if (player.playerKey) partyState.removedPlayerKeys.add(player.playerKey);
      partyState.players = partyState.players.filter((candidate) => candidate.id !== playerId);
      delete partyState.answersThisRound[playerId];
      delete partyState.scrambleWordsThisRound[playerId];
      io.to(playerId).emit('player-removed');
      io.sockets.sockets.get(playerId)?.leave(MASTER_ROOM);
      io.to(CONTROL_ROOM).emit('update-players', { players: partyState.players });

      const question = partyState.questions[partyState.currentQuestionIndex];
      const totalAnswers = question?.game_type === 'word-scramble'
        ? Object.values(partyState.scrambleWordsThisRound).reduce((total, words) => total + words.length, 0)
        : Object.keys(partyState.answersThisRound).length;
      io.to(partyState.hostId).emit('player-answered-update', { totalAnswers, totalPlayers: partyState.players.length });
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
      partyState.pitchScores = { A: 0, B: 0 };
      partyState.status = 'lobby';

      io.to(CONTROL_ROOM).emit('game-loaded', {
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
      const question = partyState.questions[partyState.currentQuestionIndex];
      if (question?.game_type === 'pitch-meeting') {
        partyState.status = 'pitch-options-entry';
        io.to(partyState.hostId).emit('request-pitch-options', { questionText: question.question_text, options: [question.option_a || '', question.option_b || ''] });
        return;
      }
      partyState.status = 'playing';
      sendNextQuestion(io, partyState);
    });

    socket.on('start-pitch-question', ({ optionA, optionB }, callback) => {
      if (socket.id !== partyState.hostId || partyState.status !== 'pitch-options-entry') {
        callback?.({ success: false, error: 'The pitch vote is not ready to start.' });
        return;
      }
      const q = partyState.questions[partyState.currentQuestionIndex];
      if (!q || q.game_type !== 'pitch-meeting') {
        callback?.({ success: false, error: 'This is not a Pitch Meeting question.' });
        return;
      }
      q.option_a = typeof optionA === 'string' && optionA.trim() ? optionA.trim().slice(0, 120) : q.option_a;
      q.option_b = typeof optionB === 'string' && optionB.trim() ? optionB.trim().slice(0, 120) : q.option_b;
      partyState.status = 'playing';
      sendNextQuestion(io, partyState);
      callback?.({ success: true });
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

    socket.on('score-open-trivia', ({ correctAnswer, acceptedAnswers }, callback) => {
      scoreOpenTrivia(io, partyState, correctAnswer, acceptedAnswers, socket, callback);
    });

    // Host moves from answer chart to the round leaderboard (non-final questions)
    socket.on('show-scores', () => {
      showScores(io, partyState);
    });

    // After the last question's vote chart, host starts the winner reveal
    socket.on('reveal-winner', () => {
      revealWinner(io, partyState);
    });

    socket.on('reveal-pitch-winner', () => revealPitchWinner(io, partyState));

    // After the winner is shown, host opens the full standings
    socket.on('show-final-scores', () => {
      showFinalScores(io, partyState);
    });

    // Host closes the final scoreboard and returns every screen to the party lobby
    socket.on('end-game', () => {
      endGame(io, partyState);
    });

    socket.on('return-to-library', () => {
      returnToLibrary(io, partyState);
    });

    // Host clicks "Next Question"
    socket.on('next-question-btn', () => {
      partyState.currentQuestionIndex++;

      if (partyState.currentQuestionIndex < partyState.questions.length) {
        const question = partyState.questions[partyState.currentQuestionIndex];
        if (question.game_type === 'pitch-meeting') {
          partyState.status = 'pitch-options-entry';
          io.to(partyState.hostId).emit('request-pitch-options', { questionText: question.question_text, options: [question.option_a || '', question.option_b || ''] });
          return;
        }
        partyState.status = 'playing';
        sendNextQuestion(io, partyState);
      }
    });

    // Slider games keep a private draft while the player is adjusting it. A
    // draft only becomes an answer if the player explicitly locks in or time ends.
    socket.on('update-slider-draft', ({ answer }) => {
      if (partyState.status !== 'playing' || partyState.questionExpired || partyState.answersThisRound[socket.id]) return;

      const q = partyState.questions[partyState.currentQuestionIndex];
      const numericAnswer = Number(answer);
      if (q?.game_type === 'shot-in-the-dark') {
        if (!Number.isFinite(numericAnswer) || numericAnswer < q.answer_min || numericAnswer > q.answer_max) return;
      } else if (q?.game_type === 'pitch-meeting') {
        const pitchPoints = q.pitch_points || 100;
        if (!Number.isInteger(numericAnswer) || numericAnswer < 0 || numericAnswer > pitchPoints) return;
      } else {
        return;
      }

      partyState.sliderDraftsThisRound[socket.id] = numericAnswer;
    });

    // Player submits an answer
    socket.on('submit-answer', ({ answer }, callback) => {
      const reject = (error) => callback?.({ success: false, error });
      if (partyState.status !== 'playing') return reject('This question is no longer accepting answers.');
      if (partyState.questionExpired) return reject('Time is up for this question.');
      if (partyState.answersThisRound[socket.id]) return callback?.({ success: true, alreadyRecorded: true });

      const q = partyState.questions[partyState.currentQuestionIndex];
      if (!q) return reject('No question is currently active.');
      const isShotInTheDark = q.game_type === 'shot-in-the-dark';
      const isFollowTheHerd = q.game_type === 'follow-the-herd';
      const isSimonSays = q.game_type === 'simon-says';
      const isAutocompleteTrivia = q.game_type === 'autocomplete-trivia';
      const isOpenTrivia = q.game_type === 'open-trivia';
      const isPitchMeeting = q.game_type === 'pitch-meeting';
      const isTimeline = q.game_type === 'timeline';
      const numericAnswer = Number(answer);
      if (isShotInTheDark && (!Number.isFinite(numericAnswer) || numericAnswer < q.answer_min || numericAnswer > q.answer_max)) return reject('Choose a number within the available range.');
      const simonSequence = isSimonSays ? JSON.parse(q.simon_sequence || '[]') : [];
      if (isSimonSays && (!Array.isArray(answer) || simonSequence.length === 0 || answer.length !== simonSequence.length || answer.some((color) => !['red', 'green', 'blue', 'orange'].includes(color)))) return reject('Complete the full color sequence first.');
      const autocompleteAnswers = isAutocompleteTrivia ? JSON.parse(q.autocomplete_answers || '[]') : [];
      if (isAutocompleteTrivia && (!autocompleteAnswers.includes(answer) || !q.correct_answer)) return reject('Choose an answer from the suggestions.');
      if (isOpenTrivia && (typeof answer !== 'string' || !answer.trim())) return reject('Type an answer before locking it in.');
      const pitchPoints = q.pitch_points || 100;
      if (isPitchMeeting && (!Number.isInteger(numericAnswer) || numericAnswer < 0 || numericAnswer > pitchPoints)) return reject('Choose a valid allocation.');
      const timelineItems = isTimeline ? JSON.parse(q.timeline_items || '[]') : [];
      if (isTimeline && (!Array.isArray(answer) || timelineItems.length !== 6 || answer.length !== timelineItems.length || new Set(answer).size !== answer.length || answer.some((item) => !timelineItems.includes(item)))) return reject('Arrange all six items before locking in.');

      const timeTaken = (Date.now() - partyState.questionStartTime) / 1000;
      const timeLimit = q.time_limit || 30;
      const correctSimonColors = isSimonSays
        ? answer.filter((color, index) => color === simonSequence[index]).length
        : 0;
      const correctTimelineItems = isTimeline
        ? answer.filter((item, index) => item === timelineItems[index]).length
        : 0;
      const isCorrect = isSimonSays
        ? answer.every((color, index) => color === simonSequence[index])
        : isTimeline ? correctTimelineItems === timelineItems.length
        : !isShotInTheDark && !isFollowTheHerd && !isOpenTrivia && answer === q.correct_answer;
      const pointsEarned = isSimonSays
        ? (correctSimonColors * 50) + (isCorrect ? 250 + Math.round(250 * Math.max(0, 1 - (timeTaken / timeLimit))) : 0)
        : isTimeline ? (correctTimelineItems * 100) + (correctTimelineItems === timelineItems.length ? 400 : 0) + Math.round(200 * Math.max(0, 1 - (timeTaken / timeLimit)))
        : isCorrect ? Math.round(500 + (500 * Math.max(0, 1 - (timeTaken / timeLimit)))) : 0;

      partyState.answersThisRound[socket.id] = { answer: isShotInTheDark || isPitchMeeting ? numericAnswer : isOpenTrivia ? answer.trim().slice(0, 120) : answer, isCorrect, pointsEarned, timeTaken };
      delete partyState.sliderDraftsThisRound[socket.id];
      if (isTimeline) partyState.answersThisRound[socket.id].correctItems = correctTimelineItems;

      const player = partyState.players.find(p => p.id === socket.id);
      if (player && !isShotInTheDark && !isFollowTheHerd && !isPitchMeeting && !isOpenTrivia) {
        player.score += pointsEarned;
      }

      // Notify host how many answered (round stays open until the host reveals)
      if (partyState.hostId) {
        io.to(partyState.hostId).emit('player-answered-update', {
          totalAnswers: Object.keys(partyState.answersThisRound).length,
          totalPlayers: partyState.players.length
        });
      }
      callback?.({ success: true });
    });

    socket.on('submit-scramble-word', ({ word }, callback) => {
      if (partyState.status !== 'playing' || partyState.questionExpired) {
        callback?.({ success: false, error: 'Time is up.' });
        return;
      }

      const q = partyState.questions[partyState.currentQuestionIndex];
      if (q?.game_type !== 'word-scramble') {
        callback?.({ success: false, error: 'This is not a Word Scramble question.' });
        return;
      }

      const normalizedWord = typeof word === 'string' ? word.trim().toLowerCase() : '';
      const letters = (q.scramble_letters || '').toLowerCase();
      if (!/^[a-z]{3,}$/.test(normalizedWord)) {
        callback?.({ success: false, error: 'Words need at least 3 letters.' });
        return;
      }
      if (!dictionaryWords.has(normalizedWord)) {
        callback?.({ success: false, error: 'That word is not in the dictionary.' });
        return;
      }
      if (!canBuildWord(normalizedWord, letters)) {
        callback?.({ success: false, error: 'Use only the letters on screen.' });
        return;
      }

      const entries = partyState.scrambleWordsThisRound[socket.id] || [];
      if (entries.some((entry) => entry.word === normalizedWord)) {
        callback?.({ success: false, error: 'You already found that word.' });
        return;
      }

      const longWordBonus = Math.max(0, normalizedWord.length - 5) * 20;
      const pointsEarned = (normalizedWord.length * 10) + longWordBonus;
      entries.push({ word: normalizedWord, pointsEarned });
      partyState.scrambleWordsThisRound[socket.id] = entries;

      const player = partyState.players.find((candidate) => candidate.id === socket.id);
      if (player) player.score += pointsEarned;

      if (partyState.hostId) {
        io.to(partyState.hostId).emit('player-answered-update', {
          totalAnswers: Object.values(partyState.scrambleWordsThisRound).reduce((total, playerWords) => total + playerWords.length, 0),
          totalPlayers: partyState.players.length
        });
      }
      callback?.({ success: true, word: normalizedWord, pointsEarned });
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
  const isLiarLiar = q.game_type === 'liar-liar';
  const gameType = q.game_type || (q.scramble_letters ? 'word-scramble' : q.pitch_points != null ? 'pitch-meeting' : 'trivia');
  return {
    gameType,
    questionNumber: partyState.currentQuestionIndex + 1,
    totalQuestions: partyState.questions.length,
    questionText: q.question_text,
    options: isLiarLiar ? ['True', 'False'] : [q.option_a, q.option_b, q.option_c, q.option_d],
    answerMin: q.answer_min,
    answerMax: q.answer_max,
    answerStep: q.answer_step,
    herdMode: q.herd_mode || 'most',
    simonSequenceLength: q.game_type === 'simon-says' ? JSON.parse(q.simon_sequence || '[]').length : undefined,
    autocompleteAnswers: q.game_type === 'autocomplete-trivia' ? JSON.parse(q.autocomplete_answers || '[]') : undefined,
    scrambleLetters: gameType === 'word-scramble' ? (q.scramble_letters || '').toUpperCase() : undefined,
    pitchPoints: gameType === 'pitch-meeting' ? (q.pitch_points || 100) : undefined,
    timelineItems: gameType === 'timeline' ? JSON.parse(q.timeline_items || '[]') : undefined,
    timelineTopLabel: gameType === 'timeline' ? q.timeline_top_label : undefined,
    timelineBottomLabel: gameType === 'timeline' ? q.timeline_bottom_label : undefined,
    timeLimit: q.time_limit || 15,
    isLastQuestion: partyState.currentQuestionIndex === partyState.questions.length - 1
  };
}

function syncPlayerToCurrentState(socket, partyState) {
  const currentQuestion = partyState.questions[partyState.currentQuestionIndex];
  const sendCurrentQuestion = () => {
    if (currentQuestion) socket.emit('next-question', buildQuestionPayload(partyState, currentQuestion));
  };

  if (partyState.status === 'intro') {
    socket.emit('game-intro', { title: partyState.gameTitle, gameType: currentQuestion?.game_type || 'trivia' });
    return;
  }

  if (partyState.status === 'playing') {
    sendCurrentQuestion();
    const entry = partyState.answersThisRound[socket.id];
    const scrambleWords = partyState.scrambleWordsThisRound[socket.id];
    if (entry || scrambleWords?.length) socket.emit('player-answer-state', {
      answer: entry?.answer,
      scrambleWords,
      isWordScramble: currentQuestion.game_type === 'word-scramble'
    });
    if (partyState.questionExpired) socket.emit('question-time-up');
    return;
  }

  if (partyState.status === 'answer-entry') {
    sendCurrentQuestion();
    socket.emit('question-time-up');
    return;
  }

  if (partyState.status === 'answer-reveal') {
    sendCurrentQuestion();
    if (partyState.lastBreakdown) socket.emit('answer-breakdown', partyState.lastBreakdown);
    return;
  }

  if (partyState.status === 'results') {
    socket.emit('awaiting-next-question');
    return;
  }

  if (partyState.status === 'winner-reveal' && partyState.lastWinner) {
    socket.emit('winner-reveal', partyState.lastWinner);
    return;
  }

  if (partyState.status === 'game-over') {
    socket.emit('game-over');
    return;
  }

  if (partyState.status === 'picker-result' && partyState.pickerRun) {
    socket.emit('player-picker-result', { players: partyState.pickerRun.selectedPlayers });
    return;
  }

  if (partyState.status === 'lobby') socket.emit('game-ended');
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
  partyState.sliderDraftsThisRound = {};
  partyState.scrambleWordsThisRound = {};
  partyState.lastBreakdown = null;
  partyState.lastWinner = null;

  io.to("PARTY").emit('next-question', buildQuestionPayload(partyState, q));
  partyState.questionTimer = setTimeout(() => {
    if (partyState.status === 'playing' && partyState.currentQuestionIndex === questionIndex) {
      lockSliderDrafts(partyState);
      partyState.questionExpired = true;
      io.to("PARTY").emit('question-time-up');
    }
  }, (q.time_limit || 15) * 1000);
}

function lockSliderDrafts(partyState) {
  const q = partyState.questions[partyState.currentQuestionIndex];
  if (!q || (q.game_type !== 'shot-in-the-dark' && q.game_type !== 'pitch-meeting')) return;

  const timeTaken = Math.max(0, (Date.now() - partyState.questionStartTime) / 1000);
  const pitchPoints = q.pitch_points || 100;
  for (const [playerId, answer] of Object.entries(partyState.sliderDraftsThisRound)) {
    if (partyState.answersThisRound[playerId] || !partyState.players.some((player) => player.id === playerId)) continue;

    const isShotInTheDark = q.game_type === 'shot-in-the-dark';
    const isValid = isShotInTheDark
      ? Number.isFinite(answer) && answer >= q.answer_min && answer <= q.answer_max
      : Number.isInteger(answer) && answer >= 0 && answer <= pitchPoints;
    if (!isValid) continue;

    partyState.answersThisRound[playerId] = {
      answer,
      isCorrect: false,
      pointsEarned: 0,
      timeTaken
    };
  }
  partyState.sliderDraftsThisRound = {};
}

function revealAnswers(io, partyState) {
  if (partyState.status !== 'playing') return;
  partyState.questionExpired = true;
  clearTimeout(partyState.questionTimer);

  const q = partyState.questions[partyState.currentQuestionIndex];
  lockSliderDrafts(partyState);
  if (q.game_type === 'shot-in-the-dark') {
    partyState.status = 'answer-entry';
    io.to("PARTY").emit('question-time-up');
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

  if (q.game_type === 'open-trivia') {
    partyState.status = 'answer-entry';
    io.to('PARTY').emit('question-time-up');
    io.to(partyState.hostId).emit('request-open-trivia-scoring', {
      questionText: q.question_text,
      correctAnswer: q.correct_answer || '',
      answerGroups: groupOpenTriviaAnswers(partyState.answersThisRound)
    });
    return;
  }

  if (q.game_type === 'autocomplete-trivia') {
    partyState.status = 'answer-reveal';
    const autocompleteAnswers = JSON.parse(q.autocomplete_answers || '[]');
    const answerCounts = autocompleteAnswers.map((answer) => ({
      answer,
      count: Object.values(partyState.answersThisRound).filter((entry) => entry.answer === answer).length
    }));
    const payload = {
      gameType: 'autocomplete-trivia', questionText: q.question_text, correctAnswer: q.correct_answer,
      answerCounts, totalAnswers: Object.keys(partyState.answersThisRound).length,
      totalPlayers: partyState.players.length, questionNumber: partyState.currentQuestionIndex + 1,
      totalQuestions: partyState.questions.length,
      isLastQuestion: partyState.currentQuestionIndex === partyState.questions.length - 1
    };
    partyState.lastBreakdown = payload;
    io.to('PARTY').emit('answer-breakdown', payload);
    return;
  }

  if (q.game_type === 'word-scramble') {
    partyState.status = 'answer-reveal';
    const wordUsers = new Map();
    Object.values(partyState.scrambleWordsThisRound).flat().forEach((entry) => {
      wordUsers.set(entry.word, (wordUsers.get(entry.word) || 0) + 1);
    });
    const summaries = partyState.players.map((player) => {
      const words = partyState.scrambleWordsThisRound[player.id] || [];
      const uniqueWords = words.filter((entry) => wordUsers.get(entry.word) === 1);
      const uniqueBonus = uniqueWords.length * 25;
      player.score += uniqueBonus;
      const basePoints = words.reduce((total, entry) => total + entry.pointsEarned, 0);
      return {
        playerId: player.id, name: player.name, emoji: player.emoji,
        words: words.map((entry) => entry.word), wordCount: words.length,
        longestWord: words.reduce((longest, entry) => entry.word.length > longest.length ? entry.word : longest, ''),
        uniqueWords: uniqueWords.map((entry) => entry.word), uniqueBonus,
        pointsEarned: basePoints + uniqueBonus
      };
    });
    const highest = (property) => Math.max(0, ...summaries.map((summary) => summary[property] || 0));
    const longestLength = Math.max(0, ...summaries.map((summary) => summary.longestWord.length));
    const payload = {
      gameType: 'word-scramble', letters: (q.scramble_letters || '').toUpperCase(), summaries,
      highlights: {
        longestWord: summaries.filter((summary) => summary.longestWord.length === longestLength && longestLength > 0),
        mostWords: summaries.filter((summary) => summary.wordCount === highest('wordCount') && summary.wordCount > 0),
        mostPoints: summaries.filter((summary) => summary.pointsEarned === highest('pointsEarned') && summary.pointsEarned > 0)
      },
      totalAnswers: Object.values(partyState.scrambleWordsThisRound).reduce((total, words) => total + words.length, 0),
      totalPlayers: partyState.players.length, questionNumber: partyState.currentQuestionIndex + 1,
      totalQuestions: partyState.questions.length,
      isLastQuestion: partyState.currentQuestionIndex === partyState.questions.length - 1
    };
    partyState.lastBreakdown = payload;
    io.to('PARTY').emit('answer-breakdown', payload);
    return;
  }

  if (q.game_type === 'timeline') {
    partyState.status = 'answer-reveal';
    const correctOrder = JSON.parse(q.timeline_items || '[]');
    const submissions = Object.entries(partyState.answersThisRound).map(([playerId, entry]) => {
      const player = partyState.players.find((candidate) => candidate.id === playerId);
      return {
        playerId,
        name: player?.name || 'Player',
        emoji: player?.emoji || '🎮',
        correctItems: entry.correctItems || 0,
        pointsEarned: entry.pointsEarned || 0,
        order: entry.answer
      };
    });
    const payload = {
      gameType: 'timeline', questionText: q.question_text, correctOrder,
      topLabel: q.timeline_top_label, bottomLabel: q.timeline_bottom_label,
      submissions, totalAnswers: submissions.length, totalPlayers: partyState.players.length,
      questionNumber: partyState.currentQuestionIndex + 1, totalQuestions: partyState.questions.length,
      isLastQuestion: partyState.currentQuestionIndex === partyState.questions.length - 1
    };
    partyState.lastBreakdown = payload;
    io.to('PARTY').emit('answer-breakdown', payload);
    return;
  }

  if (q.game_type === 'pitch-meeting') {
    const pitchPoints = q.pitch_points || 100;
    const roundA = Object.values(partyState.answersThisRound).reduce((total, entry) => total + entry.answer, 0);
    const roundB = (Object.keys(partyState.answersThisRound).length * pitchPoints) - roundA;
    partyState.pitchScores.A += roundA;
    partyState.pitchScores.B += roundB;
    partyState.status = 'answer-reveal';
    const payload = {
      gameType: 'pitch-meeting', questionText: q.question_text, options: [q.option_a, q.option_b], pitchPoints,
      roundScores: { A: roundA, B: roundB }, totalScores: { ...partyState.pitchScores },
      totalAnswers: Object.keys(partyState.answersThisRound).length, totalPlayers: partyState.players.length,
      questionNumber: partyState.currentQuestionIndex + 1, totalQuestions: partyState.questions.length,
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

  const isLiarLiar = q.game_type === 'liar-liar';
  const payload = {
    gameType: q.game_type || 'trivia',
    questionText: q.question_text,
    options: isLiarLiar ? ['True', 'False'] : [q.option_a, q.option_b, q.option_c, q.option_d],
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
  const fallbackMargin = correctValueTolerance === 0 ? rangeTolerance : Math.min(correctValueTolerance, rangeTolerance);
  const configuredMargin = Number(q.scoring_margin);
  const scoringMargin = Number.isFinite(configuredMargin) && configuredMargin > 0 ? configuredMargin : fallbackMargin;
  const timeLimit = q.time_limit || 15;
  const guesses = Object.entries(partyState.answersThisRound).map(([playerId, entry]) => {
    const difference = Math.abs(entry.answer - correct);
    const closenessPoints = scoringMargin > 0 && difference <= scoringMargin
      ? 800 * (1 - difference / scoringMargin)
      : 0;
    const speedPoints = scoringMargin > 0 && difference <= scoringMargin
      ? 200 * Math.max(0, 1 - (entry.timeTaken / timeLimit))
      : 0;
    const pointsEarned = difference === 0 ? 1300 : Math.round(closenessPoints + speedPoints);
    entry.pointsEarned = pointsEarned;
    const player = partyState.players.find((candidate) => candidate.id === playerId);
    if (player) player.score += pointsEarned;
    return { playerId, name: player?.name || 'Player', emoji: player?.emoji || '🎮', answer: entry.answer, pointsEarned, difference };
  });

  partyState.status = 'answer-reveal';
  const payload = {
    gameType: 'shot-in-the-dark', questionText: q.question_text, correctNumber: correct,
    scoringMargin, guesses, totalAnswers: guesses.length, totalPlayers: partyState.players.length,
    questionNumber: partyState.currentQuestionIndex + 1, totalQuestions: partyState.questions.length,
    isLastQuestion: partyState.currentQuestionIndex === partyState.questions.length - 1
  };
  partyState.lastBreakdown = payload;
  io.to("PARTY").emit('answer-breakdown', payload);
  callback?.({ success: true, payload });
}

function scoreOpenTrivia(io, partyState, correctAnswer, acceptedAnswers, socket, callback) {
  if (socket.id !== partyState.hostId || partyState.status !== 'answer-entry') {
    callback?.({ success: false, error: 'This question is not ready to score.' });
    return;
  }
  const q = partyState.questions[partyState.currentQuestionIndex];
  const officialAnswer = typeof correctAnswer === 'string' ? correctAnswer.trim().slice(0, 120) : '';
  if (!q || q.game_type !== 'open-trivia' || !officialAnswer) {
    callback?.({ success: false, error: 'Enter the correct answer before scoring.' });
    return;
  }

  const accepted = new Set(Array.isArray(acceptedAnswers) ? acceptedAnswers.map(normalizeOpenTriviaAnswer).filter(Boolean) : []);
  accepted.add(normalizeOpenTriviaAnswer(officialAnswer));
  db.prepare('UPDATE questions SET correct_answer = ? WHERE id = ?').run(officialAnswer, q.id);
  q.correct_answer = officialAnswer;

  const timeLimit = q.time_limit || 15;
  Object.values(partyState.answersThisRound).forEach((entry) => {
    entry.isCorrect = accepted.has(normalizeOpenTriviaAnswer(entry.answer));
    entry.pointsEarned = entry.isCorrect
      ? Math.round(500 + (500 * Math.max(0, 1 - (entry.timeTaken / timeLimit))))
      : 0;
  });
  partyState.players.forEach((player) => {
    const entry = partyState.answersThisRound[player.id];
    if (entry?.isCorrect) player.score += entry.pointsEarned;
  });

  partyState.status = 'answer-reveal';
  const answerCounts = groupOpenTriviaAnswers(partyState.answersThisRound).map((group) => ({
    ...group,
    isCorrect: accepted.has(group.key)
  }));
  const payload = {
    gameType: 'open-trivia', questionText: q.question_text, correctAnswer: officialAnswer,
    answerCounts, totalAnswers: Object.keys(partyState.answersThisRound).length,
    totalPlayers: partyState.players.length, questionNumber: partyState.currentQuestionIndex + 1,
    totalQuestions: partyState.questions.length,
    isLastQuestion: partyState.currentQuestionIndex === partyState.questions.length - 1
  };
  partyState.lastBreakdown = payload;
  io.to('PARTY').emit('answer-breakdown', payload);
  callback?.({ success: true, payload });
}

function buildRoundResultsPayload(partyState, q) {
  const isLastQuestion = partyState.currentQuestionIndex === partyState.questions.length - 1;
  const isLiarLiar = q.game_type === 'liar-liar';
  const currentRanks = buildRankMap(partyState.players);
  return {
    gameType: q.game_type || 'trivia',
    correctAnswer: q.correct_answer,
    options: isLiarLiar ? ['True', 'False'] : [q.option_a, q.option_b, q.option_c, q.option_d],
    correctNumber: q.correct_number,
    herdMode: q.herd_mode || 'most',
    simonSequence: q.simon_sequence ? JSON.parse(q.simon_sequence) : [],
    autocompleteAnswers: q.autocomplete_answers ? JSON.parse(q.autocomplete_answers) : [],
    scrambleLetters: q.scramble_letters || '',
    pitchPoints: q.pitch_points || 100,
    timelineItems: q.timeline_items ? JSON.parse(q.timeline_items) : [],
    timelineTopLabel: q.timeline_top_label || '',
    timelineBottomLabel: q.timeline_bottom_label || '',
    pitchScores: { ...partyState.pitchScores },
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
  if (q.game_type !== 'pitch-meeting' && q.game_type !== 'player-picker') {
    partyState.players.forEach((player) => {
      const wordScrambleSummary = q.game_type === 'word-scramble'
        ? partyState.lastBreakdown?.summaries?.find((summary) => summary.playerId === player.id)
        : null;
      const roundPoints = wordScrambleSummary
        ? wordScrambleSummary.pointsEarned
        : partyState.answersThisRound[player.id]?.pointsEarned || 0;
      io.to(player.id).emit('round-points', { roundPoints });
    });
  }
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

function revealPitchWinner(io, partyState) {
  if (partyState.status !== 'answer-reveal') return;
  const q = partyState.questions[partyState.currentQuestionIndex];
  if (q.game_type !== 'pitch-meeting') return;
  partyState.status = 'winner-reveal';
  const top = Math.max(partyState.pitchScores.A, partyState.pitchScores.B);
  const winners = ['A', 'B'].filter((key) => partyState.pitchScores[key] === top);
  partyState.lastWinner = {
    gameType: 'pitch-meeting', scores: { ...partyState.pitchScores }, winners,
    winningGroups: winners.map((key) => ({
      key,
      score: partyState.pitchScores[key],
      options: partyState.questions.map((question) => key === 'A' ? question.option_a : question.option_b)
    }))
  };
  io.to('PARTY').emit('winner-reveal', partyState.lastWinner);
}

function showFinalScores(io, partyState) {
  if (partyState.status !== 'winner-reveal') return;
  partyState.status = 'game-over';
  io.to("PARTY").emit('game-over', {
    players: [...partyState.players].sort((a, b) => b.score - a.score)
  });
}

function endGame(io, partyState) {
  const isPitchWinnerReveal = partyState.status === 'winner-reveal' && partyState.questions[partyState.currentQuestionIndex]?.game_type === 'pitch-meeting';
  if (partyState.status !== 'game-over' && partyState.status !== 'picker-result' && !isPitchWinnerReveal) return;
  returnToLibrary(io, partyState);
}

function returnToLibrary(io, partyState) {
  partyState.status = 'lobby';
  partyState.currentGameId = null;
  partyState.questions = [];
  partyState.currentQuestionIndex = 0;
  partyState.answersThisRound = {};
  partyState.scrambleWordsThisRound = {};
  partyState.previousRanks = null;
  partyState.pickerRun = null;
  clearTimeout(partyState.questionTimer);
  clearTimeout(partyState.introTimer);
  clearTimeout(partyState.pickerTimer);
  partyState.lastBreakdown = null;
  partyState.lastWinner = null;
  io.to("PARTY").emit('game-ended');
}

function canBuildWord(word, letters) {
  const available = new Map();
  for (const letter of letters) available.set(letter, (available.get(letter) || 0) + 1);
  for (const letter of word) {
    const count = available.get(letter) || 0;
    if (count === 0) return false;
    available.set(letter, count - 1);
  }
  return true;
}
