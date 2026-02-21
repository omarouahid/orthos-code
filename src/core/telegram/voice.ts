import { writeFileSync, unlinkSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

let whisperPipeline: any = null;

/** Get the log file path for ONNX warnings */
function getLogPath(): string {
  const logDir = join(homedir(), '.orthos-code', 'logs');
  try { mkdirSync(logDir, { recursive: true }); } catch { /* exists */ }
  return join(logDir, 'onnx.log');
}

/**
 * Pre-load the Whisper model at bot startup.
 * First run downloads ~40MB model; subsequent runs load from disk cache (~2s).
 */
export async function initWhisper(): Promise<void> {
  if (whisperPipeline) return;

  console.log('[voice] Loading Whisper model (whisper-tiny.en)...');

  // Redirect ONNX runtime native warnings to log file instead of console
  const logPath = getLogPath();
  const origStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: any, ...args: any[]) => {
    const str = typeof chunk === 'string' ? chunk : chunk.toString();
    if (str.includes('onnxruntime') || str.includes('Removing initializer')) {
      try { appendFileSync(logPath, str); } catch { /* ignore */ }
      return true;
    }
    return origStderrWrite(chunk, ...args);
  }) as any;

  const { pipeline } = await import('@xenova/transformers');
  whisperPipeline = await pipeline(
    'automatic-speech-recognition',
    'Xenova/whisper-tiny.en',
  );

  // Restore stderr
  process.stderr.write = origStderrWrite;
  console.log('[voice] Whisper model ready.');
}

/**
 * Transcribe an OGG Opus voice buffer to text.
 * Requires ffmpeg on PATH for OGG → WAV conversion.
 */
export async function transcribeVoice(oggBuffer: Buffer): Promise<string> {
  if (!whisperPipeline) {
    await initWhisper();
  }

  const id = `orthos-voice-${Date.now()}`;
  const oggPath = join(tmpdir(), `${id}.ogg`);
  const wavPath = join(tmpdir(), `${id}.wav`);

  try {
    // Write OGG to temp file
    writeFileSync(oggPath, oggBuffer);

    // Convert OGG Opus → 16kHz mono WAV via ffmpeg
    try {
      execSync(`ffmpeg -i "${oggPath}" -ar 16000 -ac 1 -f wav "${wavPath}" -y`, {
        stdio: 'pipe',
        timeout: 30000,
      });
    } catch {
      throw new Error(
        'ffmpeg is required for voice transcription but was not found. ' +
        'Install it: https://ffmpeg.org/download.html'
      );
    }

    // Read WAV and extract Float32Array samples
    const wavBuffer = readFileSync(wavPath);
    const { WaveFile } = await import('wavefile');
    const wav = new WaveFile(wavBuffer);
    wav.toBitDepth('32f'); // Convert to 32-bit float
    const samples = wav.getSamples(false, Float32Array) as unknown as Float32Array;

    // Run through Whisper
    const result = await whisperPipeline(samples);
    return (result?.text || '').trim();
  } finally {
    // Cleanup temp files
    try { unlinkSync(oggPath); } catch { /* ignore */ }
    try { unlinkSync(wavPath); } catch { /* ignore */ }
  }
}

/**
 * Convert text to speech using node-edge-tts (Microsoft Edge TTS with Sec-MS-GEC token).
 * Returns an MP3 buffer. Telegram accepts MP3 for voice messages.
 * Truncates long text to avoid TTS timeout.
 */
export async function synthesizeSpeech(text: string): Promise<Buffer> {
  // TTS works best with shorter text — truncate to ~1000 chars
  const truncated = text.length > 1000 ? text.slice(0, 1000) + '...' : text;

  const { EdgeTTS } = await import('node-edge-tts');
  const tts = new EdgeTTS({
    voice: 'en-US-GuyNeural',
    lang: 'en-US',
    rate: '+5%',
  });

  // node-edge-tts only writes to files — use a temp file
  const outPath = join(tmpdir(), `orthos-tts-${Date.now()}.mp3`);
  try {
    await tts.ttsPromise(truncated, outPath);
    const audioBuffer = readFileSync(outPath);
    if (!audioBuffer || audioBuffer.length === 0) {
      throw new Error('TTS returned empty audio file');
    }
    return audioBuffer;
  } finally {
    try { unlinkSync(outPath); } catch { /* ignore */ }
  }
}

/**
 * Download a file from Telegram servers by file_id.
 */
export async function downloadTelegramFile(
  fileId: string,
  botToken: string,
): Promise<Buffer> {
  // Step 1: Get the file path from Telegram API
  const fileInfoRes = await fetch(
    `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`,
  );
  const fileInfo = (await fileInfoRes.json()) as {
    ok: boolean;
    result?: { file_path: string };
  };

  if (!fileInfo.ok || !fileInfo.result?.file_path) {
    throw new Error('Failed to get file info from Telegram');
  }

  // Step 2: Download the file
  const fileUrl = `https://api.telegram.org/file/bot${botToken}/${fileInfo.result.file_path}`;
  const fileRes = await fetch(fileUrl);
  if (!fileRes.ok) {
    throw new Error(`Failed to download file: ${fileRes.status}`);
  }

  const arrayBuffer = await fileRes.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
