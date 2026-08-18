"use client";

import React, { useState, useEffect } from 'react';
import { socket } from '@/lib/socket';

// Expanded list of emojis for large crowds
const EMOJIS = [
  '🍒', '🌭', '🔥', '⭐', '🍕', '🦊', '⚡', '💀', '🤖', '👑',
  '🦄', '🐱', '🐶', '🐵', '👻', '👽', '💩', '🎉', '❤️', '🍩',
  '🎸', '🏆', '💎', '🎯', '🥑', '🍔', '🚀', '🍆', '💦', '🐳'
];
const COLORS = ['#a855f7', '#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#06b6d4'];
const PLAYER_STORAGE_KEY = 'hotspot-trivia-player';

const createPlayerKey = () => globalThis.crypto?.randomUUID?.() || `player-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export default function PlayPage() {
  const [playerName, setPlayerName] = useState('');
  const [selectedEmoji, setSelectedEmoji] = useState('🎮');
  const [selectedColor, setSelectedColor] = useState('#a855f7');
  const [playerKey, setPlayerKey] = useState(null);
  
  const [joined, setJoined] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [error, setError] = useState('');
  
  const [gameStarted, setGameStarted] = useState(false);
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [answered, setAnswered] = useState(false);
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [guessValue, setGuessValue] = useState(null);
  const [podiumPlace, setPodiumPlace] = useState(null);
  const [showPodiumPlace, setShowPodiumPlace] = useState(false);

  useEffect(() => {
    socket.on('next-question', (qData) => {
      setGameStarted(true);
      setCurrentQuestion(qData);
      setAnswered(false);
      setSelectedAnswer(null);
      setGuessValue(qData.gameType === 'shot-in-the-dark' ? Number(qData.answerMin) : null);
      setPodiumPlace(null);
      setShowPodiumPlace(false);
    });

    socket.on('answer-breakdown', () => {
      setAnswered(true);
    });

    socket.on('winner-reveal', (data) => {
      const playerResult = data.podium.find((player) => player.id === socket.id);
      setPodiumPlace(playerResult?.place ?? null);
      setShowPodiumPlace(false);
    });

    socket.on('game-over', () => {
      setGameStarted(false);
      setCurrentQuestion(null);
    });

    socket.on('game-ended', () => {
      setGameStarted(false);
      setCurrentQuestion(null);
      setAnswered(false);
      setSelectedAnswer(null);
      setPodiumPlace(null);
      setShowPodiumPlace(false);
    });

    return () => {
      socket.off('next-question');
      socket.off('answer-breakdown');
      socket.off('winner-reveal');
      socket.off('game-over');
      socket.off('game-ended');
    };
  }, []);

  useEffect(() => {
    const savedPlayer = localStorage.getItem(PLAYER_STORAGE_KEY);
    if (!savedPlayer) return;

    try {
      const savedProfile = JSON.parse(savedPlayer);
      if (!savedProfile.playerName || !savedProfile.playerKey) return;

      socket.emit('join-master-lobby', {
        playerName: savedProfile.playerName,
        emoji: savedProfile.emoji || '🎮',
        color: savedProfile.color || '#a855f7',
        playerKey: savedProfile.playerKey
      }, (response) => {
        if (response?.success) {
          setPlayerName(savedProfile.playerName);
          setSelectedEmoji(savedProfile.emoji || '🎮');
          setSelectedColor(savedProfile.color || '#a855f7');
          setPlayerKey(savedProfile.playerKey);
          setJoined(true);
        }
      });
    } catch {
      localStorage.removeItem(PLAYER_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    if (!podiumPlace) return;
    const timer = setTimeout(() => setShowPodiumPlace(true), 3000);
    return () => clearTimeout(timer);
  }, [podiumPlace]);

  const handleJoinOrUpdate = (e) => {
    e.preventDefault();
    if (!playerName.trim()) {
      setError('Please enter your nickname.');
      return;
    }

    const nextPlayerKey = playerKey || createPlayerKey();
    socket.emit('join-master-lobby', { 
      playerName: playerName.trim(), 
      emoji: selectedEmoji, 
      color: selectedColor,
      playerKey: nextPlayerKey
    }, (response) => {
      if (response && response.success) {
        setPlayerKey(nextPlayerKey);
        localStorage.setItem(PLAYER_STORAGE_KEY, JSON.stringify({
          playerName: playerName.trim(),
          emoji: selectedEmoji,
          color: selectedColor,
          playerKey: nextPlayerKey
        }));
        setJoined(true);
        setIsEditingName(false);
        setError('');
      } else {
        setError(response ? response.error : "Failed to join");
      }
    });
  };

  const handleAnswerClick = (optionLetter) => {
    if (answered) return;
    setAnswered(true);
    setSelectedAnswer(optionLetter);
    socket.emit('submit-answer', { answer: optionLetter });
  };

  const adjustGuess = (amount) => {
    setGuessValue((current) => Math.min(currentQuestion.answerMax, Math.max(currentQuestion.answerMin, Number((current + amount).toFixed(8)))));
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col justify-between p-4 select-none">
      
      {/* HEADER / TAPPABLE IDENTITY BAR */}
      {joined && !isEditingName && (
        <div className="flex justify-between items-center bg-zinc-900 border border-zinc-800 p-3 rounded-2xl mb-4">
          <button 
            onClick={() => setIsEditingName(true)}
            className="flex items-center gap-2 text-left group focus:outline-none"
            title="Tap to change name/emoji"
          >
            <span className="text-2xl p-1 rounded-xl transition group-hover:scale-110" style={{ backgroundColor: selectedColor + '33' }}>
              {selectedEmoji}
            </span>
            <div>
              <div className="font-bold text-white tracking-wide flex items-center gap-1.5">
                {playerName} <span className="text-xs text-purple-400 font-normal underline">Edit</span>
              </div>
            </div>
          </button>
          
          <span className="text-xs uppercase tracking-widest text-emerald-400 font-semibold bg-emerald-950/50 border border-emerald-800 px-3 py-1 rounded-full">
            Connected 🟢
          </span>
        </div>
      )}

      {/* 1. INITIAL LOGIN SCREEN OR QUICK RENAME SCREEN */}
      {(!joined || isEditingName) && (
        <div className="max-w-md w-full mx-auto my-auto bg-zinc-900 border border-zinc-800 p-6 rounded-3xl shadow-2xl">
          <h1 className="text-3xl font-extrabold text-purple-400 mb-2 text-center">
            {joined ? 'Edit Profile' : 'Party Controller'}
          </h1>
          <p className="text-zinc-400 text-sm text-center mb-6">
            {joined ? 'Update your name or look for the evening' : 'Log in once, play all night!'}
          </p>
          
          <form onSubmit={handleJoinOrUpdate} className="space-y-4">
            {error && <div className="bg-red-500/20 border border-red-500 text-red-300 p-3 rounded-xl text-sm">{error}</div>}
            
            <div>
              <label className="block text-sm font-semibold text-zinc-300 mb-1">Your Nickname</label>
              <input 
                type="text" 
                maxLength={15}
                className="w-full p-3.5 bg-zinc-950 border border-zinc-700 rounded-xl text-white placeholder-zinc-600 focus:outline-none focus:border-purple-500 text-lg font-medium"
                placeholder="e.g. TriviaKing"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
              />
            </div>

            {/* Scrollable Horizontal Emoji Selector */}
            <div>
              <label className="block text-sm font-semibold text-zinc-300 mb-2">Pick an Emoji</label>
              <div className="flex gap-2 overflow-x-auto bg-zinc-950 p-3 rounded-xl border border-zinc-800 no-scrollbar">
                {EMOJIS.map((emoji, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => setSelectedEmoji(emoji)}
                    className={`text-2xl p-2.5 rounded-xl shrink-0 transition ${selectedEmoji === emoji ? 'bg-purple-600 scale-110 shadow-lg' : 'hover:bg-zinc-800'}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>

            {/* Choose Color */}
            <div>
              <label className="block text-sm font-semibold text-zinc-300 mb-2">Pick a Color</label>
              <div className="flex gap-3 justify-center bg-zinc-950 p-3 rounded-xl border border-zinc-800">
                {COLORS.map((col) => (
                  <button
                    key={col}
                    type="button"
                    onClick={() => setSelectedColor(col)}
                    className={`w-8 h-8 rounded-full transition ${selectedColor === col ? 'scale-125 ring-4 ring-white' : 'opacity-70 hover:opacity-100'}`}
                    style={{ backgroundColor: col }}
                  />
                ))}
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              {joined && (
                <button 
                  type="button" 
                  onClick={() => setIsEditingName(false)}
                  className="w-1/3 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold p-3.5 rounded-xl transition"
                >
                  Cancel
                </button>
              )}
              <button 
                type="submit" 
                className={`${joined ? 'w-2/3' : 'w-full'} bg-purple-600 hover:bg-purple-500 text-white font-bold p-3.5 rounded-xl shadow-lg transition text-lg`}
              >
                {joined ? 'Save Changes' : 'Enter Party 🎉'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 2. WAITING LOBBY SCREEN */}
      {joined && !isEditingName && !gameStarted && !podiumPlace && (
        <div className="text-center my-auto p-6 bg-zinc-900/50 border border-zinc-800 rounded-3xl mx-auto max-w-md w-full">
          <div className="w-20 h-20 bg-emerald-500/20 border border-emerald-500 text-emerald-400 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl font-bold animate-pulse">
            ✓
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">You&apos;re in the Party!</h2>
          <p className="text-zinc-400 text-sm">Sit tight! The host will launch the next game from the main screen shortly.</p>
        </div>
      )}

      {/* 3. QUESTION + ANSWER BUTTONS */}
      {joined && !isEditingName && gameStarted && currentQuestion && !podiumPlace && (
        <div className="w-full max-w-md mx-auto my-auto flex flex-col justify-center">
          <p className="text-center text-xs uppercase tracking-widest text-zinc-500 font-semibold mb-2">
            Question {currentQuestion.questionNumber} of {currentQuestion.totalQuestions}
          </p>
          <h2 className="text-xl font-black text-white text-center leading-snug mb-5 px-1">
            {currentQuestion.questionText}
          </h2>

          {!answered && currentQuestion.gameType === 'shot-in-the-dark' ? (
            <div className="space-y-6 text-center">
              <p className="text-zinc-400 font-semibold">Move the slider to make your best estimate:</p>
              <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6">
                <p className="text-5xl font-black text-white mb-6">{guessValue}</p>
                <input type="range" min={currentQuestion.answerMin} max={currentQuestion.answerMax} step={currentQuestion.answerStep} value={guessValue ?? currentQuestion.answerMin} onChange={(e) => setGuessValue(Number(e.target.value))} className="w-full accent-purple-500" />
                <div className="flex justify-between text-xs text-zinc-500 mt-2"><span>{currentQuestion.answerMin}</span><span>{currentQuestion.answerMax}</span></div>
                <div className="flex gap-3 mt-6"><button onClick={() => adjustGuess(-currentQuestion.answerStep)} className="flex-1 bg-zinc-800 p-3 rounded-xl font-black text-2xl">−</button><button onClick={() => adjustGuess(currentQuestion.answerStep)} className="flex-1 bg-zinc-800 p-3 rounded-xl font-black text-2xl">+</button></div>
              </div>
              <button onClick={() => handleAnswerClick(guessValue)} className="w-full bg-purple-600 hover:bg-purple-500 p-4 rounded-2xl font-black text-lg">Lock In {guessValue}</button>
            </div>
          ) : !answered ? (
            <div className="space-y-3">
              <p className="text-center text-zinc-400 font-semibold mb-2">Tap your choice:</p>
              {currentQuestion.options.map((optText, idx) => {
                const optLetter = ['A', 'B', 'C', 'D'][idx];
                const btnStyles = {
                  A: 'bg-red-600 active:bg-red-700 border-red-500',
                  B: 'bg-blue-600 active:bg-blue-700 border-blue-500',
                  C: 'bg-yellow-600 active:bg-yellow-700 border-yellow-500',
                  D: 'bg-green-600 active:bg-green-700 border-green-500'
                };

                return (
                  <button
                    key={idx}
                    onClick={() => handleAnswerClick(optLetter)}
                    className={`${btnStyles[optLetter]} w-full p-4 rounded-2xl border text-white font-bold text-lg shadow-xl flex items-center gap-4 transition active:scale-95 text-left`}
                  >
                    <span className="w-10 h-10 bg-black/30 rounded-xl flex items-center justify-center text-xl shrink-0 font-black">
                      {optLetter}
                    </span>
                    <span className="flex-1 leading-snug">{optText}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-12 bg-zinc-900 border border-zinc-800 rounded-3xl p-8 shadow-2xl">
              <div className="w-20 h-20 bg-purple-600/20 border border-purple-500 text-purple-400 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl font-bold animate-bounce">
                {selectedAnswer}
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">{selectedAnswer ? 'Locked In!' : 'Time is up'}</h2>
              <p className="text-zinc-400">Watch the main host screen for the round results.</p>
            </div>
          )}
        </div>
      )}

      {/* 4. PODIUM CELEBRATION */}
      {joined && !isEditingName && podiumPlace && (
        <div className="w-full max-w-md mx-auto my-auto text-center bg-gradient-to-b from-amber-500/20 to-zinc-900 border border-amber-400/60 rounded-3xl p-10 shadow-2xl shadow-amber-500/20">
          {showPodiumPlace ? (
            <>
              <div className="text-8xl mb-6 animate-bounce">{podiumPlace === 1 ? '🏆' : podiumPlace === 2 ? '🥈' : '🥉'}</div>
              <p className="text-sm uppercase tracking-[0.3em] text-amber-300 font-bold mb-3">You did it</p>
              <h2 className="text-5xl font-black text-white mb-4">{podiumPlace === 1 ? 'Winner!' : `${podiumPlace}${podiumPlace === 2 ? 'nd' : 'rd'} Place!`}</h2>
              <p className="text-zinc-300 text-lg">{podiumPlace === 1 ? 'You won this game. Celebrate!' : 'You made the podium. Great game!'}</p>
            </>
          ) : (
            <>
              <p className="text-3xl font-bold text-zinc-300 mb-8">The winner is...</p>
              <div className="h-20 w-20 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto" />
            </>
          )}
        </div>
      )}

      {/* FOOTER */}
      <div className="text-xs text-zinc-600 pt-4 text-center">
        Live Party System • No Room Code Needed
      </div>

    </div>
  );
}
