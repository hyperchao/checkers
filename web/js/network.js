class NetworkManager {
  constructor(options = {}) {
    this.mode = options.mode || null;
    this.wsUrl = options.wsUrl || `ws://${window.location.host}/ws`;
    this.ws = null;
    this.peerId = options.peerId || this.generatePeerId();
    this.roomCode = null;
    this.roomInfo = null;

    this.peerConnection = null;
    this.peerConnections = new Map();
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
    this.closePeerConnections();
    this.pendingCandidates.clear();
    this.messageQueue = [];
    if (this.ws) {
      const ws = this.ws;
      ws.onopen = null;
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
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
          if (msg.payload && msg.payload.code) {
            this.roomInfo = msg.payload;
            this.roomCode = msg.payload.code;
            this.onRoomInfo(msg.payload);
          }
          this.onRoomStart(msg.payload);
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

  getHostPeerId() {
    return this.roomInfo ? this.roomInfo.hostId : null;
  }

  async createPeerConnection(peerId = this.getTargetPeerId()) {
    if (!peerId) return null;

    const existing = this.peerConnections.get(peerId);
    if (existing) {
      return existing;
    }

    const config = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    };

    const peerConnection = new RTCPeerConnection(config);
    this.peerConnections.set(peerId, peerConnection);
    if (!this.peerConnection) this.peerConnection = peerConnection;

    peerConnection.onicecandidate = (event) => {
      if (event.candidate && this.roomCode) {
        this.sendSignaling(NETWORK_MESSAGES.ICE_CANDIDATE, {
          roomCode: this.roomCode,
          targetId: peerId,
          candidate: JSON.stringify(event.candidate)
        });
      }
    };

    peerConnection.onconnectionstatechange = () => {
      console.log('PeerConnection state:', peerId, peerConnection.connectionState);
      if (peerConnection.connectionState === 'disconnected' ||
          peerConnection.connectionState === 'failed') {
        this.onDisconnected();
      }
    };

    peerConnection.ondatachannel = (event) => {
      const channel = event.channel;
      this.setupDataChannel(channel, peerId);
    };

    return peerConnection;
  }

  async createDataChannel(label, peerId = this.getTargetPeerId()) {
    const peerConnection = await this.createPeerConnection(peerId);
    if (!peerConnection) return null;

    const channel = peerConnection.createDataChannel(label, {
      ordered: true
    });

    this.setupDataChannel(channel, peerId);
    return channel;
  }

  async setupWebRTC() {
    if (this.mode === 'client') {
      await this.createPeerConnection(this.getHostPeerId());
    }
  }

  async sendSDPOffer(targetId) {
    console.log('sendSDPOffer to', targetId);
    const peerConnection = await this.createPeerConnection(targetId);
    if (!peerConnection) return;

    if (!this.dataChannels.has(targetId)) {
      await this.createDataChannel('game', targetId);
    }

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

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
    const peerConnection = await this.createPeerConnection(payload.fromId);
    if (!peerConnection) return;

    const sdp = JSON.parse(payload.sdp);
    await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));

    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

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
        await peerConnection.addIceCandidate(new RTCIceCandidate(JSON.parse(candidate)));
      }
      this.pendingCandidates.delete(payload.fromId);
    }
  }

  setupDataChannel(channel, peerId = this.getTargetPeerId()) {
    channel.onopen = () => {
      console.log('DataChannel opened:', channel.label, 'peer=', peerId, 'mode=', this.mode);
      this.dataChannels.set(peerId || channel.label, channel);
      this.flushMessageQueue(peerId);
      this.onDataChannelReady(peerId);
    };

    channel.onclose = () => {
      console.log('DataChannel closed:', channel.label, 'peer=', peerId);
      this.dataChannels.delete(peerId || channel.label);
    };

    channel.onmessage = (event) => {
      const msg = deserializeMessage(event.data);
      if (!msg) return;

      console.log('DataChannel received message:', msg.type, msg.payload);

      switch (msg.type) {
        case NETWORK_MESSAGES.GAME_MOVE:
          this.onGameMove({ ...msg.payload, fromPeerId: peerId });
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
            this.onPlayerNameUpdate({ ...msg.payload, fromPeerId: peerId });
          }
          break;
      }
    };
  }

  async handleSDPAnswer(payload) {
    console.log('handleSDPAnswer received from', payload.fromId);
    const peerConnection = this.peerConnections.get(payload.fromId);
    if (!peerConnection) return;

    const sdp = JSON.parse(payload.sdp);
    await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
    console.log('handleSDPAnswer: remote description set');

    if (this.pendingCandidates.has(payload.fromId)) {
      const candidates = this.pendingCandidates.get(payload.fromId);
      for (const candidate of candidates) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(JSON.parse(candidate)));
      }
      this.pendingCandidates.delete(payload.fromId);
    }
  }

  async handleICECandidate(payload) {
    const peerConnection = this.peerConnections.get(payload.fromId);
    if (peerConnection && peerConnection.remoteDescription) {
      try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(JSON.parse(payload.candidate)));
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
    this.dataChannels.forEach((channel, peerId) => {
      if (channel.readyState === 'open') {
        channel.send(data);
      } else {
        console.log('broadcastToRoom: channel not open, state=', channel.readyState);
        this.messageQueue.push({ peerId, data });
      }
    });
  }

  broadcastPlayerName(payload) {
    this.broadcastToRoom(createMessage(NETWORK_MESSAGES.PLAYER_NAME, payload));
  }

  sendToHost(message) {
    console.log('sendToHost called, dataChannels size=', this.dataChannels.size);
    const hostId = this.getHostPeerId();
    const channel = this.dataChannels.get(hostId) || this.dataChannels.values().next().value;
    if (!channel) {
      console.log('sendToHost: no data channels, queuing message');
      this.messageQueue.push({ peerId: hostId, data: serializeMessage(message) });
      return;
    }
    if (channel.readyState === 'open') {
      console.log('sendToHost: sending via data channel');
      channel.send(serializeMessage(message));
    } else {
      console.log('sendToHost: channel not open, queuing message, state=', channel.readyState);
      this.messageQueue.push({ peerId: hostId, data: serializeMessage(message) });
    }
  }

  flushMessageQueue(openedPeerId = null) {
    this.messageQueue = this.messageQueue.filter((item) => {
      if (item.peerId && openedPeerId && item.peerId !== openedPeerId) return true;
      const channel = item.peerId ? this.dataChannels.get(item.peerId) : null;
      if (channel && channel.readyState === 'open') {
        channel.send(item.data);
        return false;
      }
      if (!item.peerId) {
        let sent = false;
        this.dataChannels.forEach((candidate) => {
          if (candidate.readyState === 'open') {
            candidate.send(item.data);
            sent = true;
          }
        });
        return !sent;
      }
      return true;
    });
  }

  closeDataChannels() {
    this.dataChannels.forEach((channel) => {
      channel.onopen = null;
      channel.onclose = null;
      channel.onmessage = null;
      channel.close();
    });
    this.dataChannels.clear();
  }

  closePeerConnections() {
    this.peerConnections.forEach((peerConnection) => {
      peerConnection.onicecandidate = null;
      peerConnection.onconnectionstatechange = null;
      peerConnection.ondatachannel = null;
      peerConnection.close();
    });
    this.peerConnections.clear();
    this.peerConnection = null;
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

  isPeerConnected(peerId) {
    const channel = this.dataChannels.get(peerId);
    return Boolean(channel && channel.readyState === 'open');
  }

  get isConnected() {
    return this.connectionState === 'connected' && this.dataChannels.size > 0;
  }
}
