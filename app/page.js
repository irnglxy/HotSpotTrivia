"use client";

import React, { useState, useEffect } from 'react';
import { socket } from '@/lib/socket';

const newQuestion = (gameType) => gameType === 'shot-in-the-dark'
  ? { questionText: '', options: ['', '', '', ''], correctAnswer: 'A', correctNumber: '', answerMin: 0, answerMax: 100, answerStep: 1, timeLimit: 30 }
  : gameType === 'liar-liar'
    ? { questionText: 'Is it true or false?', options: ['True', 'False'], correctAnswer: 'A', timeLimit: 15 }
    : gameType === 'simon-says'
      ? { questionText: '', options: [], simonSequence: [], timeLimit: 15 }
      : gameType === 'player-picker'
        ? { questionText: '', options: [], timeLimit: 15 }
        : gameType === 'autocomplete-trivia'
          ? { questionText: '', options: [], autocompleteAnswers: [], correctAnswer: '', timeLimit: 15 }
          : { questionText: '', options: ['', '', '', ''], correctAnswer: 'A', herdMode: 'most', timeLimit: 15 };

const gameTypeLabel = (gameType) => ({
  'shot-in-the-dark': 'Shot In The Dark',
  'follow-the-herd': 'Follow The Herd',
  'liar-liar': 'Liar Liar',
  'simon-says': 'Simon Says',
  'player-picker': 'Player Picker',
  'autocomplete-trivia': 'Autocomplete Trivia'
}[gameType] || 'Trivia');

const gameTypeClass = (gameType) => ({
  'shot-in-the-dark': 'bg-purple-950 text-purple-300',
  'follow-the-herd': 'bg-amber-950 text-amber-300',
  'liar-liar': 'bg-rose-950 text-rose-300',
  'simon-says': 'bg-cyan-950 text-cyan-300',
  'player-picker': 'bg-fuchsia-950 text-fuchsia-300',
  'autocomplete-trivia': 'bg-teal-950 text-teal-300'
}[gameType] || 'bg-blue-950 text-blue-300');

export default function MasterHostDashboard() {
  const [view, setView] = useState('library'); // 'library', 'lobby', 'question', 'answer-reveal', 'results', 'winner-reveal', 'game-over', 'builder'
  
  // Library State
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);

  // Master Party & Game State
  const [players, setPlayers] = useState([]);
  const [signupsOpen, setSignupsOpen] = useState(true);
  
  // Question & Timer State
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [timeLeft, setTimeLeft] = useState(15);
  const [answerStats, setAnswerStats] = useState({ totalAnswers: 0, totalPlayers: 0 });
  const [answerBreakdown, setAnswerBreakdown] = useState(null);
  const [roundResults, setRoundResults] = useState(null);
  const [winnerReveal, setWinnerReveal] = useState(null);
  const [showWinnerName, setShowWinnerName] = useState(false);
  const [finalScores, setFinalScores] = useState([]);
  const [introTitle, setIntroTitle] = useState(null);

  // Builder State
  const [editingGameId, setEditingGameId] = useState(null);
  const [gameTitle, setGameTitle] = useState('');
  const [gameType, setGameType] = useState('trivia');
  const [questions, setQuestions] = useState([newQuestion('trivia')]);
  const [correctNumber, setCorrectNumber] = useState('');
  const [pickerCount, setPickerCount] = useState(1);
  const [pickedPlayers, setPickedPlayers] = useState([]);

  const fetchGames = async () => {
    try {
      const res = await fetch('/api/games');
      const data = await res.json();
      if (res.ok) setGames(data.games);
    } catch (err) {
      console.error("Failed to load games", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    socket.emit('host-master-lobby');

    socket.on('update-players', (data) => setPlayers(data.players));
    socket.on('master-update', (data) => setSignupsOpen(data.signupsOpen !== false));
    socket.on('game-loaded', (data) => {
      setPlayers(data.players);
      setView('lobby');
    });
    socket.on('game-intro', (data) => { setIntroTitle(data.title); setView('intro'); });
    socket.on('next-question', (qData) => {
      setView('question');
      setIntroTitle(null);
      setCurrentQuestion(qData);
      setTimeLeft(qData.timeLimit || 15);
      setAnswerStats({ totalAnswers: 0, totalPlayers: players.length });
      setAnswerBreakdown(null);
      setRoundResults(null);
      setWinnerReveal(null);
      setShowWinnerName(false);
    });
    socket.on('player-answered-update', (stats) => setAnswerStats(stats));
    socket.on('answer-breakdown', (data) => {
      setView('answer-reveal');
      setAnswerBreakdown(data);
    });
    socket.on('round-results', (results) => {
      setView('results');
      setRoundResults(results);
      setPlayers(results.players);
    });
    socket.on('winner-reveal', (data) => {
      setView('winner-reveal');
      setWinnerReveal(data);
      setShowWinnerName(false);
    });
    socket.on('game-over', (data) => {
      setView('game-over');
      setFinalScores(data.players);
    });
    socket.on('game-ended', () => {
      setView('library');
      setWinnerReveal(null);
      setFinalScores([]);
    });
    socket.on('request-correct-number', (data) => { setCorrectNumber(data.correctNumber); setView('answer-entry'); });
    socket.on('player-picker-setup', (data) => { setPickerCount(Math.min(1, data.totalPlayers)); setView('picker-setup'); });
    socket.on('player-picker-start', () => setView('picker-selecting'));
    socket.on('player-picker-result', (data) => { setPickedPlayers(data.players); setView('picker-result'); });

    return () => {
      socket.off('host-master-lobby');
      socket.off('master-update');
      socket.off('update-players');
      socket.off('game-loaded');
      socket.off('game-intro');
      socket.off('next-question');
      socket.off('player-answered-update');
      socket.off('answer-breakdown');
      socket.off('round-results');
      socket.off('winner-reveal');
      socket.off('game-over');
      socket.off('game-ended');
      socket.off('request-correct-number');
      socket.off('player-picker-setup');
      socket.off('player-picker-start');
      socket.off('player-picker-result');
    };
  }, [players.length]);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/games')
      .then(async (res) => ({ res, data: await res.json() }))
      .then(({ res, data }) => {
        if (res.ok && !cancelled) setGames(data.games);
      })
      .catch((err) => console.error("Failed to load games", err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (view === 'question' && timeLeft > 0) {
      const timer = setInterval(() => {
        setTimeLeft((prev) => (prev > 0 ? prev - 1 : 0));
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [view, timeLeft]);

  useEffect(() => {
    if (view !== 'winner-reveal') return;
    const timer = setTimeout(() => setShowWinnerName(true), 3000);
    return () => clearTimeout(timer);
  }, [view, winnerReveal]);

  const loadGame = (gameId) => {
    socket.emit('load-game', { gameId });
  };

  const startGame = () => socket.emit('start-game');
  const beginFirstQuestion = () => socket.emit('begin-first-question');
  const revealAnswers = () => socket.emit('reveal-answers');
  const showScores = () => socket.emit('show-scores');
  const revealWinner = () => socket.emit('reveal-winner');
  const showFinalScores = () => socket.emit('show-final-scores');
  const endGame = () => socket.emit('end-game');
  const nextQuestion = () => socket.emit('next-question-btn');
  const startPlayerPicker = () => socket.emit('start-player-picker', { count: pickerCount }, (response) => { if (!response?.success) alert(response?.error || 'Could not start the picker.'); });
  const setSignupsOpenForNight = (open) => socket.emit('set-signups-open', { open }, (response) => { if (response?.success) setSignupsOpen(response.signupsOpen); });
  const scoreShotInTheDark = () => socket.emit('score-shot-in-the-dark', { correctNumber }, (response) => {
    if (!response?.success) {
      alert(response?.error || 'Enter a valid number.');
      return;
    }
    setAnswerBreakdown(response.payload);
    setView('answer-reveal');
  });

  const renamePlayer = (player) => {
    const playerName = prompt(`Rename ${player.name}`, player.name);
    if (playerName === null) return;

    socket.emit('rename-player', { playerId: player.id, playerName }, (response) => {
      if (!response?.success) alert(response?.error || 'Could not rename player.');
    });
  };

  const moveGame = async (index, direction) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= games.length) return;
    const reordered = [...games];
    [reordered[index], reordered[nextIndex]] = [reordered[nextIndex], reordered[index]];
    setGames(reordered);
    const response = await fetch('/api/games', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gameIds: reordered.map((game) => game.id) }) });
    if (!response.ok) fetchGames();
  };

  // Delete a game
  const deleteGame = async (gameId) => {
    if (!confirm("Are you sure you want to delete this game?")) return;
    try {
      const res = await fetch(`/api/games?id=${gameId}`, { method: 'DELETE' });
      if (res.ok) {
        setLoading(true);
        fetchGames();
      } else {
        alert("Failed to delete game.");
      }
    } catch (err) {
      console.error("Delete error:", err);
    }
  };

  // Open builder for creating a new game
  const openNewBuilder = () => {
    setEditingGameId(null);
    setGameTitle('');
    setGameType('trivia'); setQuestions([newQuestion('trivia')]);
    setView('builder');
  };

  // Load an existing game into the builder for editing
  const loadGameForEdit = async (gameId) => {
    try {
      const res = await fetch(`/api/games?id=${gameId}`);
      const data = await res.json();
      if (res.ok) {
        setEditingGameId(data.game.id);
        setGameTitle(data.game.title);
        setGameType(data.game.gameType || 'trivia');
        setQuestions(data.game.questions.map((question) => data.game.gameType === 'liar-liar' ? { ...question, questionText: 'Is it true or false?', options: ['True', 'False'] } : question));
        setView('builder');
      } else {
        alert("Could not load game for editing.");
      }
    } catch (err) {
      console.error("Failed to load game for edit:", err);
    }
  };

  const addQuestionField = () => {
    setQuestions([...questions, newQuestion(gameType)]);
  };

  const removeQuestionField = (index) => {
    if (questions.length === 1) return;
    setQuestions(questions.filter((_, i) => i !== index));
  };

  const handleQuestionChange = (index, field, value) => {
    const updated = [...questions];
    updated[index][field] = value;
    setQuestions(updated);
  };

  const handleOptionChange = (qIndex, optIndex, value) => {
    const updated = [...questions];
    updated[qIndex].options[optIndex] = value;
    setQuestions(updated);
  };

  const handleAutocompleteAnswers = (qIndex, value) => {
    const answers = [...new Set(value.split('\n').map((answer) => answer.trim()).filter(Boolean))];
    const updated = [...questions];
    updated[qIndex].autocompleteAnswers = answers;
    if (!answers.includes(updated[qIndex].correctAnswer)) updated[qIndex].correctAnswer = answers[0] || '';
    setQuestions(updated);
  };

  const saveGame = async () => {
    if (!gameTitle.trim()) {
      alert("Please enter a game title.");
      return;
    }
    if (gameType === 'simon-says' && questions.some((question) => !question.simonSequence?.length)) {
      alert('Add at least one color to every Simon Says sequence.');
      return;
    }
    if (gameType === 'autocomplete-trivia' && questions.some((question) => !question.autocompleteAnswers?.length || !question.correctAnswer)) {
      alert('Add possible answers and select the correct one for every question.');
      return;
    }

    const payload = { id: editingGameId, title: gameTitle, gameType, questions };
    const method = editingGameId ? 'PUT' : 'POST';

    try {
      const response = await fetch('/api/games', {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (response.ok) {
        alert(editingGameId ? 'Game updated successfully!' : 'Game created successfully!');
        setEditingGameId(null);
        setGameTitle('');
        setQuestions([newQuestion(gameType)]);
        setLoading(true);
        fetchGames();
        setView('library');
      } else {
        alert('Failed to save game.');
      }
    } catch (err) {
      console.error("Save error:", err);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6 md:p-12">
      <div className="max-w-5xl mx-auto">
        
        {/* HEADER NAVIGATION */}
        <div className="flex justify-between items-center mb-8 pb-4 border-b border-zinc-800">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-purple-400">
              Live Show Host Dashboard
            </h1>
            <p className="text-zinc-400 text-sm">Players connect at <span className="text-white font-mono underline">/play</span></p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setSignupsOpenForNight(!signupsOpen)} className={`px-4 py-2 rounded-xl font-semibold ${signupsOpen ? 'bg-red-950 text-red-300' : 'bg-emerald-700 text-white'}`}>{signupsOpen ? 'Close Room' : 'Open Room'}</button>
            <button 
              onClick={() => setView('library')}
              className={`px-4 py-2 rounded-xl font-semibold transition ${view === 'library' ? 'bg-purple-600 text-white' : 'bg-zinc-900 text-zinc-400 hover:text-white'}`}
            >
              Game Library
            </button>
            <button 
              onClick={openNewBuilder}
              className={`px-4 py-2 rounded-xl font-semibold transition ${view === 'builder' ? 'bg-purple-600 text-white' : 'bg-zinc-900 text-zinc-400 hover:text-white'}`}
            >
              + Create Game
            </button>
          </div>
        </div>

        {/* GLOBAL PLAYER LOUNGE BANNER */}
        {(view === 'library' || view === 'builder') && (
          <div className="mb-8 bg-zinc-900/80 border border-zinc-800 p-5 rounded-2xl shadow-xl backdrop-blur">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-bold text-zinc-200 flex items-center gap-2">
                <span>🟢 Global Party Lounge</span>
                <span className="text-xs bg-emerald-950 border border-emerald-800 text-emerald-400 px-2.5 py-0.5 rounded-full font-mono">
                  {players.length} Connected
                </span>
              </h3>
              <span className="text-xs text-zinc-500">Players can join anytime at /play</span>
            </div>

            {players.length === 0 ? (
              <p className="text-zinc-500 italic text-sm">No players logged in yet. Open <span className="font-mono text-purple-400">/play</span> on a phone/browser to test!</p>
            ) : (
              <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto p-1">
                {players.map((player) => (
                  <div 
                    key={player.id} 
                    className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-semibold shadow border"
                    style={{ backgroundColor: player.color + '15', borderColor: player.color + '44', color: '#fff' }}
                  >
                    <span>{player.emoji}</span>
                    <span>{player.name}</span>
                    <button
                      onClick={() => renamePlayer(player)}
                      className="text-zinc-400 hover:text-white transition"
                      title={`Rename ${player.name}`}
                      aria-label={`Rename ${player.name}`}
                    >
                      ✏️
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* VIEW 1: GAME LIBRARY (With Edit & Delete Buttons) */}
        {view === 'library' && (
          <div>
            <h2 className="text-xl font-bold mb-4 text-zinc-200">Select a Game to Host</h2>
            {loading ? (
              <p className="text-zinc-500">Loading games...</p>
            ) : games.length === 0 ? (
              <div className="text-center py-12 bg-zinc-900 border border-zinc-800 rounded-2xl">
                <p className="text-zinc-400 mb-4">No trivia games found.</p>
                <button onClick={openNewBuilder} className="bg-purple-600 text-white font-semibold px-6 py-2.5 rounded-xl">
                  Create Your First Game
                </button>
              </div>
            ) : (
              <div className="grid gap-4">
                {games.map((game, index) => (
                  <div key={game.id} className="p-5 bg-zinc-900 border border-zinc-800 rounded-2xl flex justify-between items-center shadow-lg">
                    <div>
                      <h3 className="font-bold text-lg text-white">{game.title}</h3>
                      <p className="text-sm text-zinc-400">{game.question_count} Questions <span className={`ml-2 px-2 py-0.5 rounded-full text-xs font-bold ${gameTypeClass(game.game_type)}`}>{gameTypeLabel(game.game_type)}</span></p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex flex-col text-xs"><button onClick={() => moveGame(index, -1)} disabled={index === 0} className="disabled:opacity-30">▲</button><button onClick={() => moveGame(index, 1)} disabled={index === games.length - 1} className="disabled:opacity-30">▼</button></div>
                      <button 
                        onClick={() => loadGameForEdit(game.id)}
                        className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-purple-300 px-4 py-2.5 rounded-xl font-semibold transition text-sm"
                      >
                        Edit ✏️
                      </button>
                      <button 
                        onClick={() => deleteGame(game.id)}
                        className="bg-red-950/60 hover:bg-red-900 border border-red-800 text-red-300 px-4 py-2.5 rounded-xl font-semibold transition text-sm"
                      >
                        Delete 🗑️
                      </button>
                      <button 
                        onClick={() => loadGame(game.id)}
                        className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-6 py-2.5 rounded-xl shadow-lg transition flex items-center gap-2"
                      >
                        Host Game 🚀
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* VIEW 2: MASTER LOBBY */}
        {view === 'lobby' && (
          <div className="text-center">
            <div className="inline-block bg-purple-950/60 border border-purple-800 text-purple-300 px-4 py-1.5 rounded-full font-bold text-sm mb-3">
              Game Lobby • {players.length} {players.length === 1 ? 'Player' : 'Players'} Ready
            </div>
            <h2 className="text-3xl font-extrabold text-emerald-400 mb-2">Game Loaded Successfully!</h2>
            <p className="text-zinc-400 mb-8">Review your players below. Scores will start fresh for this game.</p>

            <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl max-w-2xl mx-auto mb-8 shadow-2xl">
              <h3 className="text-xl font-bold mb-4 text-zinc-300 flex justify-between items-center">
                <span>Players Ready for This Game</span>
                <span className="text-sm font-mono text-emerald-400">{players.length} Active</span>
              </h3>
              
              {players.length === 0 ? (
                <p className="text-zinc-500 italic py-6">No players are currently connected.</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-60 overflow-y-auto p-2">
                  {players.map((player) => (
                    <div 
                      key={player.id} 
                      className="flex items-center gap-3 px-3 py-2.5 rounded-xl font-semibold shadow border text-left"
                      style={{ backgroundColor: player.color + '15', borderColor: player.color + '44', color: '#fff' }}
                    >
                      <span className="text-2xl shrink-0">{player.emoji}</span>
                      <span className="truncate text-sm font-medium">{player.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-center gap-4">
              <button 
                onClick={() => setView('library')}
                className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-semibold px-6 py-4 rounded-2xl transition"
              >
                ← Back to Game Library
              </button>
              {players.length > 0 && (
                <button 
                  onClick={startGame} 
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xl px-8 py-4 rounded-2xl shadow-2xl transition animate-bounce"
                >
                  Start This Game! 🎮
                </button>
              )}
            </div>
          </div>
        )}

        {view === 'intro' && <div className="text-center py-24"><p className="text-purple-300 uppercase tracking-[0.3em] font-bold mb-5">Get ready for</p><h2 className="text-6xl font-black text-white mb-12">{introTitle}</h2><button onClick={beginFirstQuestion} className="bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xl px-8 py-4 rounded-2xl shadow-xl">Begin First Question 🎮</button></div>}

        {view === 'picker-setup' && <div className="max-w-xl mx-auto text-center bg-zinc-900 border border-fuchsia-700 rounded-3xl p-8"><p className="text-fuchsia-300 font-bold uppercase tracking-widest mb-3">Player Picker</p><h2 className="text-3xl font-black text-white mb-3">How many players should remain?</h2><p className="text-zinc-400 mb-6">The display will eliminate everyone else randomly over 10 seconds.</p><input type="number" min="1" max={players.length} value={pickerCount} onChange={(e) => setPickerCount(Math.min(players.length, Math.max(1, Number(e.target.value) || 1)))} className="w-32 text-center text-4xl font-black p-3 bg-zinc-950 border border-zinc-700 rounded-xl text-white mb-6" /><p className="text-zinc-500 text-sm mb-6">from {players.length} players</p><button onClick={startPlayerPicker} className="bg-fuchsia-600 hover:bg-fuchsia-500 text-white font-black px-8 py-4 rounded-2xl">Start the Picker 🎲</button></div>}

        {view === 'picker-selecting' && <div className="text-center py-24"><p className="text-fuchsia-300 font-bold uppercase tracking-widest mb-5">Player Picker</p><h2 className="text-5xl font-black text-white">The display is choosing...</h2></div>}

        {view === 'picker-result' && <div className="max-w-3xl mx-auto text-center"><p className="text-fuchsia-300 font-bold uppercase tracking-widest mb-4">Selected Players</p><div className="flex flex-wrap justify-center gap-4 mb-10">{pickedPlayers.map((player) => <div key={player.id} className="bg-zinc-900 border border-fuchsia-600 rounded-2xl px-6 py-5"><span className="text-4xl mr-3">{player.emoji}</span><span className="text-3xl font-black text-white">{player.name}</span></div>)}</div><button onClick={endGame} className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-8 py-4 rounded-xl">End Picker &amp; Return to Lobby</button></div>}

        {/* VIEW 3: QUESTION BOARD WITH TIMER */}
        {view === 'question' && currentQuestion && (
          <div className="text-center">
            {currentQuestion.isLastQuestion && (
              <div className="mb-6 bg-amber-950/80 border border-amber-500 text-amber-200 px-5 py-3 rounded-2xl font-bold">
                Final question of this game
              </div>
            )}

            <div className="flex justify-between items-center mb-6">
              <p className="text-zinc-400 font-bold">Question {currentQuestion.questionNumber} of {currentQuestion.totalQuestions}</p>
              
              <div className={`px-6 py-2 rounded-full font-black text-xl border flex items-center gap-2 ${timeLeft <= 0 ? 'bg-red-950/80 text-red-400 border-red-600' : timeLeft <= 5 ? 'bg-red-950/80 text-red-400 border-red-600 animate-pulse' : 'bg-zinc-900 text-purple-300 border-zinc-700'}`}>
                {timeLeft <= 0 ? 'TIME UP' : `⏱️ ${timeLeft}s`}
              </div>

              <div className="bg-purple-900/50 border border-purple-700 text-purple-200 px-4 py-1.5 rounded-full font-bold text-sm">
                Locked In: {answerStats.totalAnswers} / {answerStats.totalPlayers}
              </div>
            </div>
            
            {currentQuestion.gameType !== 'simon-says' && <h1 className="text-4xl md:text-5xl font-black text-white mb-12 bg-zinc-900 border border-zinc-800 p-8 rounded-3xl shadow-2xl leading-tight">
              {currentQuestion.questionText}
            </h1>}

            {currentQuestion.gameType === 'autocomplete-trivia' ? <div className="mb-10 bg-teal-950/50 border border-teal-700 rounded-2xl p-6 text-teal-200 font-bold">Autocomplete Trivia • Players are typing and selecting their answer.</div> : currentQuestion.gameType === 'simon-says' ? <div className="mb-10 bg-cyan-950/50 border border-cyan-700 rounded-2xl p-8 text-cyan-200"><p className="text-3xl font-black">Simon Says</p><p className="mt-2">Players are entering {currentQuestion.simonSequenceLength} colors.</p></div> : currentQuestion.gameType === 'shot-in-the-dark' ? (
              <div className="mb-10 bg-purple-950/50 border border-purple-700 rounded-2xl p-6 text-purple-200 font-bold">
                Shot In The Dark • Players are choosing a number between {currentQuestion.answerMin} and {currentQuestion.answerMax}
              </div>
            ) : <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-10">
              {currentQuestion.options.slice(0, currentQuestion.gameType === 'liar-liar' ? 2 : 4).map((opt, idx) => {
                const optLetter = ['A', 'B', 'C', 'D'][idx];
                const optColors = { A: 'bg-red-600', B: 'bg-blue-600', C: 'bg-yellow-600', D: 'bg-green-600' };

                return (
                  <div key={idx} className={`${optColors[optLetter]} text-white p-6 rounded-2xl font-bold text-xl shadow-lg flex items-center`}>
                    <span className="bg-black/30 w-12 h-12 rounded-xl flex items-center justify-center mr-4 text-2xl font-black shrink-0">{optLetter}</span>
                    <span className="flex-1 text-left leading-snug">{opt}</span>
                  </div>
                );
              })}
            </div>}

            {answerStats.totalPlayers > 0 && answerStats.totalAnswers === answerStats.totalPlayers && timeLeft > 0 && (
              <p className="text-emerald-400 font-semibold mb-4">Everyone has locked in — the timer keeps running until you reveal.</p>
            )}

            <button
              onClick={revealAnswers}
              className={`font-extrabold text-xl px-8 py-4 rounded-2xl shadow-2xl transition ${timeLeft <= 0 ? 'bg-purple-600 hover:bg-purple-500 text-white animate-pulse' : 'bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 text-white'}`}
            >
              {timeLeft <= 0 ? 'Reveal How Everyone Answered' : 'End Question Early & Reveal Answers'}
            </button>
          </div>
        )}

        {/* VIEW 3b: ANSWER DISTRIBUTION */}
        {view === 'answer-reveal' && answerBreakdown?.gameType === 'shot-in-the-dark' && (
          <div className="max-w-3xl mx-auto text-center space-y-6">
            <p className="text-purple-300 font-bold uppercase tracking-widest">Shot In The Dark</p>
            <h2 className="text-3xl font-black text-white">Correct answer: <span className="text-emerald-400">{answerBreakdown.correctNumber}</span></h2>
            <p className="text-zinc-400">{answerBreakdown.totalAnswers} guesses scored. Players within 20% earned points; exact guesses earned 1,200.</p>
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 text-left">
              <h3 className="font-bold text-white mb-3">All guesses</h3>
              <div className="max-h-64 overflow-y-auto space-y-2 pr-2">
                {[...answerBreakdown.guesses].sort((a, b) => a.answer - b.answer).map((guess) => <div key={guess.playerId} className="flex justify-between items-center bg-zinc-950 rounded-xl p-3"><span>{guess.emoji} <span className="font-bold text-white">{guess.name}</span></span><span className="font-mono text-purple-300">{guess.answer}</span><span className="font-mono text-emerald-400">+{guess.pointsEarned}</span></div>)}
              </div>
            </div>
            {answerBreakdown.isLastQuestion ? <button onClick={revealWinner} className="bg-amber-500 text-zinc-950 font-black px-8 py-4 rounded-2xl">Reveal Winner 🏆</button> : <button onClick={showScores} className="bg-purple-600 text-white font-bold px-8 py-4 rounded-2xl">Show Scores</button>}
          </div>
        )}

        {view === 'answer-reveal' && answerBreakdown?.gameType === 'simon-says' && (
          <div className="max-w-3xl mx-auto text-center space-y-6">
            <p className="text-cyan-300 font-bold uppercase tracking-widest">Simon Says</p>
            <h2 className="text-3xl font-black text-white">Correct sequence</h2>
            <div className="flex flex-wrap justify-center gap-3 bg-zinc-900 border border-zinc-800 rounded-3xl p-6">{answerBreakdown.simonSequence.map((color, index) => <span key={index} className={`w-14 h-14 rounded-xl shadow-lg ${color === 'red' ? 'bg-red-600' : color === 'green' ? 'bg-green-600' : color === 'blue' ? 'bg-blue-600' : 'bg-orange-500'}`} title={color} />)}</div>
            <p className="text-zinc-400">{answerBreakdown.totalAnswers} / {answerBreakdown.totalPlayers} players completed a sequence</p>
            {answerBreakdown.isLastQuestion ? <button onClick={revealWinner} className="bg-amber-500 text-zinc-950 font-black px-8 py-4 rounded-2xl">Reveal Winner 🏆</button> : <button onClick={showScores} className="bg-purple-600 text-white font-bold px-8 py-4 rounded-2xl">Show Scores</button>}
          </div>
        )}

        {view === 'answer-reveal' && answerBreakdown?.gameType === 'autocomplete-trivia' && (
          <div className="max-w-3xl mx-auto text-center space-y-6"><p className="text-teal-300 font-bold uppercase tracking-widest">Autocomplete Trivia</p><h2 className="text-3xl font-black text-white">{answerBreakdown.questionText}</h2><div className="space-y-2 text-left">{answerBreakdown.answerCounts.filter(({ count }) => count > 0).map(({ answer, count }) => <div key={answer} className={`flex justify-between bg-zinc-900 border rounded-xl p-4 ${answer === answerBreakdown.correctAnswer ? 'border-emerald-400' : 'border-zinc-800'}`}><span className="font-bold text-white">{answer}{answer === answerBreakdown.correctAnswer && <span className="ml-3 text-emerald-400 text-sm">Correct</span>}</span><span className="font-mono text-white">{count}</span></div>)}</div>{answerBreakdown.isLastQuestion ? <button onClick={revealWinner} className="bg-amber-500 text-zinc-950 font-black px-8 py-4 rounded-2xl">Reveal Winner 🏆</button> : <button onClick={showScores} className="bg-purple-600 text-white font-bold px-8 py-4 rounded-2xl">Show Scores</button>}</div>
        )}

        {view === 'answer-reveal' && answerBreakdown && answerBreakdown.gameType !== 'shot-in-the-dark' && answerBreakdown.gameType !== 'simon-says' && answerBreakdown.gameType !== 'autocomplete-trivia' && (
          <div>
            {answerBreakdown.isLastQuestion && (
              <div className="mb-6 bg-amber-950/80 border border-amber-500 text-amber-200 px-5 py-3 rounded-2xl font-bold text-center">
                That was the final question
              </div>
            )}

            <div className="flex justify-between items-center mb-4">
              <p className="text-zinc-400 font-bold">Question {answerBreakdown.questionNumber} of {answerBreakdown.totalQuestions}</p>
              <p className="text-zinc-400 font-mono text-sm">
                {answerBreakdown.totalAnswers} / {answerBreakdown.totalPlayers} answered
              </p>
            </div>

            <h2 className="text-2xl font-black text-white mb-2">{answerBreakdown.questionText}</h2>
            <p className="text-purple-300 font-semibold mb-6">{answerBreakdown.gameType === 'follow-the-herd' ? `Follow The Herd • ${answerBreakdown.herdMode === 'least' ? 'Least popular selected answer scores' : 'Most popular answer scores'}` : answerBreakdown.gameType === 'liar-liar' ? 'How did the room answer?' : 'How the room voted'}</p>

            <div className="space-y-3 mb-8">
              {answerBreakdown.options.slice(0, answerBreakdown.gameType === 'liar-liar' ? 2 : 4).map((optText, idx) => {
                const optLetter = ['A', 'B', 'C', 'D'][idx];
                const count = answerBreakdown.counts[optLetter] || 0;
                const pct = answerBreakdown.totalAnswers === 0 ? 0 : Math.round((count / answerBreakdown.totalAnswers) * 100);
                const isFollowTheHerd = answerBreakdown.gameType === 'follow-the-herd';
                const isLiarLiar = answerBreakdown.gameType === 'liar-liar';
                const isCorrect = !isLiarLiar && answerBreakdown.correctAnswer === optLetter;
                const scores = isFollowTheHerd && answerBreakdown.winningAnswers?.includes(optLetter);
                const barColors = { A: 'bg-red-600', B: 'bg-blue-600', C: 'bg-yellow-600', D: 'bg-green-600' };

                return (
                  <div
                    key={idx}
                    className={`bg-zinc-900 border p-4 rounded-2xl ${isFollowTheHerd ? (scores ? 'border-emerald-400' : 'border-zinc-800') : isCorrect ? 'border-emerald-400' : 'border-zinc-800'}`}
                  >
                    <div className="flex justify-between items-center mb-2 gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className={`${barColors[optLetter]} w-10 h-10 rounded-xl flex items-center justify-center font-black shrink-0`}>
                          {optLetter}
                        </span>
                        <span className="font-bold text-white truncate">{optText}</span>
                        {isFollowTheHerd ? scores && <span className="text-xs font-bold uppercase text-emerald-400 shrink-0">Scores</span> : isCorrect && <span className="text-xs font-bold uppercase text-emerald-400 shrink-0">Correct</span>}
                      </div>
                      <span className="font-mono font-black text-white shrink-0">{count} ({pct}%)</span>
                    </div>
                    <div className="h-3 bg-zinc-950 rounded-full overflow-hidden">
                      <div
                        className={`${barColors[optLetter]} h-full rounded-full transition-all duration-700`}
                        style={{ width: `${Math.max(pct, count > 0 ? 4 : 0)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="text-center">
              {answerBreakdown.isLastQuestion ? (
                <div>
                  <p className="text-amber-300 font-semibold mb-4">Next screen is the winner reveal</p>
                  <button onClick={revealWinner} className="bg-amber-500 hover:bg-amber-400 text-zinc-950 font-black text-lg px-8 py-4 rounded-2xl shadow-xl transition">
                    Reveal the Winner 🏆
                  </button>
                </div>
              ) : (
                <button onClick={showScores} className="bg-purple-600 hover:bg-purple-500 text-white font-bold text-lg px-8 py-4 rounded-2xl shadow-xl transition">
                  Show Scoreboard
                </button>
              )}
            </div>
          </div>
        )}

        {/* VIEW 4: ROUND RESULTS & LEADERBOARD */}
        {view === 'results' && roundResults && (
          <div className="max-w-2xl mx-auto text-center">
            {roundResults.isFinalQuestionNext && (
              <div className="mb-6 bg-amber-950/80 border border-amber-500 text-amber-200 px-5 py-3 rounded-2xl font-bold">
                Next up is the final question of this game
              </div>
            )}

            <h1 className="text-3xl font-extrabold text-purple-400 mb-2">Round Results</h1>
            {roundResults.gameType === 'trivia' && <p className="text-zinc-400 mb-6">Correct Answer was: <span className="text-emerald-400 font-bold text-2xl">[{roundResults.correctAnswer}]</span></p>}
            {roundResults.gameType === 'liar-liar' && <p className="text-zinc-400 mb-6">Correct answer: <span className="text-emerald-400 font-bold text-2xl">{roundResults.options?.[roundResults.correctAnswer === 'B' ? 1 : 0]}</span></p>}
            {roundResults.gameType === 'autocomplete-trivia' && <p className="text-zinc-400 mb-6">Correct answer: <span className="text-emerald-400 font-bold text-2xl">{roundResults.correctAnswer}</span></p>}

            <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-3xl shadow-2xl space-y-3 mb-8">
              <h2 className="text-xl font-bold text-white mb-4">Game Leaderboard</h2>
              {[...roundResults.players]
                .sort((a, b) => b.score - a.score)
                .map((p, idx) => (
                  <div key={p.id} className="flex justify-between items-center bg-zinc-950 p-4 rounded-xl border border-zinc-800">
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-zinc-500 w-6">#{idx + 1}</span>
                      {p.rankChange !== null && p.rankChange !== 0 && <span className={`font-black ${p.rankChange > 0 ? 'text-emerald-400' : 'text-rose-400'}`} title={`${Math.abs(p.rankChange)} place${Math.abs(p.rankChange) === 1 ? '' : 's'} ${p.rankChange > 0 ? 'up' : 'down'}`}>{p.rankChange > 0 ? (p.rankChange > 10 ? '⇈' : '↑') : (p.rankChange < -10 ? '⇊' : '↓')}</span>}
                      <span className="text-xl">{p.emoji}</span>
                      <span className="font-bold text-white">{p.name}</span>
                    </div>
                    <span className="font-mono text-emerald-400 font-extrabold text-lg">{p.score} pts</span>
                  </div>
              ))}
            </div>

            {roundResults.isFinalQuestionNext ? (
              <button onClick={nextQuestion} className="bg-amber-500 hover:bg-amber-400 text-zinc-950 font-black text-lg px-8 py-4 rounded-2xl shadow-xl transition">
                Start Final Question ➡️
              </button>
            ) : (
              <button onClick={nextQuestion} className="bg-purple-600 hover:bg-purple-500 text-white font-bold text-lg px-8 py-4 rounded-2xl shadow-xl transition">
                Next Question ➡️
              </button>
            )}
          </div>
        )}

        {/* VIEW 5a: STAGGERED WINNER REVEAL */}
        {view === 'winner-reveal' && winnerReveal && (
          <div className="max-w-3xl mx-auto text-center py-8">
            <p className="text-2xl md:text-3xl font-bold text-zinc-400 mb-10 tracking-wide">The winner is...</p>
            <div className="min-h-48 flex flex-col items-center justify-center mb-12">
              {showWinnerName && winnerReveal.winners.length > 0 ? (
                <div className="space-y-6">
                  {winnerReveal.winners.map((w) => (
                    <div key={w.id} className="flex flex-col items-center gap-3">
                      <span className="text-7xl">{w.emoji}</span>
                      <h1 className="text-5xl md:text-7xl font-black text-white tracking-tight">{w.name}</h1>
                      <p className="font-mono text-2xl font-bold text-emerald-400">{w.score} pts</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="h-16 w-16 border-4 border-purple-500 border-t-transparent rounded-full animate-spin" />
              )}
            </div>
            {showWinnerName && (
              <button onClick={showFinalScores} className="bg-purple-600 hover:bg-purple-500 text-white font-bold text-lg px-8 py-4 rounded-2xl shadow-xl transition">
                Show Final Scoreboard
              </button>
            )}
          </div>
        )}

        {/* VIEW 5: FINAL STANDINGS */}
        {view === 'game-over' && (
          <div className="max-w-2xl mx-auto text-center">
            <h1 className="text-4xl font-black text-purple-400 mb-2">Final Standings</h1>
            <p className="text-zinc-400 mb-8">How everyone finished this game</p>

            <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-3xl shadow-2xl space-y-3 mb-8">
              {finalScores.map((p, idx) => (
                <div key={p.id} className="flex justify-between items-center bg-zinc-950 p-4 rounded-xl border border-zinc-800">
                  <div className="flex items-center gap-3">
                    <span className="font-bold text-zinc-500 w-6">#{idx + 1}</span>
                    <span className="text-xl">{p.emoji}</span>
                    <span className="font-bold text-white">{p.name}</span>
                  </div>
                  <span className="font-mono text-emerald-400 font-extrabold text-lg">{p.score} pts</span>
                </div>
              ))}
            </div>

            <button onClick={endGame} className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-8 py-4 rounded-xl shadow-xl transition">
              End Game &amp; Return to Lobby
            </button>
          </div>
        )}

        {view === 'answer-entry' && (
          <div className="max-w-xl mx-auto text-center bg-zinc-900 border border-zinc-800 rounded-3xl p-8">
            <p className="text-purple-300 font-bold uppercase tracking-widest mb-3">Shot In The Dark</p>
            <h2 className="text-3xl font-black text-white mb-3">Set the correct answer</h2>
            <p className="text-zinc-400 mb-6">Players are locked in. You can confirm or alter this number before scores are calculated.</p>
            <input type="number" value={correctNumber} onChange={(e) => setCorrectNumber(e.target.value)} className="w-full p-4 text-3xl text-center bg-zinc-950 border border-zinc-700 rounded-xl text-white mb-5" autoFocus />
            <button onClick={scoreShotInTheDark} className="bg-purple-600 hover:bg-purple-500 text-white font-bold px-8 py-4 rounded-xl">Score Guesses &amp; Reveal Answer</button>
          </div>
        )}

        {/* VIEW 6: GAME BUILDER (Create / Edit Mode) */}
        {view === 'builder' && (
          <div>
            <h2 className="text-xl font-bold mb-4 text-zinc-200">
              {editingGameId ? 'Edit Game' : 'Create a New Game'}
            </h2>
            
            <div className="mb-8 bg-zinc-900 p-6 rounded-2xl border border-zinc-800 shadow-xl">
              <label className="block text-zinc-300 font-semibold mb-2">Game Title</label>
              <input 
                type="text" 
                className="w-full p-3 bg-zinc-950 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-purple-500" 
                placeholder="e.g., Movie Trivia Night"
                value={gameTitle}
                onChange={(e) => setGameTitle(e.target.value)}
              />
              <label className="block text-zinc-300 font-semibold mt-4 mb-2">Game Type</label>
              <select value={gameType} onChange={(e) => { const type = e.target.value; setGameType(type); setQuestions([newQuestion(type)]); }} className="w-full p-3 bg-zinc-950 border border-zinc-700 rounded-lg text-white">
                <option value="trivia">Trivia</option><option value="shot-in-the-dark">Shot In The Dark</option><option value="follow-the-herd">Follow The Herd</option><option value="liar-liar">Liar Liar</option><option value="simon-says">Simon Says</option><option value="player-picker">Player Picker</option><option value="autocomplete-trivia">Autocomplete Trivia</option>
              </select>
            </div>

            {questions.map((q, qIndex) => (
              <div key={qIndex} className="mb-6 p-6 bg-zinc-900 border border-zinc-800 rounded-2xl shadow-xl">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-bold text-lg text-purple-300">Question {qIndex + 1}</h3>
                  {questions.length > 1 && (
                    <button 
                      onClick={() => removeQuestionField(qIndex)}
                      className="text-red-400 hover:text-red-300 text-sm font-semibold"
                    >
                      Remove Question ❌
                    </button>
                  )}
                </div>

                {gameType !== 'simon-says' && gameType !== 'player-picker' && <input
                  type="text" 
                  placeholder="Type your question..."
                  className="w-full p-3 bg-zinc-950 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 mb-4 focus:outline-none focus:border-purple-500"
                  value={q.questionText}
                  onChange={(e) => handleQuestionChange(qIndex, 'questionText', e.target.value)}
                />}

                {gameType === 'autocomplete-trivia' && <div className="mb-4 rounded-xl border border-teal-800 bg-teal-950/30 p-4"><label className="block font-bold text-teal-200 mb-2">Possible answers</label><textarea value={(q.autocompleteAnswers || []).join('\n')} onChange={(e) => handleAutocompleteAnswers(qIndex, e.target.value)} placeholder={'One answer per line\ne.g. The Beatles'} rows={5} className="w-full p-3 bg-zinc-950 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-teal-500 resize-y" /><p className="text-zinc-400 text-sm mt-2">Players type to filter suggestions, then tap one answer to submit.</p></div>}

                {gameType === 'player-picker' ? <div className="mb-4 rounded-xl border border-fuchsia-800 bg-fuchsia-950/30 p-4 text-fuchsia-200"><p className="font-bold">Player Picker</p><p className="text-sm mt-1">No questions or scores. The host chooses how many randomly selected players remain when the game begins.</p></div> : gameType === 'simon-says' ? <div className="mb-4 rounded-xl border border-cyan-800 bg-cyan-950/30 p-4"><p className="font-bold text-cyan-200 mb-3">Build the color sequence</p><div className="flex flex-wrap gap-2 min-h-12 mb-4">{(q.simonSequence || []).length === 0 ? <span className="text-zinc-500 text-sm">Choose colors below to build this round.</span> : q.simonSequence.map((color, index) => <span key={index} className={`w-10 h-10 rounded-lg ${color === 'red' ? 'bg-red-600' : color === 'green' ? 'bg-green-600' : color === 'blue' ? 'bg-blue-600' : 'bg-orange-500'}`} title={`${index + 1}: ${color}`} />)}</div><div className="grid grid-cols-2 gap-2 max-w-xs"><button type="button" onClick={() => handleQuestionChange(qIndex, 'simonSequence', [...(q.simonSequence || []), 'red'])} className="h-14 rounded-xl bg-red-600 font-bold">Red</button><button type="button" onClick={() => handleQuestionChange(qIndex, 'simonSequence', [...(q.simonSequence || []), 'green'])} className="h-14 rounded-xl bg-green-600 font-bold">Green</button><button type="button" onClick={() => handleQuestionChange(qIndex, 'simonSequence', [...(q.simonSequence || []), 'blue'])} className="h-14 rounded-xl bg-blue-600 font-bold">Blue</button><button type="button" onClick={() => handleQuestionChange(qIndex, 'simonSequence', [...(q.simonSequence || []), 'orange'])} className="h-14 rounded-xl bg-orange-500 font-bold">Orange</button></div><div className="flex gap-3 mt-4"><button type="button" onClick={() => handleQuestionChange(qIndex, 'simonSequence', (q.simonSequence || []).slice(0, -1))} className="text-sm text-zinc-300">Undo last</button><button type="button" onClick={() => handleQuestionChange(qIndex, 'simonSequence', [])} className="text-sm text-red-300">Clear sequence</button></div></div> : gameType === 'liar-liar' ? <div className="mb-4 rounded-xl border border-rose-800 bg-rose-950/30 p-4 text-rose-200"><p className="font-bold">Liar Liar</p><p className="text-sm mt-1">Players choose between fixed answers: <strong>True</strong> or <strong>False</strong>.</p></div> : gameType !== 'shot-in-the-dark' ? <div className="space-y-3 mb-4">
                  {gameType !== 'autocomplete-trivia' && q.options.map((opt, optIndex) => {
                    const optLetter = ['A', 'B', 'C', 'D'][optIndex];
                    const badgeColors = { A: 'bg-red-500/20 text-red-400 border-red-500/30', B: 'bg-blue-500/20 text-blue-400 border-blue-500/30', C: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', D: 'bg-green-500/20 text-green-400 border-green-500/30' };

                    return (
                      <div key={optIndex} className="flex items-center gap-3">
                        <span className={`w-8 h-8 flex items-center justify-center rounded-lg font-bold border ${badgeColors[optLetter]}`}>
                          {optLetter}
                        </span>
                        <input 
                          type="text"
                          placeholder={`Option ${optLetter}`}
                          className="w-full p-2.5 bg-zinc-950 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-purple-500"
                          value={opt}
                          onChange={(e) => handleOptionChange(qIndex, optIndex, e.target.value)}
                        />
                      </div>
                    );
                  })}
                </div> : <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                  {[['answerMin', 'Minimum'], ['answerMax', 'Maximum'], ['answerStep', 'Step size']].map(([field, label]) => <label key={field} className="text-sm text-zinc-300">{label}<input type="number" value={q[field]} onChange={(e) => handleQuestionChange(qIndex, field, Number(e.target.value))} className="mt-1 w-full p-2.5 bg-zinc-950 border border-zinc-700 rounded-lg text-white" /></label>)}
                  <label className="sm:col-span-3 text-sm text-zinc-300">Correct number <span className="text-zinc-500">(optional; can be set after guesses)</span><input type="number" value={q.correctNumber} onChange={(e) => handleQuestionChange(qIndex, 'correctNumber', e.target.value)} className="mt-1 w-full p-2.5 bg-zinc-950 border border-zinc-700 rounded-lg text-white" /></label>
                </div>}

                <div className="flex gap-6 pt-4 border-t border-zinc-800">
                  {gameType === 'autocomplete-trivia' && <div><label className="block text-xs uppercase tracking-wider text-zinc-400 mb-1">Correct Answer</label><select className="p-2 bg-zinc-950 border border-zinc-700 rounded-lg text-white focus:outline-none focus:border-teal-500 font-bold" value={q.correctAnswer} onChange={(e) => handleQuestionChange(qIndex, 'correctAnswer', e.target.value)}>{(q.autocompleteAnswers || []).map((answer) => <option key={answer} value={answer}>{answer}</option>)}</select></div>}
                  {(gameType === 'trivia' || gameType === 'liar-liar') && <div>
                    <label className="block text-xs uppercase tracking-wider text-zinc-400 mb-1">Correct Answer</label>
                    <select 
                      className="p-2 bg-zinc-950 border border-zinc-700 rounded-lg text-white focus:outline-none focus:border-purple-500 font-bold"
                      value={q.correctAnswer}
                      onChange={(e) => handleQuestionChange(qIndex, 'correctAnswer', e.target.value)}
                    >
                      <option value="A">{gameType === 'liar-liar' ? 'True' : 'Option A'}</option>
                      <option value="B">{gameType === 'liar-liar' ? 'False' : 'Option B'}</option>
                      {gameType === 'trivia' && <><option value="C">Option C</option><option value="D">Option D</option></>}
                    </select>
                  </div>}
                  {gameType === 'follow-the-herd' && <div>
                    <label className="block text-xs uppercase tracking-wider text-zinc-400 mb-1">Herd Scoring</label>
                    <select className="p-2 bg-zinc-950 border border-zinc-700 rounded-lg text-white focus:outline-none focus:border-purple-500 font-bold" value={q.herdMode || 'most'} onChange={(e) => handleQuestionChange(qIndex, 'herdMode', e.target.value)}>
                      <option value="most">Most popular answer scores</option>
                      <option value="least">Least popular answer scores</option>
                    </select>
                  </div>}

                  {gameType !== 'player-picker' && <div>
                    <label className="block text-xs uppercase tracking-wider text-zinc-400 mb-1">Time Limit (sec)</label>
                    <input 
                      type="number" 
                      className="p-2 bg-zinc-950 border border-zinc-700 rounded-lg text-white w-24 focus:outline-none focus:border-purple-500"
                      value={q.timeLimit}
                      onChange={(e) => handleQuestionChange(qIndex, 'timeLimit', Number(e.target.value))}
                    />
                  </div>}
                </div>

              </div>
            ))}
            
            <div className="flex gap-4 mt-6">
              <button onClick={addQuestionField} className="bg-zinc-800 hover:bg-zinc-700 text-purple-300 px-6 py-3 rounded-xl border border-zinc-700 font-semibold">+ Add Question</button>
              <button onClick={() => setView('library')} className="bg-zinc-900 hover:bg-zinc-800 text-zinc-400 px-6 py-3 rounded-xl">Cancel</button>
              <button onClick={saveGame} className="bg-purple-600 hover:bg-purple-500 text-white font-semibold px-6 py-3 rounded-xl shadow-lg transition ml-auto">
                {editingGameId ? 'Update Game' : 'Save Game to Library'}
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
