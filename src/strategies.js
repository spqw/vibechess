/**
 * Curated strategy database for VibeChess.
 * Each strategy has detection heuristics that determine when it's available.
 *
 * Sources credited from popular chess YouTube channels:
 * GothamChess, Eric Rosen, Daniel Naroditsky, Agadmator, Ben Finegold, Hanging Pawns
 */

export const STRATEGIES = [
  // ============ ATTACKING STRATEGIES ============
  {
    id: 'kingside_attack',
    name: 'Kingside Storm',
    type: 'attack',
    description: 'Push pawns and pieces toward the enemy king. Aggressive and committal.',
    source: 'GothamChess',
    detect: (pos) => {
      // Available when opponent has castled kingside and we have pieces aimed that way
      const isWhite = pos.turn() === 'w';
      const fen = pos.fen();
      // Check if opponent castled kingside (king on g8/g1)
      const oppKingside = isWhite
        ? fen.includes('k') && (pos.get('g8')?.type === 'k' || pos.get('h8')?.type === 'k')
        : fen.includes('K') && (pos.get('g1')?.type === 'k' || pos.get('h1')?.type === 'k');
      return oppKingside ? 0.8 : 0.3;
    },
    moveFilter: (move, pos) => {
      const isWhite = pos.turn() === 'w';
      const targetFiles = ['f', 'g', 'h'];
      const toFile = move.to[0];
      const toRank = parseInt(move.to[1]);
      // Prefer moves toward the kingside, especially toward opponent's back ranks
      if (targetFiles.includes(toFile)) {
        if (isWhite && toRank >= 5) return 2.0;
        if (!isWhite && toRank <= 4) return 2.0;
        return 1.5;
      }
      return 0.5;
    },
  },

  {
    id: 'greek_gift',
    name: 'The Greek Gift',
    type: 'tactical',
    description: 'Sacrifice the bishop on h7 to crack open the king. A classic attacking motif.',
    source: 'GothamChess - Legendary Sacrifices',
    detect: (pos) => {
      const isWhite = pos.turn() === 'w';
      if (isWhite) {
        // Need a bishop that can take on h7, and opponent king near g8
        const h7 = pos.get('h7');
        if (h7 && h7.color === 'b' && h7.type === 'p') {
          const moves = pos.moves({ verbose: true });
          const bxh7 = moves.find(m => m.to === 'h7' && m.piece === 'b');
          if (bxh7) return 0.95;
        }
      } else {
        const h2 = pos.get('h2');
        if (h2 && h2.color === 'w' && h2.type === 'p') {
          const moves = pos.moves({ verbose: true });
          const bxh2 = moves.find(m => m.to === 'h2' && m.piece === 'b');
          if (bxh2) return 0.95;
        }
      }
      return 0;
    },
    moveFilter: (move, pos) => {
      const target = pos.turn() === 'w' ? 'h7' : 'h2';
      if (move.to === target && move.piece === 'b') return 3.0;
      return 0.3;
    },
  },

  {
    id: 'center_control',
    name: 'Dominate the Center',
    type: 'positional',
    description: 'Control e4/d4/e5/d5 with pawns and pieces. The foundation of classical chess.',
    source: 'Daniel Naroditsky - Speedrun Series',
    detect: (pos) => {
      // Always somewhat relevant, especially in the opening
      const moveNum = getMoveNumber(pos);
      if (moveNum <= 10) return 0.85;
      if (moveNum <= 20) return 0.5;
      return 0.3;
    },
    moveFilter: (move) => {
      const centralSquares = ['e4', 'd4', 'e5', 'd5', 'c4', 'c5', 'f4', 'f5'];
      const extendedCenter = ['e3', 'd3', 'e6', 'd6', 'c3', 'c6', 'f3', 'f6'];
      if (centralSquares.includes(move.to)) return 2.0;
      if (extendedCenter.includes(move.to)) return 1.3;
      return 0.5;
    },
  },

  {
    id: 'queenside_expansion',
    name: 'Queenside Expansion',
    type: 'positional',
    description: 'Gain space on the queenside with a4-a5, b4-b5. Create a passed pawn or cramp the opponent.',
    source: 'Hanging Pawns - Pawn Structure Guide',
    detect: (pos) => {
      const moveNum = getMoveNumber(pos);
      if (moveNum < 8) return 0.2;
      return 0.6;
    },
    moveFilter: (move, pos) => {
      const isWhite = pos.turn() === 'w';
      const qsFiles = ['a', 'b', 'c'];
      if (qsFiles.includes(move.to[0])) {
        if (move.piece === 'p') return 2.0;
        return 1.3;
      }
      return 0.4;
    },
  },

  {
    id: 'piece_activity',
    name: 'Activate Your Pieces',
    type: 'positional',
    description: 'Move your worst-placed piece to a better square. Every piece should have a job.',
    source: 'Daniel Naroditsky - "Improve your worst piece"',
    detect: (pos) => {
      // Always relevant
      return 0.65;
    },
    moveFilter: (move, pos) => {
      // Prefer knight and bishop moves to central/active squares
      if (move.piece === 'n' || move.piece === 'b') {
        const centralFiles = ['c', 'd', 'e', 'f'];
        if (centralFiles.includes(move.to[0])) return 1.8;
        return 1.2;
      }
      if (move.piece === 'r') {
        // Rooks to open files
        return 1.3;
      }
      return 0.7;
    },
  },

  {
    id: 'trade_down',
    name: 'Simplify & Trade Down',
    type: 'defensive',
    description: 'Exchange pieces to reduce complexity. Best when ahead in material or under pressure.',
    source: 'Ben Finegold - "When you\'re ahead, trade pieces"',
    detect: (pos) => {
      return 0.4;
    },
    moveFilter: (move) => {
      if (move.captured) return 2.0;
      return 0.5;
    },
  },

  {
    id: 'prophylaxis',
    name: 'Prophylaxis',
    type: 'defensive',
    description: 'Stop the opponent\'s plan before it starts. "What does my opponent want?" - then prevent it.',
    source: 'Ben Finegold - "Always ask what your opponent wants"',
    detect: (pos) => {
      const moveNum = getMoveNumber(pos);
      if (moveNum > 10) return 0.55;
      return 0.3;
    },
    moveFilter: (move) => {
      // Prefer quiet defensive moves: h3, a3, Kh1, etc.
      const prophylacticMoves = ['h3', 'a3', 'h6', 'a6', 'g3', 'b3', 'g6', 'b6'];
      if (prophylacticMoves.includes(move.san)) return 2.0;
      if (move.piece === 'k' && !move.captured) return 1.5;
      return 0.6;
    },
  },

  {
    id: 'fianchetto',
    name: 'The Fianchetto',
    type: 'positional',
    description: 'Place your bishop on g2 or b2 (or g7/b7) for long-range diagonal control.',
    source: 'Hanging Pawns - Opening Principles',
    detect: (pos) => {
      const isWhite = pos.turn() === 'w';
      const moveNum = getMoveNumber(pos);
      if (moveNum > 12) return 0.1;
      if (isWhite) {
        const g2 = pos.get('g2');
        const b2 = pos.get('b2');
        if ((!g2 || g2.type !== 'b') || (!b2 || b2.type !== 'b')) return 0.6;
      } else {
        const g7 = pos.get('g7');
        const b7 = pos.get('b7');
        if ((!g7 || g7.type !== 'b') || (!b7 || b7.type !== 'b')) return 0.6;
      }
      return 0.15;
    },
    moveFilter: (move, pos) => {
      const isWhite = pos.turn() === 'w';
      const fianchettoSquares = isWhite ? ['g2', 'b2'] : ['g7', 'b7'];
      const prepMoves = isWhite ? ['g3', 'b3'] : ['g6', 'b6'];
      if (fianchettoSquares.includes(move.to) && move.piece === 'b') return 3.0;
      if (prepMoves.includes(move.san)) return 2.5;
      return 0.4;
    },
  },

  {
    id: 'castle_early',
    name: 'Get Your King to Safety',
    type: 'defensive',
    description: 'Castle as soon as possible. King safety first!',
    source: 'GothamChess - Opening Principles',
    detect: (pos) => {
      const isWhite = pos.turn() === 'w';
      const fen = pos.fen();
      // Check if we can still castle
      const castleRights = fen.split(' ')[2];
      if (isWhite && (castleRights.includes('K') || castleRights.includes('Q'))) {
        const moves = pos.moves({ verbose: true });
        if (moves.some(m => m.san === 'O-O' || m.san === 'O-O-O')) return 0.9;
        return 0.5; // Can castle but not yet possible - develop first
      }
      if (!isWhite && (castleRights.includes('k') || castleRights.includes('q'))) {
        const moves = pos.moves({ verbose: true });
        if (moves.some(m => m.san === 'O-O' || m.san === 'O-O-O')) return 0.9;
        return 0.5;
      }
      return 0; // Already castled or lost rights
    },
    moveFilter: (move) => {
      if (move.san === 'O-O' || move.san === 'O-O-O') return 5.0;
      // Also boost development moves that enable castling
      if (move.piece === 'n' || move.piece === 'b') return 1.2;
      return 0.3;
    },
  },

  {
    id: 'pawn_break',
    name: 'The Pawn Break',
    type: 'tactical',
    description: 'Break open the position with a pawn push. Changes the pawn structure and creates opportunities.',
    source: 'Hanging Pawns - Pawn Breaks Explained',
    detect: (pos) => {
      const moveNum = getMoveNumber(pos);
      if (moveNum < 6) return 0.2;
      // Check for pawn tension
      const moves = pos.moves({ verbose: true });
      const pawnCaptures = moves.filter(m => m.piece === 'p' && m.captured);
      if (pawnCaptures.length > 0) return 0.7;
      return 0.4;
    },
    moveFilter: (move) => {
      if (move.piece === 'p') {
        if (move.captured) return 2.5;
        // Central pawn pushes
        if (['d', 'e', 'c', 'f'].includes(move.to[0])) return 1.8;
        return 1.2;
      }
      return 0.3;
    },
  },

  {
    id: 'fork_trick',
    name: 'The Fork Trick',
    type: 'tactical',
    description: 'Use a knight or pawn to attack two pieces at once. A bread-and-butter tactic.',
    source: 'Eric Rosen - Tactical Patterns',
    detect: (pos) => {
      // Check if any knight move attacks multiple pieces
      const moves = pos.moves({ verbose: true });
      const knightMoves = moves.filter(m => m.piece === 'n');
      for (const km of knightMoves) {
        // After this move, does the knight attack multiple valuable pieces?
        // Simplified check - just see if knight lands near king + another piece
        return 0.5;
      }
      return 0.35;
    },
    moveFilter: (move) => {
      if (move.piece === 'n') return 1.5;
      if (move.piece === 'p' && move.captured) return 1.3;
      return 0.5;
    },
  },

  {
    id: 'pin_skewer',
    name: 'Pin & Skewer',
    type: 'tactical',
    description: 'Use bishops, rooks, or the queen to pin or skewer enemy pieces along lines.',
    source: 'GothamChess - Tactics You Must Know',
    detect: () => 0.45,
    moveFilter: (move) => {
      if (move.piece === 'b' || move.piece === 'r' || move.piece === 'q') return 1.4;
      return 0.5;
    },
  },

  {
    id: 'develop_with_tempo',
    name: 'Develop with Tempo',
    type: 'attack',
    description: 'Develop pieces while attacking enemy pieces or pawns, gaining time.',
    source: 'Daniel Naroditsky - Opening Fundamentals',
    detect: (pos) => {
      const moveNum = getMoveNumber(pos);
      if (moveNum <= 12) return 0.7;
      return 0.25;
    },
    moveFilter: (move) => {
      // Developing moves that also threaten
      if ((move.piece === 'n' || move.piece === 'b') && move.captured) return 2.5;
      if (move.piece === 'n' || move.piece === 'b') return 1.3;
      return 0.5;
    },
  },

  {
    id: 'the_squeeze',
    name: 'The Squeeze',
    type: 'positional',
    description: 'Restrict your opponent\'s pieces. Take away their good squares, then strike when they\'re passive.',
    source: 'Agadmator - Karpov\'s Positional Masterpieces',
    detect: (pos) => {
      const moveNum = getMoveNumber(pos);
      if (moveNum > 15) return 0.6;
      return 0.3;
    },
    moveFilter: (move) => {
      // Quiet, space-gaining moves
      if (move.piece === 'p' && !move.captured) return 1.5;
      if ((move.piece === 'n' || move.piece === 'b') && !move.captured) return 1.3;
      return 0.7;
    },
  },

  {
    id: 'oh_no_my_queen',
    name: '"Oh No My Queen!"',
    type: 'tactical',
    description: 'A queen sacrifice or trap that looks like a blunder but wins material or delivers checkmate.',
    source: 'Eric Rosen - signature move',
    detect: (pos) => {
      // Only show if there's a queen move that captures and looks wild
      const moves = pos.moves({ verbose: true });
      const queenSacs = moves.filter(m => m.piece === 'q');
      if (queenSacs.length > 0) return 0.3;
      return 0;
    },
    moveFilter: (move) => {
      if (move.piece === 'q') return 2.0;
      return 0.3;
    },
  },

  {
    id: 'endgame_technique',
    name: 'Convert the Endgame',
    type: 'positional',
    description: 'Push passed pawns, activate the king, and trade down to win a technically winning position.',
    source: 'Daniel Naroditsky - Endgame Fundamentals',
    detect: (pos) => {
      // Count pieces - if few pieces left, this is relevant
      const fen = pos.fen().split(' ')[0];
      const pieces = fen.replace(/[0-9/]/g, '');
      if (pieces.length <= 12) return 0.8;
      if (pieces.length <= 18) return 0.4;
      return 0.1;
    },
    moveFilter: (move, pos) => {
      const isWhite = pos.turn() === 'w';
      // King activity matters in endgames
      if (move.piece === 'k') return 1.8;
      // Pawn pushes toward promotion
      if (move.piece === 'p') {
        const rank = parseInt(move.to[1]);
        if (isWhite && rank >= 6) return 2.5;
        if (!isWhite && rank <= 3) return 2.5;
        return 1.5;
      }
      return 0.7;
    },
  },
];

function getMoveNumber(pos) {
  return pos.moveNumber();
}

/**
 * Given a chess.js position, return strategies sorted by relevance.
 */
export function getAvailableStrategies(pos) {
  return STRATEGIES
    .map(s => ({
      ...s,
      relevance: s.detect(pos),
    }))
    .filter(s => s.relevance > 0.1)
    .sort((a, b) => b.relevance - a.relevance);
}

/**
 * Given a strategy and list of engine moves, rank moves by strategy fit.
 */
export function rankMovesForStrategy(strategy, moves, pos) {
  return moves
    .map(m => ({
      ...m,
      strategyScore: strategy.moveFilter(m, pos),
      combinedScore: m.engineScore * strategy.moveFilter(m, pos),
    }))
    .sort((a, b) => b.combinedScore - a.combinedScore);
}
