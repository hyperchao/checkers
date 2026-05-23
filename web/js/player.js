class Player {
  constructor(id, seats, isAI = false, difficulty = 'medium', isRemote = false) {
    this.id = id;
    this.seats = seats;
    this.isAI = isAI;
    this.difficulty = difficulty;
    this.isRemote = isRemote;
    this.color = CONFIG.COLORS.PLAYERS[id % CONFIG.COLORS.PLAYERS.length];
    this.pieces = [];
    const savedName = Player.getSavedName();
    this.name = savedName || `${isAI ? 'AI' : '玩家'}${id + 1}`;
  }

  static getSavedName() {
    return localStorage.getItem('playerName') || null;
  }

  static setName(name) {
    localStorage.setItem('playerName', name);
  }

  setName(name) {
    this.name = name;
    Player.setName(name);
  }

  addPiece(piece) {
    this.pieces.push(piece);
  }

  ownsPiece(piece) {
    return Boolean(piece && piece.playerId === this.id);
  }

  get targetCells() {
    return this.seats.flatMap((seatId) => getCornerCells(getTargetCorner(seatId)).map((cell) => cell.id));
  }

  get isFinished() {
    return this.pieces.length > 0 && this.pieces.every((piece) => {
      const cell = idToCoord(piece.cellId);
      return cell && cell.corner === piece.targetCorner;
    });
  }

  get finishedCount() {
    return this.pieces.filter((piece) => {
      const cell = idToCoord(piece.cellId);
      return cell && cell.corner === piece.targetCorner;
    }).length;
  }
}
