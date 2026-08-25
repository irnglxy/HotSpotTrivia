#!/usr/bin/env node

// This standalone Node script intentionally uses CommonJS so it can run without
// changing the app's module configuration.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { io } = require('socket.io-client');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('node:fs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const wordListPath = require('word-list').default;

const [targetUrl, requestedPlayers = '25', requestedDuration = '180'] = process.argv.slice(2);
const playerCount = Number(requestedPlayers);
const durationSeconds = Number(requestedDuration);

if (!targetUrl || !Number.isInteger(playerCount) || playerCount < 1 || playerCount > 200 || !Number.isFinite(durationSeconds) || durationSeconds < 10) {
  console.error('Usage: npm run load-test -- <URL> [players 1-200] [duration-seconds]');
  process.exit(1);
}

const bots = [];
const dictionaryWords = new Set(fs.readFileSync(wordListPath, 'utf8').split(/\r?\n/).map((word) => word.trim().toLowerCase()).filter(Boolean));
const joinedAt = new Map();
const questionReceipts = new Map();
const wordCandidateReports = new Set();
const scrambleCandidates = new Map();
let connected = 0;
let joined = 0;
let joinFailures = 0;
let connectionFailures = 0;
let answersSubmitted = 0;
let wordSubmissions = 0;
let rejectedWordSubmissions = 0;
let shuttingDown = false;
const startedAt = Date.now();

function makeAnswer(question) {
  if (question.gameType === 'shot-in-the-dark') {
    const min = Number(question.answerMin);
    const max = Number(question.answerMax);
    const step = Number(question.answerStep) || 1;
    const midpoint = min + ((max - min) / 2);
    return Math.round(midpoint / step) * step;
  }
  if (question.gameType === 'pitch-meeting') return Math.round((Number(question.pitchPoints) || 100) / 2);
  if (question.gameType === 'simon-says') return Array.from({ length: question.simonSequenceLength || 1 }, () => 'red');
  if (question.gameType === 'timeline') return [...(question.timelineItems || [])].reverse();
  if (question.gameType === 'autocomplete-trivia') return question.autocompleteAnswers?.[0];
  return 'A';
}

function canBuildWord(word, letters) {
  const available = new Map();
  for (const letter of letters.toLowerCase()) available.set(letter, (available.get(letter) || 0) + 1);
  for (const letter of word) {
    const remaining = available.get(letter) || 0;
    if (remaining === 0) return false;
    available.set(letter, remaining - 1);
  }
  return true;
}

function wordsForLetters(letters) {
  const normalizedLetters = (letters || '').toLowerCase();
  if (scrambleCandidates.has(normalizedLetters)) return scrambleCandidates.get(normalizedLetters);
  const candidates = [...dictionaryWords]
    .filter((word) => word.length >= 3 && canBuildWord(word, normalizedLetters))
    .sort((first, second) => second.length - first.length || first.localeCompare(second));
  scrambleCandidates.set(normalizedLetters, candidates);
  return candidates;
}

function printStatus() {
  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  console.log(`[${elapsed}s] connected ${connected}/${playerCount} | joined ${joined}/${playerCount} | join failures ${joinFailures} | connection failures ${connectionFailures} | answers ${answersSubmitted} | word submissions ${wordSubmissions} accepted, ${rejectedWordSubmissions} rejected`);
}

function printQuestionDelivery() {
  for (const [questionNumber, receipts] of questionReceipts) {
    const firstReceipt = Math.min(...receipts);
    const lastReceipt = Math.max(...receipts);
    console.log(`Question ${questionNumber}: received by ${receipts.length}/${joined} bots; delivery spread ${lastReceipt - firstReceipt}ms.`);
  }
}

function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(statusTimer);
  clearTimeout(endTimer);
  bots.forEach((bot) => bot.disconnect());
  printStatus();
  printQuestionDelivery();
  console.log(`Load test ended: ${reason}`);
  process.exit(joinFailures || connectionFailures ? 1 : 0);
}

function createBot(index) {
  const socket = io(targetUrl, {
    reconnection: false,
    timeout: 15000
  });
  bots.push(socket);
  let wordTimer;
  let submittedWords = new Set();

  const stopSubmittingWords = () => {
    clearInterval(wordTimer);
    wordTimer = undefined;
  };

  socket.on('connect', () => {
    connected += 1;
    const key = `load-test-${startedAt}-${index}`;
    socket.emit('join-master-lobby', {
      playerName: `Load Test ${String(index + 1).padStart(3, '0')}`,
      emoji: '🤖',
      color: '#2A97CE',
      playerKey: key
    }, (response) => {
      if (response?.success) {
        joined += 1;
        joinedAt.set(socket.id, Date.now());
      } else {
        joinFailures += 1;
        console.error(`Bot ${index + 1} could not join: ${response?.error || 'no response'}`);
      }
    });
  });

  socket.on('connect_error', (error) => {
    connectionFailures += 1;
    console.error(`Bot ${index + 1} connection error: ${error.message}`);
  });

  socket.on('next-question', (question) => {
    if (!joinedAt.has(socket.id)) return;
    const key = question.questionNumber || 0;
    const receipts = questionReceipts.get(key) || [];
    receipts.push(Date.now());
    questionReceipts.set(key, receipts);
    stopSubmittingWords();
    submittedWords = new Set();

    if (question.gameType === 'word-scramble') {
      const candidates = wordsForLetters(question.scrambleLetters);
      if (candidates.length === 0) {
        console.error(`Bot ${index + 1} found no valid dictionary words for "${question.scrambleLetters}".`);
        return;
      }
      let candidateIndex = index % candidates.length;
      const submitWord = () => {
        if (shuttingDown || !socket.connected || submittedWords.size === candidates.length) return stopSubmittingWords();
        const word = candidates[candidateIndex];
        candidateIndex = (candidateIndex + 1) % candidates.length;
        if (submittedWords.has(word)) return;
        submittedWords.add(word);
        socket.emit('submit-scramble-word', { word }, (response) => {
          if (response?.success) wordSubmissions += 1;
          else rejectedWordSubmissions += 1;
        });
      };
      if (!wordCandidateReports.has(key)) {
        wordCandidateReports.add(key);
        console.log(`Question ${key}: Word Scramble has ${candidates.length} valid test words available to each bot.`);
      }
      setTimeout(submitWord, 250 + Math.floor(Math.random() * 1250));
      wordTimer = setInterval(submitWord, 1600 + Math.floor(Math.random() * 1200));
      return;
    }

    const answer = makeAnswer(question);
    if (answer === undefined) return;
    setTimeout(() => {
      if (!shuttingDown && socket.connected) {
        socket.emit('submit-answer', { answer });
        answersSubmitted += 1;
      }
    }, 250 + Math.floor(Math.random() * 1750));
  });

  socket.on('question-time-up', stopSubmittingWords);
  socket.on('disconnect', stopSubmittingWords);
}

console.log(`Starting ${playerCount} simulated players against ${targetUrl}`);
console.log('Open a dedicated test game in the host screen, then start a question while this test runs.');

for (let index = 0; index < playerCount; index += 1) {
  setTimeout(() => createBot(index), index * 40);
}

const statusTimer = setInterval(printStatus, 5000);
const endTimer = setTimeout(() => shutdown('time limit reached'), durationSeconds * 1000);
process.on('SIGINT', () => shutdown('stopped with Ctrl+C'));
