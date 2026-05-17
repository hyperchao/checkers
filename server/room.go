package main

import (
	"fmt"
	"math/rand"
	"sync"
	"time"
)

const (
	RoomCodeLength = 6
	RoomCodeChars  = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
)

type RoomStatus string

const (
	RoomWaiting RoomStatus = "waiting"
	RoomPlaying RoomStatus = "playing"
	RoomFull    RoomStatus = "full"
)

type RoomConfig struct {
	PlayerCount    int `json:"playerCount"`
	SeatsPerPlayer int `json:"seatsPerPlayer"`
	MaxPlayers     int `json:"maxPlayers"`
}

type Room struct {
	Code      string     `json:"code"`
	Config    RoomConfig `json:"config"`
	Status    RoomStatus `json:"status"`
	HostID    string     `json:"hostId"`
	ClientIDs []string   `json:"clientIds"`
	CreatedAt time.Time  `json:"createdAt"`
	mu        sync.RWMutex
}

func (r *Room) PlayerCount() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.playerCountLocked()
}

func (r *Room) playerCountLocked() int {
	return 1 + len(r.ClientIDs)
}

func (r *Room) IsFull() bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.isFullLocked()
}

func (r *Room) isFullLocked() bool {
	return r.playerCountLocked() >= r.Config.MaxPlayers
}

func (r *Room) AddClient(clientID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.Status == RoomPlaying {
		return fmt.Errorf("room is already playing")
	}
	if r.isFullLocked() {
		return fmt.Errorf("room is full")
	}
	for _, id := range r.ClientIDs {
		if id == clientID {
			return fmt.Errorf("client already in room")
		}
	}

	r.ClientIDs = append(r.ClientIDs, clientID)

	if r.isFullLocked() {
		r.Status = RoomFull
	}

	return nil
}

func (r *Room) RemoveClient(clientID string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	for i, id := range r.ClientIDs {
		if id == clientID {
			r.ClientIDs = append(r.ClientIDs[:i], r.ClientIDs[i+1:]...)
			if r.Status == RoomFull {
				r.Status = RoomWaiting
			}
			return true
		}
	}
	return false
}

func (r *Room) IsHost(peerID string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.HostID == peerID
}

func (r *Room) IsMember(peerID string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if r.HostID == peerID {
		return true
	}
	for _, id := range r.ClientIDs {
		if id == peerID {
			return true
		}
	}
	return false
}

func (r *Room) Start() error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.Status == RoomPlaying {
		return fmt.Errorf("room already started")
	}
	r.Status = RoomPlaying
	return nil
}

func (r *Room) ToJSON() map[string]interface{} {
	r.mu.RLock()
	defer r.mu.RUnlock()

	return map[string]interface{}{
		"code":        r.Code,
		"config":      r.Config,
		"status":      r.Status,
		"hostId":      r.HostID,
		"clientIds":   r.ClientIDs,
		"playerCount": r.playerCountLocked(),
		"maxPlayers":  r.Config.MaxPlayers,
	}
}

func GenerateRoomCode() string {
	code := make([]byte, RoomCodeLength)
	for i := range code {
		code[i] = RoomCodeChars[rand.Intn(len(RoomCodeChars))]
	}
	return string(code)
}

type RoomManager struct {
	rooms map[string]*Room
	mu    sync.RWMutex
}

func NewRoomManager() *RoomManager {
	return &RoomManager{
		rooms: make(map[string]*Room),
	}
}

func (rm *RoomManager) CreateRoom(hostID string, config RoomConfig) *Room {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	if config.MaxPlayers <= 0 {
		config.MaxPlayers = 6
	}

	var code string
	for {
		code = GenerateRoomCode()
		if _, exists := rm.rooms[code]; !exists {
			break
		}
	}

	room := &Room{
		Code:      code,
		Config:    config,
		Status:    RoomWaiting,
		HostID:    hostID,
		ClientIDs: []string{},
		CreatedAt: time.Now(),
	}

	rm.rooms[code] = room
	return room
}

func (rm *RoomManager) GetRoom(code string) (*Room, bool) {
	rm.mu.RLock()
	defer rm.mu.RUnlock()
	room, exists := rm.rooms[code]
	return room, exists
}

func (rm *RoomManager) RemoveRoom(code string) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	delete(rm.rooms, code)
}

type LeaveRoomResult struct {
	IsHost      bool
	RoomExists  bool
	Room        *Room
	RoomRemoved bool
}

func (rm *RoomManager) HandleLeaveRoom(clientID string) LeaveRoomResult {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	for code, room := range rm.rooms {
		room.mu.RLock()
		isHost := room.HostID == clientID
		isMember := room.HostID == clientID
		if !isMember {
			for _, id := range room.ClientIDs {
				if id == clientID {
					isMember = true
					break
				}
			}
		}
		room.mu.RUnlock()

		if !isMember {
			continue
		}

		if isHost {
			delete(rm.rooms, code)
			return LeaveRoomResult{
				IsHost:      true,
				RoomExists:  true,
				Room:        room,
				RoomRemoved: true,
			}
		}

		room.mu.Lock()
		for i, id := range room.ClientIDs {
			if id == clientID {
				room.ClientIDs = append(room.ClientIDs[:i], room.ClientIDs[i+1:]...)
				if room.Status == RoomFull {
					room.Status = RoomWaiting
				}
				break
			}
		}
		room.mu.Unlock()

		return LeaveRoomResult{
			IsHost:     false,
			RoomExists: true,
			Room:       room,
		}
	}

	return LeaveRoomResult{RoomExists: false}
}

func (rm *RoomManager) ListRooms() []map[string]interface{} {
	rm.mu.RLock()
	defer rm.mu.RUnlock()

	result := make([]map[string]interface{}, 0, len(rm.rooms))
	for _, room := range rm.rooms {
		result = append(result, room.ToJSON())
	}
	return result
}
