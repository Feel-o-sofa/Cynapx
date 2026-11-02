package main

import "example.com/gold/client"

type Base struct{}

func (b *Base) Ping() int {
	return 1
}

type Holder struct {
	Base
	c *client.Client
}

func NewClient() *client.Client {
	return &client.Client{}
}

func (h *Holder) ViaField() {
	h.c.Configure()
}

func (h *Holder) ViaEmbedding() int {
	return h.Ping()
}

func ViaReturn() {
	c := NewClient()
	c.Configure()
}
