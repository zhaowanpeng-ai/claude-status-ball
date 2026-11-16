'use strict';

const http = require('http');
const { EVENTS } = require('./state');

const MAX_BODY = 64 * 1024;

function isValid(evt) {
  return Boolean(
    evt &&
      typeof evt === 'object' &&
      typeof evt.session_id === 'string' &&
      evt.session_id.length > 0 &&
      evt.session_id.length <= 128 &&
      EVENTS.has(evt.event)
  );
}

function startEventServer({ port, host = '127.0.0.1', onEvent }) {
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/event') {
      res.writeHead(404);
      res.end();
      return;
    }

    let body = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        res.writeHead(413);
        res.end();
        req.destroy();
        return;
      }
      body += chunk;
    });

    req.on('end', () => {
      let evt;
      try {
        evt = JSON.parse(body);
      } catch {
        res.writeHead(400);
        res.end();
        return;
      }
      if (!isValid(evt)) {
        res.writeHead(400);
        res.end();
        return;
      }
      res.writeHead(204);
      res.end();
      try {
        onEvent(evt);
      } catch (err) {
        console.error('event handler failed:', err);
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      resolve(server);
    });
  });
}

module.exports = { startEventServer };
