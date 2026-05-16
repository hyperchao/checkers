class Piece {
  constructor(id, playerId, seatId, cellId) {
    this.id = id;
    this.playerId = playerId;
    this.seatId = seatId;
    this.cellId = cellId;
  }

  get targetCorner() {
    return getTargetCorner(this.seatId);
  }
}

function renderPiece(ctx, piece, board, player, isSelected = false) {
  const cell = board.getCellById(piece.cellId);
  if (!cell) return;

  const point = board.hexToPixel(cell.q, cell.r);
  const radius = CONFIG.HEX_SIZE * 0.55;

  const pieceColor = BOARD_DATA.corners[piece.seatId].color;

  ctx.beginPath();
  ctx.arc(point.x + 2, point.y + 3, radius, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = pieceColor;
  ctx.fill();
  ctx.strokeStyle = isSelected ? CONFIG.COLORS.SELECTED : '#f8fafc';
  ctx.lineWidth = isSelected ? 4 : 2;
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(player.id + 1), point.x, point.y);

  if (cell.corner === piece.targetCorner) {
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius * 0.28, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.fill();
  }
}
