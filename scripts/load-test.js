#!/usr/bin/env node

// This standalone Node script intentionally uses CommonJS so it can run without
// changing the app's module configuration.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { io } = require('socket.io-client');

const [targetUrl, requestedPlayers = '25', requestedDuration = '180'] = process.argv.slice(2);
const playerCount = Number(requestedPlayers);
const durationSeconds = Number(requestedDuration);

if (!targetUrl || !Number.isInteger(playerCount) || playerCount < 1 || playerCount > 200 || !Number.isFinite(durationSeconds) || durationSeconds < 10) {
  console.error('Usage: npm run load-test -- <URL> [players 1-200] [duration-seconds]');
  process.exit(1);
}

const bots = [];
const joinedAt = new Map();
const questionReceipts = new Map();
let connected = 0;
let joined = 0;
let joinFailures = 0;
let connectionFailures = 0;
let answersSubmitted = 0;
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

function printStatus() {
  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  console.log(`[${elapsed}s] connected ${connected}/${playerCount} | joined ${joined}/${playerCount} | join failures ${joinFailures} | connection failures ${connectionFailures} | answers submitted ${answersSubmitted}`);
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
    const answer = makeAnswer(question);
    if (answer === undefined) return;
    setTimeout(() => {
      if (!shuttingDown && socket.connected) {
        socket.emit('submit-answer', { answer });
        answersSubmitted += 1;
      }
    }, 250 + Math.floor(Math.random() * 1750));
  });
}

console.log(`Starting ${playerCount} simulated players against ${targetUrl}`);
console.log('Open a dedicated test game in the host screen, then start a question while this test runs.');

for (let index = 0; index < playerCount; index += 1) {
  setTimeout(() => createBot(index), index * 40);
}

const statusTimer = setInterval(printStatus, 5000);
const endTimer = setTimeout(() => shutdown('time limit reached'), durationSeconds * 1000);
process.on('SIGINT', () => shutdown('stopped with Ctrl+C'));
