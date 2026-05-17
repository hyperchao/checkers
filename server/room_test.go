package main

import (
	"fmt"
	"sync"
	"testing"
)

func TestGenerateRoomCode(t *testing.T) {
	code := GenerateRoomCode()

	if len(code) != RoomCodeLength {
		t.Errorf("expected code length %d, got %d", RoomCodeLength, len(code))
	}

	for _, c := range code {
		found := false
		for _, valid := range RoomCodeChars {
			if c == valid {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("invalid character %c in code %s", c, code)
		}
	}
}

func TestGenerateRoomCodeUniqueness(t *testing.T) {
	codes := make(map[string]bool)
	iterations := 1000

	for i := 0; i < iterations; i++ {
		code := GenerateRoomCode()
		if codes[code] {
			t.Errorf("duplicate code generated: %s", code)
		}
		codes[code] = true
	}
}

func TestNewRoom(t *testing.T) {
	rm := NewRoomManager()
	config := RoomConfig{
		PlayerCount:    2,
		SeatsPerPlayer: 1,
		MaxPlayers:     2,
	}

	room := rm.CreateRoom("host1", config)

	if room == nil {
		t.Fatal("expected room to be created")
	}
	if room.Code == "" {
		t.Error("expected room code to be set")
	}
	if room.HostID != "host1" {
		t.Errorf("expected host ID 'host1', got '%s'", room.HostID)
	}
	if room.Status != RoomWaiting {
		t.Errorf("expected status 'waiting', got '%s'", room.Status)
	}
	if room.PlayerCount() != 1 {
		t.Errorf("expected 1 player (host), got %d", room.PlayerCount())
	}
}

func TestRoomAddClient(t *testing.T) {
	rm := NewRoomManager()
	room := rm.CreateRoom("host1", RoomConfig{MaxPlayers: 3})

	err := room.AddClient("client1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if room.PlayerCount() != 2 {
		t.Errorf("expected 2 players, got %d", room.PlayerCount())
	}

	err = room.AddClient("client2")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if room.PlayerCount() != 3 {
		t.Errorf("expected 3 players, got %d", room.PlayerCount())
	}
	if room.Status != RoomFull {
		t.Errorf("expected status 'full', got '%s'", room.Status)
	}
}

func TestRoomAddClientToFullRoom(t *testing.T) {
	rm := NewRoomManager()
	room := rm.CreateRoom("host1", RoomConfig{MaxPlayers: 2})

	_ = room.AddClient("client1")

	err := room.AddClient("client2")
	if err == nil {
		t.Fatal("expected error when adding to full room")
	}
}

func TestRoomAddDuplicateClient(t *testing.T) {
	rm := NewRoomManager()
	room := rm.CreateRoom("host1", RoomConfig{MaxPlayers: 3})

	_ = room.AddClient("client1")
	err := room.AddClient("client1")

	if err == nil {
		t.Fatal("expected error when adding duplicate client")
	}
}

func TestRoomRemoveClient(t *testing.T) {
	rm := NewRoomManager()
	room := rm.CreateRoom("host1", RoomConfig{MaxPlayers: 3})

	_ = room.AddClient("client1")
	_ = room.AddClient("client2")

	removed := room.RemoveClient("client1")
	if !removed {
		t.Fatal("expected client to be removed")
	}
	if room.PlayerCount() != 2 {
		t.Errorf("expected 2 players after removal, got %d", room.PlayerCount())
	}

	removed = room.RemoveClient("nonexistent")
	if removed {
		t.Fatal("expected false when removing nonexistent client")
	}
}

func TestRoomRemoveClientUnfullRoom(t *testing.T) {
	rm := NewRoomManager()
	room := rm.CreateRoom("host1", RoomConfig{MaxPlayers: 2})

	_ = room.AddClient("client1")

	if room.Status != RoomFull {
		t.Errorf("expected status 'full', got '%s'", room.Status)
	}

	room.RemoveClient("client1")

	if room.Status != RoomWaiting {
		t.Errorf("expected status 'waiting' after client left, got '%s'", room.Status)
	}
}

func TestRoomIsHost(t *testing.T) {
	room := &Room{HostID: "host1"}

	if !room.IsHost("host1") {
		t.Error("expected host1 to be host")
	}
	if room.IsHost("client1") {
		t.Error("expected client1 not to be host")
	}
}

func TestRoomIsMember(t *testing.T) {
	room := &Room{
		HostID:    "host1",
		ClientIDs: []string{"client1", "client2"},
	}

	if !room.IsMember("host1") {
		t.Error("expected host to be member")
	}
	if !room.IsMember("client1") {
		t.Error("expected client1 to be member")
	}
	if room.IsMember("stranger") {
		t.Error("expected stranger not to be member")
	}
}

func TestRoomStart(t *testing.T) {
	room := &Room{Status: RoomWaiting}

	err := room.Start()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if room.Status != RoomPlaying {
		t.Errorf("expected status 'playing', got '%s'", room.Status)
	}

	err = room.Start()
	if err == nil {
		t.Fatal("expected error when starting already started room")
	}
}

func TestRoomToJSON(t *testing.T) {
	room := &Room{
		Code:      "ABC123",
		HostID:    "host1",
		ClientIDs: []string{"client1"},
		Config:    RoomConfig{MaxPlayers: 3},
		Status:    RoomWaiting,
	}

	data := room.ToJSON()

	if data["code"] != "ABC123" {
		t.Errorf("expected code 'ABC123', got %v", data["code"])
	}
	if data["playerCount"] != 2 {
		t.Errorf("expected playerCount 2, got %v", data["playerCount"])
	}
	if data["maxPlayers"] != 3 {
		t.Errorf("expected maxPlayers 3, got %v", data["maxPlayers"])
	}
}

func TestRoomManagerGetRoom(t *testing.T) {
	rm := NewRoomManager()
	room := rm.CreateRoom("host1", RoomConfig{})

	found, exists := rm.GetRoom(room.Code)
	if !exists {
		t.Fatal("expected room to exist")
	}
	if found.Code != room.Code {
		t.Errorf("expected code '%s', got '%s'", room.Code, found.Code)
	}

	_, exists = rm.GetRoom("NONEXIST")
	if exists {
		t.Fatal("expected nonexistent room to not exist")
	}
}

func TestRoomManagerRemoveRoom(t *testing.T) {
	rm := NewRoomManager()
	room := rm.CreateRoom("host1", RoomConfig{})

	rm.RemoveRoom(room.Code)

	_, exists := rm.GetRoom(room.Code)
	if exists {
		t.Fatal("expected room to be removed")
	}
}

func TestRoomManagerListRooms(t *testing.T) {
	rm := NewRoomManager()

	rm.CreateRoom("host1", RoomConfig{})
	rm.CreateRoom("host2", RoomConfig{})

	rooms := rm.ListRooms()
	if len(rooms) != 2 {
		t.Errorf("expected 2 rooms, got %d", len(rooms))
	}
}

func TestRoomConcurrency(t *testing.T) {
	rm := NewRoomManager()
	room := rm.CreateRoom("host1", RoomConfig{MaxPlayers: 10})

	var wg sync.WaitGroup
	for i := 0; i < 9; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			clientID := fmt.Sprintf("client%d", id)
			_ = room.AddClient(clientID)
		}(i)
	}
	wg.Wait()

	if room.PlayerCount() != 10 {
		t.Errorf("expected 10 players, got %d", room.PlayerCount())
	}
}

func TestRoomConcurrencyRemove(t *testing.T) {
	room := &Room{
		HostID:    "host1",
		ClientIDs: []string{"c1", "c2", "c3", "c4", "c5"},
		Config:    RoomConfig{MaxPlayers: 10},
		Status:    RoomWaiting,
	}

	var wg sync.WaitGroup
	for i := 1; i <= 5; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			room.RemoveClient(fmt.Sprintf("c%d", id))
		}(i)
	}
	wg.Wait()

	if room.PlayerCount() != 1 {
		t.Errorf("expected 1 player (host only), got %d", room.PlayerCount())
	}
}
