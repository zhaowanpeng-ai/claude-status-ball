#!/usr/bin/env node
'use strict';

/*
 * Claude Code hook -> status ball event sender (Node version).
 *
 * Used when Claude Code runs on the same Windows PC as the app:
 *     node "%USERPROFILE%\.claude-ball\hook_send.js" running|tool|done|waiting|end
 *
 * It reads the hook event JSON from stdin and POSTs one event to
 * 127.0.0.1:47831, so no SSH tunnel is needed.
 *
 * Any failure is silent: hooks must never break Claude Code.
 */

const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');

const TARGET_URL = process.env.CLAUDE_BALL_URL || 'http://127.0.0.1:47831/event';
const STATE_DIR = path.join(os.homedir(), '.claude-ball');
const TOOL_THROTTLE_MS = 8000;
const HEADLESS_ENTRYPOINTS = new Set(['sdk-cli', 'sdk-ts', 'sdk-py']);
const TRANSCRIPT_SCAN_BYTES = 256 * 1024;
const TITLE_SCAN_BYTES = 2 * 1024 * 1024;

function chars(value, limit) {
  return Array.from(value).slice(0, limit).join('');
}

function normalize(value) {
  return String(value == null ? '' : value)
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
}

function readTail(file, maxBytes) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - maxBytes);
    const length = size - start;
    const buffer = Buffer.alloc(length);
    let offset = 0;
    while (offset < length) {
      const read = fs.readSync(fd, buffer, offset, length - offset, start + offset);
      if (read <= 0) break;
      offset += read;
    }
    // A partial first line must be skipped when the read started mid-file.
    return { buffer: buffer.subarray(0, offset), dropFirstLine: size >= maxBytes };
  } catch (err) {
    return null;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch (err) {
        // ignore
      }
    }
  }
}

function splitLines(buffer) {
  const lines = [];
  let start = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    if (buffer[i] === 0x0a) {
      lines.push(buffer.subarray(start, i));
      start = i + 1;
    }
  }
  lines.push(buffer.subarray(start));
  return lines;
}

function parseLine(line) {
  const text = line.toString('utf8').trim();
  if (!text) return null;
  try {
    const record = JSON.parse(text);
    return record && typeof record === 'object' && !Array.isArray(record) ? record : null;
  } catch (err) {
    return null;
  }
}

function transcriptEntrypoint(transcriptPath) {
  if (!transcriptPath) return '';
  const tail = readTail(transcriptPath, TRANSCRIPT_SCAN_BYTES);
  if (!tail) return '';
  let lines = splitLines(tail.buffer);
  if (tail.dropFirstLine && lines.length > 0) lines = lines.slice(1);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const record = parseLine(lines[i]);
    if (record && record.entrypoint) return String(record.entrypoint);
  }
  return '';
}

function isHeadless(data) {
  let entrypoint = String(
    data.entrypoint || process.env.CLAUDE_CODE_ENTRYPOINT || ''
  ).trim();
  if (!entrypoint) entrypoint = transcriptEntrypoint(String(data.transcript_path || ''));
  return HEADLESS_ENTRYPOINTS.has(entrypoint);
}

function sessionTitle(transcriptPath) {
  if (!transcriptPath) return '';
  let fd;
  try {
    fd = fs.openSync(transcriptPath, 'r');
    let pos = fs.fstatSync(fd).size;
    let carry = Buffer.alloc(0);
    let scanned = 0;
    let aiTitle = '';

    while (pos > 0 && scanned < TITLE_SCAN_BYTES) {
      const readSize = Math.min(65536, pos);
      pos -= readSize;
      const block = Buffer.alloc(readSize);
      let offset = 0;
      while (offset < readSize) {
        const read = fs.readSync(fd, block, offset, readSize - offset, pos + offset);
        if (read <= 0) break;
        offset += read;
      }
      const data = Buffer.concat([block.subarray(0, offset), carry]);
      const lines = splitLines(data);

      if (pos > 0) {
        // lines[0] may be cut at the chunk boundary; prepend it next round.
        carry = lines.length > 0 ? lines[0] : data;
        for (let i = lines.length - 1; i >= 1; i -= 1) {
          const found = titleFromLine(lines[i], aiTitle);
          if (found && found.custom) return found.custom;
          if (found && found.ai) aiTitle = found.ai;
        }
      } else {
        carry = Buffer.alloc(0);
        for (let i = lines.length - 1; i >= 0; i -= 1) {
          const found = titleFromLine(lines[i], aiTitle);
          if (found && found.custom) return found.custom;
          if (found && found.ai) aiTitle = found.ai;
        }
      }

      scanned += readSize;
    }

    return aiTitle;
  } catch (err) {
    return '';
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch (err) {
        // ignore
      }
    }
  }
}

function titleFromLine(line, currentAiTitle) {
  const record = parseLine(line);
  if (!record) return null;
  if (record.type === 'custom-title') {
    const title = chars(normalize(record.customTitle), 80);
    if (title) return { custom: title };
  } else if (record.type === 'ai-title' && !currentAiTitle) {
    return { ai: chars(normalize(record.aiTitle), 80) };
  }
  return null;
}

function lastAssistantText(transcriptPath) {
  if (!transcriptPath) return '';
  const tail = readTail(transcriptPath, TRANSCRIPT_SCAN_BYTES);
  if (!tail) return '';
  let lines = splitLines(tail.buffer);
  if (tail.dropFirstLine && lines.length > 0) lines = lines.slice(1);

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const record = parseLine(lines[i]);
    if (!record) continue;
    const message = record.message;
    if (!message || typeof message !== 'object' || Array.isArray(message)) continue;
    const isAssistant = record.type === 'assistant' || message.role === 'assistant';
    if (!isAssistant || record.isSidechain) continue;

    const parts = [];
    if (Array.isArray(message.content)) {
      for (const block of message.content) {
        if (!block || typeof block !== 'object' || block.type !== 'text') continue;
        const chunk = String(block.text == null ? '' : block.text).trim();
        if (chunk) parts.push(chunk);
      }
    } else if (typeof message.content === 'string') {
      const chunk = message.content.trim();
      if (chunk) parts.push(chunk);
    }

    const text = normalize(parts.join(' '));
    if (text) return chars(text, 600);
  }
  return '';
}

function cwdLabel(cwd) {
  const trimmed = String(cwd || '').replace(/[\\/]+$/, '');
  if (!trimmed) return '';
  const base = trimmed.split(/[\\/]/).pop() || '';
  return /^[A-Za-z]:$/.test(base) ? '' : base;
}

function shouldSend(kind, sessionId) {
  if (kind !== 'tool') return true;
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const marker = path.join(STATE_DIR, '.last-tool-' + sessionId);
    const now = Date.now();
    try {
      if (now - fs.statSync(marker).mtimeMs < TOOL_THROTTLE_MS) return false;
    } catch (err) {
      // marker does not exist yet
    }
    fs.writeFileSync(marker, '');
    return true;
  } catch (err) {
    return true;
  }
}

function post(payload) {
  return new Promise((resolve) => {
    let url;
    try {
      url = new URL(TARGET_URL);
    } catch (err) {
      resolve();
      return;
    }

    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': body.length,
        },
      },
      (response) => {
        response.resume();
        response.on('end', resolve);
        response.on('error', resolve);
      }
    );

    request.setTimeout(1200, () => {
      request.destroy();
      resolve();
    });
    request.on('error', resolve);
    request.end(body);
  });
}

function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    };

    if (process.stdin.isTTY) {
      finish();
      return;
    }

    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', finish);
    process.stdin.on('error', finish);
  });
}

async function main() {
  const kind = process.argv[2] || '';
  const eventByKind = {
    running: 'running',
    tool: 'running',
    done: 'done',
    waiting: 'waiting',
    end: 'end',
  };
  const event = eventByKind[kind];
  if (!event) return;

  let data = {};
  try {
    const raw = (await readStdin()).toString('utf8').trim() || '{}';
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed;
  } catch (err) {
    data = {};
  }

  if (isHeadless(data)) return;

  const sessionId = String(data.session_id || '');
  if (!sessionId || !shouldSend(kind, sessionId)) return;

  const cwd = String(data.cwd || '');
  const transcriptPath = String(data.transcript_path || '');
  const label = sessionTitle(transcriptPath) || cwdLabel(cwd) || 'claude';

  const payload = {
    v: 1,
    session_id: sessionId,
    event,
    label,
    cwd,
    ts: Date.now() / 1000,
  };

  if (kind === 'done') {
    payload.summary = lastAssistantText(transcriptPath);
  } else if (kind === 'waiting') {
    payload.message = chars(String(data.message || ''), 400);
  } else if (kind === 'running') {
    const prompt = normalize(data.prompt);
    if (prompt) payload.task = chars(prompt, 120);
  }

  await post(payload);
}

if (require.main === module) {
  main()
    .catch(() => {})
    .finally(() => process.exit(0));
}

module.exports = {
  isHeadless,
  lastAssistantText,
  sessionTitle,
  transcriptEntrypoint,
};
