package main

import (
	"encoding/json"
	"testing"
)

func TestNewHub(t *testing.T) {
	rm := NewRoomManager()
	hub := NewHub(rm)

	if hub.Clients == nil {
		t.Error("expected Clients map to be initialized")
	}
	if hub.Rooms != rm {
		t.Error("expected Rooms to be set")
	}
}

func TestHubRegisterClient(t *testing.T) {
	hub := NewHub(NewRoomManager())

	go hub.Run()

	client := &Client{
		ID:   "test1",
		Send: make(chan []byte, 256),
	}

	hub.Register <- client

	hub.mu.RLock()
	_, exists := hub.Clients["test1"]
	hub.mu.RUnlock()

	if !exists {
		t.Fatal("expected client to be registered")
	}
}

func TestHubUnregisterClient(t *testing.T) {
	hub := NewHub(NewRoomManager())

	go hub.Run()

	client := &Client{
		ID:   "test1",
		Send: make(chan []byte, 256),
	}

	hub.Register <- client
	hub.Unregister <- client

	hub.mu.RLock()
	_, exists := hub.Clients["test1"]
	hub.mu.RUnlock()

	if exists {
		t.Fatal("expected client to be unregistered")
	}
}

func TestHubGetClient(t *testing.T) {
	hub := NewHub(NewRoomManager())

	client := &Client{ID: "test1"}
	hub.mu.Lock()
	hub.Clients["test1"] = client
	hub.mu.Unlock()

	found, ok := hub.GetClient("test1")
	if !ok {
		t.Fatal("expected client to exist")
	}
	if found.ID != "test1" {
		t.Errorf("expected ID 'test1', got '%s'", found.ID)
	}

	_, ok = hub.GetClient("nonexistent")
	if ok {
		t.Fatal("expected nonexistent client to not exist")
	}
}

func TestHubGetClientsInRoom(t *testing.T) {
	hub := NewHub(NewRoomManager())

	c1 := &Client{ID: "c1", RoomCode: "ABC123"}
	c2 := &Client{ID: "c2", RoomCode: "ABC123"}
	c3 := &Client{ID: "c3", RoomCode: "XYZ789"}

	hub.mu.Lock()
	hub.Clients["c1"] = c1
	hub.Clients["c2"] = c2
	hub.Clients["c3"] = c3
	hub.mu.Unlock()

	clients := hub.GetClientsInRoom("ABC123")
	if len(clients) != 2 {
		t.Errorf("expected 2 clients in room, got %d", len(clients))
	}

	clients = hub.GetClientsInRoom("NONEXIST")
	if len(clients) != 0 {
		t.Errorf("expected 0 clients, got %d", len(clients))
	}
}

func TestClientSetGetRoom(t *testing.T) {
	client := &Client{ID: "test1"}

	if client.GetRoom() != "" {
		t.Error("expected empty room initially")
	}

	client.SetRoom("ABC123")
	if client.GetRoom() != "ABC123" {
		t.Errorf("expected room 'ABC123', got '%s'", client.GetRoom())
	}
}

func TestClientSendMessage(t *testing.T) {
	client := &Client{
		ID:   "test1",
		Send: make(chan []byte, 256),
	}

	msg := Message{
		Type:    MsgPong,
		Payload: json.RawMessage(`{"test":true}`),
	}

	err := client.SendMessage(msg)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	data := <-client.Send
	var received Message
	if err := json.Unmarshal(data, &received); err != nil {
		t.Fatalf("failed to unmarshal message: %v", err)
	}

	if received.Type != MsgPong {
		t.Errorf("expected type '%s', got '%s'", MsgPong, received.Type)
	}
}

func TestHubSendToClient(t *testing.T) {
	hub := NewHub(NewRoomManager())

	client := &Client{
		ID:   "test1",
		Send: make(chan []byte, 256),
	}
	hub.mu.Lock()
	hub.Clients["test1"] = client
	hub.mu.Unlock()

	msg := Message{Type: MsgPong}
	err := hub.SendToClient("test1", msg)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	data := <-client.Send
	var received Message
	json.Unmarshal(data, &received)

	if received.Type != MsgPong {
		t.Errorf("expected type '%s', got '%s'", MsgPong, received.Type)
	}

	err = hub.SendToClient("nonexistent", msg)
	if err != nil {
		t.Fatalf("expected no error for nonexistent client, got %v", err)
	}
}

func TestHubBroadcastToRoom(t *testing.T) {
	hub := NewHub(NewRoomManager())

	c1 := &Client{ID: "c1", RoomCode: "ABC123", Send: make(chan []byte, 256)}
	c2 := &Client{ID: "c2", RoomCode: "ABC123", Send: make(chan []byte, 256)}
	c3 := &Client{ID: "c3", RoomCode: "ABC123", Send: make(chan []byte, 256)}

	hub.mu.Lock()
	hub.Clients["c1"] = c1
	hub.Clients["c2"] = c2
	hub.Clients["c3"] = c3
	hub.mu.Unlock()

	msg := Message{Type: MsgRoomInfo}
	hub.broadcastToRoom("ABC123", msg, "c1")

	if len(c1.Send) != 0 {
		t.Error("expected c1 to not receive (excluded)")
	}
	if len(c2.Send) != 1 {
		t.Errorf("expected c2 to receive 1 message, got %d", len(c2.Send))
	}
	if len(c3.Send) != 1 {
		t.Errorf("expected c3 to receive 1 message, got %d", len(c3.Send))
	}
}

func TestMessageMarshal(t *testing.T) {
	msg := Message{
		Type:    MsgCreateRoom,
		Payload: json.RawMessage(`{"playerCount":2}`),
	}

	data, err := json.Marshal(msg)
	if err != nil {
		t.Fatalf("failed to marshal: %v", err)
	}

	var received Message
	if err := json.Unmarshal(data, &received); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}

	if received.Type != MsgCreateRoom {
		t.Errorf("expected type '%s', got '%s'", MsgCreateRoom, received.Type)
	}
}

func TestMustMarshal(t *testing.T) {
	data := mustMarshal(map[string]string{"key": "value"})
	if string(data) != `{"key":"value"}` {
		t.Errorf("unexpected result: %s", string(data))
	}

	data = mustMarshal(nil)
	if string(data) != "null" {
		t.Errorf("unexpected result for nil: %s", string(data))
	}
}
