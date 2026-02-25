package main

import (
	"fmt"
	"net/http"

	"github.com/gorilla/mux"
	"github.com/sirupsen/logrus"
)

func main() {
	r := mux.NewRouter()
	r.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintln(w, "Hello from Dependicus Go example")
	})

	logrus.Info("Starting server on :8080")
	logrus.Fatal(http.ListenAndServe(":8080", r))
}
