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
    this.onDataChannelReady = options.onDataChannelReady || (() => {});

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
        console.log('WebSocket connected, readyState=', this.ws.readyState);
        this.setState('connected');
        resolve();
      };

      this.ws.onclose = (event) => {
        console.log('WebSocket disconnected, code=', event.code, 'reason=', event.reason, 'wasClean=', event.wasClean);
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
    if (this.roomCode && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendSignaling(NETWORK_MESSAGES.LEAVE_ROOM, {});
    }
    this.closeDataChannels();
    this.pendingCandidates.clear();
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      setTimeout(() => ws.close(), 50);
    }
    this.setState('disconnected');
  }

  handleMessage(data) {
    console.log('WebSocket raw message:', data.substring(0, 200));
    
    // Handle multiple messages separated by newlines
    const messages = data.split('\n').filter(line => line.trim());
    
    for (const msgData of messages) {
      const msg = deserializeMessage(msgData);
      if (!msg) continue;

      console.log('WebSocket received message:', msg.type, 'payload:', msg.payload);

      switch (msg.type) {
        case NETWORK_MESSAGES.ROOM_INFO:
          console.log('ROOM_INFO received, calling onRoomInfo');
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
          this.onError((msg.payload && msg.payload.message) || 'Unknown error');
          break;
      }
    }
  }

  sendSignaling(type, payload) {
    console.log('sendSignaling:', type, 'ws readyState:', this.ws ? this.ws.readyState : 'null');
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('WebSocket not connected, cannot send:', type);
      return;
    }
    const msg = createMessage(type, payload);
    console.log('sendSignaling: sending', JSON.stringify(msg).substring(0, 100));
    this.ws.send(serializeMessage(msg));
  }

  createRoom(config = {}) {
    console.log('createRoom called, ws state:', this.ws ? this.ws.readyState : 'no ws');
    this.mode = 'host';
    this.sendSignaling(NETWORK_MESSAGES.CREATE_ROOM, {
      playerCount: config.playerCount || 2,
      seatsPerPlayer: config.seatsPerPlayer || 1,
      maxPlayers: config.maxPlayers || 6
    });
  }

  joinRoom(roomCode) {
    this.mode = 'client';
    this.sendSignaling(NETWORK_MESSAGES.JOIN_ROOM, {
      roomCode: roomCode,
      playerId: this.peerId
    });
  }

  async createPeerConnection() {
    // Close existing peer connection if any
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
    this.pendingCandidates.clear();

    const config = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    };

    this.peerConnection = new RTCPeerConnection(config);

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate && this.roomCode) {
        const targetId = this.getTargetPeerId();
        if (!targetId) return;
        this.sendSignaling(NETWORK_MESSAGES.ICE_CANDIDATE, {
          roomCode: this.roomCode,
          targetId: targetId,
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

    this.peerConnection.ondatachannel = (event) => {
      const channel = event.channel;
      this.setupDataChannel(channel);
    };
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

  async setupWebRTC() {
    await this.createPeerConnection();

    if (this.mode === 'host') {
      const channel = this.peerConnection.createDataChannel('game', {
        ordered: true
      });
      this.setupDataChannel(channel);
    }
  }

  async sendSDPOffer(targetId) {
    console.log('sendSDPOffer to', targetId);
    if (!this.peerConnection) {
      await this.createPeerConnection();
    }

    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);

    this.sendSignaling(NETWORK_MESSAGES.SDP_OFFER, {
      roomCode: this.roomCode,
      targetId: targetId,
      sdp: JSON.stringify(offer),
      type: 'offer'
    });
    console.log('sendSDPOffer: sent offer to', targetId);
  }

  async handleSDPOffer(payload) {
    console.log('handleSDPOffer received from', payload.fromId);
    if (!this.peerConnection) {
      await this.createPeerConnection();
    }

    const sdp = JSON.parse(payload.sdp);
    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));

    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);

    console.log('handleSDPOffer: sending SDP answer to', payload.fromId);
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

  setupDataChannel(channel) {
    channel.onopen = () => {
      console.log('DataChannel opened:', channel.label, 'mode=', this.mode);
      this.dataChannels.set(channel.label, channel);
      this.flushMessageQueue();
      this.onDataChannelReady();
    };

    channel.onclose = () => {
      console.log('DataChannel closed:', channel.label);
      this.dataChannels.delete(channel.label);
    };

    channel.onmessage = (event) => {
      const msg = deserializeMessage(event.data);
      if (!msg) return;

      console.log('DataChannel received message:', msg.type, msg.payload);

      switch (msg.type) {
        case NETWORK_MESSAGES.GAME_MOVE:
          this.onGameMove(msg.payload);
          break;
        case NETWORK_MESSAGES.GAME_STATE:
          if (msg.payload && msg.payload.request) {
            this.onGameStateRequest && this.onGameStateRequest();
          } else {
            this.onGameState(msg.payload);
          }
          break;
        case NETWORK_MESSAGES.ROOM_START:
          this.onRoomStart();
          break;
        case NETWORK_MESSAGES.PLAYER_NAME:
          if (this.onPlayerNameUpdate) {
            this.onPlayerNameUpdate(msg.payload);
          }
          break;
      }
    };
  }

  async handleSDPAnswer(payload) {
    console.log('handleSDPAnswer received from', payload.fromId);
    if (!this.peerConnection) return;

    const sdp = JSON.parse(payload.sdp);
    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
    console.log('handleSDPAnswer: remote description set');

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
    console.log('broadcastToRoom: sending message type=', message.type, 'channels=', this.dataChannels.size);
    this.dataChannels.forEach((channel) => {
      if (channel.readyState === 'open') {
        channel.send(data);
      } else {
        console.log('broadcastToRoom: channel not open, state=', channel.readyState);
        this.messageQueue.push(data);
      }
    });
  }

  broadcastPlayerName(name) {
    this.broadcastToRoom(createMessage(NETWORK_MESSAGES.PLAYER_NAME, { name }));
  }

  sendToHost(message) {
    console.log('sendToHost called, dataChannels size=', this.dataChannels.size);
    if (this.dataChannels.size === 0) {
      console.log('sendToHost: no data channels, queuing message');
      this.messageQueue.push(serializeMessage(message));
      return;
    }
    const channel = this.dataChannels.values().next().value;
    if (channel.readyState === 'open') {
      console.log('sendToHost: sending via data channel');
      channel.send(serializeMessage(message));
    } else {
      console.log('sendToHost: channel not open, queuing message, state=', channel.readyState);
      this.messageQueue.push(serializeMessage(message));
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

  getTargetPeerId() {
    if (this.mode === 'host' && this.roomInfo && this.roomInfo.clientIds) {
      return this.roomInfo.clientIds[0] || null;
    }
    if (this.roomInfo) {
      return this.roomInfo.hostId || null;
    }
    return null;
  }

  get isConnected() {
    return this.connectionState === 'connected' && this.dataChannels.size > 0;
  }
}
