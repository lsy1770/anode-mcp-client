#!/usr/bin/env node

/**
 * Anode MCP Client - Stdio Bridge
 *
 * 这是一个 stdio 桥接器，将标准输入/输出转换为 WebSocket 连接到 Android 设备。
 * 用于 Claude Code、Cursor 等需要 stdio 类型 MCP 服务器的工具。
 *
 * @package @anode/mcp-client
 */

const WebSocket = require('ws');
const readline = require('readline');

// 配置
const config = {
  host: process.env.ANODE_HOST || process.env.ACS_HOST || '192.168.1.100',
  port: parseInt(process.env.ANODE_PORT || process.env.ACS_PORT || '8765'),
  reconnect: process.env.ANODE_RECONNECT !== 'false',
  reconnectInterval: parseInt(process.env.ANODE_RECONNECT_INTERVAL || '3000'),
};

let ws = null;
let connected = false;
let messageQueue = [];

// 日志输出到 stderr（不干扰 stdio 协议）
function log(...args) {
  console.error('[anode-mcp]', ...args);
}

// 连接 WebSocket
function connect() {
  const url = `ws://${config.host}:${config.port}`;
  log(`Connecting to ${url}...`);

  ws = new WebSocket(url);

  ws.on('open', () => {
    log('Connected to Anode MCP Server');
    connected = true;

    // 发送队列中的消息
    while (messageQueue.length > 0) {
      const msg = messageQueue.shift();
      ws.send(msg);
    }
  });

  ws.on('message', (data) => {
    // 将服务器响应输出到 stdout
    const message = data.toString();
    process.stdout.write(message + '\n');
  });

  ws.on('close', (code, reason) => {
    log(`Disconnected: ${code} ${reason}`);
    connected = false;
    ws = null;

    if (config.reconnect) {
      setTimeout(connect, config.reconnectInterval);
    } else {
      process.exit(1);
    }
  });

  ws.on('error', (error) => {
    log(`WebSocket error: ${error.message}`);
  });
}

// 处理 stdin 输入
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', (line) => {
  if (!line.trim()) return;

  if (connected && ws) {
    ws.send(line);
  } else {
    // 未连接时加入队列
    messageQueue.push(line);
  }
});

rl.on('close', () => {
  log('stdin closed, exiting...');
  if (ws) {
    ws.close(1000, 'Client closing');
  }
  process.exit(0);
});

// 处理进程信号
process.on('SIGINT', () => {
  log('Received SIGINT, closing...');
  if (ws) {
    ws.close(1000, 'Client closing');
  }
  process.exit(0);
});

process.on('SIGTERM', () => {
  log('Received SIGTERM, closing...');
  if (ws) {
    ws.close(1000, 'Client closing');
  }
  process.exit(0);
});

// 启动连接
connect();
