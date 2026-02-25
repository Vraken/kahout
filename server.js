const express   = require('express');
const http      = require('http');
const WebSocket = require('ws');
const path      = require('path');
const fs        = require('fs');
const multer    = require('multer');
const rateLimit = require('express-rate-limit');
const helmet    = require('helmet');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

// ─── Helmet ───────────────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:    ["'self'"],
      scriptSrc:     ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc:      ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc:       ["'self'", "https://fonts.gstatic.com"],
      imgSrc:        ["'self'", "data:"],
    },
  },
}));

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ─── Rate limiting ────────────────────────────────────────────────────────────
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Trop de requêtes, réessaie plus tard.' },
}));
app.use('/api/upload', rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  message: { error: "Trop d'uploads." },
}));
app.use('/api/create', rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: 'Trop de parties créées.' },
}));

// ─── Constantes de validation ─────────────────────────────────────────────────
const MAX_PLAYERS   = 100;
const MAX_QUESTIONS = 50;
const MAX_ANSWERS   = 12;
const MAX_Q_LENGTH  = 500;
const MAX_A_LENGTH  = 200;
const MAX_NAME_LEN  = 60;

function sanitizeQuestions(questions) {
  if (!Array.isArray(questions) || questions.length === 0)
    throw new Error('Questions manquantes');
  if (questions.length > MAX_QUESTIONS)
    throw new Error('Trop de questions (max 50)');
  return questions.map(q => {
    if (!q.question || typeof q.question !== 'string')
      throw new Error('Question invalide');
    if (!Array.isArray(q.answers) || q.answers.length < 2 || q.answers.length > MAX_ANSWERS)
      throw new Error('Réponses invalides');
    return {
      question: q.question.trim().slice(0, MAX_Q_LENGTH),
      answers:  q.answers.map(a => (typeof a === 'string' ? a : '').trim().slice(0, MAX_A_LENGTH)),
      correct:  q.correct,
      time:     typeof q.time === 'number' ? Math.min(Math.max(q.time, 5), 120) : 20,
      type:     q.type === 'multiple' ? 'multiple' : 'single',
      image:    typeof q.image === 'string' && q.image.startsWith('/uploads/') ? q.image : null,
    };
  });
}

// ─── Dossiers ─────────────────────────────────────────────────────────────────
const QUIZ_DIR   = path.join(__dirname, 'quizzes');
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(QUIZ_DIR))   fs.mkdirSync(QUIZ_DIR);
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ─── Multer ───────────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename:    (req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    const name = Date.now() + '-' + Math.random().toString(36).slice(2) + ext;
    cb(null, name);
  },
});

const ALLOWED_TYPES = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
const MAX_SIZE_MB   = 5;
const MAX_SIZE_B    = MAX_SIZE_MB * 1024 * 1024;

const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE_B },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_TYPES.includes(ext)) {
      return cb(new multer.MulterError(
        'LIMIT_UNEXPECTED_FILE',
        `Format non supporté : ${ext || 'inconnu'}. Formats acceptés : JPG, PNG, GIF, WebP`
      ));
    }
    cb(null, true);
  },
});

function handleUpload(req, res, next) {
  upload.single('image')(req, res, (err) => {
    if (!err) return next();
    if (req.file) fs.unlink(req.file.path, () => {});
    if (err instanceof multer.MulterError) {
      switch (err.code) {
        case 'LIMIT_FILE_SIZE':
          return res.status(413).json({
            error:     'Fichier trop volumineux',
            detail:    `La taille maximale autorisée est de ${MAX_SIZE_MB} Mo.`,
            code:      'FILE_TOO_LARGE',
            maxSizeMb: MAX_SIZE_MB,
          });
        case 'LIMIT_UNEXPECTED_FILE':
          return res.status(415).json({
            error:   err.field,
            detail:  'Utilise un format image standard.',
            code:    'INVALID_TYPE',
            allowed: ALLOWED_TYPES,
          });
        case 'LIMIT_FILE_COUNT':
          return res.status(400).json({ error: 'Un seul fichier à la fois', code: 'TOO_MANY_FILES' });
        default:
          return res.status(400).json({ error: `Erreur d'upload : ${err.message}`, code: err.code });
      }
    }
    console.error('[upload] Erreur inattendue :', err);
    return res.status(500).json({
      error:  "Erreur serveur lors de l'upload",
      detail: err.message,
      code:   'SERVER_ERROR',
    });
  });
}

// ─── State ────────────────────────────────────────────────────────────────────
const games = {};

function generatePin() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function broadcast(game, msg) {
  const data = JSON.stringify(msg);
  game.players.forEach(p => {
    if (p.ws && p.ws.readyState === WebSocket.OPEN) p.ws.send(data);
  });
}

function sendToHost(game, msg) {
  if (game.hostWs && game.hostWs.readyState === WebSocket.OPEN)
    game.hostWs.send(JSON.stringify(msg));
}

function getLeaderboard(game) {
  return [...game.players]
    .sort((a, b) => b.score - a.score)
    .map((p, i) => ({ rank: i + 1, name: p.name, score: p.score }));
}

function getAnswerCounts(game) {
  const q      = game.questions[game.currentQ];
  const count  = q ? q.answers.length : 4;
  const counts = new Array(count).fill(0);
  Object.values(game.answers).forEach(a => {
    const selected = Array.isArray(a.answer) ? a.answer : [a.answer];
    selected.forEach(idx => { if (idx >= 0 && idx < count) counts[idx]++; });
  });
  return counts;
}

// ─── REST : Upload image ──────────────────────────────────────────────────────
app.post('/api/upload', handleUpload, (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      error:  'Aucun fichier reçu',
      detail: 'Assure-toi de bien sélectionner une image.',
      code:   'NO_FILE',
    });
  }
  const sizeMb = (req.file.size / (1024 * 1024)).toFixed(2);
  console.log(`[upload] ✅ ${req.file.filename} — ${sizeMb} Mo`);
  res.json({
    url:      `/uploads/${req.file.filename}`,
    filename: req.file.filename,
    sizeMb:   parseFloat(sizeMb),
  });
});

app.delete('/api/upload', (req, res) => {
  const { url } = req.body;
  if (!url || !url.startsWith('/uploads/'))
    return res.status(400).json({ error: 'URL invalide' });
  const file = path.join(__dirname, 'public', url);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  res.json({ ok: true });
});

// ─── REST : Quiz ──────────────────────────────────────────────────────────────
app.get('/api/quizzes', (req, res) => {
  const files = fs.readdirSync(QUIZ_DIR).filter(f => f.endsWith('.json'));
  const quizzes = files.map(f => {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(QUIZ_DIR, f), 'utf8'));
      return {
        id:            f.replace('.json', ''),
        name:          data.name,
        questionCount: data.questions.length,
        createdAt:     data.createdAt,
      };
    } catch { return null; }
  }).filter(Boolean);
  res.json(quizzes);
});

app.get('/api/quizzes/:id', (req, res) => {
  const file = path.join(QUIZ_DIR, `${req.params.id}.json`);
  if (!fs.existsSync(file))
    return res.status(404).json({ error: 'Quiz introuvable' });
  res.json(JSON.parse(fs.readFileSync(file, 'utf8')));
});

app.post('/api/quizzes', (req, res) => {
  const { name, questions, id } = req.body;
  if (!name || !name.trim())
    return res.status(400).json({ error: 'Nom manquant' });
  if (name.length > MAX_NAME_LEN)
    return res.status(400).json({ error: 'Nom trop long' });
  let sanitized;
  try { sanitized = sanitizeQuestions(questions); }
  catch (e) { return res.status(400).json({ error: e.message }); }

  const quizId   = id || Date.now().toString();
  const file     = path.join(QUIZ_DIR, `${quizId}.json`);
  const existing = (id && fs.existsSync(file))
    ? JSON.parse(fs.readFileSync(file, 'utf8'))
    : null;

  const quiz = {
    id:        quizId,
    name:      name.trim(),
    questions: sanitized,
    createdAt: existing ? existing.createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(file, JSON.stringify(quiz, null, 2));
  res.json({ ok: true, id: quizId });
});

app.delete('/api/quizzes/:id', (req, res) => {
  const file = path.join(QUIZ_DIR, `${req.params.id}.json`);
  if (!fs.existsSync(file))
    return res.status(404).json({ error: 'Quiz introuvable' });
  try {
    const quiz = JSON.parse(fs.readFileSync(file, 'utf8'));
    quiz.questions.forEach(q => {
      if (q.image && q.image.startsWith('/uploads/')) {
        const imgFile = path.join(__dirname, 'public', q.image);
        if (fs.existsSync(imgFile)) fs.unlinkSync(imgFile);
      }
    });
  } catch {}
  fs.unlinkSync(file);
  res.json({ ok: true });
});

// ─── REST : Partie ────────────────────────────────────────────────────────────
app.post('/api/create', (req, res) => {
  const { questions } = req.body;
  let sanitized;
  try { sanitized = sanitizeQuestions(questions); }
  catch (e) { return res.status(400).json({ error: e.message }); }

  const pin = generatePin();
  games[pin] = {
    pin,
    hostWs:        null,
    players:       [],
    questions:     sanitized,
    currentQ:      -1,
    state:         'lobby',
    timer:         null,
    autoTimer:     null,
    answers:       {},
    questionStart: null,
  };
  res.json({ pin });
});

app.get('/api/check/:pin', (req, res) => {
  const game = games[req.params.pin];
  if (!game)
    return res.status(404).json({ error: 'Partie introuvable' });
  if (game.state !== 'lobby')
    return res.status(400).json({ error: 'Partie déjà commencée' });
  res.json({ ok: true });
});

// ─── WebSocket ────────────────────────────────────────────────────────────────
wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    if (raw.length > 4096)
      return ws.send(JSON.stringify({ type: 'error', message: 'Message trop grand' }));

    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    const { type, pin } = msg;

    if (pin && !/^\d{6}$/.test(pin)) return;

    const game = games[pin];

    if (type === 'host_join') {
      if (!game)
        return ws.send(JSON.stringify({ type: 'error', message: 'Partie introuvable' }));
      game.hostWs = ws;
      ws.gamePin  = pin;
      ws.role     = 'host';
      ws.send(JSON.stringify({ type: 'host_joined', pin }));
      return;
    }

    if (type === 'player_join') {
      if (!game)
        return ws.send(JSON.stringify({ type: 'error', message: 'Code invalide' }));
      if (game.state !== 'lobby')
        return ws.send(JSON.stringify({ type: 'error', message: 'Partie déjà commencée' }));
      if (game.players.length >= MAX_PLAYERS)
        return ws.send(JSON.stringify({ type: 'error', message: 'Partie pleine' }));
      const name = (msg.name || '').trim().slice(0, 20).replace(/[<>]/g, '');
      if (!name)
        return ws.send(JSON.stringify({ type: 'error', message: 'Nom invalide' }));
      if (game.players.find(p => p.name.toLowerCase() === name.toLowerCase()))
        return ws.send(JSON.stringify({ type: 'error', message: 'Nom déjà pris' }));

      const playerId = Date.now().toString() + Math.random().toString(36).slice(2);
      ws.playerId = playerId;
      ws.gamePin  = pin;
      ws.role     = 'player';
      game.players.push({ id: playerId, name, score: 0, ws });
      ws.send(JSON.stringify({ type: 'joined', playerId, name }));
      sendToHost(game, { type: 'player_joined', name, count: game.players.length });
      return;
    }

    if (!game) return;

    if (type === 'start_game' && ws.role === 'host') {
      if (game.players.length === 0)
        return sendToHost(game, { type: 'error', message: 'Aucun joueur' });
      nextQuestion(game);
      return;
    }

    if (type === 'next_question' && ws.role === 'host') {
      if (game.state === 'q_result') nextQuestion(game);
      return;
    }

    if (type === 'end_game' && ws.role === 'host') {
      endGame(game);
      return;
    }

    if (type === 'answer' && ws.role === 'player') {
      if (game.state !== 'question') return;
      const player = game.players.find(p => p.id === ws.playerId);
      if (!player) return;

      const q          = game.questions[game.currentQ];
      const isMultiple = q.type === 'multiple';

      if (isMultiple) {
        if (!msg.final) {
          game.answers[ws.playerId] = { answer: msg.answer, submitted: false };
          return;
        }
        if (game.answers[ws.playerId]?.submitted) return;
      } else {
        if (game.answers[ws.playerId]?.submitted) return;
      }

      const elapsed   = (Date.now() - game.questionStart) / 1000;
      const timeLimit = q.time || 20;
      let isCorrect   = false;
      let points      = 0;

      if (isMultiple) {
        const correctSet = new Set(q.correct);
        const givenSet   = new Set(Array.isArray(msg.answer) ? msg.answer : []);
        const allCorrect = [...correctSet].every(i => givenSet.has(i));
        const noWrong    = [...givenSet].every(i => correctSet.has(i));
        isCorrect = allCorrect && noWrong && givenSet.size > 0;
        if (isCorrect) {
          const ratio = Math.max(0, (timeLimit - elapsed) / timeLimit);
          points = Math.round(500 + 500 * ratio);
          player.score += points;
        } else if ([...givenSet].every(i => correctSet.has(i)) && givenSet.size > 0) {
          points = Math.round(([...givenSet].filter(i => correctSet.has(i)).length / correctSet.size) * 300);
          player.score += points;
        }
      } else {
        isCorrect = msg.answer === q.correct;
        if (isCorrect) {
          const ratio = Math.max(0, (timeLimit - elapsed) / timeLimit);
          points = Math.round(500 + 500 * ratio);
          player.score += points;
        }
      }

      game.answers[ws.playerId] = { answer: msg.answer, correct: isCorrect, points, submitted: true };
      ws.send(JSON.stringify({ type: 'answer_received', correct: isCorrect, points }));

      const activePlayers  = game.players.filter(p => p.ws && p.ws.readyState === WebSocket.OPEN);
      const submittedCount = Object.values(game.answers).filter(a => a.submitted).length;
      sendToHost(game, { type: 'answer_count', count: submittedCount, total: activePlayers.length });

      if (submittedCount >= activePlayers.length) {
        clearTimeout(game.timer);
        game.autoTimer = setTimeout(() => revealAnswer(game), 1000);
      }
      return;
    }
  });

  ws.on('close', () => {
    if (!ws.gamePin) return;
    const game = games[ws.gamePin];
    if (!game) return;

    if (ws.role === 'player') {
      const player = game.players.find(p => p.id === ws.playerId);
      if (player) player.ws = null;
      const activeCount = game.players.filter(p => p.ws && p.ws.readyState === WebSocket.OPEN).length;
      sendToHost(game, { type: 'player_left', count: activeCount });

      if (game.state === 'question') {
        const activePlayers  = game.players.filter(p => p.ws && p.ws.readyState === WebSocket.OPEN);
        const submittedCount = Object.values(game.answers).filter(a => a.submitted).length;
        if (activePlayers.length > 0 && submittedCount >= activePlayers.length) {
          clearTimeout(game.timer);
          game.autoTimer = setTimeout(() => revealAnswer(game), 1000);
        }
      }
    }

    if (ws.role === 'host') {
      broadcast(game, { type: 'host_left' });
    }
  });
});

// ─── Logique de jeu ───────────────────────────────────────────────────────────
function nextQuestion(game) {
  game.currentQ++;
  if (game.currentQ >= game.questions.length) {
    endGame(game);
    return;
  }
  game.state         = 'question';
  game.answers       = {};
  const q            = game.questions[game.currentQ];
  const timeLimit    = q.time || 20;
  game.questionStart = Date.now();

  sendToHost(game, {
    type:         'question',
    index:        game.currentQ,
    total:        game.questions.length,
    question:     q.question,
    answers:      q.answers,
    correct:      q.correct,
    time:         timeLimit,
    questionType: q.type || 'single',
    image:        q.image || null,
  });

  broadcast(game, {
    type:         'question',
    index:        game.currentQ,
    total:        game.questions.length,
    question:     q.question,
    answers:      q.answers,
    time:         timeLimit,
    questionType: q.type || 'single',
    image:        q.image || null,
  });

  game.timer = setTimeout(() => revealAnswer(game), timeLimit * 1000);
}

function revealAnswer(game) {
  if (game.state !== 'question') return;
  clearTimeout(game.timer);
  clearTimeout(game.autoTimer);
  game.state        = 'q_result';
  const q           = game.questions[game.currentQ];
  const leaderboard = getLeaderboard(game);
  const isLast      = game.currentQ + 1 >= game.questions.length;

  sendToHost(game, {
    type:         'question_result',
    correct:      q.correct,
    leaderboard,
    answerCounts: getAnswerCounts(game),
    questionType: q.type || 'single',
    isLast,
  });

  broadcast(game, {
    type:         'question_result',
    correct:      q.correct,
    leaderboard,
    questionType: q.type || 'single',
    isLast,
  });

  game.autoTimer = setTimeout(() => {
    if (game.state === 'q_result') isLast ? endGame(game) : nextQuestion(game);
  }, 5000);
}

function endGame(game) {
  clearTimeout(game.timer);
  clearTimeout(game.autoTimer);
  game.state        = 'final';
  const leaderboard = getLeaderboard(game);
  sendToHost(game, { type: 'game_over', leaderboard });
  broadcast(game,  { type: 'game_over', leaderboard });
  setTimeout(() => delete games[game.pin], 10 * 60 * 1000);
}

// ─── Nettoyage des uploads orphelins ─────────────────────────────────────────
function cleanupOrphanUploads() {
  try {
    const usedImages = new Set();
    fs.readdirSync(QUIZ_DIR)
      .filter(f => f.endsWith('.json'))
      .forEach(f => {
        try {
          const quiz = JSON.parse(fs.readFileSync(path.join(QUIZ_DIR, f), 'utf8'));
          quiz.questions.forEach(q => {
            if (q.image && q.image.startsWith('/uploads/'))
              usedImages.add(path.basename(q.image));
          });
        } catch {}
      });
    fs.readdirSync(UPLOAD_DIR).forEach(file => {
      if (!usedImages.has(file)) {
        fs.unlinkSync(path.join(UPLOAD_DIR, file));
        console.log(`[cleanup] 🗑  Orphelin supprimé : ${file}`);
      }
    });
  } catch (e) {
    console.error('[cleanup] Erreur :', e);
  }
}
setInterval(cleanupOrphanUploads, 60 * 60 * 1000);
cleanupOrphanUploads();

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🎮 Kahoot Clone lancé sur http://localhost:${PORT}`));