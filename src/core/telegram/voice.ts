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
 * Transcribe from pre-decoded Float32 samples (16 kHz mono).
 * Use when you already have samples (e.g. from oggToFloatSamples) to avoid decoding twice.
 */
export async function transcribeFromSamples(samples: Float32Array): Promise<string> {
  if (!whisperPipeline) {
    await initWhisper();
  }
  const result = await whisperPipeline(samples);
  return (result?.text || '').trim();
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
 * Voice activity detection (VAD): detect when the user is talking.
 * Use for call-like flows so we know when to listen / run STT.
 *
 * Simple energy-based VAD: returns true if RMS in the last frame exceeds threshold.
 * For streaming: call with chunks of samples (e.g. 10–20 ms); when true, gate your mic → STT.
 */
const VAD_FRAME_SAMPLES = 320; // 20 ms at 16 kHz
const VAD_RMS_THRESHOLD = 0.01;
const VAD_SILENCE_FRAMES_BEFORE_END = 15; // ~300 ms silence to consider "stopped talking"

export function isVoiceActive(samples: Float32Array, sampleRate = 16000): boolean {
  if (samples.length === 0) return false;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  const rms = Math.sqrt(sum / samples.length);
  return rms >= VAD_RMS_THRESHOLD;
}

export interface VoiceSegment {
  startMs: number;
  endMs: number;
  startSample: number;
  endSample: number;
}

/**
 * Given a full buffer of Float32 samples, return segments where voice was detected.
 * Useful to run STT only on speech segments or to know "when user talked".
 */
export function detectVoiceSegments(
  samples: Float32Array,
  sampleRate = 16000,
  options?: { minSegmentMs?: number; silenceFramesToEnd?: number }
): VoiceSegment[] {
  const minSegmentMs = options?.minSegmentMs ?? 200;
  const silenceToEnd = options?.silenceFramesToEnd ?? VAD_SILENCE_FRAMES_BEFORE_END;
  const frameLen = VAD_FRAME_SAMPLES;
  const segments: VoiceSegment[] = [];
  let inSegment = false;
  let segmentStart = 0;
  let silenceCount = 0;

  for (let i = 0; i + frameLen <= samples.length; i += frameLen) {
    const frame = samples.subarray(i, i + frameLen);
    const active = isVoiceActive(frame, sampleRate);
    if (active) {
      if (!inSegment) {
        inSegment = true;
        segmentStart = i;
      }
      silenceCount = 0;
    } else {
      if (inSegment) {
        silenceCount++;
        if (silenceCount >= silenceToEnd) {
          const endSample = i - (silenceToEnd - 1) * frameLen;
          const startMs = (segmentStart / sampleRate) * 1000;
          const endMs = (endSample / sampleRate) * 1000;
          if (endMs - startMs >= minSegmentMs) {
            segments.push({ startMs, endMs, startSample: segmentStart, endSample });
          }
          inSegment = false;
        }
      }
    }
  }
  if (inSegment) {
    const endSample = samples.length;
    segments.push({
      startMs: (segmentStart / sampleRate) * 1000,
      endMs: (endSample / sampleRate) * 1000,
      startSample: segmentStart,
      endSample,
    });
  }
  return segments;
}

/**
 * Extract Float32 samples from an OGG Opus buffer (e.g. from Telegram).
 * Returns { samples, sampleRate } for use with isVoiceActive / detectVoiceSegments / Whisper.
 */
export async function oggToFloatSamples(oggBuffer: Buffer): Promise<{ samples: Float32Array; sampleRate: number }> {
  const id = `orthos-vad-${Date.now()}`;
  const oggPath = join(tmpdir(), `${id}.ogg`);
  const wavPath = join(tmpdir(), `${id}.wav`);
  try {
    writeFileSync(oggPath, oggBuffer);
    execSync(`ffmpeg -i "${oggPath}" -ar 16000 -ac 1 -f wav "${wavPath}" -y`, {
      stdio: 'pipe',
      timeout: 15000,
    });
    const wavBuffer = readFileSync(wavPath);
    const { WaveFile } = await import('wavefile');
    const wav = new WaveFile(wavBuffer);
    wav.toBitDepth('32f');
    const samples = wav.getSamples(false, Float32Array) as unknown as Float32Array;
    return { samples, sampleRate: 16000 };
  } finally {
    try { unlinkSync(oggPath); } catch { /* ignore */ }
    try { unlinkSync(wavPath); } catch { /* ignore */ }
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
