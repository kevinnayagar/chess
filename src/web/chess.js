/*
 * Chess puzzle board - single-file, no dependencies.
 *
 * Usage:
 *   <div id="board"></div>
 *   <script src="chess.js"></script>
 *   <script>
 *     var game = ChessPuzzle.create('#board', {
 *       puzzle: 'puzzles/mate-in-2.json',   // URL of a puzzle JSON file, or a puzzle object
 *       imagePath: 'images/',               // folder holding the piece images (default: images/ next to this script)
 *       imageExtension: 'svg',              // images are named <color>-<piece>.<ext>, e.g. white-king.svg
 *       showStatus: true,                   // show the title / feedback line under the board
 *       opponentDelay: 500,                 // ms before the opponent's reply is played
 *       onCorrect: function (move) {},
 *       onIncorrect: function (move) {},
 *       onSolved: function () {}
 *     });
 *     game.load('puzzles/other.json');      // load another puzzle
 *     game.reset();                         // restart the current puzzle
 *   </script>
 *
 * Puzzle JSON:
 *   {
 *     "title": "Back rank mate",
 *     "description": "White to move. Mate in 1.",
 *     "turn": "white",                      // side to move = the side the user plays
 *     "pieces": [ { "type": "king", "color": "white", "square": "g1" }, ... ],
 *     "castling": "KQkq",                   // optional, castling rights still available (default none)
 *     "enPassant": "e6",                    // optional, en passant target square
 *     "solution": [                         // alternating: user move, opponent reply, user move, ...
 *       { "from": "a1", "to": "a8" },       // add "promotion": "queen" for promotions
 *       ...
 *     ]
 *   }
 * If "solution" is omitted the board is in free-play mode: any legal move is accepted for both sides.
 */
(function (root) {
  'use strict';

  // ------------------------------------------------------------------
  // Rules engine
  // ------------------------------------------------------------------

  var TYPES = { pawn: 'p', knight: 'n', bishop: 'b', rook: 'r', queen: 'q', king: 'k' };
  var TYPE_NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
  var COLORS = { white: 'w', black: 'b', w: 'w', b: 'b' };
  var COLOR_NAMES = { w: 'white', b: 'black' };

  var KNIGHT_STEPS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
  var KING_STEPS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  var ROOK_DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  var BISHOP_DIRS = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
  var PROMOTIONS = ['q', 'r', 'b', 'n'];

  // Squares are indexed 0..63: a1 = 0, b1 = 1, ... h8 = 63.
  function parseSquare(name) {
    var m = /^([a-h])([1-8])$/.exec(String(name).toLowerCase());
    if (!m) throw new Error('Invalid square: ' + name);
    return (m[2].charCodeAt(0) - 49) * 8 + (m[1].charCodeAt(0) - 97);
  }

  function squareName(i) {
    return String.fromCharCode(97 + (i & 7)) + ((i >> 3) + 1);
  }

  function parseType(t) {
    var s = String(t).toLowerCase();
    var code = TYPES[s] || (TYPE_NAMES[s] ? s : null);
    if (!code) throw new Error('Invalid piece type: ' + t);
    return code;
  }

  function parseColor(c) {
    var code = COLORS[String(c).toLowerCase()];
    if (!code) throw new Error('Invalid color: ' + c);
    return code;
  }

  function onBoard(f, r) {
    return f >= 0 && f <= 7 && r >= 0 && r <= 7;
  }

  function isAttacked(board, target, by) {
    var tf = target & 7, tr = target >> 3, i, f, r, p;

    var pr = tr + (by === 'w' ? -1 : 1);
    for (i = -1; i <= 1; i += 2) {
      if (onBoard(tf + i, pr)) {
        p = board[pr * 8 + tf + i];
        if (p && p.color === by && p.type === 'p') return true;
      }
    }
    for (i = 0; i < 8; i++) {
      f = tf + KNIGHT_STEPS[i][0]; r = tr + KNIGHT_STEPS[i][1];
      if (onBoard(f, r)) {
        p = board[r * 8 + f];
        if (p && p.color === by && p.type === 'n') return true;
      }
      f = tf + KING_STEPS[i][0]; r = tr + KING_STEPS[i][1];
      if (onBoard(f, r)) {
        p = board[r * 8 + f];
        if (p && p.color === by && p.type === 'k') return true;
      }
    }
    function slides(dirs, type) {
      for (var d = 0; d < 4; d++) {
        var sf = tf + dirs[d][0], sr = tr + dirs[d][1];
        while (onBoard(sf, sr)) {
          var q = board[sr * 8 + sf];
          if (q) {
            if (q.color === by && (q.type === type || q.type === 'q')) return true;
            break;
          }
          sf += dirs[d][0]; sr += dirs[d][1];
        }
      }
      return false;
    }
    return slides(ROOK_DIRS, 'r') || slides(BISHOP_DIRS, 'b');
  }

  function findKing(board, color) {
    for (var i = 0; i < 64; i++) {
      if (board[i] && board[i].type === 'k' && board[i].color === color) return i;
    }
    return -1;
  }

  function inCheck(state, color) {
    var k = findKing(state.board, color);
    return k >= 0 && isAttacked(state.board, k, color === 'w' ? 'b' : 'w');
  }

  function pseudoMoves(state) {
    var board = state.board, us = state.turn, them = us === 'w' ? 'b' : 'w';
    var moves = [];

    function add(from, to, extra) {
      var m = { from: from, to: to };
      if (extra) for (var k in extra) m[k] = extra[k];
      moves.push(m);
    }

    for (var from = 0; from < 64; from++) {
      var piece = board[from];
      if (!piece || piece.color !== us) continue;
      var f = from & 7, r = from >> 3, i, tf, tr, t;

      if (piece.type === 'p') {
        var dir = us === 'w' ? 1 : -1;
        var startRank = us === 'w' ? 1 : 6;
        var promoRank = us === 'w' ? 7 : 0;
        var addPawn = function (to, extra) {
          if ((to >> 3) === promoRank) {
            for (var p = 0; p < 4; p++) add(from, to, { promotion: PROMOTIONS[p] });
          } else {
            add(from, to, extra);
          }
        };
        tr = r + dir;
        if (onBoard(f, tr)) {
          if (!board[tr * 8 + f]) {
            addPawn(tr * 8 + f);
            if (r === startRank && !board[(tr + dir) * 8 + f]) add(from, (tr + dir) * 8 + f);
          }
          for (i = -1; i <= 1; i += 2) {
            tf = f + i;
            if (!onBoard(tf, tr)) continue;
            t = tr * 8 + tf;
            if (board[t] && board[t].color === them) addPawn(t);
            else if (t === state.ep && !board[t]) add(from, t, { enPassant: true });
          }
        }
      } else if (piece.type === 'n' || piece.type === 'k') {
        var steps = piece.type === 'n' ? KNIGHT_STEPS : KING_STEPS;
        for (i = 0; i < 8; i++) {
          tf = f + steps[i][0]; tr = r + steps[i][1];
          if (!onBoard(tf, tr)) continue;
          t = tr * 8 + tf;
          if (!board[t] || board[t].color === them) add(from, t);
        }
      } else {
        var dirs = piece.type === 'r' ? ROOK_DIRS
          : piece.type === 'b' ? BISHOP_DIRS
          : ROOK_DIRS.concat(BISHOP_DIRS);
        for (i = 0; i < dirs.length; i++) {
          tf = f + dirs[i][0]; tr = r + dirs[i][1];
          while (onBoard(tf, tr)) {
            t = tr * 8 + tf;
            if (!board[t]) add(from, t);
            else {
              if (board[t].color === them) add(from, t);
              break;
            }
            tf += dirs[i][0]; tr += dirs[i][1];
          }
        }
      }
    }

    // Castling: king and rook on their home squares, squares between empty,
    // king not in check and not passing through or landing on an attacked square.
    var home = us === 'w' ? 0 : 56;
    var king = board[home + 4];
    if (king && king.type === 'k' && king.color === us) {
      var isRook = function (s) {
        return board[s] && board[s].type === 'r' && board[s].color === us;
      };
      var safe = function (s) { return !isAttacked(board, s, them); };
      if (state.castling[us === 'w' ? 'K' : 'k'] && isRook(home + 7) &&
          !board[home + 5] && !board[home + 6] &&
          safe(home + 4) && safe(home + 5) && safe(home + 6)) {
        add(home + 4, home + 6, { castle: 'k' });
      }
      if (state.castling[us === 'w' ? 'Q' : 'q'] && isRook(home) &&
          !board[home + 1] && !board[home + 2] && !board[home + 3] &&
          safe(home + 4) && safe(home + 3) && safe(home + 2)) {
        add(home + 4, home + 2, { castle: 'q' });
      }
    }
    return moves;
  }

  // Returns a new state; the given state is not modified.
  function makeMove(state, move) {
    var board = state.board.slice();
    var piece = board[move.from];
    var us = piece.color;
    board[move.from] = null;

    if (move.enPassant) board[(move.from >> 3) * 8 + (move.to & 7)] = null;
    if (move.castle) {
      var home = us === 'w' ? 0 : 56;
      if (move.castle === 'k') { board[home + 5] = board[home + 7]; board[home + 7] = null; }
      else { board[home + 3] = board[home]; board[home] = null; }
    }
    board[move.to] = move.promotion
      ? { type: move.promotion, color: us, id: piece.id }
      : piece;

    var c = state.castling;
    var castling = { K: c.K, Q: c.Q, k: c.k, q: c.q };
    if (piece.type === 'k') {
      if (us === 'w') castling.K = castling.Q = false;
      else castling.k = castling.q = false;
    }
    if (move.from === 0 || move.to === 0) castling.Q = false;
    if (move.from === 7 || move.to === 7) castling.K = false;
    if (move.from === 56 || move.to === 56) castling.q = false;
    if (move.from === 63 || move.to === 63) castling.k = false;

    var ep = null;
    if (piece.type === 'p' && Math.abs(move.to - move.from) === 16) ep = (move.from + move.to) / 2;

    return { board: board, turn: us === 'w' ? 'b' : 'w', castling: castling, ep: ep };
  }

  function legalMoves(state) {
    var us = state.turn;
    return pseudoMoves(state).filter(function (m) {
      return !inCheck(makeMove(state, m), us);
    });
  }

  function isCheckmate(state) {
    return inCheck(state, state.turn) && legalMoves(state).length === 0;
  }

  function isStalemate(state) {
    return !inCheck(state, state.turn) && legalMoves(state).length === 0;
  }

  function stateFromPuzzle(puzzle) {
    if (!puzzle || !Array.isArray(puzzle.pieces)) throw new Error('Puzzle has no "pieces" array');
    var board = [];
    for (var i = 0; i < 64; i++) board.push(null);
    puzzle.pieces.forEach(function (p, id) {
      var s = parseSquare(p.square);
      if (board[s]) throw new Error('Two pieces on ' + p.square);
      board[s] = { type: parseType(p.type), color: parseColor(p.color), id: id };
    });
    var rights = String(puzzle.castling || '');
    return {
      board: board,
      turn: parseColor(puzzle.turn || 'white'),
      castling: {
        K: rights.indexOf('K') >= 0, Q: rights.indexOf('Q') >= 0,
        k: rights.indexOf('k') >= 0, q: rights.indexOf('q') >= 0
      },
      ep: puzzle.enPassant ? parseSquare(puzzle.enPassant) : null
    };
  }

  // Accepts { from, to, promotion } or a string like "e2e4" / "e7e8q".
  function parseSolutionMove(m) {
    if (typeof m === 'string') {
      m = { from: m.slice(0, 2), to: m.slice(2, 4), promotion: m.slice(4) || undefined };
    }
    return {
      from: parseSquare(m.from),
      to: parseSquare(m.to),
      promotion: m.promotion ? parseType(m.promotion) : undefined
    };
  }

  function sameMove(a, b) {
    return a.from === b.from && a.to === b.to && (a.promotion || null) === (b.promotion || null);
  }

  var engine = {
    parseSquare: parseSquare,
    squareName: squareName,
    stateFromPuzzle: stateFromPuzzle,
    parseSolutionMove: parseSolutionMove,
    legalMoves: legalMoves,
    makeMove: makeMove,
    inCheck: inCheck,
    isCheckmate: isCheckmate,
    isStalemate: isStalemate
  };

  // ------------------------------------------------------------------
  // Board UI
  // ------------------------------------------------------------------

  var CSS =
    '.cpz-root{width:100%;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;}' +
    '.cpz-board{position:relative;width:100%;aspect-ratio:1/1;user-select:none;-webkit-user-select:none;touch-action:none;}' +
    '.cpz-squares{position:absolute;inset:0;display:grid;grid-template-columns:repeat(8,1fr);grid-template-rows:repeat(8,1fr);}' +
    '.cpz-sq{position:relative;}' +
    '.cpz-light{background:#f0d9b5;color:#b58863;}' +
    '.cpz-dark{background:#b58863;color:#f0d9b5;}' +
    '.cpz-sq.cpz-last{box-shadow:inset 0 0 0 100px rgba(155,199,0,.41);}' +
    '.cpz-sq.cpz-selected{box-shadow:inset 0 0 0 100px rgba(20,85,30,.5);}' +
    '.cpz-sq.cpz-check{background-image:radial-gradient(circle,rgba(255,0,0,.9) 0%,rgba(231,0,0,.6) 35%,rgba(169,0,0,0) 75%);}' +
    '.cpz-sq.cpz-wrong{box-shadow:inset 0 0 0 100px rgba(220,40,40,.6);}' +
    '.cpz-sq.cpz-target::after{content:"";position:absolute;left:35%;top:35%;width:30%;height:30%;border-radius:50%;background:rgba(20,85,30,.45);}' +
    '.cpz-sq.cpz-target.cpz-occupied::after{left:4%;top:4%;width:92%;height:92%;background:none;box-sizing:border-box;border:5px solid rgba(20,85,30,.45);}' +
    '.cpz-coord{position:absolute;font-size:11px;font-weight:600;line-height:1;pointer-events:none;}' +
    '.cpz-coord-file{right:3px;bottom:2px;}' +
    '.cpz-coord-rank{left:3px;top:2px;}' +
    '.cpz-piece{position:absolute;width:12.5%;height:12.5%;pointer-events:none;transition:left .2s ease,top .2s ease;z-index:1;}' +
    '.cpz-piece.cpz-dragging{transition:none;z-index:3;}' +
    '.cpz-grab{cursor:grab;}' +
    '.cpz-grabbing{cursor:grabbing;}' +
    '.cpz-promo{position:absolute;inset:0;z-index:4;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45);}' +
    '.cpz-promo-box{display:flex;background:#fff;border-radius:6px;padding:4px;box-shadow:0 4px 16px rgba(0,0,0,.4);}' +
    '.cpz-promo-box img{width:60px;height:60px;max-width:20vw;max-height:20vw;cursor:pointer;border-radius:4px;}' +
    '.cpz-promo-box img:hover{background:#ddd;}' +
    '.cpz-status{margin-top:8px;min-height:1.4em;font-size:15px;color:#333;}' +
    '.cpz-status b{margin-right:6px;}' +
    '.cpz-status.cpz-good{color:#1a7f37;}' +
    '.cpz-status.cpz-bad{color:#c62828;}';

  // Default image folder: "images/" next to this script file.
  var scriptDir = '';
  if (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) {
    scriptDir = document.currentScript.src.replace(/[^\/]*$/, '');
  }

  function injectStyles() {
    if (document.getElementById('cpz-styles')) return;
    var style = document.createElement('style');
    style.id = 'cpz-styles';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function el(tag, className, parent) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (parent) parent.appendChild(e);
    return e;
  }

  function create(container, options) {
    if (typeof container === 'string') container = document.querySelector(container);
    if (!container) throw new Error('ChessPuzzle: container not found');
    options = options || {};

    var imagePath = options.imagePath != null ? options.imagePath : scriptDir + 'images/';
    if (imagePath && !/\/$/.test(imagePath)) imagePath += '/';
    var imageExt = options.imageExtension || 'svg';
    var opponentDelay = options.opponentDelay != null ? options.opponentDelay : 500;

    injectStyles();
    container.innerHTML = '';
    var rootEl = el('div', 'cpz-root', container);
    var boardEl = el('div', 'cpz-board', rootEl);
    var squaresEl = el('div', 'cpz-squares', boardEl);
    var statusEl = el('div', 'cpz-status', rootEl);
    if (options.showStatus === false) statusEl.style.display = 'none';

    var puzzle = null;       // the loaded puzzle object
    var state = null;        // current engine state
    var legal = [];          // legal moves in the current state
    var solution = null;     // parsed solution moves, or null for free play
    var solutionIndex = 0;
    var playerColor = 'w';
    var flipped = false;
    var solved = false;
    var locked = false;      // true while an animation / opponent reply is pending
    var selected = null;     // selected square index
    var lastMove = null;
    var wrongSquare = null;
    var drag = null;         // { from, el }
    var promoEl = null;
    var squareEls = [];      // by square index
    var pieceEls = {};       // by piece id
    var generation = 0;      // bumped on load/reset to cancel pending timers

    function imageUrl(color, type) {
      return imagePath + COLOR_NAMES[color] + '-' + TYPE_NAMES[type] + '.' + imageExt;
    }

    function setStatus(text, kind) {
      statusEl.className = 'cpz-status' + (kind ? ' cpz-' + kind : '');
      statusEl.textContent = '';
      if (puzzle && puzzle.title) el('b', '', statusEl).textContent = puzzle.title;
      statusEl.appendChild(document.createTextNode(text || ''));
    }

    function later(fn, ms) {
      var gen = generation;
      setTimeout(function () { if (gen === generation) fn(); }, ms);
    }

    // Square index -> display column/row (0,0 = top left).
    function colOf(s) { return flipped ? 7 - (s & 7) : (s & 7); }
    function rowOf(s) { return flipped ? (s >> 3) : 7 - (s >> 3); }

    function squareAt(e) {
      var rect = boardEl.getBoundingClientRect();
      var col = Math.floor((e.clientX - rect.left) / rect.width * 8);
      var row = Math.floor((e.clientY - rect.top) / rect.height * 8);
      if (col < 0 || col > 7 || row < 0 || row > 7) return null;
      return flipped ? row * 8 + (7 - col) : (7 - row) * 8 + col;
    }

    function buildSquares() {
      squaresEl.innerHTML = '';
      squareEls = [];
      for (var row = 0; row < 8; row++) {
        for (var col = 0; col < 8; col++) {
          var s = flipped ? row * 8 + (7 - col) : (7 - row) * 8 + col;
          var dark = ((s & 7) + (s >> 3)) % 2 === 0;
          var sqEl = el('div', 'cpz-sq ' + (dark ? 'cpz-dark' : 'cpz-light'), squaresEl);
          if (row === 7) el('span', 'cpz-coord cpz-coord-file', sqEl).textContent = squareName(s)[0];
          if (col === 0) el('span', 'cpz-coord cpz-coord-rank', sqEl).textContent = squareName(s)[1];
          squareEls[s] = sqEl;
        }
      }
    }

    function placeAt(pieceEl, s) {
      pieceEl.style.left = colOf(s) * 12.5 + '%';
      pieceEl.style.top = rowOf(s) * 12.5 + '%';
    }

    function movesFrom(s) {
      return legal.filter(function (m) { return m.from === s; });
    }

    function canPickUp(s) {
      var p = state.board[s];
      if (!p || solved || p.color !== state.turn) return false;
      return solution ? p.color === playerColor : true;
    }

    function render() {
      var s, checkSq = inCheck(state, state.turn) ? findKing(state.board, state.turn) : -1;
      var targets = {};
      if (selected != null) movesFrom(selected).forEach(function (m) { targets[m.to] = true; });

      for (s = 0; s < 64; s++) {
        var c = squareEls[s].classList;
        c.toggle('cpz-selected', s === selected);
        c.toggle('cpz-target', !!targets[s]);
        c.toggle('cpz-occupied', !!state.board[s]);
        c.toggle('cpz-last', !!lastMove && (s === lastMove.from || s === lastMove.to));
        c.toggle('cpz-check', s === checkSq);
        c.toggle('cpz-wrong', s === wrongSquare);
      }

      var seen = {};
      for (s = 0; s < 64; s++) {
        var p = state.board[s];
        if (!p) continue;
        seen[p.id] = true;
        var img = pieceEls[p.id];
        var key = p.color + p.type;
        if (!img) {
          img = el('img', 'cpz-piece', boardEl);
          img.draggable = false;
          pieceEls[p.id] = img;
        }
        if (img.getAttribute('data-piece') !== key) {
          img.setAttribute('data-piece', key);
          img.src = imageUrl(p.color, p.type);
          img.alt = COLOR_NAMES[p.color] + ' ' + TYPE_NAMES[p.type];
        }
        if (!drag || drag.el !== img) placeAt(img, s);
      }
      Object.keys(pieceEls).forEach(function (id) {
        if (!seen[id]) {
          boardEl.removeChild(pieceEls[id]);
          delete pieceEls[id];
        }
      });
    }

    function commit(move) {
      state = makeMove(state, move);
      legal = legalMoves(state);
      lastMove = move;
      selected = null;
      render();
    }

    function describeTurn() {
      return COLOR_NAMES[state.turn].replace(/^./, function (ch) { return ch.toUpperCase(); }) + ' to move.';
    }

    function finish() {
      solved = true;
      locked = false;
      setStatus('Solved!', 'good');
      if (options.onSolved) options.onSolved();
    }

    function playOpponentMove() {
      var expected = solution[solutionIndex];
      var move = legal.filter(function (m) { return sameMove(m, expected); })[0];
      locked = false;
      if (!move) {
        setStatus('Puzzle error: solution move ' + squareName(expected.from) + '-' +
          squareName(expected.to) + ' is not legal.', 'bad');
        solved = true;
        return;
      }
      commit(move);
      solutionIndex++;
      if (solutionIndex >= solution.length || legal.length === 0) finish();
      else setStatus('Correct! Keep going.', 'good');
    }

    // Called with a legal move chosen by the user.
    function playUserMove(move) {
      if (!solution) {
        commit(move);
        if (isCheckmate(state)) setStatus('Checkmate!', 'good');
        else if (isStalemate(state)) setStatus('Stalemate.');
        else setStatus(describeTurn());
        return;
      }

      // Any move that delivers checkmate counts as correct, even if it is
      // not the exact move listed in the solution.
      var mates = isCheckmate(makeMove(state, move));
      var expected = solution[solutionIndex];
      if (mates || (expected && sameMove(move, expected))) {
        commit(move);
        solutionIndex++;
        if (options.onCorrect) options.onCorrect(publicMove(move));
        if (mates || solutionIndex >= solution.length) {
          finish();
        } else {
          locked = true;
          setStatus('Correct!', 'good');
          later(playOpponentMove, opponentDelay);
        }
        return;
      }

      // Wrong move: show the piece on the square it was dropped on, then move it back.
      locked = true;
      selected = null;
      wrongSquare = move.to;
      render();
      placeAt(pieceEls[state.board[move.from].id], move.to);
      setStatus('Incorrect move. Try again.', 'bad');
      if (options.onIncorrect) options.onIncorrect(publicMove(move));
      later(function () {
        locked = false;
        wrongSquare = null;
        render();
      }, 600);
    }

    function publicMove(m) {
      var out = { from: squareName(m.from), to: squareName(m.to) };
      if (m.promotion) out.promotion = TYPE_NAMES[m.promotion];
      return out;
    }

    function closePromotion() {
      if (promoEl) {
        boardEl.removeChild(promoEl);
        promoEl = null;
      }
    }

    function askPromotion(candidates) {
      var color = state.board[candidates[0].from].color;
      // Hold the pawn on the promotion square while the picker is open.
      placeAt(pieceEls[state.board[candidates[0].from].id], candidates[0].to);
      promoEl = el('div', 'cpz-promo', boardEl);
      var box = el('div', 'cpz-promo-box', promoEl);
      candidates.forEach(function (m) {
        var img = el('img', '', box);
        img.src = imageUrl(color, m.promotion);
        img.alt = TYPE_NAMES[m.promotion];
        img.draggable = false;
        img.addEventListener('pointerdown', function (e) {
          e.stopPropagation();
          closePromotion();
          playUserMove(m);
        });
      });
      promoEl.addEventListener('pointerdown', function (e) {
        // Clicked outside the picker: cancel the move.
        e.stopPropagation();
        closePromotion();
        selected = null;
        render();
      });
    }

    // Returns true if from->to is legal and has been handled.
    function attemptMove(from, to) {
      var candidates = legal.filter(function (m) { return m.from === from && m.to === to; });
      if (!candidates.length) return false;
      if (candidates[0].promotion) askPromotion(candidates);
      else playUserMove(candidates[0]);
      return true;
    }

    function dragTo(e) {
      var rect = boardEl.getBoundingClientRect();
      drag.el.style.left = (e.clientX - rect.left - rect.width / 16) + 'px';
      drag.el.style.top = (e.clientY - rect.top - rect.height / 16) + 'px';
    }

    function endDrag() {
      drag.el.classList.remove('cpz-dragging');
      boardEl.classList.remove('cpz-grabbing');
      drag = null;
    }

    boardEl.addEventListener('pointerdown', function (e) {
      if (!state || locked || promoEl || drag || (e.button != null && e.button > 0)) return;
      var s = squareAt(e);
      if (s == null) return;
      e.preventDefault();

      // Click-to-move: a piece is already selected and this is one of its targets.
      if (selected != null && s !== selected && attemptMove(selected, s)) return;

      if (!canPickUp(s)) {
        selected = null;
        render();
        return;
      }
      selected = s;
      drag = { from: s, el: pieceEls[state.board[s].id] };
      drag.el.classList.add('cpz-dragging');
      boardEl.classList.add('cpz-grabbing');
      try { boardEl.setPointerCapture(e.pointerId); } catch (err) { /* not supported */ }
      render();
      dragTo(e);
    });

    boardEl.addEventListener('pointermove', function (e) {
      if (drag) {
        dragTo(e);
      } else if (state && !locked) {
        var s = squareAt(e);
        boardEl.classList.toggle('cpz-grab', s != null && canPickUp(s));
      }
    });

    boardEl.addEventListener('pointerup', function (e) {
      if (!drag) return;
      var from = drag.from, s = squareAt(e);
      endDrag();
      // Dropped on the origin square: keep it selected for click-to-move.
      if (s == null || s === from || !attemptMove(from, s)) {
        if (s !== from) selected = null;
        render();
      }
    });

    boardEl.addEventListener('pointercancel', function () {
      if (!drag) return;
      endDrag();
      selected = null;
      render();
    });

    function start() {
      generation++;
      closePromotion();
      if (drag) endDrag();
      state = stateFromPuzzle(puzzle);
      legal = legalMoves(state);
      solution = Array.isArray(puzzle.solution) && puzzle.solution.length
        ? puzzle.solution.map(parseSolutionMove) : null;
      solutionIndex = 0;
      playerColor = state.turn;
      var orientation = options.orientation ? parseColor(options.orientation) : playerColor;
      flipped = orientation === 'b';
      solved = false;
      locked = false;
      selected = null;
      lastMove = null;
      wrongSquare = null;
      buildSquares();
      render();
      setStatus(puzzle.description || describeTurn());
    }

    function showError(err) {
      puzzle = null;
      setStatus('Could not load puzzle: ' + (err && err.message ? err.message : err), 'bad');
    }

    // Load a puzzle from a URL (string) or a puzzle object. Returns a Promise.
    function load(source) {
      generation++;
      var gen = generation;
      var pending = typeof source === 'string'
        ? fetch(source).then(function (res) {
            if (!res.ok) throw new Error(source + ' (HTTP ' + res.status + ')');
            return res.json();
          })
        : Promise.resolve(source);
      return pending.then(function (data) {
        if (gen !== generation) return;
        puzzle = data;
        start();
        if (options.onLoad) options.onLoad(puzzle);
      }).catch(function (err) {
        if (gen !== generation) return;
        showError(err);
      });
    }

    function reset() {
      if (puzzle) start();
    }

    if (options.puzzle) load(options.puzzle);

    return {
      load: load,
      reset: reset,
      isSolved: function () { return solved; },
      getPuzzle: function () { return puzzle; }
    };
  }

  var api = { create: create, engine: engine };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ChessPuzzle = api;
})(typeof window !== 'undefined' ? window : this);
