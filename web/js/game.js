class Game {
  constructor(options = {}) {
    this.canvas = document.getElementById('board');
    this.ctx = this.canvas.getContext('2d');
    this.board = new Board(this.canvas.width, CONFIG.HEX_SIZE);
    this.audio = new AudioManager();
    this.ai = null;
    this.players = [];
    this.pieces = [];
    this.currentPlayerIndex = 0;
    this.selectedPiece = null;
    this.validMoves = [];
    this.jumpChain = [];
    this.rankings = [];
    this.gameOver = false;
    this.debugMode = new URLSearchParams(window.location.search).get('mode') === 'debug';
    this.showIds = this.debugMode;
    this.config = options.mode ? { ...this.readConfig(), ...options } : this.readConfig();
    this.embedded = Boolean(options.embedded);
    this.network = options.networkManager || null;
    this.isHost = options.isHost || false;
    this.myPlayerId = null;
    this.lastStateSync = 0;
    this.networkDisconnected = false;
    this.disposed = false;
    this.eventCleanups = [];
    this.timeoutIds = new Set();
    this.setupEvents();
    this.initNetwork();
  }

  readConfig() {
    const fallback = { mode: 'local', playerCount: 2, seatsPerPlayer: 3, aiDifficulty: 'medium' };
    try {
      return { ...fallback, ...JSON.parse(sessionStorage.getItem('gameConfig') || '{}') };
    } catch (error) {
      return fallback;
    }
  }

  async initNetwork() {
    if (this.config.mode !== 'online' || !this.config.network) {
      console.log('initNetwork: local mode, starting game immediately');
      this.startGame();
      return;
    }

    this.isHost = this.config.isHost;
    console.log('initNetwork: online mode, isHost=', this.isHost, 'network exists=', !!this.network);

    if (this.network) {
      this.network.onGameState = (state) => this.applyRemoteState(state);
      this.network.onGameMove = (move) => this.applyRemoteMove(move);
      this.network.onDisconnected = () => this.handleDisconnect();
      this.network.onPlayerNameUpdate = (payload) => {
        const player = this.players.find((p) => p.id === payload.playerId);
        if (player) {
          player.name = payload.name;
          this.updateStatusBar();
          if (this.isHost && payload.fromPeerId && payload.fromPeerId !== this.network.peerId) {
            this.network.broadcastPlayerName({ name: payload.name, playerId: payload.playerId });
          }
        }
      };
      this.network.onGameStateRequest = () => {
        console.log('onGameStateRequest triggered, isHost=', this.isHost, 'players.length=', this.players.length);
        if (this.isHost && this.players.length > 0) {
          this.broadcastState();
        }
      };

      console.log('initNetwork: reusing existing network, dataChannels=', this.network.dataChannels.size);

      if (this.isHost) {
        console.log('initNetwork: host starting game');
        this.startGame();
      } else {
        console.log('initNetwork: client starting game, sending state request');
        this.startGame();
        this.network.sendToHost(createMessage(NETWORK_MESSAGES.GAME_STATE, { request: true }));
      }
      return;
    }

    this.network = new NetworkManager({
      onGameState: (state) => this.applyRemoteState(state),
      onGameMove: (move) => this.applyRemoteMove(move),
      onDisconnected: () => this.handleDisconnect()
    });

    try {
      await this.network.connect();

      if (this.isHost) {
        await this.network.createPeerConnection();
        const channel = await this.network.createDataChannel('game');

        await new Promise((resolve) => {
          if (channel.readyState === 'open') {
            resolve();
          } else {
            channel.onopen = () => resolve();
          }
        });

        this.startGame();
      } else {
        await new Promise((resolve, reject) => {
          const timeout = this.setGameTimeout(() => reject(new Error('DataChannel timeout')), 30000);

          this.network.onStateChange = (state) => {
            if (state === 'connected' && this.network.dataChannels.size > 0) {
              this.clearGameTimeout(timeout);
              this.network.sendToHost(createMessage(NETWORK_MESSAGES.GAME_STATE, { request: true }));
              resolve();
            }
          };
        });
      }
    } catch (error) {
      console.error('Failed to initialize network:', error);
      this.startGame();
    }
  }

  setupEvents() {
    this.addEvent(document.getElementById('btnBack'), 'click', () => {
      if (this.network) {
        this.network.disconnect();
      }
      this.dispose({ disconnectNetwork: false });
      if (this.embedded) return;
      window.location.href = 'start.html';
    });

    this.addEvent(document.getElementById('btnRestart'), 'click', () => {
      if (this.config.mode === 'online') return;
      this.startGame();
    });

    const btnIds = document.getElementById('btnIds');
    if (this.debugMode && btnIds) {
      btnIds.hidden = false;
      this.addEvent(btnIds, 'click', () => {
        this.showIds = !this.showIds;
        this.render();
      });
    }

    this.addEvent(document.getElementById('btnEndJump'), 'click', () => {
      if (this.config.mode === 'online' && !this.isHost) {
        if (this.jumpChain.length > 0 && this.selectedPiece) {
          this.network.sendToHost(createMessage(NETWORK_MESSAGES.GAME_MOVE, {
            type: 'end_jump'
          }));
        }
        return;
      }
      this.endJumpTurn();
    });

    const btnBGM = document.getElementById('btnBGM');
    if (btnBGM) {
      this.addEvent(btnBGM, 'click', () => {
        const enabled = this.audio.toggleBGM();
        btnBGM.textContent = enabled ? '音乐' : '静音';
      });
    }

    this.addEvent(this.canvas, 'click', (event) => this.handleClick(event));
    if (this.debugMode) {
      this.addEvent(this.canvas, 'mousemove', (event) => this.handleMouseMove(event));
      this.addEvent(this.canvas, 'mouseleave', () => {
        document.getElementById('tooltip').hidden = true;
      });
    }
  }

  addEvent(target, type, handler, options) {
    if (!target) return;
    target.addEventListener(type, handler, options);
    this.eventCleanups.push(() => target.removeEventListener(type, handler, options));
  }

  setGameTimeout(handler, delay) {
    const timeoutId = window.setTimeout(() => {
      this.timeoutIds.delete(timeoutId);
      if (!this.disposed) handler();
    }, delay);
    this.timeoutIds.add(timeoutId);
    return timeoutId;
  }

  clearGameTimeout(timeoutId) {
    window.clearTimeout(timeoutId);
    this.timeoutIds.delete(timeoutId);
  }

  clearGameTimeouts() {
    this.timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
    this.timeoutIds.clear();
  }

  dispose(options = {}) {
    if (this.disposed) return;
    this.disposed = true;
    this.clearGameTimeouts();
    this.eventCleanups.forEach((cleanup) => cleanup());
    this.eventCleanups = [];
    this.audio.dispose();

    if (this.network) {
      this.network.onGameState = () => {};
      this.network.onGameMove = () => {};
      this.network.onDisconnected = () => {};
      this.network.onPlayerNameUpdate = () => {};
      this.network.onGameStateRequest = () => {};
      this.network.onStateChange = () => {};
      if (options.disconnectNetwork) {
        this.network.disconnect();
      }
    }
  }

  startGame() {
    if (this.disposed) return;
    this.clearGameTimeouts();
    console.log('startGame called, config=', this.config);
    const requestedHumans = Number(this.config.playerCount) || 2;
    const seatsPerPlayer = Number(this.config.seatsPerPlayer) || 1;
    const controllerCount = requestedHumans === 1 ? 2 : requestedHumans;
    const assignments = getSeatAssignments(controllerCount, seatsPerPlayer);

    this.board = new Board(this.canvas.width, CONFIG.HEX_SIZE);
    this.players = assignments.map((seats, index) => {
      const isAI = this.config.mode === 'local' && requestedHumans === 1 && index === 1;
      const isRemote = this.config.mode === 'online' && !this.isHost && index !== 0;
      return new Player(index, seats, isAI, this.config.aiDifficulty, isRemote);
    });

    if (this.config.mode === 'online') {
      const peerIds = Array.isArray(this.config.peerIds) ? this.config.peerIds : [];
      const peerIndex = peerIds.indexOf(this.network ? this.network.peerId : null);
      this.myPlayerId = peerIndex >= 0 ? peerIndex : (this.isHost ? 0 : 1);
      if (this.players[this.myPlayerId]) this.players[this.myPlayerId].applySavedName((name) => {
        if (this.network) {
          this.network.broadcastPlayerName({ name, playerId: this.myPlayerId });
        }
      });
    } else {
      this.myPlayerId = null;
    }

    this.ai = new AIEngine(this.config.aiDifficulty);
    this.pieces = [];
    this.currentPlayerIndex = 0;
    this.selectedPiece = null;
    this.validMoves = [];
    this.jumpChain = [];
    this.rankings = [];
    this.gameOver = false;
    this.initPieces();
    this.render();
    this.updateStatusBar();

    this.audio.loadBGM();

    if (this.isHost && this.network) {
      this.broadcastState();
    }

    if (this.currentPlayer.isAI) {
      this.setGameTimeout(() => this.doAITurn(), CONFIG.AI_THINK_DELAY);
    }
  }

  initPieces() {
    let pieceId = 1;
    this.players.forEach((player) => {
      player.seats.forEach((seatId) => {
        getCornerCells(seatId).forEach((cell) => {
          const piece = new Piece(pieceId, player.id, seatId, cell.id);
          pieceId += 1;
          player.addPiece(piece);
          this.pieces.push(piece);
          this.board.placePiece(piece);
        });
      });
    });
  }

  get currentPlayer() {
    return this.players[this.currentPlayerIndex];
  }

  handleClick(event) {
    if (this.gameOver || this.currentPlayer.isAI) return;

    if (this.config.mode === 'online' && this.currentPlayer.id !== this.myPlayerId) return;

    if (this.config.mode === 'online' && !this.isHost) {
      this.handleClientClick(event);
      return;
    }

    const rect = this.canvas.getBoundingClientRect();
    const cell = this.board.findCellAtPixel(event.clientX - rect.left, event.clientY - rect.top);
    if (!cell) return;

    const clickedPiece = cell.piece;
    if (this.jumpChain.length > 0 && clickedPiece === this.selectedPiece) {
      this.endJumpTurn();
      return;
    }

    if (clickedPiece && this.currentPlayer.ownsPiece(clickedPiece) && this.jumpChain.length === 0) {
      this.selectPiece(clickedPiece);
      return;
    }

    if (!this.selectedPiece || clickedPiece) return;

    const move = this.validMoves.find((item) => item.cellId === cell.id);
    if (!move) return;

    this.applyMove(this.selectedPiece, move);
  }

  handleClientClick(event) {
    const rect = this.canvas.getBoundingClientRect();
    const cell = this.board.findCellAtPixel(event.clientX - rect.left, event.clientY - rect.top);
    if (!cell) return;

    const clickedPiece = cell.piece;

    if (this.jumpChain.length > 0 && clickedPiece === this.selectedPiece) {
      this.network.sendToHost(createMessage(NETWORK_MESSAGES.GAME_MOVE, {
        type: 'end_jump'
      }));
      return;
    }

    if (clickedPiece && this.currentPlayer.ownsPiece(clickedPiece) && this.jumpChain.length === 0) {
      this.selectPiece(clickedPiece);
      return;
    }

    if (!this.selectedPiece || clickedPiece) return;

    const move = this.validMoves.find((item) => item.cellId === cell.id);
    if (!move) return;

    this.network.sendToHost(createMessage(NETWORK_MESSAGES.GAME_MOVE, {
      pieceId: this.selectedPiece.id,
      fromCellId: this.selectedPiece.cellId,
      toCellId: move.cellId,
      moveType: move.type,
      via: move.via,
      jumpChain: this.jumpChain
    }));
  }

  selectPiece(piece) {
    this.selectedPiece = piece;
    this.jumpChain = [];
    this.validMoves = this.board.getLegalMoves(piece.cellId);
    this.audio.play('select');
    this.render();
    this.updateStatusBar();
  }

  applyMove(piece, move) {
    const fromCellId = piece.cellId;
    this.board.movePiece(piece, move.cellId);

    if (move.type === 'jump') {
      this.jumpChain.push({ from: fromCellId, to: move.cellId, via: move.via });
      this.audio.play('jump');
      this.validMoves = this.board.getJumpMoves(piece.cellId, this.getJumpVisited());
      if (this.validMoves.length > 0) {
        this.render();
        this.updateStatusBar(this.currentPlayer.isAI ? '继续跳跃中...' : '可继续跳跃；点击当前棋子结束回合');
        if (this.isHost && this.network) {
          this.broadcastState(true);
        }
        if (this.currentPlayer.isAI) {
          this.setGameTimeout(() => {
            this.applyMove(piece, this.validMoves[0]);
          }, 260);
        }
        return;
      }
    } else {
      this.audio.play('move');
    }

    if (this.isHost && this.network) {
      this.broadcastMove({
        pieceId: piece.id,
        fromCellId: fromCellId,
        toCellId: move.cellId,
        moveType: move.type,
        via: move.via,
        jumpChain: this.jumpChain
      });
    }

    this.endTurn();
  }

  applyRemoteMove(movePayload) {
    if (movePayload.type === 'end_jump') {
      if (this.canRemoteEndJump(movePayload)) {
        this.endJumpTurn();
      }
      return;
    }

    const piece = this.pieces.find((p) => p.id === movePayload.pieceId);
    if (!piece) return;
    const move = this.getValidatedRemoteMove(piece, movePayload);
    if (!move) return;
    const fromCellId = piece.cellId;

    this.board.movePiece(piece, move.cellId);

    if (move.type === 'jump') {
      this.jumpChain = movePayload.jumpChain || [];
      this.jumpChain.push({ from: fromCellId, to: move.cellId, via: move.via });
      this.selectedPiece = piece;
      this.audio.play('jump');
      this.validMoves = this.board.getJumpMoves(piece.cellId, this.getJumpVisited());
      if (this.validMoves.length > 0) {
        this.render();
        this.updateStatusBar('可继续跳跃；点击当前棋子结束回合');
        this.broadcastState(true);
        return;
      }
    } else {
      this.audio.play('move');
    }

    this.selectedPiece = null;
    this.validMoves = [];
    this.render();
    this.updateStatusBar();

    this.endTurn();
  }

  canRemoteEndJump(movePayload) {
    const peerIds = Array.isArray(this.config.peerIds) ? this.config.peerIds : [];
    const expectedPeerId = peerIds[this.currentPlayer.id];
    return this.config.mode === 'online' &&
      this.isHost &&
      !this.gameOver &&
      this.jumpChain.length > 0 &&
      this.selectedPiece &&
      (!expectedPeerId || movePayload.fromPeerId === expectedPeerId) &&
      this.currentPlayer.ownsPiece(this.selectedPiece);
  }

  getValidatedRemoteMove(piece, movePayload) {
    if (this.config.mode === 'online' && !this.isHost) {
      return {
        type: movePayload.moveType,
        cellId: movePayload.toCellId,
        via: movePayload.via,
        path: [movePayload.fromCellId, movePayload.toCellId]
      };
    }

    if (this.config.mode !== 'online' || !this.isHost || this.gameOver) return null;
    const peerIds = Array.isArray(this.config.peerIds) ? this.config.peerIds : [];
    const expectedPeerId = peerIds[this.currentPlayer.id];
    if (expectedPeerId && movePayload.fromPeerId !== expectedPeerId) return null;
    if (!this.currentPlayer || !this.currentPlayer.ownsPiece(piece)) return null;
    if (piece.cellId !== movePayload.fromCellId) return null;
    if (movePayload.moveType !== 'move' && movePayload.moveType !== 'jump') return null;
    if (this.jumpChain.length > 0 && piece !== this.selectedPiece) return null;
    if (this.jumpChain.length > 0 && movePayload.moveType !== 'jump') return null;

    const legalMoves = this.board.getLegalMoves(piece.cellId, this.jumpChain.length > 0);
    const move = legalMoves.find((item) =>
      item.cellId === movePayload.toCellId &&
      item.type === movePayload.moveType &&
      (item.type !== 'jump' || item.via === movePayload.via)
    );
    if (!move) return null;
    if (movePayload.moveType === 'jump' && !Array.isArray(movePayload.jumpChain)) return null;
    return move;
  }

  applyRemoteState(state) {
    console.log('applyRemoteState called, pieces count=', state.pieces.length, 'my pieces count=', this.pieces.length);
    this.board.resetPieces();

    state.pieces.forEach((pieceData) => {
      const piece = this.pieces.find((p) => p.id === pieceData.id);
      if (piece) {
        piece.cellId = pieceData.cellId;
        this.board.placePiece(piece);
      }
    });

    this.currentPlayerIndex = state.currentPlayerIndex;
    this.gameOver = state.gameOver;
    this.rankings = state.rankings || [];
    this.jumpChain = state.jumpChain || [];

    if (this.jumpChain.length > 0 && state.selectedPieceId) {
      this.selectedPiece = this.pieces.find((p) => p.id === state.selectedPieceId) || null;
      if (this.selectedPiece) {
        this.validMoves = this.board.getJumpMoves(this.selectedPiece.cellId, this.getJumpVisited());
      } else {
        this.selectedPiece = null;
        this.validMoves = [];
      }
    } else {
      this.selectedPiece = null;
      this.validMoves = [];
    }

    this.render();
    this.updateStatusBar();
  }

  broadcastMove(move) {
    if (!this.network) return;
    this.network.broadcastToRoom(createMessage(NETWORK_MESSAGES.GAME_MOVE, move));
  }

  broadcastState(force = false) {
    if (!this.network) return;

    const now = Date.now();
    if (!force && now - this.lastStateSync < CONFIG.NETWORK.STATE_SYNC_THROTTLE) {
      console.log('broadcastState throttled');
      return;
    }
    this.lastStateSync = now;

    const state = {
      pieces: this.pieces.map((p) => ({ id: p.id, cellId: p.cellId })),
      currentPlayerIndex: this.currentPlayerIndex,
      gameOver: this.gameOver,
      rankings: this.rankings,
      jumpChain: this.jumpChain,
      selectedPieceId: this.selectedPiece ? this.selectedPiece.id : null
    };

    console.log('broadcastState: sending state with', state.pieces.length, 'pieces');
    this.network.broadcastToRoom(createMessage(NETWORK_MESSAGES.GAME_STATE, state));
  }

  endJumpTurn() {
    if (this.gameOver || this.currentPlayer.isAI || this.jumpChain.length === 0) return;
    this.endTurn();
  }

  getJumpVisited() {
    const visited = new Set();
    this.jumpChain.forEach((item) => {
      visited.add(item.from);
      visited.add(item.to);
    });
    return visited;
  }

  endTurn() {
    const player = this.currentPlayer;
    if (player.isFinished && !this.rankings.includes(player.id)) {
      this.rankings.push(player.id);
      this.audio.play('finish');
    }

    this.selectedPiece = null;
    this.validMoves = [];
    this.jumpChain = [];

    if (this.rankings.length > 0) {
      this.gameOver = true;
      this.render();
      this.showGameOver();

      if (this.isHost && this.network) {
        this.broadcastState(true);
      }
      return;
    }

    this.advancePlayer();
    this.render();
    this.updateStatusBar();

    if (this.isHost && this.network) {
      this.broadcastState(true);
    }

    if (this.currentPlayer.isAI) {
      this.setGameTimeout(() => this.doAITurn(), CONFIG.AI_THINK_DELAY);
    }
  }

  advancePlayer() {
    let attempts = 0;
    do {
      this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
      attempts += 1;
    } while (attempts < this.players.length && this.rankings.includes(this.currentPlayer.id));
  }

  doAITurn() {
    if (this.gameOver || !this.currentPlayer.isAI) return;

    const result = this.ai.calculateMove(this, this.currentPlayer);
    if (!result) {
      this.endTurn();
      return;
    }

    this.selectedPiece = result.piece;
    this.validMoves = [result.move];
    this.render();

    this.setGameTimeout(() => {
      this.applyMove(result.piece, result.move);
    }, 250);
  }

  handleDisconnect() {
    if (!this.gameOver) {
      this.gameOver = true;
      this.networkDisconnected = true;
      this.render();
    }
  }

  showGameOver() {
    const winner = this.players[this.rankings[0]];
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.68)';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.fillStyle = '#ffffff';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.font = 'bold 32px sans-serif';
    this.ctx.fillText('游戏结束', this.canvas.width / 2, this.canvas.height / 2 - 28);
    this.ctx.font = '20px sans-serif';
    this.ctx.fillText(`冠军: ${winner ? winner.name : '未定'}`, this.canvas.width / 2, this.canvas.height / 2 + 18);
    this.updateStatusBar();
  }

  render() {
    this.board.render(this.ctx, { showIds: this.showIds });

    this.validMoves.forEach((move) => {
      const cell = this.board.getCellById(move.cellId);
      if (!cell) return;
      const point = this.board.hexToPixel(cell.q, cell.r);
      this.ctx.beginPath();
      this.ctx.arc(point.x, point.y, CONFIG.HEX_SIZE * 0.45, 0, Math.PI * 2);
      this.ctx.strokeStyle = move.type === 'jump' ? CONFIG.COLORS.JUMP : CONFIG.COLORS.MOVE;
      this.ctx.lineWidth = 4;
      this.ctx.stroke();
    });

    this.drawJumpPath();

    this.players.forEach((player) => {
      player.pieces.forEach((piece) => {
        renderPiece(this.ctx, piece, this.board, player, piece === this.selectedPiece, this.debugMode);
      });
    });

    if (this.networkDisconnected) {
      this.ctx.fillStyle = 'rgba(0, 0, 0, 0.68)';
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      this.ctx.fillStyle = '#ffffff';
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      this.ctx.font = 'bold 28px sans-serif';
      this.ctx.fillText('连接断开', this.canvas.width / 2, this.canvas.height / 2);
      this.ctx.font = '18px sans-serif';
      this.ctx.fillText('请返回主页重新开始', this.canvas.width / 2, this.canvas.height / 2 + 40);
    }
  }

  drawJumpPath() {
    if (this.jumpChain.length === 0) return;
    this.ctx.save();
    this.ctx.strokeStyle = '#ffffff';
    this.ctx.lineWidth = 2;
    this.ctx.setLineDash([6, 6]);
    this.ctx.beginPath();
    this.jumpChain.forEach((item) => {
      const from = this.board.getCellById(item.from);
      const to = this.board.getCellById(item.to);
      if (!from || !to) return;
      const p1 = this.board.hexToPixel(from.q, from.r);
      const p2 = this.board.hexToPixel(to.q, to.r);
      this.ctx.moveTo(p1.x, p1.y);
      this.ctx.lineTo(p2.x, p2.y);
    });
    this.ctx.stroke();
    this.ctx.restore();
  }

  updateStatusBar(message = '') {
    const playerInfo = document.getElementById('playerInfo');
    const turnMessage = document.getElementById('turnMessage');
    const btnEndJump = document.getElementById('btnEndJump');

    playerInfo.innerHTML = this.players.map((player) => {
      const active = player.id === this.currentPlayer.id && !this.gameOver;
      const isSelf = player.id === this.myPlayerId;
      const canRename = this.canRenamePlayer(player);
      const seatColors = player.seats.map((seat) => BOARD_DATA.corners[seat].color);
      const badgeColor = seatColors[0] || player.color;
      const dotFill = seatColors.length > 1 ? `conic-gradient(${seatColors.join(', ')})` : badgeColor;
      const seatText = player.seats.map((seat) => {
        const color = BOARD_DATA.corners[seat].color;
        if (this.debugMode) {
          const corner = BOARD_DATA.corners[seat];
          const target = getTargetCorner(seat);
          return `<span style="color:${color}">角${seat}(${corner.name}→角${target})</span>`;
        }
        return `<span style="color:${color}">●</span>`;
      }).join('/');
      const finished = player.isFinished || this.rankings.includes(player.id);
      const selfMark = isSelf ? '（我）' : '';
      const clickHandler = canRename ? ` onclick="game.renamePlayer(${player.id})" title="点击修改名称"` : '';
      const editMark = canRename ? '<span class="edit-mark" aria-hidden="true">编辑</span>' : '';
      return `<div class="player-badge ${active ? 'active' : ''} ${finished ? 'finished' : ''} ${isSelf ? 'self' : ''} ${canRename ? 'editable' : ''}" style="--player-color:${badgeColor};--player-dot:${dotFill}"${clickHandler}>
        <span class="dot"></span><span class="player-copy"><span class="player-name">${this.escapeHtml(player.name)}${selfMark}</span><small>${seatText} ${player.finishedCount}/${player.pieces.length}</small></span>${editMark}
      </div>`;
    }).join('');

    btnEndJump.hidden = true;
    if (this.gameOver) {
      const winner = this.players[this.rankings[0]];
      turnMessage.textContent = winner ? `冠军: ${winner.name}` : '游戏结束';
      return;
    }

    const networkStatus = this.network ? `<span style="color:${this.network.isConnected ? '#4ecdc4' : '#e94560'}">●</span> ` : '';
    const prompt = this.getTurnPrompt(message);
    const plainMessage = `${this.currentPlayer.name}: ${prompt}`;
    turnMessage.title = plainMessage;
    turnMessage.innerHTML = `${networkStatus}${this.escapeHtml(this.currentPlayer.name)}: ${this.escapeHtml(prompt)}`;
  }

  getTurnPrompt(message = '') {
    const isOnline = this.config.mode === 'online';
    const canAct = !isOnline || this.currentPlayer.id === this.myPlayerId;

    if (this.currentPlayer.isAI) return 'AI 思考中...';
    if (this.jumpChain.length > 0) {
      return canAct ? '可继续跳跃；点击当前棋子结束回合' : '等待继续跳跃';
    }
    if (!canAct) return '等待行动';
    return message || '选择棋子';
  }

  canRenamePlayer(player) {
    if (!player || player.isAI) return false;
    if (this.config.mode === 'online') return player.id === this.myPlayerId;
    return true;
  }

  renamePlayer(playerId = this.myPlayerId) {
    const player = this.players[playerId];
    if (!this.canRenamePlayer(player)) return;
    const newName = prompt('输入新名称：', player.name);
    if (!newName || newName.trim() === '') return;
    const trimmed = newName.trim();
    player.name = trimmed;
    if (this.config.mode === 'online' && player.id === this.myPlayerId) {
      Player.setName(trimmed);
    }
    this.updateStatusBar();
    if (this.network) {
      this.network.broadcastPlayerName({ name: trimmed, playerId: player.id });
    }
  }

  escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  handleMouseMove(event) {
    const rect = this.canvas.getBoundingClientRect();
    const cell = this.board.findCellAtPixel(event.clientX - rect.left, event.clientY - rect.top);
    const tooltip = document.getElementById('tooltip');

    if (!cell) {
      tooltip.hidden = true;
      return;
    }

    tooltip.hidden = false;
    tooltip.style.left = `${event.clientX + 14}px`;
    tooltip.style.top = `${event.clientY + 14}px`;
    const corner = cell.corner === null ? '中央' : `${BOARD_DATA.corners[cell.corner].name} -> 角${getTargetCorner(cell.corner)}`;
    const pieceText = cell.piece ? `<br>${this.players[cell.piece.playerId].name} / 起点角${cell.piece.seatId}` : '';
    tooltip.innerHTML = `ID ${cell.id}<br>坐标 (${cell.q}, ${cell.r})<br>${corner}${pieceText}`;
  }
}

window.addEventListener('DOMContentLoaded', () => {
  if (window.NO_AUTO_GAME_INIT) return;
  window.game = new Game();
});
