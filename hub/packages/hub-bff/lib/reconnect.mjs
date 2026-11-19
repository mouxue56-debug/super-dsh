// 单一重试队列；业务读请求不绕过退避，任何写请求都不在这里重放。
export class Reconnector {
  constructor({client,random=Math.random,schedule=setTimeout,cancel=clearTimeout}) {
    Object.assign(this,{client,random,schedule,cancel});this.stopped=true;this.attempt=0;
  }
  async start() {
    if(!this.stopped)return;this.stopped=false;
    this.off=this.client.onStateChange(()=>{
      if(this.client.connected && (!this.client.interactionHandler || this.client.eventsReady)) {
        this.attempt=0;if(this.timer!==undefined)this.cancel(this.timer);this.timer=undefined;
      } else if(!this.client.connected)this.retry();
    });
    await this.tryConnect();
  }
  async tryConnect() {
    if(this.stopped || this.inFlight)return;
    this.inFlight=true;
    try {await this.client.connect({retry:true});this.attempt=0;}
    catch {this.retry();}
    finally {this.inFlight=false;}
  }
  retry() {
    if(this.stopped || this.timer!==undefined)return;
    const base=Math.min(30000,1000*2**Math.min(this.attempt++,5));
    // ±20% 抖动，实际等待也不超过 30 秒。
    this.delay=Math.min(30000,Math.round(base*(0.8+0.4*this.random())));
    this.timer=this.schedule(()=>{this.timer=undefined;return this.tryConnect();},this.delay);this.timer?.unref?.();
  }
  stop() {this.stopped=true;this.off?.();if(this.timer!==undefined)this.cancel(this.timer);this.timer=undefined;}
}
