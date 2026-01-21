/**
 * Anode MCP Client
 *
 * A TypeScript/JavaScript client for connecting to Anode Android MCP Server.
 * Supports WebSocket and HTTP/SSE transports.
 *
 * @package @anode/mcp-client
 */

import WebSocket from 'ws';
import EventSource from 'eventsource';

// ============================================================================
// Types
// ============================================================================

export interface McpClientConfig {
  /** Server host (IP or hostname) */
  host: string;
  /** WebSocket port (default: 8765) */
  wsPort?: number;
  /** HTTP/SSE port (default: 8766) */
  httpPort?: number;
  /** Transport type (default: 'websocket') */
  transport?: 'websocket' | 'http-sse';
  /** Auto reconnect on disconnect (default: true) */
  autoReconnect?: boolean;
  /** Reconnect interval in ms (default: 3000) */
  reconnectInterval?: number;
  /** Request timeout in ms (default: 30000) */
  timeout?: number;
}

export interface McpRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface McpResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface McpNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

export interface ToolInfo {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ServerInfo {
  name: string;
  version: string;
}

export interface ServerCapabilities {
  tools?: { listChanged?: boolean };
  resources?: { subscribe?: boolean; listChanged?: boolean };
  prompts?: { listChanged?: boolean };
}

export interface InitializeResult {
  protocolVersion: string;
  serverInfo: ServerInfo;
  capabilities: ServerCapabilities;
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface McpClientEvents {
  connect: () => void;
  disconnect: (reason?: string) => void;
  error: (error: Error) => void;
  notification: (notification: McpNotification) => void;
  stateChange: (state: ConnectionState) => void;
}

// ============================================================================
// McpClient Class
// ============================================================================

export class McpClient {
  private config: Required<McpClientConfig>;
  private ws: WebSocket | null = null;
  private eventSource: EventSource | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number | string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }>();
  private eventHandlers: Partial<Record<keyof McpClientEvents, Function[]>> = {};
  private _state: ConnectionState = 'disconnected';
  private reconnectTimer: NodeJS.Timeout | null = null;
  private serverInfo: ServerInfo | null = null;
  private capabilities: ServerCapabilities | null = null;

  constructor(config: McpClientConfig) {
    this.config = {
      host: config.host,
      wsPort: config.wsPort ?? 8765,
      httpPort: config.httpPort ?? 8766,
      transport: config.transport ?? 'websocket',
      autoReconnect: config.autoReconnect ?? true,
      reconnectInterval: config.reconnectInterval ?? 3000,
      timeout: config.timeout ?? 30000,
    };
  }

  // --------------------------------------------------------------------------
  // Connection Management
  // --------------------------------------------------------------------------

  get state(): ConnectionState {
    return this._state;
  }

  get isConnected(): boolean {
    return this._state === 'connected';
  }

  get server(): ServerInfo | null {
    return this.serverInfo;
  }

  async connect(): Promise<InitializeResult> {
    if (this._state === 'connected') {
      throw new Error('Already connected');
    }

    this.setState('connecting');

    try {
      if (this.config.transport === 'websocket') {
        await this.connectWebSocket();
      } else {
        await this.connectHttpSse();
      }

      // Initialize MCP connection
      const result = await this.initialize();
      this.serverInfo = result.serverInfo;
      this.capabilities = result.capabilities;

      this.setState('connected');
      this.emit('connect');

      return result;
    } catch (error) {
      this.setState('error');
      this.emit('error', error as Error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.stopReconnectTimer();

    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Client disconnected'));
    }
    this.pendingRequests.clear();

    this.setState('disconnected');
    this.emit('disconnect', 'Client initiated');
  }

  // --------------------------------------------------------------------------
  // Event Handling
  // --------------------------------------------------------------------------

  on<K extends keyof McpClientEvents>(event: K, handler: McpClientEvents[K]): void {
    if (!this.eventHandlers[event]) {
      this.eventHandlers[event] = [];
    }
    this.eventHandlers[event]!.push(handler);
  }

  off<K extends keyof McpClientEvents>(event: K, handler: McpClientEvents[K]): void {
    const handlers = this.eventHandlers[event];
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index !== -1) {
        handlers.splice(index, 1);
      }
    }
  }

  private emit<K extends keyof McpClientEvents>(
    event: K,
    ...args: Parameters<McpClientEvents[K]>
  ): void {
    const handlers = this.eventHandlers[event];
    if (handlers) {
      for (const handler of handlers) {
        try {
          (handler as Function)(...args);
        } catch (e) {
          console.error(`Error in event handler for ${event}:`, e);
        }
      }
    }
  }

  private setState(state: ConnectionState): void {
    if (this._state !== state) {
      this._state = state;
      this.emit('stateChange', state);
    }
  }

  // --------------------------------------------------------------------------
  // WebSocket Transport
  // --------------------------------------------------------------------------

  private connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `ws://${this.config.host}:${this.config.wsPort}`;
      this.ws = new WebSocket(url);

      this.ws.on('open', () => resolve());

      this.ws.on('error', (error) => {
        reject(error);
      });

      this.ws.on('message', (data) => {
        this.handleMessage(data.toString());
      });

      this.ws.on('close', (code, reason) => {
        this.handleDisconnect(reason.toString());
      });
    });
  }

  // --------------------------------------------------------------------------
  // HTTP/SSE Transport
  // --------------------------------------------------------------------------

  private connectHttpSse(): Promise<void> {
    return new Promise((resolve, reject) => {
      const sseUrl = `http://${this.config.host}:${this.config.httpPort}/mcp/events`;
      this.eventSource = new EventSource(sseUrl);

      this.eventSource.onopen = () => resolve();

      this.eventSource.onerror = (error) => {
        reject(new Error('SSE connection failed'));
      };

      this.eventSource.addEventListener('message', (event) => {
        this.handleMessage(event.data);
      });

      this.eventSource.addEventListener('connected', (event) => {
        // Server sends connected event on SSE open
      });
    });
  }

  private async sendHttpRequest(request: McpRequest): Promise<McpResponse> {
    const url = `http://${this.config.host}:${this.config.httpPort}/mcp/message`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }

    return response.json() as Promise<McpResponse>;
  }

  // --------------------------------------------------------------------------
  // Message Handling
  // --------------------------------------------------------------------------

  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data);

      // Check if it's a response (has id)
      if ('id' in message) {
        const pending = this.pendingRequests.get(message.id);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(message.id);

          if (message.error) {
            pending.reject(new Error(message.error.message));
          } else {
            pending.resolve(message.result);
          }
        }
      } else if ('method' in message) {
        // It's a notification
        this.emit('notification', message as McpNotification);
      }
    } catch (e) {
      console.error('Failed to parse message:', e);
    }
  }

  private handleDisconnect(reason: string): void {
    this.ws = null;
    this.setState('disconnected');
    this.emit('disconnect', reason);

    if (this.config.autoReconnect) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connect();
      } catch (e) {
        // Will retry on next interval
      }
    }, this.config.reconnectInterval);
  }

  private stopReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // --------------------------------------------------------------------------
  // Request/Response
  // --------------------------------------------------------------------------

  async request<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    const id = ++this.requestId;
    const request: McpRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    if (this.config.transport === 'http-sse') {
      const response = await this.sendHttpRequest(request);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.result as T;
    }

    // WebSocket transport
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not connected'));
        return;
      }

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error('Request timeout'));
      }, this.config.timeout);

      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
      });

      this.ws.send(JSON.stringify(request));
    });
  }

  // --------------------------------------------------------------------------
  // MCP Protocol Methods
  // --------------------------------------------------------------------------

  private async initialize(): Promise<InitializeResult> {
    return this.request<InitializeResult>('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: '@anode/mcp-client',
        version: '1.0.0',
      },
    });
  }

  async listTools(): Promise<{ tools: ToolInfo[] }> {
    return this.request('tools/list');
  }

  async callTool<T = unknown>(name: string, args?: Record<string, unknown>): Promise<T> {
    const result = await this.request<{ content: Array<{ type: string; text?: string; data?: string }> }>(
      'tools/call',
      { name, arguments: args }
    );

    // Parse result content
    const content = result.content?.[0];
    if (content?.type === 'text' && content.text) {
      try {
        return JSON.parse(content.text) as T;
      } catch {
        return content.text as T;
      }
    }
    return result as T;
  }

  async listResources(): Promise<{ resources: Array<{ uri: string; name: string; mimeType?: string }> }> {
    return this.request('resources/list');
  }

  async readResource(uri: string): Promise<{ contents: Array<{ uri: string; text?: string; blob?: string }> }> {
    return this.request('resources/read', { uri });
  }

  async ping(): Promise<void> {
    await this.request('ping');
  }

  // --------------------------------------------------------------------------
  // Convenience Methods for ACS Tools
  // --------------------------------------------------------------------------

  /** File Operations */
  async fileRead(path: string): Promise<{ content: string; size: number }> {
    return this.callTool('file_read', { path });
  }

  async fileWrite(path: string, content: string): Promise<{ success: boolean }> {
    return this.callTool('file_write', { path, content });
  }

  async fileList(path: string): Promise<{ files: Array<{ name: string; isDirectory: boolean; size: number }> }> {
    return this.callTool('file_list', { path });
  }

  async fileExists(path: string): Promise<{ exists: boolean }> {
    return this.callTool('file_exists', { path });
  }

  async fileDelete(path: string): Promise<{ success: boolean }> {
    return this.callTool('file_delete', { path });
  }

  /** App Operations */
  async appList(): Promise<{ apps: Array<{ packageName: string; appName: string }> }> {
    return this.callTool('app_list_installed');
  }

  async appLaunch(packageName: string): Promise<{ success: boolean }> {
    return this.callTool('app_launch', { packageName });
  }

  async appGetInfo(packageName: string): Promise<{ packageName: string; appName: string; versionName: string }> {
    return this.callTool('app_get_info', { packageName });
  }

  /** UI Automation */
  async uiClick(selector: string): Promise<{ success: boolean }> {
    return this.callTool('ui_click', { selector });
  }

  async uiLongClick(selector: string): Promise<{ success: boolean }> {
    return this.callTool('ui_long_click', { selector });
  }

  async uiSetText(selector: string, text: string): Promise<{ success: boolean }> {
    return this.callTool('ui_set_text', { selector, text });
  }

  async uiScroll(direction: 'up' | 'down' | 'left' | 'right'): Promise<{ success: boolean }> {
    return this.callTool('ui_scroll', { direction });
  }

  async uiFindNode(selector: string): Promise<{ found: boolean; node?: unknown }> {
    return this.callTool('ui_find_node', { selector });
  }

  /** Gesture Operations */
  async tap(x: number, y: number): Promise<{ success: boolean }> {
    return this.callTool('gesture_tap', { x, y });
  }

  async swipe(
    startX: number, startY: number,
    endX: number, endY: number,
    duration?: number
  ): Promise<{ success: boolean }> {
    return this.callTool('gesture_swipe', { startX, startY, endX, endY, duration });
  }

  async longPress(x: number, y: number, duration?: number): Promise<{ success: boolean }> {
    return this.callTool('gesture_long_press', { x, y, duration });
  }

  async pinch(
    centerX: number, centerY: number,
    scale: number, duration?: number
  ): Promise<{ success: boolean }> {
    return this.callTool('gesture_pinch', { centerX, centerY, scale, duration });
  }

  async drag(
    startX: number, startY: number,
    endX: number, endY: number,
    duration?: number
  ): Promise<{ success: boolean }> {
    return this.callTool('gesture_drag', { startX, startY, endX, endY, duration });
  }

  /** Layout Analysis */
  async layoutGetRoot(): Promise<{ root: unknown }> {
    return this.callTool('layout_get_root');
  }

  async layoutFindById(id: string): Promise<{ nodes: unknown[] }> {
    return this.callTool('layout_find_by_id', { id });
  }

  async layoutFindByText(text: string, exact?: boolean): Promise<{ nodes: unknown[] }> {
    return this.callTool('layout_find_by_text', { text, exact });
  }

  async layoutFindClickable(): Promise<{ nodes: unknown[] }> {
    return this.callTool('layout_find_clickable');
  }

  /** Image Operations */
  async captureScreen(format?: 'png' | 'jpeg', quality?: number): Promise<{ image: string; width: number; height: number }> {
    return this.callTool('image_capture_screen', { format, quality });
  }

  async findColor(color: string, region?: { x: number; y: number; width: number; height: number }): Promise<{ found: boolean; x?: number; y?: number }> {
    return this.callTool('image_find_color', { color, region });
  }

  async findImage(template: string, threshold?: number): Promise<{ found: boolean; x?: number; y?: number; similarity?: number }> {
    return this.callTool('image_find_image', { template, threshold });
  }

  /** Device Information */
  async deviceGetScreenSize(): Promise<{ width: number; height: number; density: number }> {
    return this.callTool('device_get_screen_size');
  }

  async deviceGetCurrentApp(): Promise<{ packageName: string; activityName: string }> {
    return this.callTool('device_get_current_app');
  }

  async deviceGetScreenState(): Promise<{ isOn: boolean; isLocked: boolean }> {
    return this.callTool('device_get_screen_state');
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createClient(config: McpClientConfig): McpClient {
  return new McpClient(config);
}

// Default export
export default McpClient;
