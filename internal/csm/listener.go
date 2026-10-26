package csm

import (
	"fmt"
	"net"
)

type ListenerHandle struct {
	Host   string
	Port   int
	Token  string
	conn   *net.UDPConn
	closed bool
}

func StartCsmListener(traceID string, opts *ListenerOptions) (*ListenerHandle, error) {
	host := DefaultHost
	token := ""
	if opts != nil {
		if opts.Host != "" {
			host = opts.Host
		}
		if opts.Token != "" {
			token = opts.Token
		}
	}
	if token == "" {
		t, err := RequireCsmToken()
		if err != nil {
			return nil, err
		}
		token = t
	}
	addr, err := net.ResolveUDPAddr("udp4", host+":0")
	if err != nil {
		return nil, err
	}
	conn, err := net.ListenUDP("udp4", addr)
	if err != nil {
		return nil, err
	}
	handle := &ListenerHandle{
		Host:  host,
		Port:  conn.LocalAddr().(*net.UDPAddr).Port,
		Token: token,
		conn:  conn,
	}
	go func() {
		buf := make([]byte, 65535)
		for {
			n, _, err := conn.ReadFromUDP(buf)
			if err != nil {
				if handle.closed {
					return
				}
				continue
			}
			IngestCsmPayload(traceID, string(buf[:n]), token)
		}
	}()
	return handle, nil
}

type ListenerOptions struct {
	Host  string
	Token string
}

func (h *ListenerHandle) Close() error {
	h.closed = true
	if h.conn != nil {
		return h.conn.Close()
	}
	return nil
}

func (h *ListenerHandle) Addr() string {
	return fmt.Sprintf("%s:%d", h.Host, h.Port)
}
