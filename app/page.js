"use client";

import React, { useState, useEffect } from 'react';
import { socket } from '@/lib/socket';

export default function MasterHostDashboard() {
  const [view, setView] = useState('library'); // 'library', 'lobby', 'question', 'answer-reveal', 'results', 'winner-reveal', 'game-over', 'builder'
  
  // Library State
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);

  // Master Party & Game State
  const [players, setPlayers] = useState([]);
  
  // Question & Timer State
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [timeLeft, setTimeLeft] = useState(15);
  const [answerStats, setAnswerStats] = useState({ totalAnswers: 0, totalPlayers: 0 });
  const [answerBreakdown, setAnswerBreakdown] = useState(null);
  const [roundResults, setRoundResults] = useState(null);
  const [winnerReveal, setWinnerReveal] = useState(null);
  const [showWinnerName, setShowWinnerName] = useState(false);
  const [finalScores, setFinalScores] = useState([]);

  // Builder State
  const [editingGameId, setEditingGameId] = useState(null);
  const [gameTitle, setGameTitle] = useState('');
  const [questions, setQuestions] = useState([
    { questionText: '', options: ['', '', '', ''], correctAnswer: 'A', timeLimit: 15 }
  ]);

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
    socket.on('game-loaded', (data) => {
      setPlayers(data.players);
      setView('lobby');
    });
    socket.on('next-question', (qData) => {
      setView('question');
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

    return () => {
      socket.off('host-master-lobby');
      socket.off('update-players');
      socket.off('game-loaded');
      socket.off('next-question');
      socket.off('player-answered-update');
      socket.off('answer-breakdown');
      socket.off('round-results');
      socket.off('winner-reveal');
      socket.off('game-over');
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
  const revealAnswers = () => socket.emit('reveal-answers');
  const showScores = () => socket.emit('show-scores');
  const revealWinner = () => socket.emit('reveal-winner');
  const showFinalScores = () => socket.emit('show-final-scores');
  const nextQuestion = () => socket.emit('next-question-btn');

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
    setQuestions([{ questionText: '', options: ['', '', '', ''], correctAnswer: 'A', timeLimit: 15 }]);
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
        setQuestions(data.game.questions);
        setView('builder');
      } else {
        alert("Could not load game for editing.");
      }
    } catch (err) {
      console.error("Failed to load game for edit:", err);
    }
  };

  const addQuestionField = () => {
    setQuestions([...questions, { questionText: '', options: ['', '', '', ''], correctAnswer: 'A', timeLimit: 15 }]);
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

  const saveGame = async () => {
    if (!gameTitle.trim()) {
      alert("Please enter a game title.");
      return;
    }

    const payload = { id: editingGameId, title: gameTitle, questions };
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
        setQuestions([{ questionText: '', options: ['', '', '', ''], correctAnswer: 'A', timeLimit: 15 }]);
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
                {games.map((game) => (
                  <div key={game.id} className="p-5 bg-zinc-900 border border-zinc-800 rounded-2xl flex justify-between items-center shadow-lg">
                    <div>
                      <h3 className="font-bold text-lg text-white">{game.title}</h3>
                      <p className="text-sm text-zinc-400">{game.question_count} Questions</p>
                    </div>
                    <div className="flex items-center gap-3">
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
            
            <h1 className="text-4xl md:text-5xl font-black text-white mb-12 bg-zinc-900 border border-zinc-800 p-8 rounded-3xl shadow-2xl leading-tight">
              {currentQuestion.questionText}
            </h1>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-10">
              {currentQuestion.options.map((opt, idx) => {
                const optLetter = ['A', 'B', 'C', 'D'][idx];
                const optColors = { A: 'bg-red-600', B: 'bg-blue-600', C: 'bg-yellow-600', D: 'bg-green-600' };

                return (
                  <div key={idx} className={`${optColors[optLetter]} text-white p-6 rounded-2xl font-bold text-xl shadow-lg flex items-center`}>
                    <span className="bg-black/30 w-12 h-12 rounded-xl flex items-center justify-center mr-4 text-2xl font-black shrink-0">{optLetter}</span>
                    <span className="flex-1 text-left leading-snug">{opt}</span>
                  </div>
                );
              })}
            </div>

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
        {view === 'answer-reveal' && answerBreakdown && (
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
            <p className="text-purple-300 font-semibold mb-6">How the room voted</p>

            <div className="space-y-3 mb-8">
              {answerBreakdown.options.map((optText, idx) => {
                const optLetter = ['A', 'B', 'C', 'D'][idx];
                const count = answerBreakdown.counts[optLetter] || 0;
                const pct = answerBreakdown.totalAnswers === 0 ? 0 : Math.round((count / answerBreakdown.totalAnswers) * 100);
                const isCorrect = answerBreakdown.correctAnswer === optLetter;
                const barColors = { A: 'bg-red-600', B: 'bg-blue-600', C: 'bg-yellow-600', D: 'bg-green-600' };

                return (
                  <div
                    key={idx}
                    className={`bg-zinc-900 border p-4 rounded-2xl ${isCorrect ? 'border-emerald-400' : 'border-zinc-800'}`}
                  >
                    <div className="flex justify-between items-center mb-2 gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className={`${barColors[optLetter]} w-10 h-10 rounded-xl flex items-center justify-center font-black shrink-0`}>
                          {optLetter}
                        </span>
                        <span className="font-bold text-white truncate">{optText}</span>
                        {isCorrect && <span className="text-xs font-bold uppercase text-emerald-400 shrink-0">Correct</span>}
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
            <p className="text-zinc-400 mb-6">Correct Answer was: <span className="text-emerald-400 font-bold text-2xl">[{roundResults.correctAnswer}]</span></p>

            <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-3xl shadow-2xl space-y-3 mb-8">
              <h2 className="text-xl font-bold text-white mb-4">Game Leaderboard</h2>
              {roundResults.players
                .sort((a, b) => b.score - a.score)
                .map((p, idx) => (
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

            <button onClick={() => setView('library')} className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-8 py-4 rounded-xl shadow-xl transition">
              Choose Next Game for the Evening 🚀
            </button>
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

                <input 
                  type="text" 
                  placeholder="Type your question..."
                  className="w-full p-3 bg-zinc-950 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 mb-4 focus:outline-none focus:border-purple-500"
                  value={q.questionText}
                  onChange={(e) => handleQuestionChange(qIndex, 'questionText', e.target.value)}
                />

                <div className="space-y-3 mb-4">
                  {q.options.map((opt, optIndex) => {
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
                </div>

                <div className="flex gap-6 pt-4 border-t border-zinc-800">
                  <div>
                    <label className="block text-xs uppercase tracking-wider text-zinc-400 mb-1">Correct Answer</label>
                    <select 
                      className="p-2 bg-zinc-950 border border-zinc-700 rounded-lg text-white focus:outline-none focus:border-purple-500 font-bold"
                      value={q.correctAnswer}
                      onChange={(e) => handleQuestionChange(qIndex, 'correctAnswer', e.target.value)}
                    >
                      <option value="A">Option A</option>
                      <option value="B">Option B</option>
                      <option value="C">Option C</option>
                      <option value="D">Option D</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs uppercase tracking-wider text-zinc-400 mb-1">Time Limit (sec)</label>
                    <input 
                      type="number" 
                      className="p-2 bg-zinc-950 border border-zinc-700 rounded-lg text-white w-24 focus:outline-none focus:border-purple-500"
                      value={q.timeLimit}
                      onChange={(e) => handleQuestionChange(qIndex, 'timeLimit', Number(e.target.value))}
                    />
                  </div>
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
