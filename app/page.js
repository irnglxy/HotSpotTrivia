"use client";

import React, { useState, useEffect } from 'react';
import { socket } from '@/lib/socket';

export default function MasterHostDashboard() {
  const [view, setView] = useState('library'); // 'library', 'lobby', 'question', 'results', 'game-over', 'builder'
  
  // Library State
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);

  // Master Party & Game State
  const [players, setPlayers] = useState([]);
  const [activeGameId, setActiveGameId] = useState(null);
  const [totalQuestions, setTotalQuestions] = useState(0);
  
  // Question & Timer State
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [timeLeft, setTimeLeft] = useState(15);
  const [answerStats, setAnswerStats] = useState({ totalAnswers: 0, totalPlayers: 0 });
  const [roundResults, setRoundResults] = useState(null);
  const [finalScores, setFinalScores] = useState([]);

  // Builder State
  const [gameTitle, setGameTitle] = useState('');
  const [questions, setQuestions] = useState([
    { questionText: '', options: ['', '', '', ''], correctAnswer: 'A', timeLimit: 15 }
  ]);

  useEffect(() => {
    // Register this window as the master host
    socket.emit('host-master-lobby');

    socket.on('update-players', (data) => {
      setPlayers(data.players);
    });

    socket.on('game-loaded', (data) => {
      setTotalQuestions(data.totalQuestions);
      setPlayers(data.players);
      setView('lobby'); // Move into lobby view once game is loaded
    });

    socket.on('next-question', (qData) => {
      setView('question');
      setCurrentQuestion(qData);
      setTimeLeft(qData.timeLimit || 15);
      setAnswerStats({ totalAnswers: 0, totalPlayers: players.length });
      setRoundResults(null);
    });

    socket.on('player-answered-update', (stats) => {
      setAnswerStats(stats);
    });

    socket.on('round-results', (results) => {
      setView('results');
      setRoundResults(results);
      setPlayers(results.players);
    });

    socket.on('game-over', (data) => {
      setView('game-over');
      setFinalScores(data.players);
    });

    fetchGames();

    return () => {
      socket.off('host-master-lobby');
      socket.off('update-players');
      socket.off('game-loaded');
      socket.off('next-question');
      socket.off('player-answered-update');
      socket.off('round-results');
      socket.off('game-over');
    };
  }, [players.length]);

  // Timer Countdown Effect
  useEffect(() => {
    if (view === 'question' && timeLeft > 0) {
      const timer = setInterval(() => {
        setTimeLeft((prev) => (prev > 0 ? prev - 1 : 0));
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [view, timeLeft]);

  const fetchGames = async () => {
    setLoading(true);
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

  const loadGame = (gameId) => {
    setActiveGameId(gameId);
    socket.emit('load-game', { gameId });
  };

  const startGame = () => {
    socket.emit('start-game');
  };

  const nextQuestion = () => {
    socket.emit('next-question-btn');
  };

  // Builder functions
  const addQuestionField = () => {
    setQuestions([...questions, { questionText: '', options: ['', '', '', ''], correctAnswer: 'A', timeLimit: 15 }]);
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
    const gameData = { title: gameTitle, questions };
    try {
      const response = await fetch('/api/games', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(gameData),
      });
      if (response.ok) {
        alert('Game saved successfully!');
        setGameTitle('');
        setQuestions([{ questionText: '', options: ['', '', '', ''], correctAnswer: 'A', timeLimit: 15 }]);
        fetchGames();
        setView('library');
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
              onClick={() => setView('builder')}
              className={`px-4 py-2 rounded-xl font-semibold transition ${view === 'builder' ? 'bg-purple-600 text-white' : 'bg-zinc-900 text-zinc-400 hover:text-white'}`}
            >
              + Create Game
            </button>
          </div>
        </div>

        {/* GLOBAL PLAYER LOUNGE BANNER (Visible on Library & Builder screens) */}
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

        {/* VIEW 1: GAME LIBRARY */}
        {view === 'library' && (
          <div>
            <h2 className="text-xl font-bold mb-4 text-zinc-200">Select a Game to Host</h2>
            {loading ? (
              <p className="text-zinc-500">Loading games...</p>
            ) : games.length === 0 ? (
              <div className="text-center py-12 bg-zinc-900 border border-zinc-800 rounded-2xl">
                <p className="text-zinc-400 mb-4">No trivia games found.</p>
                <button onClick={() => setView('builder')} className="bg-purple-600 text-white font-semibold px-6 py-2.5 rounded-xl">
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
                    <button 
                      onClick={() => loadGame(game.id)}
                      className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-6 py-3 rounded-xl shadow-lg transition flex items-center gap-2"
                    >
                      Load Game & Open Lobby 🚀
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* VIEW 2: MASTER LOBBY (Game Selected, Ready to start) */}
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
            <div className="flex justify-between items-center mb-6">
              <p className="text-zinc-400 font-bold">Question {currentQuestion.questionNumber} of {currentQuestion.totalQuestions}</p>
              
              {/* Visual Countdown Timer Badge */}
              <div className={`px-6 py-2 rounded-full font-black text-xl border flex items-center gap-2 ${timeLeft <= 5 ? 'bg-red-950/80 text-red-400 border-red-600 animate-pulse' : 'bg-zinc-900 text-purple-300 border-zinc-700'}`}>
                ⏱️ {timeLeft}s
              </div>

              <div className="bg-purple-900/50 border border-purple-700 text-purple-200 px-4 py-1.5 rounded-full font-bold text-sm">
                Locked In: {answerStats.totalAnswers} / {answerStats.totalPlayers}
              </div>
            </div>
            
            <h1 className="text-4xl md:text-5xl font-black text-white mb-12 bg-zinc-900 border border-zinc-800 p-8 rounded-3xl shadow-2xl leading-tight">
              {currentQuestion.questionText}
            </h1>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
          </div>
        )}

        {/* VIEW 4: ROUND RESULTS & LEADERBOARD */}
        {view === 'results' && roundResults && (
          <div className="max-w-2xl mx-auto text-center">
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

            <button onClick={nextQuestion} className="bg-purple-600 hover:bg-purple-500 text-white font-bold text-lg px-8 py-4 rounded-2xl shadow-xl transition">
              Next Question ➡️
            </button>
          </div>
        )}

        {/* VIEW 5: GAME OVER & PODIUM */}
        {view === 'game-over' && (
          <div className="max-w-2xl mx-auto text-center">
            <h1 className="text-4xl font-black text-purple-400 mb-2">Game Over! 🏆</h1>
            <p className="text-zinc-400 mb-8">Stand-alone game winner crowned!</p>

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

        {/* VIEW 6: GAME BUILDER */}
        {view === 'builder' && (
          <div>
            <h2 className="text-xl font-bold mb-4 text-zinc-200">Create a New Game</h2>
            
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
                <h3 className="font-bold text-lg text-purple-300 mb-4">Question {qIndex + 1}</h3>
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
                    return (
                      <div key={optIndex} className="flex items-center gap-3">
                        <span className="w-8 h-8 flex items-center justify-center rounded-lg font-bold bg-zinc-800 text-zinc-300">{optLetter}</span>
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
              </div>
            ))}
            
            <div className="flex gap-4 mt-6">
              <button onClick={addQuestionField} className="bg-zinc-800 text-purple-300 px-6 py-3 rounded-xl">+ Add Question</button>
              <button onClick={saveGame} className="bg-purple-600 text-white px-6 py-3 rounded-xl ml-auto">Save Game</button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}