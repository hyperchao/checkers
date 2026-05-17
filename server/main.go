package main

import (
	"flag"
	"log"
	"net/http"
	"os"
	"path/filepath"
)

func main() {
	port := flag.String("port", "8080", "HTTP server port")
	webDir := flag.String("web", "../web", "path to web static files")
	flag.Parse()

	absWebDir, err := filepath.Abs(*webDir)
	if err != nil {
		log.Fatalf("failed to resolve web directory: %v", err)
	}

	if _, err := os.Stat(absWebDir); os.IsNotExist(err) {
		log.Fatalf("web directory does not exist: %s", absWebDir)
	}

	roomManager := NewRoomManager()
	hub := NewHub(roomManager)

	go hub.Run()

	http.HandleFunc("/ws", hub.ServeWS)
	http.Handle("/", http.FileServer(http.Dir(absWebDir)))

	log.Printf("server starting on :%s", *port)
	log.Printf("serving static files from: %s", absWebDir)
	log.Printf("websocket endpoint: ws://localhost:%s/ws", *port)

	if err := http.ListenAndServe(":"+*port, nil); err != nil {
		log.Fatalf("server failed: %v", err)
	}
}
