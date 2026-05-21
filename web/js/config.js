const CONFIG = {
  HEX_SIZE: 22,
  CANVAS_SIZE: 700,
  AI_THINK_DELAY: 450,
  COLORS: {
    PLAYERS: ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c'],
    BOARD_BG: '#f0f4f8',
    CENTER_CELL: '#e2e8f0',
    MOVE: '#37d67a',
    JUMP: '#ffd166',
    SELECTED: '#667eea',
    CELL_TEXT: '#718096',
    CELL_STROKE: '#cbd5e0'
  },
  DARK_COLORS: {
    BOARD_BG: '#172033',
    CENTER_CELL: '#24364d',
    MOVE: '#37d67a',
    JUMP: '#ffd166',
    SELECTED: '#4ecdc4',
    CELL_TEXT: '#8fa1b7',
    CELL_STROKE: '#41546f'
  },
  END_CONDITION: {
    FIRST_FINISHED: 'FIRST_FINISHED',
    ALL_FINISHED: 'ALL_FINISHED'
  },
  NETWORK: {
    WS_URL: null,
    STATE_SYNC_THROTTLE: 100
  }
};
