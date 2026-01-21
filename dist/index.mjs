// src/index.ts
import WebSocket from "ws";
import EventSource from "eventsource";
var McpClient = class {
  constructor(config) {
    this.ws = null;
    this.eventSource = null;
    this.requestId = 0;
    this.pendingRequests = /* @__PURE__ */ new Map();
    this.eventHandlers = {};
    this._state = "disconnected";
    this.reconnectTimer = null;
    this.serverInfo = null;
    this.capabilities = null;
    this.config = {
      host: config.host,
      wsPort: config.wsPort ?? 8765,
      httpPort: config.httpPort ?? 8766,
      transport: config.transport ?? "websocket",
      autoReconnect: config.autoReconnect ?? true,
      reconnectInterval: config.reconnectInterval ?? 3e3,
      timeout: config.timeout ?? 3e4
    };
  }
  // --------------------------------------------------------------------------
  // Connection Management
  // --------------------------------------------------------------------------
  get state() {
    return this._state;
  }
  get isConnected() {
    return this._state === "connected";
  }
  get server() {
    return this.serverInfo;
  }
  async connect() {
    if (this._state === "connected") {
      throw new Error("Already connected");
    }
    this.setState("connecting");
    try {
      if (this.config.transport === "websocket") {
        await this.connectWebSocket();
      } else {
        await this.connectHttpSse();
      }
      const result = await this.initialize();
      this.serverInfo = result.serverInfo;
      this.capabilities = result.capabilities;
      this.setState("connected");
      this.emit("connect");
      return result;
    } catch (error) {
      this.setState("error");
      this.emit("error", error);
      throw error;
    }
  }
  async disconnect() {
    this.stopReconnectTimer();
    if (this.ws) {
      this.ws.close(1e3, "Client disconnect");
      this.ws = null;
    }
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Client disconnected"));
    }
    this.pendingRequests.clear();
    this.setState("disconnected");
    this.emit("disconnect", "Client initiated");
  }
  // --------------------------------------------------------------------------
  // Event Handling
  // --------------------------------------------------------------------------
  on(event, handler) {
    if (!this.eventHandlers[event]) {
      this.eventHandlers[event] = [];
    }
    this.eventHandlers[event].push(handler);
  }
  off(event, handler) {
    const handlers = this.eventHandlers[event];
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index !== -1) {
        handlers.splice(index, 1);
      }
    }
  }
  emit(event, ...args) {
    const handlers = this.eventHandlers[event];
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(...args);
        } catch (e) {
          console.error(`Error in event handler for ${event}:`, e);
        }
      }
    }
  }
  setState(state) {
    if (this._state !== state) {
      this._state = state;
      this.emit("stateChange", state);
    }
  }
  // --------------------------------------------------------------------------
  // WebSocket Transport
  // --------------------------------------------------------------------------
  connectWebSocket() {
    return new Promise((resolve, reject) => {
      const url = `ws://${this.config.host}:${this.config.wsPort}`;
      this.ws = new WebSocket(url);
      this.ws.on("open", () => resolve());
      this.ws.on("error", (error) => {
        reject(error);
      });
      this.ws.on("message", (data) => {
        this.handleMessage(data.toString());
      });
      this.ws.on("close", (code, reason) => {
        this.handleDisconnect(reason.toString());
      });
    });
  }
  // --------------------------------------------------------------------------
  // HTTP/SSE Transport
  // --------------------------------------------------------------------------
  connectHttpSse() {
    return new Promise((resolve, reject) => {
      const sseUrl = `http://${this.config.host}:${this.config.httpPort}/mcp/events`;
      this.eventSource = new EventSource(sseUrl);
      this.eventSource.onopen = () => resolve();
      this.eventSource.onerror = (error) => {
        reject(new Error("SSE connection failed"));
      };
      this.eventSource.addEventListener("message", (event) => {
        this.handleMessage(event.data);
      });
      this.eventSource.addEventListener("connected", (event) => {
      });
    });
  }
  async sendHttpRequest(request) {
    const url = `http://${this.config.host}:${this.config.httpPort}/mcp/message`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(request)
    });
    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }
    return response.json();
  }
  // --------------------------------------------------------------------------
  // Message Handling
  // --------------------------------------------------------------------------
  handleMessage(data) {
    try {
      const message = JSON.parse(data);
      if ("id" in message) {
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
      } else if ("method" in message) {
        this.emit("notification", message);
      }
    } catch (e) {
      console.error("Failed to parse message:", e);
    }
  }
  handleDisconnect(reason) {
    this.ws = null;
    this.setState("disconnected");
    this.emit("disconnect", reason);
    if (this.config.autoReconnect) {
      this.scheduleReconnect();
    }
  }
  scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connect();
      } catch (e) {
      }
    }, this.config.reconnectInterval);
  }
  stopReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
  // --------------------------------------------------------------------------
  // Request/Response
  // --------------------------------------------------------------------------
  async request(method, params) {
    const id = ++this.requestId;
    const request = {
      jsonrpc: "2.0",
      id,
      method,
      params
    };
    if (this.config.transport === "http-sse") {
      const response = await this.sendHttpRequest(request);
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.result;
    }
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("WebSocket not connected"));
        return;
      }
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error("Request timeout"));
      }, this.config.timeout);
      this.pendingRequests.set(id, {
        resolve,
        reject,
        timeout
      });
      this.ws.send(JSON.stringify(request));
    });
  }
  // --------------------------------------------------------------------------
  // MCP Protocol Methods
  // --------------------------------------------------------------------------
  async initialize() {
    return this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "@anode/mcp-client",
        version: "1.0.0"
      }
    });
  }
  async listTools() {
    return this.request("tools/list");
  }
  async callTool(name, args) {
    const result = await this.request(
      "tools/call",
      { name, arguments: args }
    );
    const content = result.content?.[0];
    if (content?.type === "text" && content.text) {
      try {
        return JSON.parse(content.text);
      } catch {
        return content.text;
      }
    }
    return result;
  }
  async listResources() {
    return this.request("resources/list");
  }
  async readResource(uri) {
    return this.request("resources/read", { uri });
  }
  async ping() {
    await this.request("ping");
  }
  // --------------------------------------------------------------------------
  // Convenience Methods for ACS Tools
  // --------------------------------------------------------------------------
  /** File Operations */
  async fileRead(path) {
    return this.callTool("file_read", { path });
  }
  async fileWrite(path, content) {
    return this.callTool("file_write", { path, content });
  }
  async fileList(path) {
    return this.callTool("file_list", { path });
  }
  async fileExists(path) {
    return this.callTool("file_exists", { path });
  }
  async fileDelete(path) {
    return this.callTool("file_delete", { path });
  }
  /** App Operations */
  async appList() {
    return this.callTool("app_list_installed");
  }
  async appLaunch(packageName) {
    return this.callTool("app_launch", { packageName });
  }
  async appGetInfo(packageName) {
    return this.callTool("app_get_info", { packageName });
  }
  /** UI Automation */
  async uiClick(selector) {
    return this.callTool("ui_click", { selector });
  }
  async uiLongClick(selector) {
    return this.callTool("ui_long_click", { selector });
  }
  async uiSetText(selector, text) {
    return this.callTool("ui_set_text", { selector, text });
  }
  async uiScroll(direction) {
    return this.callTool("ui_scroll", { direction });
  }
  async uiFindNode(selector) {
    return this.callTool("ui_find_node", { selector });
  }
  /** Gesture Operations */
  async tap(x, y) {
    return this.callTool("gesture_tap", { x, y });
  }
  async swipe(startX, startY, endX, endY, duration) {
    return this.callTool("gesture_swipe", { startX, startY, endX, endY, duration });
  }
  async longPress(x, y, duration) {
    return this.callTool("gesture_long_press", { x, y, duration });
  }
  async pinch(centerX, centerY, scale, duration) {
    return this.callTool("gesture_pinch", { centerX, centerY, scale, duration });
  }
  async drag(startX, startY, endX, endY, duration) {
    return this.callTool("gesture_drag", { startX, startY, endX, endY, duration });
  }
  /** Layout Analysis */
  async layoutGetRoot() {
    return this.callTool("layout_get_root");
  }
  async layoutFindById(id) {
    return this.callTool("layout_find_by_id", { id });
  }
  async layoutFindByText(text, exact) {
    return this.callTool("layout_find_by_text", { text, exact });
  }
  async layoutFindClickable() {
    return this.callTool("layout_find_clickable");
  }
  /** Image Operations */
  async captureScreen(format, quality) {
    return this.callTool("image_capture_screen", { format, quality });
  }
  async findColor(color, region) {
    return this.callTool("image_find_color", { color, region });
  }
  async findImage(template, threshold) {
    return this.callTool("image_find_image", { template, threshold });
  }
  /** Device Information */
  async deviceGetScreenSize() {
    return this.callTool("device_get_screen_size");
  }
  async deviceGetCurrentApp() {
    return this.callTool("device_get_current_app");
  }
  async deviceGetScreenState() {
    return this.callTool("device_get_screen_state");
  }
};
function createClient(config) {
  return new McpClient(config);
}
var index_default = McpClient;
export {
  McpClient,
  createClient,
  index_default as default
};
