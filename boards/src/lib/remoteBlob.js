// A stored file read in pieces, as if it were a Blob: the zip reader
// (lib/zipRead.js) takes one, so Quick look walks a 2 GB zip for the price
// of its directory and the pictures on screen. Every read is one GET with a
// Range for exactly the slice's bytes (R2's CORS allows it, as lib/fileHead.js
// relies on), and a server that answers a piece with the whole file is
// refused rather than read: a 2 GB answer to an 8 KB question.
//
// What zipRead asks of a Blob, and no more: size, slice(), arrayBuffer() and
// stream(). blob() turns a piece into a real Blob, for an <img> or a
// download (a stored entry's openEntry is a slice of this, not a Blob).

const viaFetch = (url, init) => fetch(url, init);

export class RemoteBlob {
  #url;
  #total;
  #fetch;
  #start;
  #end;

  constructor(url, size, { fetchImpl = viaFetch, start = 0, end = size, type = '' } = {}) {
    this.#url = url;
    this.#total = size;
    this.#fetch = fetchImpl;
    this.#start = start;
    this.#end = Math.max(start, end);
    this.type = type;
  }

  get size() { return this.#end - this.#start; }

  // As Blob.slice: offsets from the end when negative, clamped to the piece.
  slice(a = 0, b = this.size, type = '') {
    const n = this.size;
    const at = (v) => (v < 0 ? Math.max(n + v, 0) : Math.min(v, n));
    const from = at(a);
    const to = Math.max(at(b), from);
    return new RemoteBlob(this.#url, this.#total, {
      fetchImpl: this.#fetch, start: this.#start + from, end: this.#start + to, type,
    });
  }

  async #get(signal) {
    const res = await this.#fetch(this.#url, { headers: { Range: `bytes=${this.#start}-${this.#end - 1}` }, signal });
    const whole = this.#start === 0 && this.#end === this.#total;
    if (res.status === 206 || (res.status === 200 && whole)) return res;
    res.body?.cancel?.().catch(() => {});
    throw new Error(`range ${res.status}`);
  }

  #check(got) {
    if (got !== this.size) throw new Error(`range: ${got} of ${this.size} bytes`);
  }

  async arrayBuffer() {
    if (!this.size) return new ArrayBuffer(0);
    const buf = await (await this.#get()).arrayBuffer();
    this.#check(buf.byteLength);
    return buf;
  }

  // The browser keeps the bytes (a big one on disk), not the script's heap.
  async blob(type = this.type, { signal } = {}) {
    if (!this.size) return new Blob([], { type });
    const got = await (await this.#get(signal)).blob();
    this.#check(got.size);
    return new Blob([got], { type });
  }

  // One GET, made when the stream is first read; cancelling it cancels the GET.
  stream() {
    let reader = null;
    const open = async () => {
      if (!reader) reader = (await this.#get()).body.getReader();
      return reader;
    };
    if (!this.size) return new ReadableStream({ start: (c) => c.close() });
    return new ReadableStream({
      async pull(controller) {
        const { done, value } = await (await open()).read();
        if (done) controller.close();
        else controller.enqueue(value);
      },
      cancel(reason) { return reader?.cancel(reason); },
    });
  }
}
