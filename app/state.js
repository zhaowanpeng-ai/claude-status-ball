'use strict';

const EVENTS = new Set(['running', 'waiting', 'done', 'end']);

class SessionStore {
  constructor() {
    this.sessions = new Map();
  }

  apply(evt) {
    const id = evt.session_id;
    if (!id) return { type: 'noop' };

    if (evt.event === 'end') {
      if (!this.sessions.has(id)) return { type: 'noop' };
      this.sessions.delete(id);
      return { type: 'end', id };
    }

    const prev = this.sessions.get(id);
    let state;
    let summary = '';
    let message = '';
    let task = '';

    switch (evt.event) {
      case 'running':
        state = 'running';
        task = String(evt.task || '').slice(0, 200);
        break;
      case 'waiting':
        // 完成态优先：Claude 停止后的“等待输入”通知不应把绿球改回琥珀色
        if (prev && prev.state === 'done') return { type: 'noop' };
        state = 'waiting';
        message = String(evt.message || '').slice(0, 400);
        break;
      case 'done':
        state = 'done';
        summary = String(evt.summary || '').slice(0, 2000);
        break;
      default:
        return { type: 'noop' };
    }

    const session = {
      id,
      state,
      label: String(evt.label || id.slice(0, 6)),
      cwd: String(evt.cwd || ''),
      summary,
      message,
      task,
      updatedAt: Date.now(),
    };
    this.sessions.set(id, session);
    return { type: 'upsert', session, prevState: prev ? prev.state : null };
  }

  get(id) {
    return this.sessions.get(id);
  }

  values() {
    return [...this.sessions.values()];
  }
}

module.exports = { SessionStore, EVENTS };
