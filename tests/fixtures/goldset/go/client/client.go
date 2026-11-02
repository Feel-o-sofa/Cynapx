package client

import "example.com/gold/util"

func Configure() string {
	return "free"
}

type Client struct{}

func (c *Client) Configure() string {
	return util.Format(1)
}

func (c *Client) Run() string {
	return c.Configure()
}
