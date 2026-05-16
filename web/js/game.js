class Game {
  constructor() {
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
    this.showIds = false;
    this.config = this.readConfig();
    this.setupEvents();
    this.startGame();
  }

  readConfig() {
    const fallback = { playerCount: 2, seatsPerPlayer: 3, aiDifficulty: 'medium' };
    try {
      return { ...fallback, ...JSON.parse(sessionStorage.getItem('gameConfig') || '{}') };
    } catch (error) {
      return fallback;
    }
  }

  setupEvents() {
    document.getElementById('btnBack').addEventListener('click', () => {
      window.location.href = 'start.html';
    });

    document.getElementById('btnRestart').addEventListener('click', () => {
      this.startGame();
    });

    document.getElementById('btnIds').addEventListener('click', () => {
      this.showIds = !this.showIds;
      this.render();
    });

    document.getElementById('btnEndJump').addEventListener('click', () => {
      this.endJumpTurn();
    });

    this.canvas.addEventListener('click', (event) => this.handleClick(event));
    this.canvas.addEventListener('mousemove', (event) => this.handleMouseMove(event));
    this.canvas.addEventListener('mouseleave', () => {
      document.getElementById('tooltip').style.display = 'none';
    });
  }

  startGame() {
    const requestedHumans = Number(this.config.playerCount) || 2;
    const seatsPerPlayer = Number(this.config.seatsPerPlayer) || 1;
    const controllerCount = requestedHumans === 1 ? 2 : requestedHumans;
    const assignments = getSeatAssignments(controllerCount, seatsPerPlayer);

    this.board = new Board(this.canvas.width, CONFIG.HEX_SIZE);
    this.players = assignments.map((seats, index) => {
      const isAI = requestedHumans === 1 && index === 1;
      return new Player(index, seats, isAI, this.config.aiDifficulty);
    });
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

    if (this.currentPlayer.isAI) {
      window.setTimeout(() => this.doAITurn(), CONFIG.AI_THINK_DELAY);
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
        this.updateStatusBar(this.currentPlayer.isAI ? '继续跳跃中...' : '可继续跳跃，或结束回合');
        if (this.currentPlayer.isAI) {
          window.setTimeout(() => {
            this.applyMove(piece, this.validMoves[0]);
          }, 260);
        }
        return;
      }
    } else {
      this.audio.play('move');
    }

    this.endTurn();
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
      return;
    }

    this.advancePlayer();
    this.render();
    this.updateStatusBar();

    if (this.currentPlayer.isAI) {
      window.setTimeout(() => this.doAITurn(), CONFIG.AI_THINK_DELAY);
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

    window.setTimeout(() => {
      this.applyMove(result.piece, result.move);
    }, 250);
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
        renderPiece(this.ctx, piece, this.board, player, piece === this.selectedPiece);
      });
    });
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
      const seatText = player.seats.map((seat) => {
        const color = player.seats.length > 1 ? BOARD_DATA.corners[seat].color : player.color;
        return `<span style="color:${color}">角${seat}</span>`;
      }).join('/');
      const finished = player.isFinished || this.rankings.includes(player.id);
      return `<div class="player-badge ${active ? 'active' : ''} ${finished ? 'finished' : ''}" style="--player-color:${player.color}">
        <span class="dot"></span>${player.name}<small>${seatText} ${player.finishedCount}/${player.pieces.length}</small>
      </div>`;
    }).join('');

    if (this.gameOver) {
      const winner = this.players[this.rankings[0]];
      turnMessage.textContent = winner ? `冠军: ${winner.name}` : '游戏结束';
      btnEndJump.hidden = true;
      return;
    }

    const prompt = message || (this.currentPlayer.isAI ? 'AI 思考中...' : '选择棋子');
    turnMessage.textContent = `${this.currentPlayer.name}: ${prompt}`;
    btnEndJump.hidden = this.currentPlayer.isAI || this.jumpChain.length === 0;
  }

  handleMouseMove(event) {
    const rect = this.canvas.getBoundingClientRect();
    const cell = this.board.findCellAtPixel(event.clientX - rect.left, event.clientY - rect.top);
    const tooltip = document.getElementById('tooltip');

    if (!cell) {
      tooltip.style.display = 'none';
      return;
    }

    tooltip.style.display = 'block';
    tooltip.style.left = `${event.clientX + 14}px`;
    tooltip.style.top = `${event.clientY + 14}px`;
    const corner = cell.corner === null ? '中央' : `${BOARD_DATA.corners[cell.corner].name} -> 角${getTargetCorner(cell.corner)}`;
    const pieceText = cell.piece ? `<br>${this.players[cell.piece.playerId].name} / 起点角${cell.piece.seatId}` : '';
    tooltip.innerHTML = `ID ${cell.id}<br>坐标 (${cell.q}, ${cell.r})<br>${corner}${pieceText}`;
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.game = new Game();
});
