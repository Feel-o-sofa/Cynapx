package main

import (
	"time"

	"example.com/gold/client"
	"example.com/gold/util"
)

func UseClient(c *client.Client) {
	c.Configure()
	client.Configure()
	util.Log(util.Format(util.Factorial(5)))
}

func Shutdown() string {
	return time.Now().Format("15:04")
}
