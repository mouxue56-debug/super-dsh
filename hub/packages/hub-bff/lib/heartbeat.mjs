import { join } from 'node:path';
import { atomicFile } from './runtime.mjs';

// 心跳与连接状态变化共用写队列，旧的 true 不能覆盖断线/退出后的 false。
export class BffHeartbeat {
  constructor({client,runtime,configDir,now = Date.now,interactions = true,logger = console}) {
    Object.assign(this,{client,runtime,now,interactions,logger});
    this.path = join(configDir,'bff-heartbeat.json');
    this.writes = Promise.resolve(); this.stopped = false;
  }
  state() {
    let deviceLastSeen = null;
    for (const ts of this.runtime.devices.values()) if (deviceLastSeen === null || ts > deviceLastSeen) deviceLastSeen = ts;
    const dshConnected = Boolean(this.client.connected && this.client.eventsReady);
    return {v:1,ts:this.now(),pid:process.pid,dshConnected,
      answering:!this.stopped && this.interactions && dshConnected && this.client.answering === true,
      devicePresent:this.runtime.present(),deviceLastSeen};
  }
  write() {
    const snapshot = this.state();
    const write = this.writes.then(() => atomicFile(this.path,JSON.stringify(snapshot)+'\n'));
    this.writes = write.catch(() => {}); return write;
  }
  changed() { void this.write().catch(() => this.logger.error('HUB_BFF_HEARTBEAT_FAILURE')); }
  async start() {
    await this.write();
    if (this.stopped) return;
    this.timer = setInterval(() => this.changed(),5000); this.timer.unref();
  }
  async stop() { this.stopped = true; clearInterval(this.timer); await this.write(); }
}
