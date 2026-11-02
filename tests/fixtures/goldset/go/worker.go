package main

import "example.com/gold/client"

type Worker struct{}

func (w *Worker) Run() int {
	return 1
}

func Build() {
	c := &client.Client{}
	c.Configure()
	w := Worker{}
	w.Run()
}
