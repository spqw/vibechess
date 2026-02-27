/**
 * Stockfish WASM engine wrapper for VibeChess.
 * Handles communication with the Stockfish web worker.
 */

export class Engine {
  constructor() {
    this.worker = null;
    this.ready = false;
    this.analyzing = false;
    this._resolveReady = null;
    this._messageHandlers = [];
  }

  async init() {
    return new Promise((resolve, reject) => {
      this._resolveReady = resolve;

      // Timeout after 10 seconds
      const timeout = setTimeout(() => {
        console.error('Stockfish init timed out');
        reject(new Error('Engine init timeout'));
      }, 10000);

      try {
        // Use the single-threaded version to avoid CORS issues
        this.worker = new Worker('/stockfish-18-single.js');
      } catch (e) {
        clearTimeout(timeout);
        reject(e);
        return;
      }

      this.worker.onmessage = (e) => {
        const line = typeof e.data === 'string' ? e.data : e.data?.data;
        if (!line) return;
        if (line === 'readyok' && !this.ready) {
          clearTimeout(timeout);
        }
        this._onMessage(line);
      };

      this.worker.onerror = (e) => {
        console.error('Stockfish worker error:', e);
        clearTimeout(timeout);
        reject(new Error('Stockfish worker failed to load'));
      };

      // Initialize UCI
      this._send('uci');
    });
  }

  _send(cmd) {
    if (this.worker) {
      this.worker.postMessage(cmd);
    }
  }

  _onMessage(line) {
    // Check for UCI ready
    if (line === 'uciok') {
      this._send('isready');
      return;
    }

    if (line === 'readyok') {
      if (!this.ready) {
        this.ready = true;
        // Set some defaults
        this._send('setoption name MultiPV value 8');
        this._send('setoption name Skill Level value 10');
        if (this._resolveReady) {
          this._resolveReady();
          this._resolveReady = null;
        }
      }
    }

    // Forward to any active handlers
    for (const handler of this._messageHandlers) {
      handler(line);
    }
  }

  /**
   * Analyze a position and get the top N moves with evaluations.
   * Returns an array of { move, eval, pv, depth }
   */
  async analyze(fen, { depth = 16, multiPV = 8 } = {}) {
    if (!this.ready) throw new Error('Engine not ready');

    this.analyzing = true;

    return new Promise((resolve) => {
      const results = new Map();

      const handler = (line) => {
        // Parse "info depth X multipv Y score cp Z pv ..."
        if (line.startsWith('info depth')) {
          const depthMatch = line.match(/depth (\d+)/);
          const pvNumMatch = line.match(/multipv (\d+)/);
          const cpMatch = line.match(/score cp (-?\d+)/);
          const mateMatch = line.match(/score mate (-?\d+)/);
          const pvMatch = line.match(/ pv (.+)/);

          if (depthMatch && pvMatch) {
            const d = parseInt(depthMatch[1]);
            const pvNum = pvNumMatch ? parseInt(pvNumMatch[1]) : 1;
            const pv = pvMatch[1].split(' ');
            let evalScore;

            if (mateMatch) {
              const mateIn = parseInt(mateMatch[1]);
              evalScore = mateIn > 0 ? 10000 - mateIn : -10000 + Math.abs(mateIn);
            } else if (cpMatch) {
              evalScore = parseInt(cpMatch[1]);
            } else {
              return;
            }

            // Only keep the deepest analysis for each PV line
            const existing = results.get(pvNum);
            if (!existing || d >= existing.depth) {
              results.set(pvNum, {
                move: pv[0], // UCI format e.g. "e2e4"
                eval: evalScore / 100, // Convert centipawns to pawns
                pv: pv,
                depth: d,
                pvNum,
              });
            }
          }
        }

        if (line.startsWith('bestmove')) {
          this._messageHandlers = this._messageHandlers.filter(h => h !== handler);
          this.analyzing = false;

          const sorted = Array.from(results.values())
            .sort((a, b) => b.eval - a.eval);
          resolve(sorted);
        }
      };

      this._messageHandlers.push(handler);
      this._send(`setoption name MultiPV value ${multiPV}`);
      this._send(`position fen ${fen}`);
      this._send(`go depth ${depth}`);
    });
  }

  /**
   * Get the best move for the opponent (AI) to play.
   */
  async getBestMove(fen, { depth = 12 } = {}) {
    if (!this.ready) throw new Error('Engine not ready');

    return new Promise((resolve) => {
      const handler = (line) => {
        if (line.startsWith('bestmove')) {
          this._messageHandlers = this._messageHandlers.filter(h => h !== handler);
          const move = line.split(' ')[1];
          resolve(move);
        }
      };

      this._messageHandlers.push(handler);
      this._send('setoption name MultiPV value 1');
      this._send(`position fen ${fen}`);
      this._send(`go depth ${depth}`);
    });
  }

  /**
   * Quick evaluation of a position (shallow).
   */
  async quickEval(fen) {
    const results = await this.analyze(fen, { depth: 10, multiPV: 1 });
    return results[0]?.eval ?? 0;
  }

  stop() {
    this._send('stop');
  }

  destroy() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}
