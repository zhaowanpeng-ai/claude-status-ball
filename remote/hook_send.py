#!/usr/bin/env python3
"""Claude Code hook -> Windows 状态球事件发送器。

由 ~/.claude/settings.json 的 hooks 调用：
    python3 ~/.claude-ball/hook_send.py running|tool|done|waiting|end

从 stdin 读取 hook 事件 JSON，向 127.0.0.1:47831 发送一条状态事件。
该端口由 Windows 上的状态球应用经 SSH 反向隧道转发过来。

任何失败都静默退出，绝不影响 Claude Code 本身。
"""

import json
import os
import sys
import time
import urllib.request
from pathlib import Path

URL = os.environ.get("CLAUDE_BALL_URL", "http://127.0.0.1:47831/event")
STATE_DIR = Path.home() / ".claude-ball"
TOOL_THROTTLE_SECONDS = 8.0
HEADLESS_ENTRYPOINTS = {"sdk-cli", "sdk-ts", "sdk-py"}

# 不走 http_proxy / https_proxy 环境变量，127.0.0.1 必须直连
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def transcript_entrypoint(transcript_path):
    """从 transcript 尾部找最近一条 entrypoint。"""
    if not transcript_path:
        return ""
    try:
        with open(transcript_path, "rb") as f:
            f.seek(0, os.SEEK_END)
            size = f.tell()
            f.seek(max(0, size - 262144))
            raw = f.read()
    except OSError:
        return ""

    lines = raw.splitlines()
    if len(raw) >= 262144 and lines:
        lines = lines[1:]
    for line in reversed(lines):
        try:
            record = json.loads(line)
        except ValueError:
            continue
        entrypoint = record.get("entrypoint")
        if entrypoint:
            return str(entrypoint)
    return ""


def is_headless(data):
    """headless（claude -p / SDK）会话不产生球。"""
    entrypoint = str(
        data.get("entrypoint") or os.environ.get("CLAUDE_CODE_ENTRYPOINT") or ""
    ).strip()
    if not entrypoint:
        entrypoint = transcript_entrypoint(str(data.get("transcript_path") or ""))
    return entrypoint in HEADLESS_ENTRYPOINTS


def session_title(transcript_path):
    """从 transcript 尾部找最近的会话标题：custom-title 优先，其次 ai-title。"""
    if not transcript_path:
        return ""
    ai_title = ""
    try:
        with open(transcript_path, "rb") as f:
            f.seek(0, os.SEEK_END)
            pos = f.tell()
            carry = b""
            scanned = 0
            while pos > 0 and scanned < 2097152:
                read_size = min(65536, pos)
                pos -= read_size
                f.seek(pos)
                block = f.read(read_size) + carry
                lines = block.split(b"\n")
                carry = lines[0] if pos > 0 else b""
                for line in reversed(lines[1:] if pos > 0 else lines):
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        record = json.loads(line)
                    except ValueError:
                        continue
                    kind = record.get("type")
                    if kind == "custom-title":
                        title = " ".join(str(record.get("customTitle") or "").split())
                        if title:
                            return title[:80]
                    elif kind == "ai-title" and not ai_title:
                        ai_title = " ".join(str(record.get("aiTitle") or "").split())[:80]
                scanned += read_size
    except OSError:
        return ""
    return ai_title


def last_assistant_text(transcript_path):
    """从 transcript 尾部取最后一条主线程 assistant 文本。"""
    if not transcript_path:
        return ""
    try:
        with open(transcript_path, "rb") as f:
            f.seek(0, os.SEEK_END)
            size = f.tell()
            f.seek(max(0, size - 262144))
            raw = f.read()
    except OSError:
        return ""

    lines = raw.splitlines()
    if len(raw) >= 262144 and lines:
        lines = lines[1:]  # 第一行可能被截断

    for line in reversed(lines):
        try:
            record = json.loads(line)
        except ValueError:
            continue
        message = record.get("message") or {}
        if not isinstance(message, dict):
            continue
        is_assistant = record.get("type") == "assistant" or message.get("role") == "assistant"
        if not is_assistant or record.get("isSidechain"):
            continue
        content = message.get("content")
        parts = []
        if isinstance(content, list):
            for block in content:
                if isinstance(block, dict) and block.get("type") == "text":
                    chunk = (block.get("text") or "").strip()
                    if chunk:
                        parts.append(chunk)
        elif isinstance(content, str):
            chunk = content.strip()
            if chunk:
                parts.append(chunk)
        text = " ".join(" ".join(parts).split())
        if text:
            return text[:600]
    return ""


def should_send(kind, session_id):
    """PostToolUse 触发很频繁，每 8 秒最多发一次 running。"""
    if kind != "tool":
        return True
    try:
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        marker = STATE_DIR / (".last-tool-" + session_id)
        now = time.time()
        if marker.exists() and now - marker.stat().st_mtime < TOOL_THROTTLE_SECONDS:
            return False
        marker.touch()
        return True
    except OSError:
        return True


def post(payload):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        URL,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        OPENER.open(request, timeout=1.2).read()
    except OSError:
        pass


def main():
    kind = sys.argv[1] if len(sys.argv) > 1 else ""
    event_by_kind = {
        "running": "running",
        "tool": "running",
        "done": "done",
        "waiting": "waiting",
        "end": "end",
    }
    event = event_by_kind.get(kind)
    if not event:
        return

    try:
        data = json.loads(sys.stdin.buffer.read().decode("utf-8", "replace") or "{}")
    except ValueError:
        data = {}
    if not isinstance(data, dict):
        data = {}
    if is_headless(data):
        return

    session_id = str(data.get("session_id") or "")
    if not session_id or not should_send(kind, session_id):
        return

    cwd = str(data.get("cwd") or "")
    transcript_path = str(data.get("transcript_path") or "")
    label = session_title(transcript_path) or os.path.basename(cwd.rstrip("/")) or "claude"

    payload = {
        "v": 1,
        "session_id": session_id,
        "event": event,
        "label": label,
        "cwd": cwd,
        "ts": time.time(),
    }

    if kind == "done":
        payload["summary"] = last_assistant_text(transcript_path)
    elif kind == "waiting":
        payload["message"] = str(data.get("message") or "")[:400]
    elif kind == "running":
        prompt = " ".join(str(data.get("prompt") or "").split())
        if prompt:
            payload["task"] = prompt[:120]

    post(payload)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass
    sys.exit(0)
