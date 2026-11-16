#!/usr/bin/env python3
"""hook_send.py 端到端测试：stdin -> transcript 解析 -> HTTP POST。"""

import json
import os
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

received = []


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        received.append(json.loads(self.rfile.read(length)))
        self.send_response(204)
        self.end_headers()

    def log_message(self, *args):
        pass


server = HTTPServer(("127.0.0.1", 47899), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()

hook = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "remote", "hook_send.py")
tmp = tempfile.mkdtemp()
transcript = os.path.join(tmp, "transcript.jsonl")

with open(transcript, "w", encoding="utf-8") as f:
    records = [
        {"type": "user", "message": {"content": "帮我改个 bug"}},
        {"type": "assistant", "message": {"content": [{"type": "text", "text": "我修好了。\n主要改了  两处。"}]}},
        {"type": "assistant", "isSidechain": True, "message": {"content": [{"type": "text", "text": "子代理的文本"}]}},
    ]
    for record in records:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")

env = dict(
    os.environ,
    HOME=tmp,
    CLAUDE_BALL_URL="http://127.0.0.1:47899/event",
    CLAUDE_CODE_ENTRYPOINT="cli",
)
stdin_payload = json.dumps(
    {
        "session_id": "sess-1",
        "cwd": "/root/proj",
        "transcript_path": transcript,
        "message": "Claude needs your permission to use Bash",
        "prompt": "帮我改个 bug",
    }
).encode()


def run(kind, payload=stdin_payload, extra_env=None):
    run_env = dict(env, **(extra_env or {}))
    out = subprocess.run(
        [sys.executable, hook, kind],
        input=payload,
        env=run_env,
        capture_output=True,
    )
    assert out.returncode == 0, out.stderr
    assert out.stdout == b"", out.stdout
    return out


# done：解析 transcript 最后一条主线程文本
run("done")
assert len(received) == 1, received
done = received[0]
assert done["event"] == "done"
assert done["summary"] == "我修好了。 主要改了 两处。", done["summary"]
assert done["label"] == "proj"
assert done["session_id"] == "sess-1"

# running：首条 prompt 作为 task 带上
received.clear()
run("running")
assert len(received) == 1
assert received[0]["event"] == "running"
assert received[0]["task"] == "帮我改个 bug"

# waiting：带上 Notification 的 message
received.clear()
run("waiting")
assert len(received) == 1
assert received[0]["event"] == "waiting"
assert received[0]["message"].startswith("Claude needs")

# end
received.clear()
run("end")
assert len(received) == 1
assert received[0]["event"] == "end"

# tool：8 秒节流，连跑 3 次只发 1 次
received.clear()
for _ in range(3):
    run("tool")
assert len(received) == 1, received
assert received[0]["event"] == "running"

# 有 ai-title 时，标签优先用会话标题而不是目录名
received.clear()
transcript_title = os.path.join(tmp, "title.jsonl")
with open(transcript_title, "w", encoding="utf-8") as f:
    for record in [
        {"type": "assistant", "message": {"content": [{"type": "text", "text": "标题测试回复"}]}},
        {"type": "ai-title", "aiTitle": "修复登录  Bug"},
    ]:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")
payload_title = json.dumps(
    {
        "session_id": "sess-2",
        "cwd": "/root/proj",
        "transcript_path": transcript_title,
    }
).encode()
run("done", payload_title)
assert len(received) == 1
assert received[0]["label"] == "修复登录 Bug", received[0]["label"]
assert received[0]["summary"] == "标题测试回复", received[0]["summary"]

# /rename 写入 custom-title；即使后面还有更新的 ai-title，也优先用 custom-title
received.clear()
transcript_custom = os.path.join(tmp, "custom-title.jsonl")
with open(transcript_custom, "w", encoding="utf-8") as f:
    for record in [
        {"type": "ai-title", "aiTitle": "自动生成的标题"},
        {"type": "custom-title", "customTitle": "重命名  后的标题"},
        {"type": "ai-title", "aiTitle": "自动生成的标题 2"},
        {"type": "assistant", "message": {"content": [{"type": "text", "text": "自定义标题测试回复"}]}},
    ]:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")
payload_custom = json.dumps(
    {
        "session_id": "sess-3",
        "cwd": "/root/proj",
        "transcript_path": transcript_custom,
    }
).encode()
run("done", payload_custom)
assert len(received) == 1
assert received[0]["label"] == "重命名 后的标题", received[0]["label"]
assert received[0]["summary"] == "自定义标题测试回复", received[0]["summary"]

# headless：环境变量标记为 sdk-cli 时不发任何事件
received.clear()
run("done", stdin_payload, {"CLAUDE_CODE_ENTRYPOINT": "sdk-cli"})
assert received == [], received

# headless：环境变量缺失时，用 transcript 里的 entrypoint 兜底
received.clear()
transcript_headless = os.path.join(tmp, "headless.jsonl")
with open(transcript_headless, "w", encoding="utf-8") as f:
    for record in [
        {"type": "user", "entrypoint": "sdk-cli", "message": {"content": "自动任务"}},
        {"type": "assistant", "entrypoint": "sdk-cli", "message": {"content": [{"type": "text", "text": "完成"}]}},
    ]:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")
payload_headless = json.dumps(
    {
        "session_id": "sess-headless",
        "cwd": "/root/proj",
        "transcript_path": transcript_headless,
    }
).encode()
run("done", payload_headless, {"CLAUDE_CODE_ENTRYPOINT": ""})
assert received == [], received

# 服务端没起来时也必须静默成功退出
received.clear()
env_down = dict(env, CLAUDE_BALL_URL="http://127.0.0.1:47898/event")
out = subprocess.run(
    [sys.executable, hook, "done"], input=stdin_payload, env=env_down, capture_output=True
)
assert out.returncode == 0
assert out.stdout == b""

server.shutdown()
print("hook smoke: ok")
