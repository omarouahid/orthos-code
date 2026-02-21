import { WebSocketServer, WebSocket } from 'ws';
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import type { BrowserRequest, BrowserResponse, BrowserConnectionState } from './types.js';

export class BrowserServer extends EventEmitter {
  private wss: WebSocketServer | null = null;
  private client: WebSocket | null = null;
  private authToken: string;
  private port: number;
  private pendingRequests: Map<string, {
    resolve: (response: BrowserResponse) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }> = new Map();
  private _state: BrowserConnectionState = 'disconnected';

  constructor(port: number, authToken: string) {
    super();
    this.port = port;
    this.authToken = authToken;
  }

  get state(): BrowserConnectionState { return this._state; }
  get isConnected(): boolean { return this._state === 'connected'; }

  async start(): Promise<void> {
    this.wss = new WebSocketServer({
      port: this.port,
      host: '127.0.0.1',
    });

    this.wss.on('connection', (ws, req) => {
      const url = new URL(req.url || '', `http://127.0.0.1:${this.port}`);
      const token = url.searchParams.get('token');
      if (token !== this.authToken) {
        ws.close(4001, 'Unauthorized');
        return;
      }

      if (this.client) {
        this.client.close(4002, 'Replaced by new connection');
      }

      this.client = ws;
      this._state = 'connected';
      this.emit('connected');

      ws.on('message', (data) => {
        try {
          const response: BrowserResponse = JSON.parse(data.toString());
          if (response.id === 'keepalive') return;
          const pending = this.pendingRequests.get(response.id);
          if (pending) {
            clearTimeout(pending.timer);
            this.pendingRequests.delete(response.id);
            pending.resolve(response);
          }
        } catch {
          // Ignore malformed messages
        }
      });

      ws.on('close', () => {
        if (this.client === ws) {
          this.client = null;
          this._state = 'disconnected';
          this.emit('disconnected');
        }
      });

      ws.on('error', () => {
        // Will trigger close
      });
    });

    return new Promise((resolve, reject) => {
      this.wss!.on('listening', () => resolve());
      this.wss!.on('error', (err) => reject(err));
    });
  }

  async sendRequest(
    action: BrowserRequest['action'],
    params: Record<string, unknown>,
    timeoutMs: number = 30000
  ): Promise<BrowserResponse> {
    if (!this.client || this._state !== 'connected') {
      throw new Error('Browser extension not connected. Install and enable the Orthos Chrome extension.');
    }

    const id = randomUUID();
    const request: BrowserRequest = { id, action, params };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Browser action '${action}' timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timer });
      this.client!.send(JSON.stringify(request));
    });
  }

  stop(): void {
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Server shutting down'));
    }
    this.pendingRequests.clear();
    this.client?.close();
    this.wss?.close();
    this._state = 'disconnected';
  }
}
