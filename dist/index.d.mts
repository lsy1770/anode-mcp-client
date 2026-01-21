/**
 * Anode MCP Client
 *
 * A TypeScript/JavaScript client for connecting to Anode Android MCP Server.
 * Supports WebSocket and HTTP/SSE transports.
 *
 * @package @anode/mcp-client
 */
interface McpClientConfig {
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
interface McpRequest {
    jsonrpc: '2.0';
    id: number | string;
    method: string;
    params?: Record<string, unknown>;
}
interface McpResponse {
    jsonrpc: '2.0';
    id: number | string;
    result?: unknown;
    error?: {
        code: number;
        message: string;
        data?: unknown;
    };
}
interface McpNotification {
    jsonrpc: '2.0';
    method: string;
    params?: Record<string, unknown>;
}
interface ToolInfo {
    name: string;
    description: string;
    inputSchema: {
        type: 'object';
        properties: Record<string, unknown>;
        required?: string[];
    };
}
interface ServerInfo {
    name: string;
    version: string;
}
interface ServerCapabilities {
    tools?: {
        listChanged?: boolean;
    };
    resources?: {
        subscribe?: boolean;
        listChanged?: boolean;
    };
    prompts?: {
        listChanged?: boolean;
    };
}
interface InitializeResult {
    protocolVersion: string;
    serverInfo: ServerInfo;
    capabilities: ServerCapabilities;
}
type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';
interface McpClientEvents {
    connect: () => void;
    disconnect: (reason?: string) => void;
    error: (error: Error) => void;
    notification: (notification: McpNotification) => void;
    stateChange: (state: ConnectionState) => void;
}
declare class McpClient {
    private config;
    private ws;
    private eventSource;
    private requestId;
    private pendingRequests;
    private eventHandlers;
    private _state;
    private reconnectTimer;
    private serverInfo;
    private capabilities;
    constructor(config: McpClientConfig);
    get state(): ConnectionState;
    get isConnected(): boolean;
    get server(): ServerInfo | null;
    connect(): Promise<InitializeResult>;
    disconnect(): Promise<void>;
    on<K extends keyof McpClientEvents>(event: K, handler: McpClientEvents[K]): void;
    off<K extends keyof McpClientEvents>(event: K, handler: McpClientEvents[K]): void;
    private emit;
    private setState;
    private connectWebSocket;
    private connectHttpSse;
    private sendHttpRequest;
    private handleMessage;
    private handleDisconnect;
    private scheduleReconnect;
    private stopReconnectTimer;
    request<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
    private initialize;
    listTools(): Promise<{
        tools: ToolInfo[];
    }>;
    callTool<T = unknown>(name: string, args?: Record<string, unknown>): Promise<T>;
    listResources(): Promise<{
        resources: Array<{
            uri: string;
            name: string;
            mimeType?: string;
        }>;
    }>;
    readResource(uri: string): Promise<{
        contents: Array<{
            uri: string;
            text?: string;
            blob?: string;
        }>;
    }>;
    ping(): Promise<void>;
    /** File Operations */
    fileRead(path: string): Promise<{
        content: string;
        size: number;
    }>;
    fileWrite(path: string, content: string): Promise<{
        success: boolean;
    }>;
    fileList(path: string): Promise<{
        files: Array<{
            name: string;
            isDirectory: boolean;
            size: number;
        }>;
    }>;
    fileExists(path: string): Promise<{
        exists: boolean;
    }>;
    fileDelete(path: string): Promise<{
        success: boolean;
    }>;
    /** App Operations */
    appList(): Promise<{
        apps: Array<{
            packageName: string;
            appName: string;
        }>;
    }>;
    appLaunch(packageName: string): Promise<{
        success: boolean;
    }>;
    appGetInfo(packageName: string): Promise<{
        packageName: string;
        appName: string;
        versionName: string;
    }>;
    /** UI Automation */
    uiClick(selector: string): Promise<{
        success: boolean;
    }>;
    uiLongClick(selector: string): Promise<{
        success: boolean;
    }>;
    uiSetText(selector: string, text: string): Promise<{
        success: boolean;
    }>;
    uiScroll(direction: 'up' | 'down' | 'left' | 'right'): Promise<{
        success: boolean;
    }>;
    uiFindNode(selector: string): Promise<{
        found: boolean;
        node?: unknown;
    }>;
    /** Gesture Operations */
    tap(x: number, y: number): Promise<{
        success: boolean;
    }>;
    swipe(startX: number, startY: number, endX: number, endY: number, duration?: number): Promise<{
        success: boolean;
    }>;
    longPress(x: number, y: number, duration?: number): Promise<{
        success: boolean;
    }>;
    pinch(centerX: number, centerY: number, scale: number, duration?: number): Promise<{
        success: boolean;
    }>;
    drag(startX: number, startY: number, endX: number, endY: number, duration?: number): Promise<{
        success: boolean;
    }>;
    /** Layout Analysis */
    layoutGetRoot(): Promise<{
        root: unknown;
    }>;
    layoutFindById(id: string): Promise<{
        nodes: unknown[];
    }>;
    layoutFindByText(text: string, exact?: boolean): Promise<{
        nodes: unknown[];
    }>;
    layoutFindClickable(): Promise<{
        nodes: unknown[];
    }>;
    /** Image Operations */
    captureScreen(format?: 'png' | 'jpeg', quality?: number): Promise<{
        image: string;
        width: number;
        height: number;
    }>;
    findColor(color: string, region?: {
        x: number;
        y: number;
        width: number;
        height: number;
    }): Promise<{
        found: boolean;
        x?: number;
        y?: number;
    }>;
    findImage(template: string, threshold?: number): Promise<{
        found: boolean;
        x?: number;
        y?: number;
        similarity?: number;
    }>;
    /** Device Information */
    deviceGetScreenSize(): Promise<{
        width: number;
        height: number;
        density: number;
    }>;
    deviceGetCurrentApp(): Promise<{
        packageName: string;
        activityName: string;
    }>;
    deviceGetScreenState(): Promise<{
        isOn: boolean;
        isLocked: boolean;
    }>;
}
declare function createClient(config: McpClientConfig): McpClient;

export { type ConnectionState, type InitializeResult, McpClient, type McpClientConfig, type McpClientEvents, type McpNotification, type McpRequest, type McpResponse, type ServerCapabilities, type ServerInfo, type ToolInfo, createClient, McpClient as default };
