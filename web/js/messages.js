const NETWORK_MESSAGES = {
  CREATE_ROOM: 'create_room',
  JOIN_ROOM: 'join_room',
  ROOM_INFO: 'room_info',
  SDP_OFFER: 'sdp_offer',
  SDP_ANSWER: 'sdp_answer',
  ICE_CANDIDATE: 'ice_candidate',
  ROOM_FULL: 'room_full',
  ROOM_START: 'room_start',
  LEAVE_ROOM: 'leave_room',
  ERROR: 'error',
  PONG: 'pong',
  GAME_MOVE: 'game_move',
  GAME_STATE: 'game_state',
  GAME_CHAT: 'game_chat'
};

function createMessage(type, payload = {}) {
  return {
    type: type,
    payload: payload
  };
}

function serializeMessage(msg) {
  return JSON.stringify(msg);
}

function deserializeMessage(data) {
  try {
    return JSON.parse(data);
  } catch (e) {
    console.error('Failed to deserialize message:', e);
    return null;
  }
}
