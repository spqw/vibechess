/**
 * VibeChess - Strategy-First Chess
 *
 * Main application: ties together the board, engine, classifier, and UI.
 * Player plays White and picks strategies. Stockfish plays Black.
 */

import { Chessground } from 'chessground';
import { Chess } from 'chess.js';
import { Engine } from './engine.js';
import { classifyMoves, detectThreats } from './classifier.js';
import { getAvailableStrategies } from './strategies.js';

// ============ STATE ============
let chess = new Chess();
let ground = null;
let engine = null;
let engineReady = false;
let playerColor = 'white';
let selectedStrategy = null;
let moveHistory = [];
let isThinking = false;

// ============ INIT ============
async function init() {
  // Initialize board
  ground = Chessground(document.getElementById('board'), {
    orientation: playerColor,
    movable: {
      free: false,
      color: playerColor,
      dests: legalDests(),
      events: {
        after: onPlayerMove,
      },
    },
    draggable: { showGhost: true },
    animation: { duration: 200 },
    highlight: {
      lastMove: true,
      check: true,
    },
  });

  // Initialize engine
  updateStatus('Loading Stockfish engine...');
  engine = new Engine();
  try {
    await engine.init();
    engineReady = true;
    updateStatus('Engine ready. Choose a strategy!');
    await analyzePosition();
  } catch (err) {
    console.error('Failed to init engine:', err);
    updateStatus('Engine failed to load. Running without analysis.');
    showStrategiesWithoutEngine();
  }

  // New game button
  document.getElementById('new-game-btn').addEventListener('click', newGame);
}

// ============ BOARD HELPERS ============
function legalDests() {
  const dests = new Map();
  const moves = chess.moves({ verbose: true });
  for (const m of moves) {
    if (!dests.has(m.from)) dests.set(m.from, []);
    dests.get(m.from).push(m.to);
  }
  return dests;
}

function toColor() {
  return chess.turn() === 'w' ? 'white' : 'black';
}

function updateBoard() {
  ground.set({
    fen: chess.fen(),
    turnColor: toColor(),
    movable: {
      color: playerColor,
      dests: toColor() === playerColor ? legalDests() : new Map(),
    },
    check: chess.isCheck(),
  });
}

// ============ PLAYER MOVE (direct board move) ============
async function onPlayerMove(from, to) {
  // Player made a direct move on the board
  const move = chess.move({ from, to, promotion: 'q' });
  if (!move) return;

  recordMove(move, selectedStrategy?.strategy?.name || 'Direct move');
  selectedStrategy = null;
  updateBoard();
  updateMoveHistory();
  updateTurnIndicator();

  if (chess.isGameOver()) {
    handleGameOver();
    return;
  }

  // Opponent's turn
  await opponentMove();
}

// ============ STRATEGY SELECTION ============
async function onStrategySelected(strategyOption) {
  if (isThinking || toColor() !== playerColor) return;

  selectedStrategy = strategyOption;
  const move = strategyOption.topMove;

  // Highlight the planned move on the board
  ground.set({
    drawable: {
      autoShapes: [
        {
          orig: move.from,
          dest: move.to,
          brush: 'green',
        },
      ],
    },
  });

  // Execute the move after a short delay for visual feedback
  isThinking = true;
  setTimeout(async () => {
    const from = move.from;
    const to = move.to;
    const result = chess.move({ from, to, promotion: move.promotion || 'q' });
    if (!result) {
      console.error('Invalid move from strategy:', move);
      isThinking = false;
      return;
    }

    // Animate the piece move on the board
    ground.move(from, to);

    recordMove(result, strategyOption.strategy.name);
    selectedStrategy = null;
    updateBoard();
    ground.set({
      drawable: { autoShapes: [] },
      lastMove: [from, to],
    });
    updateMoveHistory();
    updateTurnIndicator();

    if (chess.isGameOver()) {
      isThinking = false;
      handleGameOver();
      return;
    }

    await opponentMove();
    isThinking = false;
  }, 400);
}

// ============ THREAT SELECTION ============
async function onThreatSelected(threat) {
  if (isThinking || toColor() !== playerColor) return;
  if (!threat.move) return;

  const move = threat.move;

  // Highlight the move
  ground.set({
    drawable: {
      autoShapes: [
        { orig: move.from, dest: move.to, brush: 'red' },
      ],
    },
  });

  isThinking = true;
  setTimeout(async () => {
    const from = move.from;
    const to = move.to;
    const result = chess.move({ from, to, promotion: move.promotion || 'q' });
    if (!result) {
      console.error('Invalid move from threat:', move);
      isThinking = false;
      return;
    }

    ground.move(from, to);
    recordMove(result, threat.title);
    updateBoard();
    ground.set({
      drawable: { autoShapes: [] },
      lastMove: [from, to],
    });
    updateMoveHistory();
    updateTurnIndicator();

    if (chess.isGameOver()) {
      isThinking = false;
      handleGameOver();
      return;
    }

    await opponentMove();
    isThinking = false;
  }, 300);
}

// ============ OPPONENT (AI) MOVE ============
async function opponentMove() {
  if (!engineReady) {
    // Fallback: random legal move
    const moves = chess.moves({ verbose: true });
    if (moves.length === 0) return;
    const randomMove = moves[Math.floor(Math.random() * moves.length)];
    chess.move(randomMove);
    recordMove(randomMove, 'AI');
    updateBoard();
    updateMoveHistory();
    updateTurnIndicator();
    if (!chess.isGameOver()) {
      await analyzePosition();
    } else {
      handleGameOver();
    }
    return;
  }

  isThinking = true;
  setStrategiesLoading('Opponent is thinking...');
  setThreatsLoading();

  try {
    // Get AI's best move (plays at a moderate level)
    const bestUci = await engine.getBestMove(chess.fen(), { depth: 10 });
    const from = bestUci.slice(0, 2);
    const to = bestUci.slice(2, 4);
    const promotion = bestUci.length > 4 ? bestUci[4] : undefined;

    const move = chess.move({ from, to, promotion: promotion || undefined });
    if (!move) {
      console.error('AI made invalid move:', bestUci);
      isThinking = false;
      return;
    }

    recordMove(move, 'Stockfish');
    updateBoard();

    // Show AI's last move
    ground.set({
      lastMove: [from, to],
    });

    updateMoveHistory();
    updateTurnIndicator();

    if (chess.isGameOver()) {
      handleGameOver();
      return;
    }

    // Analyze new position for the player
    await analyzePosition();
  } catch (err) {
    console.error('AI move error:', err);
  } finally {
    isThinking = false;
  }
}

// ============ ANALYSIS ============
async function analyzePosition() {
  if (!engineReady) {
    showStrategiesWithoutEngine();
    return;
  }

  setStrategiesLoading('Analyzing position...');
  setThreatsLoading();

  try {
    // Get engine analysis (top 8 moves)
    const engineMoves = await engine.analyze(chess.fen(), { depth: 14, multiPV: 8 });

    // Update eval display
    if (engineMoves.length > 0) {
      const eval_ = engineMoves[0].eval;
      const evalEl = document.getElementById('eval-display');
      const displayEval = chess.turn() === 'b' ? -eval_ : eval_;
      evalEl.textContent = `Eval: ${displayEval > 0 ? '+' : ''}${displayEval.toFixed(1)}`;
    }

    // Classify moves into strategies
    const strategies = classifyMoves(engineMoves, chess);
    renderStrategies(strategies);

    // Detect threats
    const threats = detectThreats(chess);
    renderThreats(threats);

    // Highlight threatened squares
    highlightThreats(threats);
  } catch (err) {
    console.error('Analysis error:', err);
    showStrategiesWithoutEngine();
  }
}

function showStrategiesWithoutEngine() {
  // Fallback: show strategies based on heuristics only (no engine)
  // Still pick the best legal move for each strategy using the moveFilter scores
  const strategies = getAvailableStrategies(chess);
  const legalMoves = chess.moves({ verbose: true });

  const strategyOptions = strategies
    .map(s => {
      // Score each legal move by strategy fit
      const scored = legalMoves.map(m => ({
        ...m,
        engineScore: 0,
        humanScore: 0.5,
        strategyScore: s.moveFilter(m, chess),
      }));
      scored.sort((a, b) => b.strategyScore - a.strategyScore);
      const topMove = scored[0];
      if (!topMove) return null;
      return {
        strategy: s,
        topMove,
        allMoves: scored.slice(0, 3),
        relevance: s.relevance,
        combinedScore: s.relevance * (topMove.strategyScore || 1),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.combinedScore - a.combinedScore)
    .slice(0, 6);

  renderStrategies(strategyOptions);

  // Also show threats even without engine
  const threats = detectThreats(chess);
  renderThreats(threats);
  highlightThreats(threats);
}

// ============ RENDERING ============
function renderStrategies(strategyOptions) {
  const container = document.getElementById('strategies-list');

  if (strategyOptions.length === 0) {
    container.innerHTML = '<div class="placeholder">No strategies available in this position</div>';
    return;
  }

  container.innerHTML = strategyOptions
    .map((opt, idx) => {
      const s = opt.strategy;
      const topMove = opt.topMove;
      const hasEngine = topMove.engineScore !== 0 || engineReady;
      const evalStr = hasEngine ? topMove.engineScore.toFixed(1) : '';
      const evalSign = hasEngine && topMove.engineScore > 0 ? '+' : '';

      // Position fit indicator (1-3 dots based on relevance)
      const fit = opt.relevance >= 0.7 ? 'Great fit'
        : opt.relevance >= 0.45 ? 'Good fit'
        : 'Possible';
      const fitClass = opt.relevance >= 0.7 ? 'fit-great'
        : opt.relevance >= 0.45 ? 'fit-good'
        : 'fit-ok';

      return `
        <div class="strategy-card" data-type="${s.type}" data-index="${idx}">
          <div class="card-header">
            <span class="card-name">${s.name}</span>
            <span class="card-fit ${fitClass}">${fit}</span>
            ${hasEngine ? `<span class="card-eval">${evalSign}${evalStr}</span>` : ''}
          </div>
          <div class="card-description">${s.description}</div>
          <div class="card-moves">Play: ${topMove.san}${opt.allMoves.length > 1 ? ` (also ${opt.allMoves.slice(1).map(m => m.san).join(', ')})` : ''}</div>
          <div class="card-source">${s.source}</div>
        </div>
      `;
    })
    .join('');

  // Attach click handlers
  container.querySelectorAll('.strategy-card').forEach((card) => {
    card.addEventListener('click', () => {
      const idx = parseInt(card.dataset.index);
      const opt = strategyOptions[idx];

      // Deselect others
      container.querySelectorAll('.strategy-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');

      onStrategySelected(opt);
    });
  });
}

function renderThreats(threats) {
  const container = document.getElementById('threats-list');

  if (threats.length === 0) {
    container.innerHTML = '<div class="placeholder">Position looks calm</div>';
    return;
  }

  container.innerHTML = threats
    .map((t, idx) => {
      const typeClass = t.type === 'opportunity' ? 'threat-opportunity'
        : t.type === 'danger' ? 'threat-danger'
        : t.type === 'warning' ? 'threat-warning'
        : 'threat-info';

      const clickable = t.move ? 'clickable' : '';
      const action = t.move ? `Play ${t.move.san}` : '';

      return `
        <div class="threat-card ${typeClass} ${clickable}" data-index="${idx}">
          <div class="threat-title">${t.title}</div>
          <div class="threat-detail">${t.detail}</div>
          ${action ? `<div class="threat-action">${action}</div>` : ''}
        </div>
      `;
    })
    .join('');

  // Attach click handlers for actionable threats
  container.querySelectorAll('.threat-card.clickable').forEach((card) => {
    card.addEventListener('click', () => {
      const idx = parseInt(card.dataset.index);
      const threat = threats[idx];
      if (threat.move) {
        onThreatSelected(threat);
      }
    });
  });
}

function highlightThreats(threats) {
  const shapes = [];

  for (const t of threats) {
    if (!t.squares || t.squares.length === 0) continue;

    if (t.type === 'warning') {
      // Opponent threats: circle on our threatened piece, arrows from attackers
      const targetSquare = t.squares[0];
      // Red circle on the threatened piece
      shapes.push({
        orig: targetSquare,
        brush: 'red',
      });
      // Yellow arrows from each attacker to the threatened piece
      for (let i = 1; i < t.squares.length; i++) {
        shapes.push({
          orig: t.squares[i],
          dest: targetSquare,
          brush: 'yellow',
        });
      }
    } else if (t.type === 'opportunity' && t.move) {
      // Our opportunities: green arrow showing the move
      shapes.push({
        orig: t.move.from,
        dest: t.move.to,
        brush: 'green',
      });
    } else if (t.type === 'danger') {
      // In check: red highlight on king
      // Find our king square
      const fen = chess.fen().split(' ')[0];
      const isWhite = chess.turn() === 'w';
      const kingChar = isWhite ? 'K' : 'k';
      // Parse FEN to find king position
      let rank = 8, file = 0;
      for (const c of fen) {
        if (c === '/') { rank--; file = 0; continue; }
        if (c >= '1' && c <= '8') { file += parseInt(c); continue; }
        if (c === kingChar) {
          const sq = String.fromCharCode(97 + file) + rank;
          shapes.push({ orig: sq, brush: 'red' });
        }
        file++;
      }
    }
  }

  ground.set({
    drawable: {
      autoShapes: shapes,
    },
  });
}

function setStrategiesLoading(msg = 'Analyzing...') {
  document.getElementById('strategies-list').innerHTML =
    `<div class="placeholder"><span class="spinner"></span>${msg}</div>`;
}

function setThreatsLoading() {
  document.getElementById('threats-list').innerHTML =
    '<div class="placeholder"><span class="spinner"></span>Scanning for threats...</div>';
}

// ============ GAME STATE ============
function recordMove(move, strategyName) {
  moveHistory.push({
    san: move.san,
    strategy: strategyName,
    color: move.color,
  });
}

function updateMoveHistory() {
  const container = document.getElementById('move-history');
  let html = '';

  for (let i = 0; i < moveHistory.length; i += 2) {
    const moveNum = Math.floor(i / 2) + 1;
    const whiteMove = moveHistory[i];
    const blackMove = moveHistory[i + 1];

    html += `<div class="move-pair">`;
    html += `<span class="move-number">${moveNum}.</span>`;
    html += `<span class="move">${whiteMove.san}`;
    if (whiteMove.strategy && whiteMove.strategy !== 'Stockfish') {
      html += `<span class="strategy-label">[${whiteMove.strategy}]</span>`;
    }
    html += `</span>`;
    if (blackMove) {
      html += `<span class="move">${blackMove.san}</span>`;
    }
    html += `</div>`;
  }

  container.innerHTML = html;
  container.scrollTop = container.scrollHeight;
}

function updateTurnIndicator() {
  const turnEl = document.getElementById('turn-indicator');
  const moveCountEl = document.getElementById('move-count');

  if (chess.isGameOver()) return;

  turnEl.textContent = toColor() === playerColor
    ? 'Your turn - pick a strategy!'
    : 'Opponent thinking...';
  moveCountEl.textContent = `Move ${chess.moveNumber()}`;
}

function updateStatus(msg) {
  document.getElementById('turn-indicator').textContent = msg;
}

function handleGameOver() {
  let result = '';
  if (chess.isCheckmate()) {
    result = chess.turn() === 'w' ? 'Black wins by checkmate!' : 'White wins by checkmate!';
  } else if (chess.isDraw()) {
    result = 'Draw!';
    if (chess.isStalemate()) result = 'Draw by stalemate!';
    if (chess.isThreefoldRepetition()) result = 'Draw by repetition!';
    if (chess.isInsufficientMaterial()) result = 'Draw - insufficient material!';
  }

  document.getElementById('turn-indicator').textContent = result;
  document.getElementById('strategies-list').innerHTML =
    `<div class="placeholder">${result}<br>Click "New Game" to play again.</div>`;
  document.getElementById('threats-list').innerHTML = '';
}

function newGame() {
  chess = new Chess();
  moveHistory = [];
  selectedStrategy = null;
  isThinking = false;

  updateBoard();
  updateMoveHistory();
  document.getElementById('eval-display').textContent = 'Eval: 0.0';
  document.getElementById('move-count').textContent = 'Move 1';

  ground.set({
    drawable: { autoShapes: [] },
    lastMove: undefined,
  });

  if (engineReady) {
    analyzePosition();
  } else {
    updateStatus('Choose a strategy!');
  }
}

// ============ START ============
init();
