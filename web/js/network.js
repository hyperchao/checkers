class NetworkManager {
  constructor(options = {}) {
    this.mode = options.mode || null;
    this.wsUrl = options.wsUrl || `ws://${window.location.host}/ws`;
    this.ws = null;
    this.peerId = options.peerId || this.generatePeerId();
    this.roomCode = null;
    this.roomInfo = null;

    this.peerConnection = null;
    this.dataChannels = new Map();
    this.pendingCandidates = new Map();

    this.onStateChange = options.onStateChange || (() => {});
    this.onRoomInfo = options.onRoomInfo || (() => {});
    this.onError = options.onError || (() => {});
    this.onGameMove = options.onGameMove || (() => {});
    this.onGameState = options.onGameState || (() => {});
    this.onRoomStart = options.onRoomStart || (() => {});
    this.onDisconnected = options.onDisconnected || (() => {});

    this.connectionState = 'disconnected';
    this.messageQueue = [];
  }

  generatePeerId() {
    return 'p_' + Math.random().toString(36).substring(2, 10);
  }

  setState(state) {
    this.connectionState = state;
    this.onStateChange(state);
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.setState('connecting');

      this.ws = new WebSocket(`${this.wsUrl}?id=${this.peerId}`);

      this.ws.onopen = () => {
        console.log('WebSocket connected');
        this.setState('connected');
        resolve();
      };

      this.ws.onclose = () => {
        console.log('WebSocket disconnected');
        this.setState('disconnected');
        this.onDisconnected();
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.setState('error');
        reject(error);
      };

      this.ws.onmessage = (event) => this.handleMessage(event.data);
    });
  }

  disconnect() {
    if (this.roomCode) {
      this.sendSignaling(NETWORK_MESSAGES.LEAVE_ROOM, {});
    }
    this.closeDataChannels();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setState('disconnected');
  }

  handleMessage(data) {
    const msg = deserializeMessage(data);
    if (!msg) return;

    switch (msg.type) {
      case NETWORK_MESSAGES.ROOM_INFO:
        this.roomInfo = msg.payload;
        this.roomCode = msg.payload.code;
        this.onRoomInfo(msg.payload);
        break;

      case NETWORK_MESSAGES.SDP_OFFER:
        this.handleSDPOffer(msg.payload);
        break;

      case NETWORK_MESSAGES.SDP_ANSWER:
        this.handleSDPAnswer(msg.payload);
        break;

      case NETWORK_MESSAGES.ICE_CANDIDATE:
        this.handleICECandidate(msg.payload);
        break;

      case NETWORK_MESSAGES.ROOM_START:
        this.onRoomStart();
        break;

      case NETWORK_MESSAGES.GAME_MOVE:
        this.onGameMove(msg.payload);
        break;

      case NETWORK_MESSAGES.GAME_STATE:
        this.onGameState(msg.payload);
        break;

      case NETWORK_MESSAGES.ERROR:
        this.onError(msg.payload.message || 'Unknown error');
        break;
    }
  }

  sendSignaling(type, payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('WebSocket not connected, cannot send:', type);
      return;
    }
    const msg = createMessage(type, payload);
    this.ws.send(serializeMessage(msg));
  }

  async createRoom(config = {}) {
    this.mode = 'host';
    this.sendSignaling(NETWORK_MESSAGES.CREATE_ROOM, {
      playerCount: config.playerCount || 2,
      seatsPerPlayer: config.seatsPerPlayer || 1,
      maxPlayers: config.maxPlayers || 6
    });
  }

  async joinRoom(roomCode) {
    this.mode = 'client';
    this.sendSignaling(NETWORK_MESSAGES.JOIN_ROOM, {
      roomCode: roomCode,
      playerId: this.peerId
    });
  }

  async createPeerConnection() {
    const config = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    };

    this.peerConnection = new RTCPeerConnection(config);

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate && this.roomCode) {
        this.sendSignaling(NETWORK_MESSAGES.ICE_CANDIDATE, {
          roomCode: this.roomCode,
          targetId: this.mode === 'host' ? this.getClientId() : this.roomInfo.hostId,
          candidate: JSON.stringify(event.candidate)
        });
      }
    };

    this.peerConnection.onconnectionstatechange = () => {
      console.log('PeerConnection state:', this.peerConnection.connectionState);
      if (this.peerConnection.connectionState === 'disconnected' ||
          this.peerConnection.connectionState === 'failed') {
        this.onDisconnected();
      }
    };

    if (this.mode === 'host') {
      this.peerConnection.ondatachannel = (event) => {
        const channel = event.channel;
        this.setupDataChannel(channel);
      };
    }
  }

  async createDataChannel(label) {
    if (!this.peerConnection) {
      await this.createPeerConnection();
    }

    const channel = this.peerConnection.createDataChannel(label, {
      ordered: true
    });

    this.setupDataChannel(channel);
    return channel;
  }

  setupDataChannel(channel) {
    channel.onopen = () => {
      console.log('DataChannel opened:', channel.label);
      this.dataChannels.set(channel.label, channel);
      this.flushMessageQueue();
    };

    channel.onclose = () => {
      console.log('DataChannel closed:', channel.label);
      this.dataChannels.delete(channel.label);
    };

    channel.onmessage = (event) => {
      const msg = deserializeMessage(event.data);
      if (!msg) return;

      switch (msg.type) {
        case NETWORK_MESSAGES.GAME_MOVE:
          this.onGameMove(msg.payload);
          break;
        case NETWORK_MESSAGES.GAME_STATE:
          this.onGameState(msg.payload);
          break;
      }
    };
  }

  async handleSDPOffer(payload) {
    if (!this.peerConnection) {
      await this.createPeerConnection();
    }

    const sdp = JSON.parse(payload.sdp);
    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));

    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);

    this.sendSignaling(NETWORK_MESSAGES.SDP_ANSWER, {
      roomCode: this.roomCode,
      targetId: payload.fromId,
      sdp: JSON.stringify(answer),
      type: 'answer'
    });

    if (this.pendingCandidates.has(payload.fromId)) {
      const candidates = this.pendingCandidates.get(payload.fromId);
      for (const candidate of candidates) {
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(JSON.parse(candidate)));
      }
      this.pendingCandidates.delete(payload.fromId);
    }
  }

  async handleSDPAnswer(payload) {
    if (!this.peerConnection) return;

    const sdp = JSON.parse(payload.sdp);
    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));

    if (this.pendingCandidates.has(payload.fromId)) {
      const candidates = this.pendingCandidates.get(payload.fromId);
      for (const candidate of candidates) {
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(JSON.parse(candidate)));
      }
      this.pendingCandidates.delete(payload.fromId);
    }
  }

  async handleICECandidate(payload) {
    if (this.peerConnection && this.peerConnection.remoteDescription) {
      try {
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(JSON.parse(payload.candidate)));
      } catch (e) {
        console.warn('Failed to add ICE candidate:', e);
      }
    } else {
      if (!this.pendingCandidates.has(payload.fromId)) {
        this.pendingCandidates.set(payload.fromId, []);
      }
      this.pendingCandidates.get(payload.fromId).push(payload.candidate);
    }
  }

  broadcastToRoom(message) {
    const data = serializeMessage(message);
    this.dataChannels.forEach((channel) => {
      if (channel.readyState === 'open') {
        channel.send(data);
      } else {
        this.messageQueue.push(data);
      }
    });
  }

  sendToHost(message) {
    if (this.dataChannels.size === 0) {
      this.messageQueue.push(serializeMessage(message));
      return;
    }
    const channel = this.dataChannels.values().next().value;
    if (channel.readyState === 'open') {
      channel.send(serializeMessage(message));
    }
  }

  flushMessageQueue() {
    while (this.messageQueue.length > 0) {
      const data = this.messageQueue.shift();
      this.dataChannels.forEach((channel) => {
        if (channel.readyState === 'open') {
          channel.send(data);
        }
      });
    }
  }

  closeDataChannels() {
    this.dataChannels.forEach((channel) => {
      channel.close();
    });
    this.dataChannels.clear();
  }

  getClientId() {
    if (this.dataChannels.size > 0) {
      return this.dataChannels.keys().next().value;
    }
    return null;
  }

  get isConnected() {
    return this.connectionState === 'connected' && this.dataChannels.size > 0;
  }
}
