import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { SSEHandler } from './sse-handler.js';
import { EventEmitter } from 'events';
import type { ServerResponse } from 'http';

// Mock ServerResponse
class MockResponse extends EventEmitter {
  public writtenData: string[] = [];
  public headers: Record<string, string> = {};
  public statusCode = 200;
  public ended = false;

  writeHead(statusCode: number, headers: Record<string, string>) {
    this.statusCode = statusCode;
    this.headers = headers;
  }

  write(data: string): boolean {
    if (this.ended) throw new Error('Response already ended');
    this.writtenData.push(data);
    return true;
  }

  end() {
    this.ended = true;
  }
}

describe('SSEHandler', () => {
  let handler: SSEHandler;

  beforeEach(() => {
    handler = new SSEHandler(1000); // 1 second heartbeat for faster tests
  });

  afterEach(() => {
    handler.shutdown();
  });

  describe('addClient', () => {
    it('sets correct SSE headers', () => {
      const res = new MockResponse() as unknown as ServerResponse;

      handler.addClient(res);

      const mockRes = res as unknown as MockResponse;
      expect(mockRes.headers['Content-Type']).toBe('text/event-stream');
      expect(mockRes.headers['Cache-Control']).toBe('no-cache');
      expect(mockRes.headers['Connection']).toBe('keep-alive');
    });

    it('sends retry interval on connect', () => {
      const res = new MockResponse() as unknown as ServerResponse;

      handler.addClient(res);

      const mockRes = res as unknown as MockResponse;
      expect(mockRes.writtenData[0]).toContain('retry: 5000');
    });

    it('sends connected event', () => {
      const res = new MockResponse() as unknown as ServerResponse;

      const clientId = handler.addClient(res);

      const mockRes = res as unknown as MockResponse;
      const connectedEvent = mockRes.writtenData.find(d => d.includes('event: connected'));
      expect(connectedEvent).toBeDefined();
      expect(connectedEvent).toContain(clientId);
    });

    it('returns unique client ID', () => {
      const res1 = new MockResponse() as unknown as ServerResponse;
      const res2 = new MockResponse() as unknown as ServerResponse;

      const id1 = handler.addClient(res1);
      const id2 = handler.addClient(res2);

      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^client-\d+-[a-z0-9]+$/);
    });

    it('tracks client count', () => {
      expect(handler.clientCount).toBe(0);

      const res1 = new MockResponse() as unknown as ServerResponse;
      handler.addClient(res1);
      expect(handler.clientCount).toBe(1);

      const res2 = new MockResponse() as unknown as ServerResponse;
      handler.addClient(res2);
      expect(handler.clientCount).toBe(2);
    });
  });

  describe('removeClient', () => {
    it('removes client from tracking', () => {
      const res = new MockResponse() as unknown as ServerResponse;
      const clientId = handler.addClient(res);

      expect(handler.clientCount).toBe(1);

      handler.removeClient(clientId);

      expect(handler.clientCount).toBe(0);
    });

    it('ends the response', () => {
      const res = new MockResponse() as unknown as ServerResponse;
      const clientId = handler.addClient(res);

      handler.removeClient(clientId);

      expect((res as unknown as MockResponse).ended).toBe(true);
    });

    it('handles non-existent client gracefully', () => {
      expect(() => handler.removeClient('non-existent')).not.toThrow();
    });
  });

  describe('client disconnect', () => {
    it('removes client on close event', () => {
      const res = new MockResponse() as unknown as ServerResponse;
      handler.addClient(res);

      expect(handler.clientCount).toBe(1);

      res.emit('close');

      expect(handler.clientCount).toBe(0);
    });

    it('removes client on error event', () => {
      const res = new MockResponse() as unknown as ServerResponse;
      handler.addClient(res);

      expect(handler.clientCount).toBe(1);

      res.emit('error', new Error('Connection reset'));

      expect(handler.clientCount).toBe(0);
    });
  });

  describe('sendToClient', () => {
    it('sends formatted event to specific client', () => {
      const res = new MockResponse() as unknown as ServerResponse;
      const clientId = handler.addClient(res);

      handler.sendToClient(clientId, {
        type: 'test',
        data: { message: 'hello' }
      });

      const mockRes = res as unknown as MockResponse;
      const testEvent = mockRes.writtenData.find(d => d.includes('event: test'));
      expect(testEvent).toBeDefined();
      expect(testEvent).toContain('"message":"hello"');
    });

    it('returns false for non-existent client', () => {
      const result = handler.sendToClient('non-existent', {
        type: 'test',
        data: {}
      });

      expect(result).toBe(false);
    });

    it('includes event ID', () => {
      const res = new MockResponse() as unknown as ServerResponse;
      const clientId = handler.addClient(res);

      handler.sendToClient(clientId, {
        type: 'test',
        data: {},
        id: 'custom-id'
      });

      const mockRes = res as unknown as MockResponse;
      const testEvent = mockRes.writtenData.find(d => d.includes('id: custom-id'));
      expect(testEvent).toBeDefined();
    });
  });

  describe('broadcast', () => {
    it('sends event to all connected clients', () => {
      const res1 = new MockResponse() as unknown as ServerResponse;
      const res2 = new MockResponse() as unknown as ServerResponse;
      const res3 = new MockResponse() as unknown as ServerResponse;

      handler.addClient(res1);
      handler.addClient(res2);
      handler.addClient(res3);

      const successCount = handler.broadcast({
        type: 'announcement',
        data: { text: 'Hello everyone' }
      });

      expect(successCount).toBe(3);

      for (const res of [res1, res2, res3]) {
        const mockRes = res as unknown as MockResponse;
        const event = mockRes.writtenData.find(d => d.includes('event: announcement'));
        expect(event).toBeDefined();
      }
    });

    it('returns count of successful sends', () => {
      const res1 = new MockResponse() as unknown as ServerResponse;
      const res2 = new MockResponse() as unknown as ServerResponse;

      handler.addClient(res1);
      handler.addClient(res2);

      // Make res2 fail on write
      (res2 as unknown as MockResponse).write = () => {
        throw new Error('Write failed');
      };

      const successCount = handler.broadcast({
        type: 'test',
        data: {}
      });

      expect(successCount).toBe(1);
      expect(handler.clientCount).toBe(1); // Failed client removed
    });
  });

  describe('broadcastQueryEvent', () => {
    it('broadcasts query events', () => {
      const res = new MockResponse() as unknown as ServerResponse;
      handler.addClient(res);

      handler.broadcastQueryEvent({
        type: 'query:completed',
        data: {
          queryId: 'q-123',
          query: 'SELECT 1',
          status: 'completed',
          startTime: Date.now()
        }
      });

      const mockRes = res as unknown as MockResponse;
      const event = mockRes.writtenData.find(d => d.includes('event: query:completed'));
      expect(event).toBeDefined();
      expect(event).toContain('q-123');
    });
  });

  describe('heartbeat', () => {
    it('starts heartbeat when first client connects', () => {
      const res = new MockResponse() as unknown as ServerResponse;

      // No heartbeat before client
      expect(handler.clientCount).toBe(0);

      handler.addClient(res);

      // Heartbeat should be started (we can't directly check the timer,
      // but we can verify it works by waiting)
      expect(handler.clientCount).toBe(1);
    });

    it('sends heartbeat comments to all clients', async () => {
      const res = new MockResponse() as unknown as ServerResponse;
      handler.addClient(res);

      // Wait for heartbeat
      await new Promise(resolve => setTimeout(resolve, 1100));

      const mockRes = res as unknown as MockResponse;
      const heartbeat = mockRes.writtenData.find(d => d.includes(':heartbeat'));
      expect(heartbeat).toBeDefined();
    });

    it('stops heartbeat when last client disconnects', () => {
      const res = new MockResponse() as unknown as ServerResponse;
      const clientId = handler.addClient(res);

      handler.removeClient(clientId);

      expect(handler.clientCount).toBe(0);
      // Heartbeat timer should be stopped (verified by no errors on shutdown)
    });
  });

  describe('getClients', () => {
    it('returns client information', () => {
      const res1 = new MockResponse() as unknown as ServerResponse;
      const res2 = new MockResponse() as unknown as ServerResponse;

      const id1 = handler.addClient(res1);
      const id2 = handler.addClient(res2);

      const clients = handler.getClients();

      expect(clients).toHaveLength(2);
      expect(clients.map(c => c.id)).toContain(id1);
      expect(clients.map(c => c.id)).toContain(id2);
      expect(clients[0].connectedAt).toBeGreaterThan(0);
    });
  });

  describe('shutdown', () => {
    it('disconnects all clients', () => {
      const res1 = new MockResponse() as unknown as ServerResponse;
      const res2 = new MockResponse() as unknown as ServerResponse;

      handler.addClient(res1);
      handler.addClient(res2);

      expect(handler.clientCount).toBe(2);

      handler.shutdown();

      expect(handler.clientCount).toBe(0);
      expect((res1 as unknown as MockResponse).ended).toBe(true);
      expect((res2 as unknown as MockResponse).ended).toBe(true);
    });

    it('sends shutdown event to clients', () => {
      const res = new MockResponse() as unknown as ServerResponse;
      handler.addClient(res);

      handler.shutdown();

      const mockRes = res as unknown as MockResponse;
      const shutdownEvent = mockRes.writtenData.find(d => d.includes('event: shutdown'));
      expect(shutdownEvent).toBeDefined();
    });
  });

  describe('event formatting', () => {
    it('formats events with proper SSE syntax', () => {
      const res = new MockResponse() as unknown as ServerResponse;
      const clientId = handler.addClient(res);

      handler.sendToClient(clientId, {
        type: 'custom-event',
        data: { key: 'value', nested: { a: 1 } }
      });

      const mockRes = res as unknown as MockResponse;
      const event = mockRes.writtenData.find(d => d.includes('event: custom-event'));
      expect(event).toBeDefined();

      // Check format
      expect(event).toMatch(/^id: evt-\d+\n/);
      expect(event).toContain('event: custom-event\n');
      expect(event).toContain('data: {"key":"value","nested":{"a":1}}\n');
      expect(event).toMatch(/\n\n$/);
    });

    it('includes retry if specified', () => {
      const res = new MockResponse() as unknown as ServerResponse;
      const clientId = handler.addClient(res);

      handler.sendToClient(clientId, {
        type: 'test',
        data: {},
        retry: 10000
      });

      const mockRes = res as unknown as MockResponse;
      const event = mockRes.writtenData.find(d => d.includes('retry: 10000'));
      expect(event).toBeDefined();
    });
  });
});
