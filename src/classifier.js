/**
 * Move Classifier for VibeChess.
 *
 * Takes raw engine output (top N moves with evals) and:
 * 1. Filters out inhuman moves
 * 2. Clusters remaining moves by strategic theme
 * 3. Returns strategy options for the player
 */

import { Chess } from 'chess.js';
import { getAvailableStrategies, rankMovesForStrategy } from './strategies.js';

/**
 * Convert UCI move (e.g., "e2e4") to a verbose move object using chess.js
 */
function uciToMove(chess, uciMove) {
  const from = uciMove.slice(0, 2);
  const to = uciMove.slice(2, 4);
  const promotion = uciMove.length > 4 ? uciMove[4] : undefined;

  const legalMoves = chess.moves({ verbose: true });
  return legalMoves.find(m =>
    m.from === from && m.to === to &&
    (!promotion || m.promotion === promotion)
  );
}

/**
 * Score how "human-like" a move is.
 * Returns 0-1 where 1 = very human, 0 = engine-only.
 */
function humanLikelihood(move, engineRank, evalDiff) {
  let score = 0.5;

  // Captures are human-like (we see them naturally)
  if (move.captured) score += 0.15;

  // Castling is very human
  if (move.san === 'O-O' || move.san === 'O-O-O') score += 0.3;

  // Development moves in the opening are natural
  if (move.piece === 'n' || move.piece === 'b') score += 0.1;

  // Central pawn moves are natural
  if (move.piece === 'p' && ['d', 'e'].includes(move.to[0])) score += 0.1;

  // Checks are natural to consider
  if (move.san.includes('+')) score += 0.15;

  // If the eval difference from the best move is small, it's more playable
  if (Math.abs(evalDiff) < 0.3) score += 0.2;
  else if (Math.abs(evalDiff) < 0.7) score += 0.1;
  else if (Math.abs(evalDiff) > 2.0) score -= 0.3;

  // Top engine moves are usually still human-findable
  if (engineRank <= 3) score += 0.1;

  // Quiet rook moves to random squares = often engine-only
  if (move.piece === 'r' && !move.captured && !move.san.includes('+')) {
    score -= 0.1;
  }

  return Math.max(0, Math.min(1, score));
}

/**
 * Main classification function.
 *
 * Takes engine analysis results and the current position,
 * returns classified strategies with their best moves.
 */
export function classifyMoves(engineMoves, chess) {
  const bestEval = engineMoves[0]?.eval ?? 0;

  // Step 1: Convert UCI moves and compute human-likeness
  const enrichedMoves = engineMoves
    .map((em, idx) => {
      const move = uciToMove(chess, em.move);
      if (!move) return null;
      const evalDiff = bestEval - em.eval;
      return {
        ...move,
        uci: em.move,
        engineScore: em.eval,
        engineRank: idx + 1,
        evalDiff,
        humanScore: humanLikelihood(move, idx + 1, evalDiff),
        pv: em.pv,
      };
    })
    .filter(Boolean);

  // Step 2: Get available strategies for this position
  const strategies = getAvailableStrategies(chess);

  // Step 3: For each strategy, rank the moves and pick the best
  const strategyOptions = strategies
    .map(strategy => {
      const ranked = rankMovesForStrategy(strategy, enrichedMoves, chess);

      // Filter to human-like moves (or at least semi-human)
      const humanMoves = ranked.filter(m => m.humanScore > 0.25);
      const bestMoves = humanMoves.length > 0 ? humanMoves : ranked;

      if (bestMoves.length === 0) return null;

      const topMove = bestMoves[0];

      const avgEval = bestMoves.slice(0, 3).reduce((s, m) => s + m.engineScore, 0) / Math.min(3, bestMoves.length);

      // How close is this strategy's best move to the overall best move?
      // 0 = same as best, higher = worse
      const evalGap = Math.abs(bestEval - topMove.engineScore);

      // Combined score: position relevance * strategy fit * eval quality * human playability
      // evalQuality: 1.0 if best move, decreasing as gap grows
      const evalQuality = Math.max(0.1, 1.0 - evalGap * 0.3);
      const combinedScore = strategy.relevance
        * (topMove.strategyScore || 1)
        * evalQuality
        * (topMove.humanScore || 0.5);

      return {
        strategy,
        topMove,
        allMoves: bestMoves.slice(0, 3),
        avgEval,
        relevance: strategy.relevance,
        evalQuality,
        combinedScore,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.combinedScore - a.combinedScore)
    .slice(0, 6); // Show top 6 strategies

  return strategyOptions;
}

/**
 * Detect threats and opportunities in the current position.
 * Returns an array of { type, title, detail, squares }
 */
export function detectThreats(chess) {
  const threats = [];
  const isWhite = chess.turn() === 'w';
  const color = isWhite ? 'w' : 'b';
  const oppColor = isWhite ? 'b' : 'w';

  // Get all legal moves
  const moves = chess.moves({ verbose: true });

  // 1. Checkmate available? (check first - highest priority)
  const checkmates = moves.filter(m => m.san.includes('#'));
  if (checkmates.length > 0) {
    threats.push({
      type: 'opportunity',
      title: 'CHECKMATE AVAILABLE!',
      detail: checkmates[0].san,
      squares: [checkmates[0].from, checkmates[0].to],
      severity: 'critical',
      move: checkmates[0],
    });
  }

  // 2. Checks available
  const checks = moves.filter(m => m.san.includes('+') && !m.san.includes('#'));
  if (checks.length > 0) {
    threats.push({
      type: 'opportunity',
      title: `Check available!`,
      detail: checks.map(m => m.san).join(', '),
      squares: [checks[0].from, checks[0].to],
      severity: 'high',
      move: checks[0],
    });
  }

  // 2. Captures available (free or winning)
  const captures = moves.filter(m => m.captured);
  if (captures.length > 0) {
    const pieceValues = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
    const goodCaptures = captures.filter(m => {
      const gain = pieceValues[m.captured] || 0;
      const risk = pieceValues[m.piece] || 0;
      return gain >= risk; // At least an even trade
    });

    if (goodCaptures.length > 0) {
      const best = goodCaptures.sort((a, b) =>
        (pieceValues[b.captured] - pieceValues[b.piece]) -
        (pieceValues[a.captured] - pieceValues[a.piece])
      )[0];

      const gain = pieceValues[best.captured];
      const risk = pieceValues[best.piece];

      if (gain > risk) {
        threats.push({
          type: 'opportunity',
          title: `Win material: ${best.san}`,
          detail: `Capture ${pieceName(best.captured)} with ${pieceName(best.piece)}`,
          squares: [best.from, best.to],
          severity: 'high',
          move: best,
        });
      } else if (gain === risk && gain >= 3) {
        threats.push({
          type: 'info',
          title: `Trade available: ${best.san}`,
          detail: `Even exchange of ${pieceName(best.piece)}s`,
          squares: [best.from, best.to],
          severity: 'low',
          move: best,
        });
      }
    }
  }

  // 3. Check for hanging pieces (opponent's pieces we can take for free)
  // This is simplified - a real version would use SEE (Static Exchange Eval)
  const freeCaptures = captures.filter(m => {
    const pieceValues = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
    return pieceValues[m.captured] > pieceValues[m.piece] + 1;
  });

  if (freeCaptures.length > 0) {
    threats.push({
      type: 'opportunity',
      title: 'Hanging piece!',
      detail: `${pieceName(freeCaptures[0].captured)} on ${freeCaptures[0].to} is undefended`,
      squares: [freeCaptures[0].from, freeCaptures[0].to],
      severity: 'critical',
      move: freeCaptures[0],
    });
  }

  // 4. Are we in check?
  if (chess.isCheck()) {
    // Find best escape (prefer captures, then blocks, then king moves)
    const escapes = [...moves].sort((a, b) => {
      if (a.captured && !b.captured) return -1;
      if (!a.captured && b.captured) return 1;
      if (a.piece !== 'k' && b.piece === 'k') return -1;
      if (a.piece === 'k' && b.piece !== 'k') return 1;
      return 0;
    });
    threats.push({
      type: 'danger',
      title: 'You are in check!',
      detail: `${moves.length} way(s) to escape — best: ${escapes[0]?.san}`,
      squares: escapes[0] ? [escapes[0].from, escapes[0].to] : [],
      severity: 'high',
      move: escapes[0] || null,
    });
  }

  // 6. Can opponent check us next move? (simulate)
  // Save state, try opponent's perspective
  const oppChess = new Chess(chess.fen());
  // Flip the turn by modifying FEN (hacky but works for threat detection)
  const fenParts = oppChess.fen().split(' ');
  fenParts[1] = fenParts[1] === 'w' ? 'b' : 'w';
  try {
    const oppPos = new Chess(fenParts.join(' '));
    const oppMoves = oppPos.moves({ verbose: true });
    const oppChecks = oppMoves.filter(m => m.san.includes('+'));
    if (oppChecks.length > 0) {
      threats.push({
        type: 'warning',
        title: 'Opponent can check you',
        detail: `Watch out for ${oppChecks.map(m => m.san).join(', ')}`,
        squares: oppChecks.map(m => m.from),
        severity: 'medium',
      });
    }

    // Opponent can capture something valuable?
    const pieceValues = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
    const oppCaptures = oppMoves.filter(m => m.captured && pieceValues[m.captured] >= 3);
    if (oppCaptures.length > 0) {
      // Group by threatened piece square and find all attackers
      const threatenedSquares = new Map();
      for (const cap of oppCaptures) {
        if (!threatenedSquares.has(cap.to)) {
          threatenedSquares.set(cap.to, {
            piece: cap.captured,
            value: pieceValues[cap.captured],
            attackers: [],
          });
        }
        threatenedSquares.get(cap.to).attackers.push(cap);
      }

      // Create a threat for each attacked piece
      const sortedThreats = [...threatenedSquares.entries()]
        .sort(([, a], [, b]) => b.value - a.value);

      for (const [square, info] of sortedThreats) {
        const attackerNames = info.attackers
          .map(a => `${pieceName(a.piece)} on ${a.from}`)
          .join(', ');
        threats.push({
          type: 'warning',
          title: `Your ${pieceName(info.piece)} on ${square} is attacked`,
          detail: `Threatened by ${attackerNames}`,
          // squares: attacked piece first, then all attacker sources
          squares: [square, ...info.attackers.map(a => a.from)],
          severity: info.value >= 5 ? 'high' : 'medium',
        });
      }
    }
  } catch (e) {
    // Invalid position from FEN flip - ignore
  }

  // Sort by severity
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  threats.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return threats;
}

function pieceName(p) {
  const names = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
  return names[p] || p;
}
