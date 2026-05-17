package main

import (
	"encoding/json"
	"testing"
)

func TestHandleCreateRoom(t *testing.T) {
	hub := NewHub(NewRoomManager())

	client := &Client{
		ID:   "host1",
		Send: make(chan []byte, 256),
	}
	hub.mu.Lock()
	hub.Clients["host1"] = client
	hub.mu.Unlock()

	payload := mustMarshal(CreateRoomPayload{
		PlayerCount:    2,
		SeatsPerPlayer: 1,
		MaxPlayers:     2,
	})

	hub.handleCreateRoom(client, payload)

	var msg Message
	select {
	case data := <-client.Send:
		if err := json.Unmarshal(data, &msg); err != nil {
			t.Fatalf("failed to unmarshal: %v", err)
		}
	default:
		t.Fatal("expected message to be sent")
	}

	if msg.Type != MsgRoomInfo {
		t.Errorf("expected type '%s', got '%s'", MsgRoomInfo, msg.Type)
	}

	var roomData map[string]interface{}
	json.Unmarshal(msg.Payload, &roomData)

	if roomData["hostId"] != "host1" {
		t.Errorf("expected hostId 'host1', got %v", roomData["hostId"])
	}
	if roomData["status"] != string(RoomWaiting) {
		t.Errorf("expected status 'waiting', got %v", roomData["status"])
	}
}

func TestHandleCreateRoomInvalidPayload(t *testing.T) {
	hub := NewHub(NewRoomManager())

	client := &Client{
		ID:   "host1",
		Send: make(chan []byte, 256),
	}
	hub.mu.Lock()
	hub.Clients["host1"] = client
	hub.mu.Unlock()

	hub.handleCreateRoom(client, json.RawMessage(`invalid`))

	var msg Message
	select {
	case data := <-client.Send:
		json.Unmarshal(data, &msg)
	default:
		t.Fatal("expected error message")
	}

	if msg.Type != MsgError {
		t.Errorf("expected error message, got '%s'", msg.Type)
	}
}

func TestHandleJoinRoom(t *testing.T) {
	hub := NewHub(NewRoomManager())

	hostClient := &Client{
		ID:   "host1",
		Send: make(chan []byte, 256),
	}
	hub.mu.Lock()
	hub.Clients["host1"] = hostClient
	hub.mu.Unlock()

	room := hub.Rooms.CreateRoom("host1", RoomConfig{MaxPlayers: 3})

	clientClient := &Client{
		ID:   "client1",
		Send: make(chan []byte, 256),
	}
	hub.mu.Lock()
	hub.Clients["client1"] = clientClient
	hub.mu.Unlock()

	payload := mustMarshal(JoinRoomPayload{
		RoomCode: room.Code,
		PlayerID: "client1",
	})

	hub.handleJoinRoom(clientClient, payload)

	var msg Message
	select {
	case data := <-clientClient.Send:
		json.Unmarshal(data, &msg)
	default:
		t.Fatal("expected message to client")
	}

	if msg.Type != MsgRoomInfo {
		t.Errorf("expected type '%s', got '%s'", MsgRoomInfo, msg.Type)
	}

	var roomData map[string]interface{}
	json.Unmarshal(msg.Payload, &roomData)
	if int(roomData["playerCount"].(float64)) != 2 {
		t.Errorf("expected 2 players, got %v", roomData["playerCount"])
	}
}

func TestHandleJoinRoomNotFound(t *testing.T) {
	hub := NewHub(NewRoomManager())

	client := &Client{
		ID:   "client1",
		Send: make(chan []byte, 256),
	}
	hub.mu.Lock()
	hub.Clients["client1"] = client
	hub.mu.Unlock()

	payload := mustMarshal(JoinRoomPayload{
		RoomCode: "NONEXIST",
		PlayerID: "client1",
	})

	hub.handleJoinRoom(client, payload)

	var msg Message
	select {
	case data := <-client.Send:
		json.Unmarshal(data, &msg)
	default:
		t.Fatal("expected error message")
	}

	if msg.Type != MsgError {
		t.Errorf("expected error, got '%s'", msg.Type)
	}
}

func TestHandleJoinRoomAlreadyPlaying(t *testing.T) {
	hub := NewHub(NewRoomManager())

	hostClient := &Client{
		ID:   "host1",
		Send: make(chan []byte, 256),
	}
	hub.mu.Lock()
	hub.Clients["host1"] = hostClient
	hub.mu.Unlock()

	room := hub.Rooms.CreateRoom("host1", RoomConfig{MaxPlayers: 2})
	room.Start()

	clientClient := &Client{
		ID:   "client1",
		Send: make(chan []byte, 256),
	}
	hub.mu.Lock()
	hub.Clients["client1"] = clientClient
	hub.mu.Unlock()

	payload := mustMarshal(JoinRoomPayload{
		RoomCode: room.Code,
		PlayerID: "client1",
	})

	hub.handleJoinRoom(clientClient, payload)

	var msg Message
	select {
	case data := <-clientClient.Send:
		json.Unmarshal(data, &msg)
	default:
		t.Fatal("expected error message")
	}

	if msg.Type != MsgError {
		t.Errorf("expected error, got '%s'", msg.Type)
	}
}

func TestHandleSDPOffer(t *testing.T) {
	hub := NewHub(NewRoomManager())

	hostClient := &Client{
		ID:   "host1",
		Send: make(chan []byte, 256),
	}
	clientClient := &Client{
		ID:   "client1",
		Send: make(chan []byte, 256),
	}
	hub.mu.Lock()
	hub.Clients["host1"] = hostClient
	hub.Clients["client1"] = clientClient
	hub.mu.Unlock()

	payload := mustMarshal(SDPPayload{
		RoomCode: "ABC123",
		TargetID: "client1",
		SDP:      `{"type":"offer","sdp":"test"}`,
		Type:     "offer",
	})

	hub.handleSDPOffer(hostClient, payload)

	var msg Message
	select {
	case data := <-clientClient.Send:
		json.Unmarshal(data, &msg)
	default:
		t.Fatal("expected SDP offer to be forwarded")
	}

	if msg.Type != MsgSDPOffer {
		t.Errorf("expected type '%s', got '%s'", MsgSDPOffer, msg.Type)
	}
}

func TestHandleSDPAnswer(t *testing.T) {
	hub := NewHub(NewRoomManager())

	hostClient := &Client{
		ID:   "host1",
		Send: make(chan []byte, 256),
	}
	clientClient := &Client{
		ID:   "client1",
		Send: make(chan []byte, 256),
	}
	hub.mu.Lock()
	hub.Clients["host1"] = hostClient
	hub.Clients["client1"] = clientClient
	hub.mu.Unlock()

	payload := mustMarshal(SDPPayload{
		RoomCode: "ABC123",
		TargetID: "host1",
		SDP:      `{"type":"answer","sdp":"test"}`,
		Type:     "answer",
	})

	hub.handleSDPAnswer(clientClient, payload)

	var msg Message
	select {
	case data := <-hostClient.Send:
		json.Unmarshal(data, &msg)
	default:
		t.Fatal("expected SDP answer to be forwarded")
	}

	if msg.Type != MsgSDPAnswer {
		t.Errorf("expected type '%s', got '%s'", MsgSDPAnswer, msg.Type)
	}
}

func TestHandleICECandidate(t *testing.T) {
	hub := NewHub(NewRoomManager())

	hostClient := &Client{
		ID:   "host1",
		Send: make(chan []byte, 256),
	}
	clientClient := &Client{
		ID:   "client1",
		Send: make(chan []byte, 256),
	}
	hub.mu.Lock()
	hub.Clients["host1"] = hostClient
	hub.Clients["client1"] = clientClient
	hub.mu.Unlock()

	payload := mustMarshal(ICEPayload{
		RoomCode:  "ABC123",
		TargetID:  "host1",
		Candidate: `{"candidate":"test"}`,
	})

	hub.handleICECandidate(clientClient, payload)

	var msg Message
	select {
	case data := <-hostClient.Send:
		json.Unmarshal(data, &msg)
	default:
		t.Fatal("expected ICE candidate to be forwarded")
	}

	if msg.Type != MsgICECandidate {
		t.Errorf("expected type '%s', got '%s'", MsgICECandidate, msg.Type)
	}
}

func TestHandleLeaveRoom(t *testing.T) {
	hub := NewHub(NewRoomManager())

	room := hub.Rooms.CreateRoom("host1", RoomConfig{MaxPlayers: 3})
	_ = room.AddClient("client1")

	hostClient := &Client{
		ID:       "host1",
		Send:     make(chan []byte, 256),
		RoomCode: room.Code,
	}
	clientClient := &Client{
		ID:       "client1",
		Send:     make(chan []byte, 256),
		RoomCode: room.Code,
	}
	hub.mu.Lock()
	hub.Clients["host1"] = hostClient
	hub.Clients["client1"] = clientClient
	hub.mu.Unlock()

	hub.handleLeaveRoom(clientClient)

	_, exists := hub.Rooms.GetRoom(room.Code)
	if !exists {
		t.Fatal("expected room to still exist after client leaves")
	}

	if room.PlayerCount() != 1 {
		t.Errorf("expected 1 player (host), got %d", room.PlayerCount())
	}

	var msg Message
	select {
	case data := <-hostClient.Send:
		json.Unmarshal(data, &msg)
	default:
		t.Fatal("expected host to receive room update")
	}

	if msg.Type != MsgRoomInfo {
		t.Errorf("expected type '%s', got '%s'", MsgRoomInfo, msg.Type)
	}
}

func TestHandleLeaveRoomHost(t *testing.T) {
	hub := NewHub(NewRoomManager())

	room := hub.Rooms.CreateRoom("host1", RoomConfig{MaxPlayers: 3})
	_ = room.AddClient("client1")

	hostClient := &Client{
		ID:       "host1",
		Send:     make(chan []byte, 256),
		RoomCode: room.Code,
	}
	clientClient := &Client{
		ID:       "client1",
		Send:     make(chan []byte, 256),
		RoomCode: room.Code,
	}
	hub.mu.Lock()
	hub.Clients["host1"] = hostClient
	hub.Clients["client1"] = clientClient
	hub.mu.Unlock()

	hub.handleLeaveRoom(hostClient)

	_, exists := hub.Rooms.GetRoom(room.Code)
	if exists {
		t.Fatal("expected room to be removed when host leaves")
	}

	var msg Message
	select {
	case data := <-clientClient.Send:
		json.Unmarshal(data, &msg)
	default:
		t.Fatal("expected client to receive error")
	}

	if msg.Type != MsgError {
		t.Errorf("expected error message, got '%s'", msg.Type)
	}
}
