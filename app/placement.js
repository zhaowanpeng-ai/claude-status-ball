'use strict';

// 纯几何计算，便于单测；坐标单位与 Electron 的 DIP 一致。

function unionBounds(rects) {
  if (!rects.length) return { x: 0, y: 0, width: 1, height: 1 };
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const rect of rects) {
    x1 = Math.min(x1, rect.x);
    y1 = Math.min(y1, rect.y);
    x2 = Math.max(x2, rect.x + rect.width);
    y2 = Math.max(y2, rect.y + rect.height);
  }
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

function clampPosition(x, y, width, height, area, margin = 0) {
  return {
    x: Math.max(area.x + margin, Math.min(x, area.x + area.width - width - margin)),
    y: Math.max(area.y + margin, Math.min(y, area.y + area.height - height - margin)),
  };
}

function intersects(a, b) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function overlaps(a, b, pad = 1) {
  return intersects(
    { x: a.x - pad, y: a.y - pad, width: a.width + pad * 2, height: a.height + pad * 2 },
    b
  );
}

// 新球优先贴着锚点，从锚点向上/向下找空位，避免和已有的球重叠。
function spawnPosition(anchor, existingRects, area, size, step) {
  const candidates = [];
  for (let i = 0; i < 12; i += 1) {
    candidates.push({ x: anchor.x, y: anchor.y - i * step });
    if (i > 0) candidates.push({ x: anchor.x, y: anchor.y + i * step });
  }

  for (const candidate of candidates) {
    const pos = clampPosition(candidate.x, candidate.y, size, size, area, 0);
    const rect = { x: pos.x, y: pos.y, width: size, height: size };
    if (existingRects.some((other) => overlaps(rect, other))) continue;
    return pos;
  }

  return clampPosition(anchor.x, anchor.y, size, size, area, 0);
}

module.exports = { unionBounds, clampPosition, intersects, overlaps, spawnPosition };
