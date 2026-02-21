import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

/**
 * Gets text from the system clipboard
 * @returns Promise<string> The clipboard content
 */
export async function getClipboardText(): Promise<string> {
  try {
    // Try different methods based on the OS
    if (process.platform === 'win32') {
      // Windows: -Raw returns a single multiline string
      const { stdout } = await execPromise('powershell -NoProfile -Command "Get-Clipboard -Raw"');
      return (stdout || '').replace(/\r\n/g, '\n').trim();
    } else if (process.platform === 'darwin') {
      // macOS
      const { stdout } = await execPromise('pbpaste');
      return stdout;
    } else {
      // Linux
      const { stdout } = await execPromise('xclip -selection clipboard -o 2>/dev/null || xsel --clipboard --output 2>/dev/null || echo ""');
      return stdout;
    }
  } catch (error) {
    console.error('Failed to read clipboard:', error);
    return '';
  }
}

/**
 * Sets text to the system clipboard
 * @param text The text to copy to clipboard
 * @returns Promise<void>
 */
export async function setClipboardText(text: string): Promise<void> {
  try {
    // Try different methods based on the OS
    if (process.platform === 'win32') {
      // Windows
      await execPromise(`echo | set /p="${text.replace(/"/g, '""')}" | clip`);
    } else if (process.platform === 'darwin') {
      // macOS
      await execPromise(`echo "${text.replace(/"/g, '\\"')}" | pbcopy`);
    } else {
      // Linux
      await execPromise(`echo "${text.replace(/"/g, '\\"')}" | xclip -selection clipboard 2>/dev/null || echo "${text.replace(/"/g, '\\"')}" | xsel --clipboard --input 2>/dev/null || true`);
    }
  } catch (error) {
    console.error('Failed to write clipboard:', error);
  }
}

/**
 * Copies text to the system clipboard and returns a success indicator
 * @param text The text to copy
 * @returns Promise<boolean> Whether the copy was successful
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await setClipboardText(text);
    return true;
  } catch (error) {
    console.error('Failed to copy to clipboard:', error);
    return false;
  }
}