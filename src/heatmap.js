/**
 * Emotional Heatmap for VibeChess.
 *
 * Computes per-square attack/defense balance and returns:
 * - Emotional overlays for pieces (happy/neutral/scared face SVGs)
 * - Square brightness overlays (bright/dim/gloomy rectangles)
 *
 * Uses chessground's customSvg autoShapes (100x100 viewBox per square).
 */

import { Chess } from 'chess.js';

const FILES = 'abcdefgh';
const RANKS = '12345678';

/**
 * Build attack maps for both colors efficiently.
 * Returns { white: Map<square, count>, black: Map<square, count> }
 * where count = number of distinct pieces of that color attacking the square.
 *
 * Only creates 2 Chess instances total (one per color).
 */
function buildAttackMaps(fen) {
  const maps = { w: new Map(), b: new Map() };

  for (const color of ['w', 'b']) {
    const parts = fen.split(' ');
    parts[1] = color;
    parts[3] = '-'; // clear en-passant

    try {
      const temp = new Chess(parts.join(' '));
      const moves = temp.moves({ verbose: true });

      // For each target square, count distinct source squares
      const sqAttackers = new Map();
      for (const m of moves) {
        if (!sqAttackers.has(m.to)) sqAttackers.set(m.to, new Set());
        sqAttackers.get(m.to).add(m.from);
      }

      for (const [sq, sources] of sqAttackers) {
        maps[color].set(sq, sources.size);
      }
    } catch {
      // Invalid FEN from flip — leave empty
    }
  }

  return maps;
}

/**
 * Compute the safety/emotion for every piece on the board.
 * Returns a Map of square -> { color, type, defenders, attackers, emotion }
 */
function computePieceSafety(chess, attackMaps) {
  const safetyMap = new Map();

  for (const file of FILES) {
    for (const rank of RANKS) {
      const sq = file + rank;
      const piece = chess.get(sq);
      if (!piece) continue;

      if (piece.type === 'k') {
        safetyMap.set(sq, { color: piece.color, type: piece.type, emotion: 'neutral' });
        continue;
      }

      const defenders = attackMaps[piece.color].get(sq) || 0;
      const enemyColor = piece.color === 'w' ? 'b' : 'w';
      const attackers = attackMaps[enemyColor].get(sq) || 0;
      const balance = defenders - attackers;

      let emotion;
      if (attackers === 0) {
        emotion = defenders > 0 ? 'happy' : 'neutral';
      } else if (balance >= 1) {
        emotion = 'happy';
      } else if (balance === 0) {
        emotion = 'worried';
      } else {
        emotion = 'scared';
      }

      safetyMap.set(sq, { color: piece.color, type: piece.type, emotion });
    }
  }

  return safetyMap;
}

/**
 * Compute square control balance for the board.
 * playerColor = 'w' or 'b' — used to determine "friendly" vs "enemy".
 */
function computeSquareControl(attackMaps, playerColor) {
  const controlMap = new Map();

  for (const file of FILES) {
    for (const rank of RANKS) {
      const sq = file + rank;

      const wCtrl = attackMaps.w.get(sq) || 0;
      const bCtrl = attackMaps.b.get(sq) || 0;

      const friendly = playerColor === 'w' ? wCtrl : bCtrl;
      const enemy = playerColor === 'w' ? bCtrl : wCtrl;
      const balance = friendly - enemy;

      let brightness;
      if (balance >= 2) brightness = 'bright';
      else if (balance >= 0) brightness = 'normal';
      else if (balance >= -1) brightness = 'dim';
      else brightness = 'gloomy';

      controlMap.set(sq, { balance, brightness });
    }
  }

  return controlMap;
}

// ============ SVG FACES ============
// Drawn within a 100x100 viewBox (one chessground square).
// Positioned in the bottom-right corner, small enough not to obscure the piece.

function faceSvg(fillColor, strokeColor, opacity, faceContent) {
  return `
    <circle cx="78" cy="78" r="16" fill="${fillColor}" fill-opacity="${opacity}" stroke="${strokeColor}" stroke-width="2"/>
    ${faceContent}
  `;
}

const FACE_HAPPY = faceSvg('#2ed573', '#1a9c4e', 0.9, `
  <circle cx="73" cy="75" r="2" fill="#1a1a2e"/>
  <circle cx="83" cy="75" r="2" fill="#1a1a2e"/>
  <path d="M71 82 Q78 88 85 82" stroke="#1a1a2e" stroke-width="2" fill="none" stroke-linecap="round"/>
`);

const FACE_WORRIED = faceSvg('#ffa502', '#cc8400', 0.9, `
  <circle cx="73" cy="75" r="2" fill="#1a1a2e"/>
  <circle cx="83" cy="75" r="2" fill="#1a1a2e"/>
  <line x1="72" y1="83" x2="84" y2="83" stroke="#1a1a2e" stroke-width="2" stroke-linecap="round"/>
`);

const FACE_SCARED = faceSvg('#ff4757', '#cc1a2a', 0.9, `
  <ellipse cx="73" cy="74" rx="2.5" ry="3" fill="#1a1a2e"/>
  <ellipse cx="83" cy="74" rx="2.5" ry="3" fill="#1a1a2e"/>
  <ellipse cx="78" cy="84" rx="4" ry="3" fill="#1a1a2e"/>
`);

const EMOTION_SVG = {
  happy: FACE_HAPPY,
  worried: FACE_WORRIED,
  scared: FACE_SCARED,
};

// ============ SQUARE OVERLAYS ============
// Semi-transparent rectangles covering the full square

const SQUARE_BRIGHT = `<rect x="0" y="0" width="100" height="100" fill="rgba(255,255,200,0.12)"/>`;
const SQUARE_DIM = `<rect x="0" y="0" width="100" height="100" fill="rgba(0,0,0,0.18)"/>`;
const SQUARE_GLOOMY = `<rect x="0" y="0" width="100" height="100" fill="rgba(0,0,0,0.35)"/>`;

const BRIGHTNESS_SVG = {
  bright: SQUARE_BRIGHT,
  dim: SQUARE_DIM,
  gloomy: SQUARE_GLOOMY,
};

/**
 * Generate all heatmap autoShapes for chessground.
 * Combines emotion faces on pieces + brightness overlays on squares.
 * Preserves any existing shapes (threat arrows etc.) passed in.
 */
export function generateHeatmapShapes(chess, playerColor, existingShapes = []) {
  const shapes = [...existingShapes];

  // Build attack maps once (just 2 Chess instances)
  const attackMaps = buildAttackMaps(chess.fen());

  // 1. Square brightness overlays (render first, underneath everything)
  const controlMap = computeSquareControl(attackMaps, playerColor);
  for (const [square, info] of controlMap) {
    if (info.brightness === 'normal') continue;
    const svg = BRIGHTNESS_SVG[info.brightness];
    if (!svg) continue;
    shapes.push({ orig: square, customSvg: { html: svg } });
  }

  // 2. Piece emotion faces (render on top)
  const safetyMap = computePieceSafety(chess, attackMaps);
  for (const [square, info] of safetyMap) {
    if (info.emotion === 'neutral') continue;
    const svg = EMOTION_SVG[info.emotion];
    if (!svg) continue;
    shapes.push({ orig: square, customSvg: { html: svg } });
  }

  return shapes;
}
