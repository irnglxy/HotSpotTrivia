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
  const [introTitle, setIntroTitle] = useState(null);
  const [pickerPlayers, setPickerPlayers] = useState([]);
  const [pickerRun, setPickerRun] = useState(null);
  const [pickedPlayers, setPickedPlayers] = useState([]);

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
    socket.on('game-intro', (data) => { setStatus('intro'); setIntroTitle(data.title); });
    socket.on('player-picker-setup', () => setStatus('picker-setup'));
    socket.on('player-picker-start', (data) => { setStatus('picker-selecting'); setPickerPlayers(data.players); setPickerRun(data); });
    socket.on('player-picker-result', (data) => { setStatus('picker-result'); setPickedPlayers(data.players); });

    socket.on('next-question', (qData) => {
      setStatus('playing');
      setIntroTitle(null);
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

    socket.on('game-ended', () => {
      setStatus('lobby');
      setCurrentQuestion(null);
      setAnswerBreakdown(null);
      setRoundResults(null);
      setWinnerReveal(null);
      setFinalScores([]);
      setPickerPlayers([]);
      setPickerRun(null);
      setPickedPlayers([]);
    });
    socket.on('room-closed', () => { setStatus('lobby'); setPlayers([]); });

    return () => {
      socket.off('join-display-screen');
      socket.off('master-update');
      socket.off('update-players');
      socket.off('game-loaded');
      socket.off('game-intro');
      socket.off('player-picker-setup');
      socket.off('player-picker-start');
      socket.off('player-picker-result');
      socket.off('next-question');
      socket.off('answer-breakdown');
      socket.off('round-results');
      socket.off('winner-reveal');
      socket.off('game-over');
      socket.off('game-ended');
      socket.off('room-closed');
    };
  }, []);

  useEffect(() => {
    if (status !== 'picker-selecting' || !pickerRun) return;
    const timers = pickerRun.eliminatedPlayerIds.map((playerId, index) => setTimeout(() => {
      setPickerPlayers((current) => current.filter((player) => player.id !== playerId));
    }, ((index + 1) * pickerRun.duration) / (pickerRun.eliminatedPlayerIds.length + 1)));
    return () => timers.forEach(clearTimeout);
  }, [status, pickerRun]);

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
          Join at: <span className="text-[#B8C22E] font-bold">gamenight.devengreen.com/play</span>
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
              <h2 className="text-6xl font-black tracking-tight"><span className="text-[#2A97CE]">GAME</span>{' '}<span className="text-[#B8C22E]">NIGHT</span></h2>
            </div>

            {/* Live Connected Players Wall */}
            <div className="bg-zinc-900/60 border border-zinc-800 p-8 rounded-3xl backdrop-blur shadow-2xl max-w-4xl mx-auto">
              <h3 className="text-xl font-bold text-zinc-300 mb-6 flex justify-between items-center">
                <span>Connected Players in Room</span>
                <span className="text-[#B8C22E] font-mono text-2xl">{players.length}</span>
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

        {status === 'intro' && <div className="text-center py-24"><p className="text-purple-300 uppercase tracking-[0.3em] font-bold mb-6">Get ready for</p><h2 className="text-7xl font-black text-white">{introTitle}</h2></div>}

        {status === 'picker-setup' && <div className="text-center py-24"><p className="text-fuchsia-300 uppercase tracking-[0.3em] font-bold mb-6">Player Picker</p><h2 className="text-6xl font-black text-white">Get Ready...</h2></div>}

        {status === 'picker-selecting' && <div className="max-w-5xl mx-auto text-center"><p className="text-fuchsia-300 uppercase tracking-[0.3em] font-bold mb-6">Player Picker</p><h2 className="text-6xl font-black text-white mb-10">Who will remain?</h2><div className="flex flex-wrap justify-center gap-4">{pickerPlayers.map((player) => <div key={player.id} className="bg-zinc-900 border border-fuchsia-700 rounded-2xl px-6 py-5 text-2xl font-black text-white transition-all duration-700"><span className="text-4xl mr-3">{player.emoji}</span>{player.name}</div>)}</div></div>}

        {status === 'picker-result' && <div className="max-w-5xl mx-auto text-center"><p className="text-fuchsia-300 uppercase tracking-[0.3em] font-bold mb-10">Selected Players</p><div className="flex flex-wrap justify-center gap-5">{pickedPlayers.map((player) => <div key={player.id} className="bg-fuchsia-950 border-2 border-fuchsia-400 rounded-3xl px-8 py-7 text-3xl font-black text-white shadow-2xl"><span className="text-5xl mr-4">{player.emoji}</span>{player.name}</div>)}</div></div>}

        {/* STATE 2: LIVE QUESTION BOARD */}
        {status === 'playing' && currentQuestion && (
          <div className="w-full space-y-6">
            <div className="flex justify-between items-center">
              <span className="text-zinc-400 font-bold text-lg uppercase tracking-widest">
                Question {currentQuestion.questionNumber} of {currentQuestion.totalQuestions}
              </span>
              
              {/* Massive Cinematic Timer */}
              <div className={`px-8 py-3 rounded-2xl font-black text-3xl border flex items-center gap-3 shadow-2xl ${timeLeft <= 0 ? 'bg-red-950 text-red-400 border-red-600' : timeLeft <= 5 ? 'bg-red-950 text-red-400 border-red-600 animate-pulse scale-105' : 'bg-zinc-900 text-purple-300 border-zinc-700'}`}>
                {timeLeft <= 0 ? 'TIME UP' : `⏱️ ${timeLeft}s`}
              </div>
            </div>

            {/* Question Card */}
            {currentQuestion.gameType !== 'simon-says' && currentQuestion.gameType !== 'word-scramble' && <div className="bg-zinc-900 border border-zinc-800 p-12 rounded-3xl shadow-2xl text-center">
              <h2 className="text-5xl md:text-6xl font-black text-white leading-tight">
                {currentQuestion.questionText}
              </h2>
            </div>}

            {currentQuestion.gameType === 'word-scramble' ? <div className="bg-[#B8C22E]/10 border border-[#B8C22E] rounded-3xl p-8 text-center"><p className="text-3xl font-black text-[#B8C22E] mb-5">Word Scramble</p><div className="space-y-3 text-xl text-zinc-200"><p>Words need to be 3 letters or more.</p><p>Longer words are worth more points.</p><p>Words other players don&apos;t find are worth more points.</p></div></div> : currentQuestion.gameType === 'autocomplete-trivia' ? <div className="bg-teal-950/50 border border-teal-700 rounded-3xl p-8 text-center"><p className="text-zinc-400 text-xl">Players are typing and selecting their answer.</p></div> : currentQuestion.gameType === 'simon-says' ? <div className="bg-cyan-950/50 border border-cyan-700 rounded-3xl p-8 text-center"><p className="text-4xl font-black text-cyan-200">Simon Says</p><p className="text-zinc-400 mt-3 text-xl">Players are entering {currentQuestion.simonSequenceLength} colors.</p></div> : currentQuestion.gameType === 'shot-in-the-dark' ? (
              <div className="bg-purple-950/50 border border-purple-700 rounded-3xl p-8 text-center">
                <p className="text-3xl font-black text-purple-200">Shot In The Dark</p>
                <p className="text-zinc-400 mt-3 text-xl">Make your best estimate between {currentQuestion.answerMin} and {currentQuestion.answerMax}</p>
              </div>
            ) : currentQuestion.gameType === 'pitch-meeting' ? <div className="bg-sky-950/50 border border-sky-700 rounded-3xl p-8 text-center"><p className="text-4xl font-black text-sky-200">Pitch Meeting</p><p className="text-zinc-400 mt-3 text-xl">Players are allocating {currentQuestion.pitchPoints} points between the two pitches.</p></div> : <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {currentQuestion.options.slice(0, currentQuestion.gameType === 'liar-liar' ? 2 : 4).map((optText, idx) => {
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
            </div>}
          </div>
        )}

        {/* STATE 3: HOW THE ROOM ANSWERED */}
        {status === 'answer-reveal' && answerBreakdown?.gameType === 'shot-in-the-dark' && (
          <div className="max-w-4xl mx-auto text-center space-y-6">
            <p className="text-purple-300 font-bold uppercase tracking-widest">Shot In The Dark</p>
            <h2 className="text-4xl font-black text-white">{answerBreakdown.questionText}</h2>
            <div className="bg-zinc-900 border border-emerald-500 p-8 rounded-3xl"><p className="text-zinc-400 uppercase tracking-widest font-bold mb-2">Correct answer</p><p className="text-7xl font-black text-emerald-400">{answerBreakdown.correctNumber}</p></div>
            {(() => {
              const closest = [...answerBreakdown.guesses].sort((a, b) => a.difference - b.difference).slice(0, 10);
              const spread = Math.max(1, ...closest.map((guess) => Math.abs(guess.answer - answerBreakdown.correctNumber)));
              return <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8"><p className="text-zinc-400 font-bold mb-12">Closest guesses</p><div className="relative h-20 border-t-2 border-zinc-600"><div className="absolute -top-3 bottom-0 left-1/2 border-l-4 border-emerald-400"><span className="absolute top-3 -translate-x-1/2 whitespace-nowrap text-emerald-400 font-black">Correct</span></div>{closest.map((guess) => { const left = 50 + ((guess.answer - answerBreakdown.correctNumber) / spread) * 45; return <div key={guess.playerId} className="absolute -top-8" style={{ left: `${left}%`, transform: 'translateX(-50%)' }}><span className="text-2xl">{guess.emoji}</span><span className="block text-xs font-bold text-white whitespace-nowrap">{guess.answer}</span></div>; })}</div></div>;
            })()}
            <p className="text-zinc-400 font-mono">{answerBreakdown.totalAnswers} / {answerBreakdown.totalPlayers} guesses locked in</p>
          </div>
        )}

        {status === 'answer-reveal' && answerBreakdown?.gameType === 'simon-says' && (
          <div className="max-w-4xl mx-auto text-center space-y-6">
            <p className="text-cyan-300 font-bold uppercase tracking-widest">Simon Says</p>
            <h2 className="text-4xl font-black text-white">Correct sequence</h2>
            <div className="flex flex-wrap justify-center gap-4 bg-zinc-900 border border-zinc-800 rounded-3xl p-8">{answerBreakdown.simonSequence.map((color, index) => <span key={index} className={`w-20 h-20 rounded-2xl shadow-xl ${color === 'red' ? 'bg-red-600' : color === 'green' ? 'bg-green-600' : color === 'blue' ? 'bg-blue-600' : 'bg-orange-500'}`} title={color} />)}</div>
            <p className="text-zinc-400 font-mono">{answerBreakdown.totalAnswers} / {answerBreakdown.totalPlayers} players completed a sequence</p>
          </div>
        )}

        {status === 'answer-reveal' && answerBreakdown?.gameType === 'autocomplete-trivia' && (
          <div className="max-w-4xl mx-auto text-center space-y-6"><h2 className="text-4xl font-black text-white">{answerBreakdown.questionText}</h2><div className="space-y-3 text-left">{answerBreakdown.answerCounts.filter(({ count }) => count > 0).map(({ answer, count }) => <div key={answer} className={`flex justify-between bg-zinc-900 border rounded-2xl p-5 text-xl ${answer === answerBreakdown.correctAnswer ? 'border-emerald-400' : 'border-zinc-800'}`}><span className="font-bold text-white">{answer}{answer === answerBreakdown.correctAnswer && <span className="ml-3 text-emerald-400 text-sm">Correct</span>}</span><span className="font-mono text-white">{count}</span></div>)}</div></div>
        )}

        {status === 'answer-reveal' && answerBreakdown?.gameType === 'word-scramble' && (
          <div className="max-w-5xl mx-auto text-center space-y-8"><p className="text-[#B8C22E] font-bold uppercase tracking-widest">Word Scramble recap</p><div className="grid md:grid-cols-3 gap-5">{[['Longest word', answerBreakdown.highlights.longestWord, (summary) => summary.longestWord], ['Most words', answerBreakdown.highlights.mostWords, (summary) => `${summary.wordCount} words`], ['Most points', answerBreakdown.highlights.mostPoints, (summary) => `${summary.pointsEarned} pts`]].map(([label, winners, detail]) => <div key={label} className="bg-zinc-900 border border-[#B8C22E] rounded-3xl p-6"><p className="text-[#B8C22E] uppercase tracking-widest text-sm font-bold mb-4">{label}</p>{winners.length ? winners.map((winner) => <div key={winner.playerId} className="mb-3 last:mb-0"><p className="text-2xl font-black text-white">{winner.emoji} {winner.name}</p><p className="text-[#2A97CE] text-xl font-bold">{detail(winner)}</p></div>) : <p className="text-zinc-500">No words found</p>}</div>)}</div><div className="grid md:grid-cols-2 gap-4 text-left">{[...answerBreakdown.summaries].sort((a, b) => b.pointsEarned - a.pointsEarned).map((summary) => <div key={summary.playerId} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5"><div className="flex justify-between gap-3"><span className="font-bold text-white text-xl">{summary.emoji} {summary.name}</span><span className="font-mono text-[#2A97CE]">+{summary.pointsEarned}</span></div><p className="text-zinc-400 mt-2">{summary.words.join(', ') || 'No valid words'}</p>{summary.uniqueWords.length > 0 && <p className="text-[#B8C22E] text-sm font-bold mt-2">Unique: {summary.uniqueWords.join(', ')} (+{summary.uniqueBonus})</p>}</div>)}</div></div>
        )}

        {status === 'answer-reveal' && answerBreakdown?.gameType === 'pitch-meeting' && (
          <div className="max-w-5xl mx-auto text-center space-y-10"><p className="text-sky-300 font-bold uppercase tracking-widest">Pitch Meeting scoreboard</p><h2 className="text-5xl font-black text-white">{answerBreakdown.questionText}</h2><div className="grid md:grid-cols-2 gap-8">{['A', 'B'].map((key, index) => { const score = answerBreakdown.roundScores[key]; const max = Math.max(1, answerBreakdown.roundScores.A, answerBreakdown.roundScores.B); return <div key={key} className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8"><p className={`text-3xl font-black ${index === 0 ? 'text-red-300' : 'text-blue-300'}`}>{answerBreakdown.options[index]}</p><p className="text-6xl font-black text-white my-6">{score.toLocaleString()}</p><div className="h-10 bg-zinc-950 rounded-full overflow-hidden"><div className={`${index === 0 ? 'bg-red-500' : 'bg-blue-500'} h-full transition-all duration-1000`} style={{ width: `${(score / max) * 100}%` }} /></div></div>; })}</div></div>
        )}

        {status === 'answer-reveal' && answerBreakdown && answerBreakdown.gameType !== 'shot-in-the-dark' && answerBreakdown.gameType !== 'simon-says' && answerBreakdown.gameType !== 'autocomplete-trivia' && answerBreakdown.gameType !== 'word-scramble' && answerBreakdown.gameType !== 'pitch-meeting' && (
          <div className="w-full space-y-8">
            <div className="flex justify-between items-center">
              <span className="text-zinc-400 font-bold text-xl uppercase tracking-widest">
                Question {answerBreakdown.questionNumber} of {answerBreakdown.totalQuestions}
              </span>
              <span className="text-zinc-400 font-mono text-lg">
                {answerBreakdown.totalAnswers} / {answerBreakdown.totalPlayers} answered
              </span>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-3xl shadow-2xl text-center">
              <p className="text-sm uppercase tracking-widest text-purple-300 font-bold mb-2">{answerBreakdown.gameType === 'follow-the-herd' ? `Follow The Herd • ${answerBreakdown.herdMode === 'least' ? 'Least popular selected answer scores' : 'Most popular answer scores'}` : answerBreakdown.gameType === 'liar-liar' ? 'How did the room answer?' : 'How the room voted'}</p>
              <h2 className="text-2xl md:text-3xl font-black text-white leading-tight">
                {answerBreakdown.questionText}
              </h2>
            </div>

            <div className="space-y-3">
              {answerBreakdown.options.slice(0, answerBreakdown.gameType === 'liar-liar' ? 2 : 4).map((optText, idx) => {
                const optLetter = ['A', 'B', 'C', 'D'][idx];
                const count = answerBreakdown.counts[optLetter] || 0;
                const pct = answerBreakdown.totalAnswers === 0 ? 0 : Math.round((count / answerBreakdown.totalAnswers) * 100);
                const isFollowTheHerd = answerBreakdown.gameType === 'follow-the-herd';
                const isLiarLiar = answerBreakdown.gameType === 'liar-liar';
                const isCorrect = !isLiarLiar && answerBreakdown.correctAnswer === optLetter;
                const scores = isFollowTheHerd && answerBreakdown.winningAnswers?.includes(optLetter);
                const barColors = {
                  A: 'bg-red-600',
                  B: 'bg-blue-600',
                  C: 'bg-yellow-600',
                  D: 'bg-green-600'
                };

                return (
                  <div
                    key={idx}
                    className={`bg-zinc-900 border p-4 rounded-3xl ${isFollowTheHerd ? (scores ? 'border-emerald-400 shadow-lg shadow-emerald-500/10' : 'border-zinc-800') : isCorrect ? 'border-emerald-400 shadow-lg shadow-emerald-500/10' : 'border-zinc-800'}`}
                  >
                    <div className="flex justify-between items-center mb-2 gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className={`${barColors[optLetter]} w-10 h-10 rounded-2xl flex items-center justify-center font-black text-lg shrink-0`}>
                          {optLetter}
                        </span>
                        <span className="text-xl font-bold text-white truncate">{optText}</span>
                        {isFollowTheHerd ? scores && (
                          <span className="shrink-0 text-sm font-bold uppercase tracking-wider text-emerald-400 bg-emerald-950 border border-emerald-700 px-3 py-1 rounded-full">Scores</span>
                        ) : isCorrect && (
                          <span className="shrink-0 text-sm font-bold uppercase tracking-wider text-emerald-400 bg-emerald-950 border border-emerald-700 px-3 py-1 rounded-full">
                            Correct
                          </span>
                        )}
                      </div>
                      <span className="font-mono text-xl font-black text-white shrink-0">
                        {count} <span className="text-zinc-500 text-base font-bold">({pct}%)</span>
                      </span>
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
          </div>
        )}

        {/* STATE 4: ROUND RESULTS & LEADERBOARD */}
        {status === 'results' && roundResults && (
          <div className="max-w-3xl mx-auto text-center space-y-8">
            <div className="space-y-2">
              <h2 className="text-5xl font-black text-purple-400">Round Complete!</h2>
              {roundResults.gameType === 'trivia' && <p className="text-zinc-400 text-2xl">Correct Answer was: <span className="text-emerald-400 font-extrabold text-3xl">[{roundResults.correctAnswer}]</span></p>}
              {roundResults.gameType === 'liar-liar' && <p className="text-zinc-400 text-2xl">Correct answer: <span className="text-emerald-400 font-extrabold text-3xl">{roundResults.options?.[roundResults.correctAnswer === 'B' ? 1 : 0]}</span></p>}
              {roundResults.gameType === 'autocomplete-trivia' && <p className="text-zinc-400 text-2xl">Correct answer: <span className="text-emerald-400 font-extrabold text-3xl">{roundResults.correctAnswer}</span></p>}
            </div>

            <div className="bg-zinc-900 border border-zinc-800 p-8 rounded-3xl shadow-2xl space-y-4">
              <h3 className="text-2xl font-bold text-white mb-6">Current Leaderboard</h3>
              {[...roundResults.players]
                .sort((a, b) => b.score - a.score)
                .map((p, idx) => (
                  <div key={p.id} className="flex justify-between items-center bg-zinc-950 p-5 rounded-2xl border border-zinc-800 text-xl">
                    <div className="flex items-center gap-4">
                      <span className="font-black text-zinc-500 w-8 text-2xl">#{idx + 1}</span>
                      {p.rankChange !== null && p.rankChange !== 0 && <span className={`font-black ${p.rankChange > 0 ? 'text-emerald-400' : 'text-rose-400'}`} title={`${Math.abs(p.rankChange)} place${Math.abs(p.rankChange) === 1 ? '' : 's'} ${p.rankChange > 0 ? 'up' : 'down'}`}>{p.rankChange > 0 ? (p.rankChange > 10 ? '⇈' : '↑') : (p.rankChange < -10 ? '⇊' : '↓')}</span>}
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
              {showWinnerName && winnerReveal.gameType === 'pitch-meeting' ? (
                <div className="space-y-5">{winnerReveal.winners.length > 1 && <h2 className="text-6xl md:text-8xl font-black text-white">It&apos;s a tie!</h2>}{winnerReveal.winningGroups.map((group, index) => { const isOptionA = group.key === 'A'; return <div key={index} className={`rounded-3xl border-2 p-8 ${isOptionA ? 'bg-red-950/50 border-red-500' : 'bg-blue-950/50 border-blue-500'}`}><p className={`text-6xl md:text-7xl font-black ${isOptionA ? 'text-red-300' : 'text-blue-300'}`}>{group.score.toLocaleString()}</p><p className="text-2xl text-zinc-200 mt-3">{group.options.join(' • ')}</p></div>; })}</div>
              ) : showWinnerName && winnerReveal.winners.length > 0 ? (
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
