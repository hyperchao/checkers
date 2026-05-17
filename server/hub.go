package main

import (
	"encoding/json"
	"log"
	"sync"

	"github.com/gorilla/websocket"
)

type MessageType string

const (
	MsgCreateRoom   MessageType = "create_room"
	MsgJoinRoom     MessageType = "join_room"
	MsgRoomInfo     MessageType = "room_info"
	MsgSDPOffer     MessageType = "sdp_offer"
	MsgSDPAnswer    MessageType = "sdp_answer"
	MsgICECandidate MessageType = "ice_candidate"
	MsgRoomFull     MessageType = "room_full"
	MsgRoomStart    MessageType = "room_start"
	MsgLeaveRoom    MessageType = "leave_room"
	MsgError        MessageType = "error"
	MsgPong         MessageType = "pong"
)

type Message struct {
	Type    MessageType     `json:"type"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

type CreateRoomPayload struct {
	PlayerCount    int `json:"playerCount"`
	SeatsPerPlayer int `json:"seatsPerPlayer"`
	MaxPlayers     int `json:"maxPlayers"`
}

type JoinRoomPayload struct {
	RoomCode string `json:"roomCode"`
	PlayerID string `json:"playerId"`
}

type SDPPayload struct {
	RoomCode string `json:"roomCode"`
	TargetID string `json:"targetId"`
	SDP      string `json:"sdp"`
	Type     string `json:"type"`
}

type ICEPayload struct {
	RoomCode string `json:"roomCode"`
	TargetID string `json:"targetId"`
	Candidate string `json:"candidate"`
}

type Client struct {
	ID       string
	Conn     *websocket.Conn
	Send     chan []byte
	RoomCode string
	mu       sync.RWMutex
}

func (c *Client) SetRoom(code string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.RoomCode = code
}

func (c *Client) GetRoom() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.RoomCode
}

func (c *Client) SendMessage(msg Message) error {
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	c.Send <- data
	return nil
}

type Hub struct {
	Clients    map[string]*Client
	Register   chan *Client
	Unregister chan *Client
	Rooms      *RoomManager
	mu         sync.RWMutex
}

func NewHub(roomManager *RoomManager) *Hub {
	return &Hub{
		Clients:    make(map[string]*Client),
		Register:   make(chan *Client),
		Unregister: make(chan *Client),
		Rooms:      roomManager,
	}
}

func (h *Hub) Run() {
	for {
		select {
		case client := <-h.Register:
			h.mu.Lock()
			h.Clients[client.ID] = client
			h.mu.Unlock()
			log.Printf("client connected: %s (total: %d)", client.ID, len(h.Clients))

		case client := <-h.Unregister:
			h.mu.Lock()
			if _, ok := h.Clients[client.ID]; ok {
				delete(h.Clients, client.ID)
				close(client.Send)
				h.handleClientDisconnect(client)
			}
			h.mu.Unlock()
			log.Printf("client disconnected: %s (total: %d)", client.ID, len(h.Clients))
		}
	}
}

func (h *Hub) handleClientDisconnect(client *Client) {
	roomCode := client.GetRoom()
	if roomCode == "" {
		return
	}

	room, exists := h.Rooms.GetRoom(roomCode)
	if !exists {
		return
	}

	if room.IsHost(client.ID) {
		h.broadcastToRoom(roomCode, Message{
			Type:    MsgError,
			Payload: json.RawMessage(`{"message":"Host disconnected"}`),
		}, client.ID)
		h.Rooms.RemoveRoom(roomCode)
		log.Printf("room %s removed (host disconnected)", roomCode)
	} else {
		room.RemoveClient(client.ID)
		h.broadcastToRoom(roomCode, Message{
			Type: MsgRoomInfo,
			Payload: mustMarshal(room.ToJSON()),
		}, client.ID)
	}
}

func (h *Hub) GetClient(id string) (*Client, bool) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	client, ok := h.Clients[id]
	return client, ok
}

func (h *Hub) GetClientsInRoom(roomCode string) []*Client {
	h.mu.RLock()
	defer h.mu.RUnlock()

	var result []*Client
	for _, client := range h.Clients {
		if client.GetRoom() == roomCode {
			result = append(result, client)
		}
	}
	return result
}

func (h *Hub) SendToClient(clientID string, msg Message) error {
	h.mu.RLock()
	client, ok := h.Clients[clientID]
	h.mu.RUnlock()

	if !ok {
		return nil
	}

	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}

	select {
	case client.Send <- data:
		return nil
	default:
		return nil
	}
}

func (h *Hub) broadcastToRoom(roomCode string, msg Message, excludeID string) {
	clients := h.GetClientsInRoom(roomCode)
	data, err := json.Marshal(msg)
	if err != nil {
		log.Printf("failed to marshal broadcast message: %v", err)
		return
	}

	for _, client := range clients {
		if client.ID == excludeID {
			continue
		}
		select {
		case client.Send <- data:
		default:
			log.Printf("client %s send buffer full, skipping broadcast", client.ID)
		}
	}
}

func mustMarshal(v interface{}) json.RawMessage {
	data, err := json.Marshal(v)
	if err != nil {
		return json.RawMessage("{}")
	}
	return json.RawMessage(data)
}
