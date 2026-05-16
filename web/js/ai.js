class AIEngine {
  constructor(difficulty = 'medium') {
    this.difficulty = difficulty;
  }

  calculateMove(game, player) {
    const candidates = [];

    player.pieces.forEach((piece) => {
      game.board.getLegalMoves(piece.cellId).forEach((move) => {
        candidates.push({
          piece,
          move,
          score: this.evaluateMove(game, player, piece, move)
        });
      });
    });

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0];
  }

  evaluateMove(game, player, piece, move) {
    const fromDistance = this.distanceToTarget(game.board, piece.cellId, piece.targetCorner);
    const toDistance = this.distanceToTarget(game.board, move.cellId, piece.targetCorner);
    let score = (fromDistance - toDistance) * 12;

    if (move.type === 'jump') score += 8 + move.path.length * 3;
    if (this.difficulty === 'easy') score += Math.random() * 12;
    if (this.difficulty === 'medium') score += Math.random() * 3;

    if (this.difficulty === 'hard') {
      score += this.cornerProgressBonus(game.board, piece, move.cellId);
      score -= this.blockedOwnTargetPenalty(game.board, player, move.cellId);
    }

    return score;
  }

  distanceToTarget(board, cellId, targetCorner) {
    const cell = board.getCellById(cellId);
    const targets = getCornerCells(targetCorner);
    if (!cell || targets.length === 0) return 0;

    return Math.min(...targets.map((target) => this.hexDistance(cell, target)));
  }

  hexDistance(a, b) {
    const as = -a.q - a.r;
    const bs = -b.q - b.r;
    return Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(as - bs));
  }

  cornerProgressBonus(board, piece, toCellId) {
    const cell = board.getCellById(toCellId);
    if (!cell) return 0;
    if (cell.corner === piece.targetCorner) return 20;
    if (cell.corner !== null && cell.corner !== piece.seatId) return -8;
    return 0;
  }

  blockedOwnTargetPenalty(board, player, toCellId) {
    const cell = board.getCellById(toCellId);
    if (!cell || !player.targetCells.includes(toCellId)) return 0;
    return cell.piece && cell.piece.playerId !== player.id ? 30 : 0;
  }
}
