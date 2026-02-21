import type { ToolDefinition, ToolResult } from './types.js';
import type { BrowserClient } from '../browser/client.js';

export const browserTool: ToolDefinition = {
  name: 'browser',
  description: `Control the user's Chrome browser via the Orthos extension. Actions:
- navigate: Go to a URL. Params: { url: string }
- click: Click an element. Params: { selector: string }
- type: Type text into an input. Params: { selector: string, text: string }
- screenshot: Capture visible tab as base64 PNG. No params needed.
- readDOM: Extract page content/structure. Params: { selector?: string } (defaults to body)
- fillForm: Fill multiple form fields. Params: { fields: { "selector": "value", ... } }
- getTabs: List open tabs. No params.
- executeJS: Run JavaScript on the page. Params: { code: string }
- waitForSelector: Wait for element to appear. Params: { selector: string, timeout?: number }
- scrollTo: Scroll to element or direction. Params: { selector?: string, direction?: "up"|"down" }
- getPageInfo: Get current page title, URL, and meta info. No params.`,
  category: 'execute',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'The browser action to perform',
        enum: [
          'navigate', 'click', 'type', 'screenshot', 'readDOM',
          'fillForm', 'getTabs', 'executeJS', 'waitForSelector',
          'scrollTo', 'getPageInfo',
        ],
      },
      params: {
        type: 'string',
        description: 'JSON string of action parameters. E.g. {"url":"https://example.com"} for navigate, {"selector":"#btn"} for click.',
      },
    },
    required: ['action'],
  },
};

export async function executeBrowser(
  args: Record<string, unknown>,
  browserClient: BrowserClient | null
): Promise<ToolResult> {
  const start = Date.now();
  const action = args.action as string;
  let params: Record<string, unknown> = {};

  if (args.params) {
    try {
      params = typeof args.params === 'string' ? JSON.parse(args.params) : args.params as Record<string, unknown>;
    } catch {
      return {
        name: 'browser',
        success: false,
        output: 'Invalid params JSON. Ensure params is a valid JSON string.',
        duration: Date.now() - start,
      };
    }
  }

  if (!browserClient || !browserClient.isConnected) {
    return {
      name: 'browser',
      success: false,
      output: 'Browser extension not connected. Start with /browser and install the Chrome extension.',
      duration: Date.now() - start,
    };
  }

  try {
    let response;
    switch (action) {
      case 'navigate':
        if (!params.url) return fail('navigate requires a "url" parameter', start);
        response = await browserClient.navigate(params.url as string);
        break;
      case 'click':
        if (!params.selector) return fail('click requires a "selector" parameter', start);
        response = await browserClient.click(params.selector as string);
        break;
      case 'type':
        if (!params.selector || params.text === undefined) return fail('type requires "selector" and "text" parameters', start);
        response = await browserClient.type(params.selector as string, params.text as string);
        break;
      case 'screenshot':
        response = await browserClient.screenshot();
        break;
      case 'readDOM':
        response = await browserClient.readDOM(params.selector as string | undefined);
        break;
      case 'fillForm':
        if (!params.fields) return fail('fillForm requires a "fields" parameter', start);
        response = await browserClient.fillForm(params.fields as Record<string, string>);
        break;
      case 'getTabs':
        response = await browserClient.getTabs();
        break;
      case 'executeJS':
        if (!params.code) return fail('executeJS requires a "code" parameter', start);
        response = await browserClient.executeJS(params.code as string);
        break;
      case 'waitForSelector':
        if (!params.selector) return fail('waitForSelector requires a "selector" parameter', start);
        response = await browserClient.waitForSelector(
          params.selector as string,
          params.timeout as number | undefined
        );
        break;
      case 'scrollTo':
        response = await browserClient.scrollTo(params.selector as string | undefined, params.direction as string | undefined);
        break;
      case 'getPageInfo':
        response = await browserClient.getPageInfo();
        break;
      default:
        return fail(`Unknown browser action: ${action}`, start);
    }

    return {
      name: 'browser',
      success: response.success,
      output: response.success
        ? JSON.stringify(response.data, null, 2)
        : (response.error || 'Browser action failed'),
      duration: Date.now() - start,
    };
  } catch (err) {
    return {
      name: 'browser',
      success: false,
      output: `Browser action failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      duration: Date.now() - start,
    };
  }
}

function fail(message: string, start: number): ToolResult {
  return { name: 'browser', success: false, output: message, duration: Date.now() - start };
}
