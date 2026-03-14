export class ProxyManager {
  private proxies: { host: string, port: number }[];
  private currentIndex: number = 0;

  constructor(proxies: { host: string, port: number }[]) {
    this.proxies = proxies;
  }

  public getProxy(): { host: string, port: number } {
    const proxy = this.proxies[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.proxies.length;
    return proxy;
  }
}
