class Board {
  constructor(canvasSize = CONFIG.CANVAS_SIZE, hexSize = CONFIG.HEX_SIZE) {
    this.canvasSize = canvasSize;
    this.hexSize = hexSize;
    this.cells = BOARD_DATA.cells.map((cell) => ({
      ...cell,
      piece: null
    }));
    this.cellById = new Map(this.cells.map((cell) => [cell.id, cell]));
    this.cellByCoord = new Map(this.cells.map((cell) => [coordKey(cell.q, cell.r), cell]));
    this.offset = this.calculateOffset();
  }

  resetPieces() {
    this.cells.forEach((cell) => {
      cell.piece = null;
    });
  }

  calculateOffset() {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    this.cells.forEach((cell) => {
      const point = this.hexToPixelRaw(cell.q, cell.r);
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    });

    return {
      x: (this.canvasSize - (maxX - minX)) / 2 - minX,
      y: (this.canvasSize - (maxY - minY)) / 2 - minY
    };
  }

  getCellById(id) {
    return this.cellById.get(id) || null;
  }

  getCell(q, r) {
    return this.cellByCoord.get(coordKey(q, r)) || null;
  }

  isValid(q, r) {
    return this.cellByCoord.has(coordKey(q, r));
  }

  isEmpty(q, r) {
    const cell = this.getCell(q, r);
    return Boolean(cell && !cell.piece);
  }

  placePiece(piece) {
    const cell = this.getCellById(piece.cellId);
    if (cell) cell.piece = piece;
  }

  movePiece(piece, toCellId) {
    const from = this.getCellById(piece.cellId);
    const to = this.getCellById(toCellId);
    if (!to || to.piece) return false;
    if (from) from.piece = null;
    to.piece = piece;
    piece.cellId = toCellId;
    return true;
  }

  getNeighbors(cellId) {
    const cell = this.getCellById(cellId);
    if (!cell) return [];

    return BOARD_DATA.directions
      .map(([dq, dr]) => this.getCell(cell.q + dq, cell.r + dr))
      .filter(Boolean);
  }

  getSimpleMoves(cellId) {
    return this.getNeighbors(cellId)
      .filter((cell) => !cell.piece)
      .map((cell) => ({
        type: 'move',
        cellId: cell.id,
        path: [cellId, cell.id]
      }));
  }

  getJumpMoves(cellId, visited = new Set([cellId])) {
    const cell = this.getCellById(cellId);
    if (!cell) return [];

    const moves = [];
    BOARD_DATA.directions.forEach(([dq, dr]) => {
      const middle = this.getCell(cell.q + dq, cell.r + dr);
      const target = this.getCell(cell.q + dq * 2, cell.r + dr * 2);

      if (middle && middle.piece && target && !target.piece && !visited.has(target.id)) {
        moves.push({
          type: 'jump',
          cellId: target.id,
          via: middle.id,
          path: [cellId, target.id]
        });
      }
    });

    return moves;
  }

  getAllJumpMoves(cellId, visited = new Set([cellId]), path = [cellId]) {
    const direct = this.getJumpMoves(cellId, visited);
    const results = [];

    direct.forEach((move) => {
      const nextVisited = new Set(visited);
      nextVisited.add(move.cellId);
      const nextPath = [...path, move.cellId];
      results.push({ ...move, path: nextPath });
      this.getAllJumpMoves(move.cellId, nextVisited, nextPath).forEach((item) => {
        results.push(item);
      });
    });

    return results;
  }

  getLegalMoves(cellId, jumpOnly = false) {
    const jumps = this.getJumpMoves(cellId);
    if (jumpOnly) return jumps;
    return [...this.getSimpleMoves(cellId), ...jumps];
  }

  hexToPixelRaw(q, r) {
    return {
      x: this.hexSize * Math.sqrt(3) * (q + r / 2),
      y: this.hexSize * 1.5 * r
    };
  }

  hexToPixel(q, r) {
    const point = this.hexToPixelRaw(q, r);
    return {
      x: point.x + this.offset.x,
      y: point.y + this.offset.y
    };
  }

  findCellAtPixel(x, y) {
    let closest = null;
    let closestDistance = this.hexSize * 0.85;

    this.cells.forEach((cell) => {
      const point = this.hexToPixel(cell.q, cell.r);
      const distance = Math.hypot(x - point.x, y - point.y);
      if (distance < closestDistance) {
        closest = cell;
        closestDistance = distance;
      }
    });

    return closest;
  }

  drawHex(ctx, x, y, radius, fill, stroke = '#52627a', lineWidth = 1) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = Math.PI / 180 * (60 * i + 30);
      const hx = x + radius * Math.cos(angle);
      const hy = y + radius * Math.sin(angle);
      if (i === 0) ctx.moveTo(hx, hy);
      else ctx.lineTo(hx, hy);
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }

  render(ctx, options = {}) {
    ctx.clearRect(0, 0, this.canvasSize, this.canvasSize);
    ctx.fillStyle = CONFIG.COLORS.BOARD_BG;
    ctx.fillRect(0, 0, this.canvasSize, this.canvasSize);

    this.cells.forEach((cell) => {
      const point = this.hexToPixel(cell.q, cell.r);
      const corner = cell.corner === null ? null : BOARD_DATA.corners[cell.corner];
      const fill = corner ? `${corner.color}33` : '#24364d';
      const stroke = corner ? `${corner.color}` : '#41546f';
      this.drawHex(ctx, point.x, point.y, this.hexSize * 0.78, fill, stroke, 1);

      if (options.showIds) {
        ctx.fillStyle = '#8fa1b7';
        ctx.font = '8px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(cell.id, point.x, point.y + this.hexSize * 0.62);
      }
    });
  }
}
