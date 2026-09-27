// wee-remote-core — ของกลางของ Wee Remote ที่ทุก host/เครื่องมือใช้ร่วม (Wee IDE · wee-node · wee-relay tools)
// โมดูลย่อย import แยกได้: wee-remote-core/protocol (type ล้วน · ใช้ใน renderer ได้) · /e2e · /chat-events · /history · /guards · /git
export * from './protocol.js';
export * from './e2e.js';
export * from './chat-events.js';
export * from './history.js';
export * from './guards.js';
export * from './git.js';
