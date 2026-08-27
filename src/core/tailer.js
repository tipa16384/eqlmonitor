'use strict';

const fs = require('node:fs');
const { StringDecoder } = require('node:string_decoder');

class LogTailer {
  constructor(filePath, onLine, options = {}) {
    this.filePath = filePath;
    this.onLine = onLine;
    this.pollMs = options.pollMs || 500;
    this.offset = 0;
    this.partial = '';
    this.timer = null;
    this.running = false;
    this.reading = false;
  }

  async start({ fromBeginning = true } = {}) {
    if (this.running) return;
    this.running = true;
    const stat = await fs.promises.stat(this.filePath);
    this.offset = fromBeginning ? 0 : stat.size;
    if (fromBeginning && stat.size) await this.readNewBytes(stat.size);
    this.timer = setInterval(() => this.poll().catch(() => {}), this.pollMs);
  }

  async poll() {
    if (!this.running || this.reading) return;
    const stat = await fs.promises.stat(this.filePath);
    if (stat.size < this.offset) { this.offset = 0; this.partial = ''; }
    if (stat.size > this.offset) await this.readNewBytes(stat.size);
  }

  async readNewBytes(size) {
    this.reading = true;
    const start = this.offset;
    const end = size - 1;
    const decoder = new StringDecoder('utf8');
    await new Promise((resolve, reject) => {
      const stream = fs.createReadStream(this.filePath, { start, end });
      stream.on('data', (chunk) => {
        const text = this.partial + decoder.write(chunk);
        const lines = text.split(/\r?\n/);
        this.partial = lines.pop() || '';
        for (const line of lines) if (line) this.onLine(line);
      });
      stream.on('end', () => {
        const rest = decoder.end();
        if (rest) this.partial += rest;
        resolve();
      });
      stream.on('error', reject);
    });
    this.offset = size;
    this.reading = false;
  }

  stop() {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = { LogTailer };
