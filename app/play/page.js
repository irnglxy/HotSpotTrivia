"use client";

import React, { useState, useEffect } from 'react';
import { socket } from '@/lib/socket';

// Expanded list of emojis for large crowds
const EMOJIS = [
  '🍒', '🌭', '🔥', '⭐', '🍕', '🦊', '⚡', '💀', '🤖', '👑',
  '🦄', '🐱', '🐶', '🐵', '👻', '👽', '💩', '🎉', '❤️', '🍩',
  '🎸', '🏆', '💎', '🍑', '🥑', '🍔', '🚀', '🍆', '💦', '🐳'
];
const COLORS = ['#a855f7', '#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#06b6d4'];
const PLAYER_STORAGE_KEY = 'hotspot-trivia-player';
const normalizeAutocompleteText = (text) => text.toLowerCase().replace(/\bthe\b/g, '').replace(/[^a-z0-9]/g, '');
const shuffledIndexes = (length) => {
  const indexes = Array.from({ length }, (_, index) => index);
  for (let index = indexes.length - 1; index > 0; index--) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [indexes[index], indexes[randomIndex]] = [indexes[randomIndex], indexes[index]];
  }
  return indexes;
};

const createPlayerKey = () => globalThis.crypto?.randomUUID?.() || `player-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export default function PlayPage() {
  const [playerName, setPlayerName] = useState('');
  const [selectedEmoji, setSelectedEmoji] = useState('🎮');
  const [selectedColor, setSelectedColor] = useState('#a855f7');
  const [playerKey, setPlayerKey] = useState(null);
  
  const [joined, setJoined] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [error, setError] = useState('');
  const [roomClosed, setRoomClosed] = useState(false);
  
  const [gameStarted, setGameStarted] = useState(false);
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [answered, setAnswered] = useState(false);
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [guessValue, setGuessValue] = useState(null);
  const [pitchAllocation, setPitchAllocation] = useState(null);
  const [simonInput, setSimonInput] = useState([]);
  const [autocompleteInput, setAutocompleteInput] = useState('');
  const [scrambleLetterIndexes, setScrambleLetterIndexes] = useState([]);
  const [scrambleLetterOrder, setScrambleLetterOrder] = useState([]);
  const [scrambleWords, setScrambleWords] = useState([]);
  const [scrambleError, setScrambleError] = useState('');
  const [podiumPlace, setPodiumPlace] = useState(null);
  const [showPodiumPlace, setShowPodiumPlace] = useState(false);
  const [introTitle, setIntroTitle] = useState(null);

  useEffect(() => {
    socket.on('next-question', (qData) => {
      const isScrambleQuestion = qData.gameType === 'word-scramble' || Boolean(qData.scrambleLetters);
      const isPitchQuestion = qData.gameType === 'pitch-meeting' || qData.pitchPoints !== undefined;
      const normalizedQuestion = isScrambleQuestion
        ? { ...qData, gameType: 'word-scramble' }
        : isPitchQuestion ? { ...qData, gameType: 'pitch-meeting' } : qData;
      setIntroTitle(null);
      setGameStarted(true);
      setCurrentQuestion(normalizedQuestion);
      setAnswered(false);
      setSelectedAnswer(null);
      setGuessValue(normalizedQuestion.gameType === 'shot-in-the-dark' ? Number(normalizedQuestion.answerMin) : null);
      setPitchAllocation(normalizedQuestion.gameType === 'pitch-meeting' ? normalizedQuestion.pitchPoints / 2 : null);
      setSimonInput([]);
      setAutocompleteInput('');
      setScrambleLetterIndexes([]);
      setScrambleLetterOrder(isScrambleQuestion ? shuffledIndexes(normalizedQuestion.scrambleLetters.length) : []);
      setScrambleWords([]);
      setScrambleError('');
      setPodiumPlace(null);
      setShowPodiumPlace(false);
    });
    socket.on('game-intro', (data) => { setGameStarted(true); setCurrentQuestion(null); setIntroTitle(data.title); });

    socket.on('answer-breakdown', () => {
      setAnswered(true);
    });

    socket.on('question-time-up', () => {
      setAnswered(true);
      setSelectedAnswer(null);
    });

    socket.on('player-answer-state', ({ answer, scrambleWords: savedScrambleWords, isWordScramble: savedWordScramble }) => {
      if (savedScrambleWords) setScrambleWords(savedScrambleWords);
      if (savedWordScramble) return;
      setAnswered(true);
      setSelectedAnswer(Array.isArray(answer) ? '✓' : answer ?? null);
    });

    socket.on('winner-reveal', (data) => {
      if (data.gameType === 'pitch-meeting') {
        setGameStarted(false);
        setCurrentQuestion(null);
        return;
      }
      const playerResult = data.podium?.find((player) => player.id === socket.id);
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
      setIntroTitle(null);
    });

    socket.on('room-closed', () => {
      setJoined(false); setGameStarted(false); setCurrentQuestion(null); setRoomClosed(true);
    });
    socket.on('room-opened', () => setRoomClosed(false));

    return () => {
      socket.off('next-question');
      socket.off('game-intro');
      socket.off('answer-breakdown');
      socket.off('question-time-up');
      socket.off('player-answer-state');
      socket.off('winner-reveal');
      socket.off('game-over');
      socket.off('game-ended');
      socket.off('room-closed'); socket.off('room-opened');
    };
  }, []);

  useEffect(() => {
    const restorePlayerSession = () => {
      const savedPlayer = localStorage.getItem(PLAYER_STORAGE_KEY);
      if (!savedPlayer) return;

      let savedProfile;
      try {
        savedProfile = JSON.parse(savedPlayer);
      } catch {
        localStorage.removeItem(PLAYER_STORAGE_KEY);
        return;
      }
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
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      if (socket.connected) restorePlayerSession();
      else socket.connect();
    };

    socket.on('connect', restorePlayerSession);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    if (socket.connected) restorePlayerSession();
    else socket.connect();

    return () => {
      socket.off('connect', restorePlayerSession);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
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

  const isShotInTheDark = currentQuestion?.gameType === 'shot-in-the-dark';
  const isPitchMeeting = currentQuestion?.gameType === 'pitch-meeting';
  const isSimonSays = currentQuestion?.gameType === 'simon-says';
  const isAutocompleteTrivia = currentQuestion?.gameType === 'autocomplete-trivia';
  const isWordScramble = currentQuestion?.gameType === 'word-scramble';

  const adjustGuess = (amount) => {
    setGuessValue((current) => Math.min(currentQuestion.answerMax, Math.max(currentQuestion.answerMin, Number((current + amount).toFixed(8)))));
  };

  const handleSimonColor = (color) => {
    if (answered) return;
    const nextSequence = [...simonInput, color];
    setSimonInput(nextSequence);
    if (nextSequence.length === currentQuestion.simonSequenceLength) {
      setAnswered(true);
      setSelectedAnswer('✓');
      socket.emit('submit-answer', { answer: nextSequence });
    }
  };

  const submitScrambleWord = (event) => {
    event.preventDefault();
    const word = scrambleLetterIndexes.map((index) => currentQuestion.scrambleLetters[index]).join('');
    if (answered || !word) return;
    socket.emit('submit-scramble-word', { word }, (response) => {
      if (!response?.success) {
        setScrambleError(response?.error || 'Could not add that word.');
        return;
      }
      setScrambleWords((words) => [...words, { word: response.word, pointsEarned: response.pointsEarned }]);
      setScrambleLetterIndexes([]);
      setScrambleError('');
    });
  };

  const addScrambleLetter = (index) => {
    if (answered || scrambleLetterIndexes.includes(index)) return;
    setScrambleLetterIndexes((indexes) => [...indexes, index]);
    setScrambleError('');
  };

  const scrambleWord = currentQuestion && isWordScramble
    ? scrambleLetterIndexes.map((index) => currentQuestion.scrambleLetters[index]).join('')
    : '';

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
          {roomClosed && <div className="mb-5 text-center bg-red-950 border border-red-700 text-red-200 rounded-xl p-3 font-bold">This room is closed for the night.</div>}
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
          <h1 className="text-4xl font-black tracking-tight mb-7"><span className="text-[#2A97CE]">GAME</span>{' '}<span className="text-[#B8C22E]">NIGHT</span></h1>
          <div className="w-20 h-20 bg-emerald-500/20 border border-emerald-500 text-emerald-400 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl font-bold animate-pulse">
            ✓
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">You&apos;re in the Party!</h2>
          <p className="text-zinc-400 text-sm">Sit tight! Deven and Ned will launch the next game shortly.</p>
        </div>
      )}

      {joined && !isEditingName && introTitle && <div className="text-center my-auto p-8 bg-zinc-900 border border-purple-700 rounded-3xl mx-auto max-w-md w-full"><p className="text-purple-300 uppercase tracking-[0.25em] font-bold mb-4">Get ready for</p><h2 className="text-4xl font-black text-white">{introTitle}</h2></div>}

      {/* 3. QUESTION + ANSWER BUTTONS */}
      {joined && !isEditingName && gameStarted && currentQuestion && !podiumPlace && (
        <div className="w-full max-w-md mx-auto my-auto flex flex-col justify-center">
          <p className="text-center text-xs uppercase tracking-widest text-zinc-500 font-semibold mb-2">
            Question {currentQuestion.questionNumber} of {currentQuestion.totalQuestions}
          </p>
          {currentQuestion.gameType !== 'simon-says' && currentQuestion.gameType !== 'word-scramble' && <h2 className="text-xl font-black text-white text-center leading-snug mb-5 px-1">
            {currentQuestion.questionText}
          </h2>}

          {!answered && isPitchMeeting ? (
            <div className="space-y-6 text-center"><div className="bg-zinc-900 border border-sky-700 rounded-3xl p-6"><div className="flex justify-between gap-4 text-xl font-black"><span className="text-red-300 text-left">{currentQuestion.options[0]}<strong className="block text-4xl text-white mt-2">{pitchAllocation}</strong></span><span className="text-blue-300 text-right">{currentQuestion.options[1]}<strong className="block text-4xl text-white mt-2">{currentQuestion.pitchPoints - pitchAllocation}</strong></span></div><input type="range" min="0" max={currentQuestion.pitchPoints} step="1" value={currentQuestion.pitchPoints - (pitchAllocation ?? currentQuestion.pitchPoints / 2)} onChange={(e) => setPitchAllocation(currentQuestion.pitchPoints - Number(e.target.value))} className="w-full mt-8 accent-sky-400" /></div><button onClick={() => handleAnswerClick(pitchAllocation)} className="w-full bg-sky-500 hover:bg-sky-400 text-zinc-950 p-4 rounded-2xl font-black text-lg">Lock In Allocation</button></div>
          ) : !answered && isWordScramble ? (
            <div className="space-y-5"><p className="text-center text-[#B8C22E] font-bold">Tap letters to build as many words as you can.</p><div className="min-h-20 bg-zinc-900 border border-[#2A97CE] rounded-2xl p-4 flex items-center justify-center"><span className={`text-3xl font-black tracking-[0.2em] ${scrambleWord ? 'text-[#2A97CE]' : 'text-zinc-600'}`}>{scrambleWord || 'YOUR WORD'}</span></div><div className="grid grid-cols-4 gap-2 max-w-xs mx-auto">{scrambleLetterOrder.map((index) => { const letter = currentQuestion.scrambleLetters[index]; return <button key={`${letter}-${index}`} onClick={() => addScrambleLetter(index)} disabled={scrambleLetterIndexes.includes(index)} className={`aspect-square rounded-xl flex items-center justify-center text-2xl font-black shadow-lg transition active:scale-95 ${scrambleLetterIndexes.includes(index) ? 'bg-zinc-800 text-zinc-600 opacity-50' : 'bg-[#B8C22E] active:bg-[#a7b127] text-zinc-950'}`}>{letter}</button>; })}</div><form onSubmit={submitScrambleWord} className="grid grid-cols-2 gap-3"><button type="button" onClick={() => setScrambleLetterIndexes((indexes) => indexes.slice(0, -1))} disabled={!scrambleLetterIndexes.length} className="bg-zinc-800 disabled:opacity-40 hover:bg-zinc-700 text-white font-bold py-4 rounded-2xl">Undo</button><button type="submit" disabled={scrambleWord.length < 3} className="bg-[#B8C22E] disabled:opacity-40 hover:bg-[#a7b127] text-zinc-950 font-black py-4 rounded-2xl">Submit Word</button></form>{scrambleLetterIndexes.length > 0 && <button type="button" onClick={() => setScrambleLetterIndexes([])} className="block mx-auto text-sm text-zinc-400 font-bold">Clear word</button>}{scrambleError && <p className="text-center text-rose-300 text-sm font-bold">{scrambleError}</p>}<div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4"><div className="flex justify-between text-sm font-bold mb-3"><span className="text-zinc-300">Your words</span><span className="text-[#2A97CE]">{scrambleWords.length} found</span></div>{scrambleWords.length ? <div className="flex flex-wrap gap-2">{scrambleWords.map((entry) => <span key={entry.word} className="bg-[#B8C22E]/15 border border-[#B8C22E] text-[#B8C22E] rounded-lg px-3 py-2 font-bold">{entry.word} <span className="text-[#2A97CE] text-xs">+{entry.pointsEarned}</span></span>)}</div> : <p className="text-zinc-500 text-sm">Words you add will appear here.</p>}</div></div>
          ) : !answered && isAutocompleteTrivia ? (
            <div className="space-y-4"><p className="text-center text-teal-300 font-bold">Start typing your answer, then choose a suggestion.</p><input autoFocus type="text" value={autocompleteInput} onChange={(e) => setAutocompleteInput(e.target.value)} placeholder="Type an answer..." className="w-full p-4 bg-zinc-900 border border-teal-700 rounded-2xl text-white text-lg font-bold focus:outline-none focus:border-teal-400" />{autocompleteInput.trim() && <div className="space-y-2">{(currentQuestion.autocompleteAnswers || []).filter((answer) => normalizeAutocompleteText(answer).includes(normalizeAutocompleteText(autocompleteInput))).slice(0, 6).map((answer) => <button key={answer} onClick={() => handleAnswerClick(answer)} className="w-full text-left p-4 bg-zinc-900 hover:bg-teal-950 border border-zinc-700 hover:border-teal-500 rounded-2xl text-white font-bold transition">{answer}</button>)}{!(currentQuestion.autocompleteAnswers || []).some((answer) => normalizeAutocompleteText(answer).includes(normalizeAutocompleteText(autocompleteInput))) && <p className="text-center text-zinc-500 py-4">No matching answer yet—try a different search.</p>}</div>}</div>
          ) : !answered && isSimonSays ? (
            <div className="space-y-5 text-center">
              <p className="text-cyan-300 font-black text-2xl">Simon Says</p>
              <p className="text-zinc-400 font-semibold">Enter the {currentQuestion.simonSequenceLength}-color sequence.</p>
              <div className="flex flex-wrap justify-center gap-2 min-h-14 bg-zinc-900 border border-zinc-800 rounded-2xl p-3">{simonInput.length === 0 ? <span className="text-zinc-500 text-sm self-center">Your sequence will appear here</span> : simonInput.map((color, index) => <span key={index} className={`w-9 h-9 rounded-lg ${color === 'red' ? 'bg-red-600' : color === 'green' ? 'bg-green-600' : color === 'blue' ? 'bg-blue-600' : 'bg-orange-500'}`} />)}</div>
              <p className="text-zinc-400 font-mono">{simonInput.length} / {currentQuestion.simonSequenceLength}</p>
              <div className="grid grid-cols-2 gap-3 max-w-64 mx-auto"><button onClick={() => handleSimonColor('red')} className="h-28 rounded-2xl bg-red-600 active:bg-red-700 shadow-xl transition active:scale-95 font-black text-white" aria-label="Red">Red</button><button onClick={() => handleSimonColor('green')} className="h-28 rounded-2xl bg-green-600 active:bg-green-700 shadow-xl transition active:scale-95 font-black text-white" aria-label="Green">Green</button><button onClick={() => handleSimonColor('blue')} className="h-28 rounded-2xl bg-blue-600 active:bg-blue-700 shadow-xl transition active:scale-95 font-black text-white" aria-label="Blue">Blue</button><button onClick={() => handleSimonColor('orange')} className="h-28 rounded-2xl bg-orange-500 active:bg-orange-600 shadow-xl transition active:scale-95 font-black text-white" aria-label="Orange">Orange</button></div>
              {simonInput.length > 0 && <button onClick={() => setSimonInput((sequence) => sequence.slice(0, -1))} className="text-zinc-400 font-bold">Undo last color</button>}
            </div>
          ) : !answered && isShotInTheDark ? (
            <div className="space-y-6 text-center">
              <p className="text-zinc-400 font-semibold">Move the slider to make your best estimate:</p>
              <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 space-y-6"><p className="text-5xl font-black text-white">{guessValue}</p><div><input type="range" min={currentQuestion.answerMin} max={currentQuestion.answerMax} step={currentQuestion.answerStep} value={guessValue ?? currentQuestion.answerMin} onChange={(e) => setGuessValue(Number(e.target.value))} className="w-full accent-purple-500" /><div className="flex justify-between text-xs text-zinc-500 mt-2"><span>{currentQuestion.answerMin}</span><span>{currentQuestion.answerMax}</span></div></div><div className="flex justify-center gap-4"><button onClick={() => adjustGuess(-currentQuestion.answerStep)} className="bg-zinc-800 w-16 h-14 rounded-xl font-black text-3xl">−</button><button onClick={() => adjustGuess(currentQuestion.answerStep)} className="bg-zinc-800 w-16 h-14 rounded-xl font-black text-3xl">+</button></div></div>
              <button onClick={() => handleAnswerClick(guessValue)} className="w-full bg-purple-600 hover:bg-purple-500 p-4 rounded-2xl font-black text-lg">Lock In {guessValue}</button>
            </div>
          ) : !answered ? (
            <div className="space-y-3">
              <p className="text-center text-zinc-400 font-semibold mb-2">Tap your choice:</p>
              {currentQuestion.options.slice(0, currentQuestion.gameType === 'liar-liar' ? 2 : 4).map((optText, idx) => {
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
              {isAutocompleteTrivia ? <div className="max-w-full overflow-x-auto whitespace-nowrap bg-teal-950/60 border border-teal-600 text-teal-200 rounded-2xl px-4 py-3 mb-4 text-lg font-bold">{selectedAnswer}</div> : <div className="w-20 h-20 bg-purple-600/20 border border-purple-500 text-purple-400 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl font-bold animate-bounce">
                {selectedAnswer}
              </div>}
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
