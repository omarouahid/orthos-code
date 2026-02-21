export type BrowserAction =
  | 'navigate'
  | 'click'
  | 'type'
  | 'screenshot'
  | 'readDOM'
  | 'fillForm'
  | 'getTabs'
  | 'executeJS'
  | 'waitForSelector'
  | 'scrollTo'
  | 'getPageInfo';

export interface BrowserRequest {
  id: string;
  action: BrowserAction;
  params: Record<string, unknown>;
}

export interface BrowserResponse {
  id: string;
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

export type BrowserConnectionState = 'disconnected' | 'connecting' | 'connected';

export interface BrowserConfig {
  wsPort: number;
  authToken: string;
  enabled: boolean;
}

export const DEFAULT_BROWSER_CONFIG: BrowserConfig = {
  wsPort: 18900,
  authToken: '',
  enabled: false,
};
