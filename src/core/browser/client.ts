import type { BrowserServer } from './server.js';
import type { BrowserResponse } from './types.js';

export class BrowserClient {
  constructor(private server: BrowserServer) {}

  get isConnected(): boolean {
    return this.server.isConnected;
  }

  async navigate(url: string): Promise<BrowserResponse> {
    return this.server.sendRequest('navigate', { url }, 30000);
  }

  async click(selector: string): Promise<BrowserResponse> {
    return this.server.sendRequest('click', { selector });
  }

  async type(selector: string, text: string): Promise<BrowserResponse> {
    return this.server.sendRequest('type', { selector, text });
  }

  async screenshot(): Promise<BrowserResponse> {
    return this.server.sendRequest('screenshot', {}, 10000);
  }

  async readDOM(selector?: string): Promise<BrowserResponse> {
    return this.server.sendRequest('readDOM', { selector });
  }

  async fillForm(fields: Record<string, string>): Promise<BrowserResponse> {
    return this.server.sendRequest('fillForm', { fields });
  }

  async getTabs(): Promise<BrowserResponse> {
    return this.server.sendRequest('getTabs', {});
  }

  async executeJS(code: string): Promise<BrowserResponse> {
    return this.server.sendRequest('executeJS', { code });
  }

  async waitForSelector(selector: string, timeout: number = 10000): Promise<BrowserResponse> {
    return this.server.sendRequest('waitForSelector', { selector, timeout }, timeout + 5000);
  }

  async scrollTo(selector?: string, direction?: string): Promise<BrowserResponse> {
    return this.server.sendRequest('scrollTo', { selector, direction });
  }

  async getPageInfo(): Promise<BrowserResponse> {
    return this.server.sendRequest('getPageInfo', {});
  }
}
