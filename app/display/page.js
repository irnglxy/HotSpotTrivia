"use client";

import React, { useEffect, useState } from 'react';
import { socket } from '@/lib/socket';

export default function DisplayScreen() {
  const [players, setPlayers] = useState([]);
  const [status, setStatus] = useState('lobby'); // 'lobby', 'playing', 'answer-reveal', 'results', 'winner-reveal', 'game-over'
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [timeLeft, setTimeLeft] = useState(15);
  const [answerBreakdown, setAnswerBreakdown] = useState(null);
  const [roundResults, setRoundResults] = useState(null);
  const [winnerReveal, setWinnerReveal] = useState(null);
  const [showWinnerName, setShowWinnerName] = useState(false);
  const [finalScores, setFinalScores] = useState([]);

  useEffect(() => {
    // Tell server this is the big screen display
    socket.emit('join-display-screen');

    socket.on('master-update', (data) => {
      setPlayers(data.players);
      setStatus(data.status);
    });

    socket.on('update-players', (data) => {
      setPlayers(data.players);
    });

    socket.on('game-loaded', (data) => {
      setPlayers(data.players);
      setStatus('lobby');
    });

    socket.on('next-question', (qData) => {
      setStatus('playing');
      setCurrentQuestion(qData);
      setTimeLeft(qData.timeLimit || 15);
      setAnswerBreakdown(null);
      setRoundResults(null);
      setWinnerReveal(null);
      setShowWinnerName(false);
    });

    socket.on('answer-breakdown', (data) => {
      setStatus('answer-reveal');
      setAnswerBreakdown(data);
    });

    socket.on('round-results', (results) => {
      setStatus('results');
      setRoundResults(results);
      setPlayers(results.players);
    });

    socket.on('winner-reveal', (data) => {
      setStatus('winner-reveal');
      setWinnerReveal(data);
      setShowWinnerName(false);
    });

    socket.on('game-over', (data) => {
      setStatus('game-over');
      setFinalScores(data.players);
    });

    return () => {
      socket.off('join-display-screen');
      socket.off('master-update');
      socket.off('update-players');
      socket.off('game-loaded');
      socket.off('next-question');
      socket.off('answer-breakdown');
      socket.off('round-results');
      socket.off('winner-reveal');
      socket.off('game-over');
    };
  }, []);

  // Timer countdown effect for the big screen
  useEffect(() => {
    if (status === 'playing' && timeLeft > 0) {
      const timer = setInterval(() => {
        setTimeLeft((prev) => (prev > 0 ? prev - 1 : 0));
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [status, timeLeft]);

  useEffect(() => {
    if (status !== 'winner-reveal') return;
    const timer = setTimeout(() => setShowWinnerName(true), 3000);
    return () => clearTimeout(timer);
  }, [status, winnerReveal]);

  return (
    <main className="min-h-screen bg-zinc-950 text-white flex flex-col items-center justify-between p-8 md:p-16 select-none overflow-hidden">
      
      {/* TOP BAR BRANDING */}
      <div className="w-full flex justify-between items-center border-b border-zinc-800 pb-4">
        <div className="flex items-center gap-3">
       
          <h1 className="text-2xl font-black tracking-wider text-purple-400 uppercase">Deven and Ned Present</h1>
        </div>
        <div className="text-sm font-mono text-zinc-400 bg-zinc-900 border border-zinc-800 px-4 py-2 rounded-xl">
          Join on your phone: <span className="text-emerald-400 font-bold">/play</span>
        </div>
      </div>

      {/* CENTER STAGE CONTENT */}
      <div className="w-full max-w-6xl my-auto py-8">
        
        {/* STATE 1: HOLD SCREEN / LOBBY (When no game or waiting to start) */}
        {(status === 'lobby' || status === 'idle') && (
          <div className="text-center space-y-8">
            <div className="space-y-3">
              <span className="bg-purple-950/80 border border-purple-700 text-purple-300 px-6 py-2 rounded-full text-lg font-bold uppercase tracking-widest inline-block animate-pulse">
                Welcome to the Party!
              </span>
              <h2 className="text-6xl font-black tracking-tight text-white">HOT SPOT TRIVIA</h2>
              <p className="text-zinc-400 text-xl">Head to <span className="text-emerald-400 font-mono underline">/play</span> and log in with your name and emoji.</p>
            </div>

            {/* Live Connected Players Wall */}
            <div className="bg-zinc-900/60 border border-zinc-800 p-8 rounded-3xl backdrop-blur shadow-2xl max-w-4xl mx-auto">
              <h3 className="text-xl font-bold text-zinc-300 mb-6 flex justify-between items-center">
                <span>Connected Players in Room</span>
                <span className="text-emerald-400 font-mono text-2xl">{players.length}</span>
              </h3>

              {players.length === 0 ? (
                <p className="text-zinc-500 italic text-lg py-8">Waiting for the first player to connect...</p>
              ) : (
                <div className="flex flex-wrap gap-3 justify-center max-h-80 overflow-y-auto p-2">
                  {players.map((p) => (
                    <div 
                      key={p.id}
                      className="flex items-center gap-3 px-5 py-3 rounded-2xl font-bold text-lg shadow-lg border transition transform hover:scale-105"
                      style={{ backgroundColor: p.color + '22', borderColor: p.color + '66', color: '#fff' }}
                    >
                      <span className="text-3xl">{p.emoji}</span>
                      <span>{p.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* STATE 2: LIVE QUESTION BOARD */}
        {status === 'playing' && currentQuestion && (
          <div className="w-full space-y-8">
            <div className="flex justify-between items-center">
              <span className="text-zinc-400 font-bold text-xl uppercase tracking-widest">
                Question {currentQuestion.questionNumber} of {currentQuestion.totalQuestions}
              </span>
              
              {/* Massive Cinematic Timer */}
              <div className={`px-8 py-3 rounded-2xl font-black text-3xl border flex items-center gap-3 shadow-2xl ${timeLeft <= 0 ? 'bg-red-950 text-red-400 border-red-600' : timeLeft <= 5 ? 'bg-red-950 text-red-400 border-red-600 animate-pulse scale-105' : 'bg-zinc-900 text-purple-300 border-zinc-700'}`}>
                {timeLeft <= 0 ? 'TIME UP' : `⏱️ ${timeLeft}s`}
              </div>
            </div>

            {/* Question Card */}
            <div className="bg-zinc-900 border border-zinc-800 p-12 rounded-3xl shadow-2xl text-center">
              <h2 className="text-5xl md:text-6xl font-black text-white leading-tight">
                {currentQuestion.questionText}
              </h2>
            </div>

            {/* Answer Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {currentQuestion.options.map((optText, idx) => {
                const optLetter = ['A', 'B', 'C', 'D'][idx];
                const optColors = {
                  A: 'bg-red-600 border-red-500',
                  B: 'bg-blue-600 border-blue-500',
                  C: 'bg-yellow-600 border-yellow-500',
                  D: 'bg-green-600 border-green-500'
                };

                return (
                  <div key={idx} className={`${optColors[optLetter]} border-2 text-white p-8 rounded-3xl font-bold text-3xl shadow-2xl flex items-center gap-6`}>
                    <span className="w-16 h-16 bg-black/30 rounded-2xl flex items-center justify-center font-black shrink-0">
                      {optLetter}
                    </span>
                    <span className="flex-1 leading-snug">{optText}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* STATE 3: HOW THE ROOM ANSWERED */}
        {status === 'answer-reveal' && answerBreakdown && (
          <div className="w-full space-y-8">
            <div className="flex justify-between items-center">
              <span className="text-zinc-400 font-bold text-xl uppercase tracking-widest">
                Question {answerBreakdown.questionNumber} of {answerBreakdown.totalQuestions}
              </span>
              <span className="text-zinc-400 font-mono text-lg">
                {answerBreakdown.totalAnswers} / {answerBreakdown.totalPlayers} answered
              </span>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 p-8 rounded-3xl shadow-2xl text-center">
              <p className="text-sm uppercase tracking-widest text-purple-300 font-bold mb-3">How the room voted</p>
              <h2 className="text-3xl md:text-4xl font-black text-white leading-tight">
                {answerBreakdown.questionText}
              </h2>
            </div>

            <div className="space-y-4">
              {answerBreakdown.options.map((optText, idx) => {
                const optLetter = ['A', 'B', 'C', 'D'][idx];
                const count = answerBreakdown.counts[optLetter] || 0;
                const pct = answerBreakdown.totalAnswers === 0 ? 0 : Math.round((count / answerBreakdown.totalAnswers) * 100);
                const isCorrect = answerBreakdown.correctAnswer === optLetter;
                const barColors = {
                  A: 'bg-red-600',
                  B: 'bg-blue-600',
                  C: 'bg-yellow-600',
                  D: 'bg-green-600'
                };

                return (
                  <div
                    key={idx}
                    className={`bg-zinc-900 border p-5 rounded-3xl ${isCorrect ? 'border-emerald-400 shadow-lg shadow-emerald-500/10' : 'border-zinc-800'}`}
                  >
                    <div className="flex justify-between items-center mb-3 gap-4">
                      <div className="flex items-center gap-4 min-w-0">
                        <span className={`${barColors[optLetter]} w-12 h-12 rounded-2xl flex items-center justify-center font-black text-xl shrink-0`}>
                          {optLetter}
                        </span>
                        <span className="text-2xl font-bold text-white truncate">{optText}</span>
                        {isCorrect && (
                          <span className="shrink-0 text-sm font-bold uppercase tracking-wider text-emerald-400 bg-emerald-950 border border-emerald-700 px-3 py-1 rounded-full">
                            Correct
                          </span>
                        )}
                      </div>
                      <span className="font-mono text-2xl font-black text-white shrink-0">
                        {count} <span className="text-zinc-500 text-lg font-bold">({pct}%)</span>
                      </span>
                    </div>
                    <div className="h-4 bg-zinc-950 rounded-full overflow-hidden">
                      <div
                        className={`${barColors[optLetter]} h-full rounded-full transition-all duration-700`}
                        style={{ width: `${Math.max(pct, count > 0 ? 4 : 0)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* STATE 4: ROUND RESULTS & LEADERBOARD */}
        {status === 'results' && roundResults && (
          <div className="max-w-3xl mx-auto text-center space-y-8">
            <div className="space-y-2">
              <h2 className="text-5xl font-black text-purple-400">Round Complete!</h2>
              <p className="text-zinc-400 text-2xl">Correct Answer was: <span className="text-emerald-400 font-extrabold text-3xl">[{roundResults.correctAnswer}]</span></p>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 p-8 rounded-3xl shadow-2xl space-y-4">
              <h3 className="text-2xl font-bold text-white mb-6">Current Leaderboard</h3>
              {roundResults.players
                .sort((a, b) => b.score - a.score)
                .map((p, idx) => (
                  <div key={p.id} className="flex justify-between items-center bg-zinc-950 p-5 rounded-2xl border border-zinc-800 text-xl">
                    <div className="flex items-center gap-4">
                      <span className="font-black text-zinc-500 w-8 text-2xl">#{idx + 1}</span>
                      <span className="text-3xl">{p.emoji}</span>
                      <span className="font-bold text-white">{p.name}</span>
                    </div>
                    <span className="font-mono text-emerald-400 font-black text-2xl">{p.score} pts</span>
                  </div>
              ))}
            </div>
          </div>
        )}

        {/* STATE 5: STAGGERED WINNER REVEAL */}
        {status === 'winner-reveal' && winnerReveal && (
          <div className="text-center space-y-10 py-8">
            <p className="text-4xl md:text-5xl font-bold text-zinc-400 tracking-wide">The winner is...</p>
            <div className="min-h-64 flex flex-col items-center justify-center">
              {showWinnerName && winnerReveal.winners.length > 0 ? (
                <div className="space-y-8">
                  {winnerReveal.winners.map((w) => (
                    <div key={w.id} className="flex flex-col items-center gap-4">
                      <span className="text-8xl">{w.emoji}</span>
                      <h2 className="text-6xl md:text-8xl font-black text-white tracking-tight">{w.name}</h2>
                      <p className="font-mono text-3xl font-black text-emerald-400">{w.score} pts</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="h-20 w-20 border-4 border-purple-500 border-t-transparent rounded-full animate-spin" />
              )}
            </div>
          </div>
        )}

        {/* STATE 6: FINAL STANDINGS */}
        {status === 'game-over' && (
          <div className="max-w-3xl mx-auto text-center space-y-8">
            <div className="space-y-2">
              <h2 className="text-5xl font-black text-purple-400">Final Standings</h2>
              <p className="text-zinc-400 text-xl">How everyone finished this game</p>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 p-8 rounded-3xl shadow-2xl space-y-4">
              {finalScores.map((p, idx) => (
                <div key={p.id} className={`flex justify-between items-center p-5 rounded-2xl border text-xl ${idx === 0 ? 'bg-purple-950/60 border-purple-500 shadow-purple-500/20 shadow-xl scale-105' : 'bg-zinc-950 border-zinc-800'}`}>
                  <div className="flex items-center gap-4">
                    <span className={`font-black w-8 text-2xl ${idx === 0 ? 'text-yellow-400' : 'text-zinc-500'}`}>#{idx + 1}</span>
                    <span className="text-3xl">{p.emoji}</span>
                    <span className="font-bold text-white">{p.name}</span>
                  </div>
                  <span className="font-mono text-emerald-400 font-black text-2xl">{p.score} pts</span>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>

  

    </main>
  );
}
