package main

import (
	"crypto/rand"
	"encoding/json"
	"log"
	"math/big"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = 54 * time.Second
	maxMessageSize = 65536
)

func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("websocket upgrade error: %v", err)
		return
	}

	clientID := r.URL.Query().Get("id")
	if clientID == "" {
		clientID = generatePeerID()
	}

	client := &Client{
		ID:   clientID,
		Conn: conn,
		Send: make(chan []byte, 256),
	}

	h.Register <- client

	go h.writePump(client)
	go h.readPump(client)
}

func (h *Hub) readPump(client *Client) {
	defer func() {
		h.Unregister <- client
		client.Conn.Close()
	}()

	client.Conn.SetReadLimit(maxMessageSize)
	client.Conn.SetReadDeadline(time.Now().Add(pongWait))
	client.Conn.SetPongHandler(func(string) error {
		client.Conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		_, message, err := client.Conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				log.Printf("websocket error: %v", err)
			}
			break
		}

		var msg Message
		if err := json.Unmarshal(message, &msg); err != nil {
			log.Printf("invalid message: %v", err)
			continue
		}

		h.handleMessage(client, msg)
	}
}

func (h *Hub) writePump(client *Client) {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		client.Conn.Close()
	}()

	for {
		select {
		case message, ok := <-client.Send:
			client.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				if err := client.Conn.WriteMessage(websocket.CloseMessage, []byte{}); err != nil {
					log.Printf("failed to write close message: %v", err)
				}
				return
			}

			w, err := client.Conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			w.Write(message)

			n := len(client.Send)
			for i := 0; i < n; i++ {
				w.Write([]byte{'\n'})
				w.Write(<-client.Send)
			}

			if err := w.Close(); err != nil {
				return
			}

		case <-ticker.C:
			client.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := client.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (h *Hub) handleMessage(client *Client, msg Message) {
	switch msg.Type {
	case MsgCreateRoom:
		h.handleCreateRoom(client, msg.Payload)
	case MsgJoinRoom:
		h.handleJoinRoom(client, msg.Payload)
	case MsgSDPOffer:
		h.handleSDPOffer(client, msg.Payload)
	case MsgSDPAnswer:
		h.handleSDPAnswer(client, msg.Payload)
	case MsgICECandidate:
		h.handleICECandidate(client, msg.Payload)
	case MsgLeaveRoom:
		h.handleLeaveRoom(client)
	default:
		log.Printf("unknown message type: %s", msg.Type)
	}
}

func (h *Hub) handleCreateRoom(client *Client, payload json.RawMessage) {
	var req CreateRoomPayload
	if err := json.Unmarshal(payload, &req); err != nil {
		client.SendMessage(Message{
			Type: MsgError,
			Payload: json.RawMessage(`{"message":"invalid payload"}`),
		})
		return
	}

	room := h.Rooms.CreateRoom(client.ID, RoomConfig{
		PlayerCount:    req.PlayerCount,
		SeatsPerPlayer: req.SeatsPerPlayer,
		MaxPlayers:     req.MaxPlayers,
	})

	client.SetRoom(room.Code)

	client.SendMessage(Message{
		Type:    MsgRoomInfo,
		Payload: mustMarshal(room.ToJSON()),
	})

	log.Printf("room created: %s by %s", room.Code, client.ID)
}

func (h *Hub) handleJoinRoom(client *Client, payload json.RawMessage) {
	var req JoinRoomPayload
	if err := json.Unmarshal(payload, &req); err != nil {
		client.SendMessage(Message{
			Type: MsgError,
			Payload: json.RawMessage(`{"message":"invalid payload"}`),
		})
		return
	}

	room, exists := h.Rooms.GetRoom(req.RoomCode)
	if !exists {
		client.SendMessage(Message{
			Type: MsgError,
			Payload: json.RawMessage(`{"message":"room not found"}`),
		})
		return
	}

	if room.Status == RoomPlaying {
		client.SendMessage(Message{
			Type: MsgError,
			Payload: json.RawMessage(`{"message":"room already playing"}`),
		})
		return
	}

	if err := room.AddClient(client.ID); err != nil {
		client.SendMessage(Message{
			Type:    MsgError,
			Payload: mustMarshal(map[string]string{"message": err.Error()}),
		})
		return
	}

	client.SetRoom(room.Code)

	client.SendMessage(Message{
		Type:    MsgRoomInfo,
		Payload: mustMarshal(room.ToJSON()),
	})

	h.broadcastToRoom(room.Code, Message{
		Type:    MsgRoomInfo,
		Payload: mustMarshal(room.ToJSON()),
	}, client.ID)

	log.Printf("client %s joined room %s", client.ID, room.Code)
}

func (h *Hub) handleSDPOffer(client *Client, payload json.RawMessage) {
	var req SDPPayload
	if err := json.Unmarshal(payload, &req); err != nil {
		return
	}

	targetClient, ok := h.GetClient(req.TargetID)
	if !ok {
		return
	}

	targetClient.SendMessage(Message{
		Type: MsgSDPOffer,
		Payload: mustMarshal(map[string]string{
			"fromId": client.ID,
			"sdp":    req.SDP,
			"type":   req.Type,
		}),
	})
}

func (h *Hub) handleSDPAnswer(client *Client, payload json.RawMessage) {
	var req SDPPayload
	if err := json.Unmarshal(payload, &req); err != nil {
		return
	}

	targetClient, ok := h.GetClient(req.TargetID)
	if !ok {
		return
	}

	targetClient.SendMessage(Message{
		Type: MsgSDPAnswer,
		Payload: mustMarshal(map[string]string{
			"fromId": client.ID,
			"sdp":    req.SDP,
			"type":   req.Type,
		}),
	})
}

func (h *Hub) handleICECandidate(client *Client, payload json.RawMessage) {
	var req ICEPayload
	if err := json.Unmarshal(payload, &req); err != nil {
		return
	}

	targetClient, ok := h.GetClient(req.TargetID)
	if !ok {
		return
	}

	targetClient.SendMessage(Message{
		Type: MsgICECandidate,
		Payload: mustMarshal(map[string]string{
			"fromId":    client.ID,
			"candidate": req.Candidate,
		}),
	})
}

func (h *Hub) handleLeaveRoom(client *Client) {
	result := h.Rooms.HandleLeaveRoom(client.ID)

	if !result.RoomExists {
		return
	}

	if result.IsHost {
		h.broadcastToRoom(result.Room.Code, Message{
			Type:    MsgError,
			Payload: json.RawMessage(`{"message":"Host left the room"}`),
		}, client.ID)
	} else {
		h.broadcastToRoom(result.Room.Code, Message{
			Type:    MsgRoomInfo,
			Payload: mustMarshal(result.Room.ToJSON()),
		}, client.ID)
	}

	client.SetRoom("")
	log.Printf("client %s left room", client.ID)
}

func generatePeerID() string {
	return generateRandomString(16)
}

func generateRandomString(length int) string {
	const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	b := make([]byte, length)
	for i := range b {
		r, err := rand.Int(rand.Reader, big.NewInt(int64(len(chars))))
		if err != nil {
			b[i] = chars[0]
			continue
		}
		b[i] = chars[r.Int64()]
	}
	return string(b)
}
