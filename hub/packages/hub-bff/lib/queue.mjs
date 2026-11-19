import { BffError } from './errors.mjs';
export class AsyncQueue {
  #items = []; #bytes = 0; #waiting; #ended = false; #error;
  push(value) {
    if (this.#ended) return false;
    const bytes = Buffer.byteLength(JSON.stringify(value));
    if (this.#bytes + bytes > 8 * 1024 * 1024) { this.finish(new BffError('UPSTREAM_FAILURE', 'Stream consumer too slow')); return false; }
    this.#items.push({value, bytes}); this.#bytes += bytes; this.#wake(); return true;
  }
  finish(error) { if (this.#ended) return; this.#ended = true; this.#error = error; if (error) { this.#items = []; this.#bytes = 0; } this.#wake(); }
  cancel() { this.#items = []; this.#bytes = 0; this.#error = undefined; this.#ended = true; this.#wake(); }
  #wake() { this.#waiting?.(); this.#waiting = undefined; }
  async next() {
    while (!this.#items.length && !this.#ended) await new Promise(resolve => { this.#waiting = resolve; });
    if (this.#items.length) { const {value,bytes} = this.#items.shift(); this.#bytes -= bytes; return {done:false,value}; }
    if (this.#error) throw this.#error;
    return {done:true};
  }
  [Symbol.asyncIterator]() { return this; }
}
