// RFC 6455 client using node:http. No extensions requested; binary and text JSON accepted.
import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { BffError, disconnected } from './errors.mjs';
const LIMIT = 8 * 1024 * 1024;
export class NodeWebSocket extends EventEmitter {
  readyState = 0;
  #socket; #request; #buffer = Buffer.alloc(0); #fragments = []; #size = 0; #fragmentOpcode = 0;
  constructor(url, cookie, timeoutMs = 10000, requestImpl = http.request) {
    super();
    const key = randomBytes(16).toString('base64');
    const expected = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    this.#request = requestImpl(url, { headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': key, Cookie: cookie } });
    const timer = setTimeout(() => this.#fail(disconnected()), timeoutMs); timer.unref();
    this.once('close', () => clearTimeout(timer));
    this.#request.on('error', () => this.#fail(disconnected()));
    this.#request.on('response', res => { res.resume(); this.#fail(disconnected()); });
    this.#request.on('upgrade', (res, socket, head) => {
      clearTimeout(timer);
      if (this.readyState === 3) { socket.destroy(); return; }
      this.#socket = socket;
      if (res.headers['sec-websocket-accept'] !== expected || res.headers.upgrade?.toLowerCase() !== 'websocket' || res.headers['sec-websocket-extensions']) { this.#fail(disconnected()); return; }
      socket.on('data', data => { try { this.#read(data); } catch { this.#fail(new BffError('INCOMPATIBLE', 'Invalid DSH stream frame')); } });
      socket.on('error', () => this.#fail(disconnected()));
      socket.on('close', () => this.#closed());
      this.readyState = 1; this.emit('open');
      if (head.length) { try { this.#read(head); } catch { this.#fail(disconnected()); } }
    });
    this.#request.end();
  }
  send(text) { if (this.readyState !== 1) throw disconnected(); this.#write(1, Buffer.from(text)); }
  close() { if (this.readyState === 1) this.#write(8, Buffer.from([3, 232])); this.#socket?.destroy(); this.#request.destroy(); this.#closed(); }
  #closed() { if (this.readyState === 3) return; this.readyState = 3; this.emit('close'); }
  #fail(error) { if (this.readyState === 3) return; this.emit('failure', error); this.close(); }
  #write(opcode, payload) {
    if (payload.length > LIMIT) throw new BffError('INVALID_INPUT', 'Stream frame too large', 413);
    const extra = payload.length < 126 ? 0 : payload.length < 65536 ? 2 : 8;
    const header = Buffer.alloc(2 + extra + 4); header[0] = 0x80 | opcode;
    header[1] = 0x80 | (extra === 0 ? payload.length : extra === 2 ? 126 : 127);
    if (extra === 2) header.writeUInt16BE(payload.length, 2);
    if (extra === 8) header.writeBigUInt64BE(BigInt(payload.length), 2);
    const mask = randomBytes(4); mask.copy(header, 2 + extra);
    const data = Buffer.from(payload); for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4];
    this.#socket.write(Buffer.concat([header, data]));
    if (this.#socket.writableLength > LIMIT * 2) this.#fail(disconnected());
  }
  #read(data) {
    this.#buffer = Buffer.concat([this.#buffer, data]);
    while (this.#buffer.length >= 2) {
      const b = this.#buffer; const fin = !!(b[0] & 128), opcode = b[0] & 15;
      if (b[0] & 112 || b[1] & 128) throw new Error('invalid flags');
      let length = b[1] & 127, offset = 2;
      if (length === 126) { if (b.length < 4) return; length = b.readUInt16BE(2); offset = 4; }
      else if (length === 127) { if (b.length < 10) return; const n = b.readBigUInt64BE(2); if (n > BigInt(LIMIT)) throw new Error('oversize'); length = Number(n); offset = 10; }
      if (length > LIMIT || (opcode >= 8 && (!fin || length > 125))) throw new Error('oversize');
      if (b.length < offset + length) return;
      const payload = b.subarray(offset, offset + length); this.#buffer = b.subarray(offset + length);
      if (opcode === 8) { this.close(); return; }
      if (opcode === 9) { this.#write(10, payload); continue; }
      if (opcode === 10) continue;
      if (![0, 1, 2].includes(opcode) || (opcode === 0 ? !this.#fragmentOpcode : !!this.#fragmentOpcode)) throw new Error('fragment');
      if (opcode) this.#fragmentOpcode = opcode;
      this.#size += length; if (this.#size > LIMIT) throw new Error('oversize');
      this.#fragments.push(payload);
      if (fin) { const bytes = Buffer.concat(this.#fragments); this.#fragments = []; this.#size = 0; this.#fragmentOpcode = 0; this.emit('message', bytes); }
    }
  }
}
