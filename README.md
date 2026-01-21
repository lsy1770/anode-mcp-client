# @anode/mcp-client

A TypeScript/JavaScript client for connecting to Anode Android MCP Server.

Enables AI assistants like Claude to control Android devices through the Model Context Protocol (MCP).

## Installation

```bash
npm install @anode/mcp-client
```

## Quick Start

```typescript
import { McpClient } from '@anode/mcp-client';

// Create client
const client = new McpClient({
  host: '192.168.1.100',  // Android device IP
  transport: 'websocket'   // or 'http-sse'
});

// Connect
await client.connect();
console.log('Connected to:', client.server?.name);

// Use automation tools
await client.tap(500, 800);
await client.swipe(500, 1500, 500, 500, 300);

const screenshot = await client.captureScreen();
console.log('Screenshot size:', screenshot.width, 'x', screenshot.height);

// Disconnect
await client.disconnect();
```

## Configuration

```typescript
const client = new McpClient({
  host: '192.168.1.100',    // Required: Android device IP
  wsPort: 8765,             // WebSocket port (default: 8765)
  httpPort: 8766,           // HTTP/SSE port (default: 8766)
  transport: 'websocket',   // 'websocket' or 'http-sse' (default: websocket)
  autoReconnect: true,      // Auto reconnect on disconnect (default: true)
  reconnectInterval: 3000,  // Reconnect interval in ms (default: 3000)
  timeout: 30000            // Request timeout in ms (default: 30000)
});
```

## Event Handling

```typescript
client.on('connect', () => {
  console.log('Connected!');
});

client.on('disconnect', (reason) => {
  console.log('Disconnected:', reason);
});

client.on('error', (error) => {
  console.error('Error:', error);
});

client.on('notification', (notification) => {
  console.log('Notification:', notification.method);
});

client.on('stateChange', (state) => {
  console.log('State:', state); // 'disconnected' | 'connecting' | 'connected' | 'error'
});
```

## API Reference

### Connection

```typescript
await client.connect();           // Connect to server
await client.disconnect();        // Disconnect
client.isConnected;               // boolean
client.state;                     // ConnectionState
client.server;                    // ServerInfo | null
```

### Low-Level Methods

```typescript
// List all available tools
const { tools } = await client.listTools();

// Call any tool
const result = await client.callTool('tool_name', { arg1: 'value' });

// Send raw MCP request
const response = await client.request('method', { params });
```

### File Operations

```typescript
// Read file
const { content } = await client.fileRead('/sdcard/test.txt');

// Write file
await client.fileWrite('/sdcard/test.txt', 'Hello World');

// List directory
const { files } = await client.fileList('/sdcard/');

// Check existence
const { exists } = await client.fileExists('/sdcard/test.txt');

// Delete file
await client.fileDelete('/sdcard/test.txt');
```

### App Management

```typescript
// List installed apps
const { apps } = await client.appList();

// Launch app
await client.appLaunch('com.example.app');

// Get app info
const info = await client.appGetInfo('com.example.app');
```

### UI Automation

```typescript
// Click by selector
await client.uiClick('text("Button")');

// Long click
await client.uiLongClick('id("item")');

// Set text
await client.uiSetText('className("EditText")', 'Hello');

// Scroll
await client.uiScroll('down');

// Find node
const { found, node } = await client.uiFindNode('text("Title")');
```

### Gesture Operations

```typescript
// Tap
await client.tap(500, 800);

// Swipe
await client.swipe(500, 1500, 500, 500, 300);

// Long press
await client.longPress(500, 800, 1000);

// Pinch (zoom)
await client.pinch(540, 960, 0.5);  // zoom out
await client.pinch(540, 960, 2.0);  // zoom in

// Drag
await client.drag(100, 100, 500, 500, 500);
```

### Layout Analysis

```typescript
// Get root node
const { root } = await client.layoutGetRoot();

// Find by ID
const { nodes } = await client.layoutFindById('com.app:id/button');

// Find by text
const { nodes } = await client.layoutFindByText('Submit');

// Find all clickable
const { nodes } = await client.layoutFindClickable();
```

### Image Operations

```typescript
// Capture screen
const { image, width, height } = await client.captureScreen('png', 90);

// Find color
const { found, x, y } = await client.findColor('#FF0000');

// Find image
const { found, x, y, similarity } = await client.findImage(templateBase64, 0.9);
```

### Device Information

```typescript
// Get screen size
const { width, height, density } = await client.deviceGetScreenSize();

// Get current app
const { packageName, activityName } = await client.deviceGetCurrentApp();

// Get screen state
const { isOn, isLocked } = await client.deviceGetScreenState();
```

## Complete Example

```typescript
import { McpClient } from '@anode/mcp-client';

async function automateApp() {
  const client = new McpClient({
    host: '192.168.1.100'
  });

  try {
    // Connect
    await client.connect();
    console.log('Connected to', client.server?.name);

    // Launch app
    await client.appLaunch('com.example.myapp');
    await sleep(2000);

    // Find and click login button
    const loginBtn = await client.layoutFindByText('Login');
    if (loginBtn.nodes.length > 0) {
      await client.uiClick('text("Login")');
    }

    // Enter credentials
    await client.uiSetText('id("username")', 'myuser');
    await client.uiSetText('id("password")', 'mypass');

    // Submit
    await client.uiClick('text("Submit")');
    await sleep(3000);

    // Take screenshot
    const screenshot = await client.captureScreen();
    console.log('Screenshot captured:', screenshot.width, 'x', screenshot.height);

  } finally {
    await client.disconnect();
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

automateApp().catch(console.error);
```

## Transport Options

### WebSocket (Recommended)

- Real-time bidirectional communication
- Lower latency
- Better for automation scripts

```typescript
const client = new McpClient({
  host: '192.168.1.100',
  transport: 'websocket',
  wsPort: 8765
});
```

### HTTP/SSE

- Firewall friendly
- Works through proxies
- Good for web-based clients

```typescript
const client = new McpClient({
  host: '192.168.1.100',
  transport: 'http-sse',
  httpPort: 8766
});
```

## License

MIT
