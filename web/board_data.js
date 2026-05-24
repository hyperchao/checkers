// 欢乐跳棋 121 格棋盘数据
// 坐标系统: axial (q, r)
// 编号: 中央 1-61，角区按 seatId 0-5 依次为 62-121。

const BOARD_DATA = {
  center: [],
  corners: [
    {
      id: 0,
      name: '角0',
      label: '右上外角',
      targetCorner: 3,
      color: '#c0392b',
      cells: [
        [4, -8],
        [3, -7], [4, -7],
        [2, -6], [3, -6], [4, -6],
        [1, -5], [2, -5], [3, -5], [4, -5]
      ]
    },
    {
      id: 1,
      name: '角1',
      label: '右侧外角',
      targetCorner: 4,
      color: '#2980b9',
      cells: [
        [5, -1],
        [5, -2], [6, -2],
        [5, -3], [6, -3], [7, -3],
        [5, -4], [6, -4], [7, -4], [8, -4]
      ]
    },
    {
      id: 2,
      name: '角2',
      label: '右下外角',
      targetCorner: 5,
      color: '#27ae60',
      cells: [
        [4, 1],
        [3, 2], [4, 2],
        [2, 3], [3, 3], [4, 3],
        [1, 4], [2, 4], [3, 4], [4, 4]
      ]
    },
    {
      id: 3,
      name: '角3',
      label: '左下外角',
      targetCorner: 0,
      color: '#f39c12',
      cells: [
        [-4, 5], [-3, 5], [-2, 5], [-1, 5],
        [-4, 6], [-3, 6], [-2, 6],
        [-4, 7], [-3, 7],
        [-4, 8]
      ]
    },
    {
      id: 4,
      name: '角4',
      label: '左侧外角',
      targetCorner: 1,
      color: '#8e44ad',
      cells: [
        [-5, 1],
        [-5, 2], [-6, 2],
        [-5, 3], [-6, 3], [-7, 3],
        [-5, 4], [-6, 4], [-7, 4], [-8, 4]
      ]
    },
    {
      id: 5,
      name: '角5',
      label: '左上外角',
      targetCorner: 2,
      color: '#16a085',
      cells: [
        [-4, -4], [-3, -4], [-2, -4], [-1, -4],
        [-4, -3], [-3, -3], [-2, -3],
        [-4, -2], [-3, -2],
        [-4, -1]
      ]
    }
  ],
  directions: [
    [1, 0], [1, -1], [0, -1],
    [-1, 0], [-1, 1], [0, 1]
  ],
  cells: []
};

function initBoardData() {
  BOARD_DATA.center.length = 0;
  BOARD_DATA.cells.length = 0;

  for (let q = -4; q <= 4; q++) {
    for (let r = -4; r <= 4; r++) {
      const s = -q - r;
      if (s >= -4 && s <= 4) {
        BOARD_DATA.center.push({ q, r });
      }
    }
  }

  BOARD_DATA.center.forEach((cell, index) => {
    BOARD_DATA.cells.push({
      id: index + 1,
      q: cell.q,
      r: cell.r,
      corner: null
    });
  });

  BOARD_DATA.corners.forEach((corner) => {
    corner.cells.forEach(([q, r], index) => {
      BOARD_DATA.cells.push({
        id: 62 + corner.id * 10 + index,
        q,
        r,
        corner: corner.id
      });
    });
  });
}

initBoardData();

function coordKey(q, r) {
  return `${q},${r}`;
}

function coordToId(q, r) {
  const cell = BOARD_DATA.cells.find((item) => item.q === q && item.r === r);
  return cell ? cell.id : -1;
}

function idToCoord(id) {
  const cell = BOARD_DATA.cells.find((item) => item.id === id);
  return cell ? { q: cell.q, r: cell.r, corner: cell.corner } : null;
}

function getCornerCells(cornerId) {
  return BOARD_DATA.cells.filter((cell) => cell.corner === cornerId);
}

function getTargetCorner(seatId) {
  return BOARD_DATA.corners[seatId].targetCorner;
}

function getSeatAssignments(controllerCount, seatsPerPlayer = 1) {
  const count = Number(controllerCount);
  const seats = Number(seatsPerPlayer);
  const patterns = {
    '2x1': [[0], [3]],
    '2x2': [[0, 1], [3, 4]],
    '2x3': [[0, 1, 2], [3, 4, 5]],
    '3x1': [[0], [2], [4]],
    '3x2': [[0, 1], [2, 3], [4, 5]],
    '4x1': [[0], [1], [3], [4]],
    '5x1': [[0], [1], [2], [3], [4]],
    '6x1': [[0], [1], [2], [3], [4], [5]]
  };
  const key = `${count}x${seats}`;
  if (patterns[key]) return patterns[key].map((item) => item.slice());

  const totalSeats = count * seats;
  if (count < 1 || seats < 1 || totalSeats > 6) {
    return patterns['2x1'].map((item) => item.slice());
  }

  const seatOrder = [0, 3, 1, 4, 2, 5];
  const assignments = Array.from({ length: count }, () => []);
  for (let round = 0; round < seats; round++) {
    for (let player = 0; player < count; player++) {
      assignments[player].push(seatOrder[round * count + player]);
    }
  }
  return assignments;
}
