// （N2）：用 DeepSeek Harness 本体自带的语音栈把一段音频转成文字。
// 用法：node sensevoice-transcribe.cjs <音频文件>。stdout 只写转写文字；失败 exit 非 0。
// 资源全部来自本机本体安装，不上网、不下载：原生库随本体装在 app.asar.unpacked，
// 模型是主人已在本体界面「下载并准备」过的本地 SenseVoice 缓存（~/.dsh/speech-to-text）。
// 环境变量可覆盖三个默认路径：DSH_NATIVE_ASR_LIB（原生库目录）、
// DSH_NATIVE_ASR_MODELS（模型根目录）、DSH_NATIVE_ASR_FFMPEG（ffmpeg 可执行文件）。
// 调用方（hub-bff）会传 DYLD_LIBRARY_PATH 指向原生库目录，这里不再改进程环境。
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SAMPLE_RATE = 16000;
const WINDOW = 512;
// 防御性上限：约 40 分钟 PCM。后端 voice.max_audio_seconds 默认 300 秒，正常到不了这里。
const MAX_SECONDS = 40 * 60;

function fail(message) {
  process.stderr.write(`native-transcribe: ${message}\n`);
  process.exit(1);
}

function envPath(name, fallback) {
  const value = process.env[name];
  if (typeof value !== 'string' || !value) return fallback;
  if (!path.isAbsolute(value)) fail(`${name} 必须是绝对路径`);
  return value;
}

const libDir = envPath('DSH_NATIVE_ASR_LIB',
  '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar.unpacked/dsh/node_modules/sherpa-onnx-darwin-arm64');
const modelsRoot = envPath('DSH_NATIVE_ASR_MODELS',
  path.join(os.homedir(), '.dsh/speech-to-text/sensevoice/models'));
const ffmpegHint = envPath('DSH_NATIVE_ASR_FFMPEG', '');

// 严格解析 16kHz 单声道 16bit PCM WAV，返回 PCM 字节；不合要求返回 null。
function pcmFromWav(bytes) {
  if (bytes.length < 44 || bytes.toString('latin1', 0, 4) !== 'RIFF' ||
      bytes.toString('latin1', 8, 12) !== 'WAVE') return null;
  let fmt = null;
  let data = null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString('latin1', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    if (id === 'fmt ' && size >= 16) {
      fmt = {
        format: bytes.readUInt16LE(offset + 8),
        channels: bytes.readUInt16LE(offset + 10),
        rate: bytes.readUInt32LE(offset + 12),
        bits: bytes.readUInt16LE(offset + 22),
      };
    } else if (id === 'data') {
      data = bytes.subarray(offset + 8, Math.min(offset + 8 + size, bytes.length));
    }
    offset += 8 + size + (size % 2);
    if (fmt && data) break;
  }
  if (!fmt || !data) return null;
  if (fmt.format !== 1 || fmt.channels !== 1 || fmt.rate !== SAMPLE_RATE || fmt.bits !== 16) return null;
  return data.length % 2 === 0 ? data : data.subarray(0, data.length - 1);
}

function findFfmpeg() {
  const candidates = [ffmpegHint, 'ffmpeg', '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const probe = spawnSync(candidate, ['-version'], { stdio: 'ignore' });
    if (probe.error === undefined && probe.status === 0) return candidate;
  }
  return null;
}

// 不是可直读的 WAV（webm/mp4/m4a 等）时用 ffmpeg 转 16kHz 单声道 PCM。
function pcmViaFfmpeg(file) {
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) return null;
  const out = spawnSync(ffmpeg,
    ['-hide_banner', '-loglevel', 'error', '-i', file,
      '-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', '1', 'pipe:1'],
    { maxBuffer: SAMPLE_RATE * 2 * (MAX_SECONDS + 60) });
  if (out.error || out.status !== 0 || !out.stdout || !out.stdout.length) return null;
  return out.stdout.length % 2 === 0 ? out.stdout : out.stdout.subarray(0, out.stdout.length - 1);
}

function samplesFromPcm(pcm) {
  if (!pcm || !pcm.length) fail('没有可识别的音频');
  if (pcm.length / 2 > SAMPLE_RATE * MAX_SECONDS) fail('音频超出可转写时长');
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  return Float32Array.from(
    { length: view.byteLength / 2 },
    (_, i) => view.getInt16(i * 2, true) / 32768);
}

function main() {
  const file = process.argv[2];
  if (typeof file !== 'string' || !file || !path.isAbsolute(file)) fail('需要一个音频文件的绝对路径');
  let bytes;
  try {
    bytes = fs.readFileSync(file);
  } catch {
    fail('音频文件读不了');
  }
  let addon;
  try {
    addon = require(path.join(libDir, 'sherpa-onnx.node'));
  } catch {
    fail('本体原生库不可用（DeepSeek Harness 未安装或位置变了）');
  }
  const modelDir = path.join(modelsRoot, 'sensevoice-onnx');
  const vadFile = path.join(modelsRoot, 'silero', 'silero_vad.onnx');
  for (const must of [path.join(modelDir, 'model.int8.onnx'), path.join(modelDir, 'tokens.txt'), vadFile]) {
    try {
      fs.accessSync(must);
    } catch {
      fail('本地语音模型不齐（先在本体插件页「下载并准备」语音输入）');
    }
  }
  const nativeConfig = {
    featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
    modelConfig: {
      senseVoice: {
        model: path.join(modelDir, 'model.int8.onnx'),
        language: 'auto',
        useInverseTextNormalization: 1,
      },
      tokens: path.join(modelDir, 'tokens.txt'),
      numThreads: 2,
      provider: 'cpu',
      debug: 0,
    },
  };
  let recognizer;
  let detector;
  try {
    recognizer = addon.createOfflineRecognizer(nativeConfig);
    detector = addon.createVoiceActivityDetector({
      sileroVad: {
        model: vadFile,
        threshold: 0.5,
        minSilenceDuration: 0.5,
        minSpeechDuration: 0.25,
        maxSpeechDuration: 30,
        windowSize: WINDOW,
      },
      sampleRate: SAMPLE_RATE,
      numThreads: 2,
      provider: 'cpu',
      debug: 0,
    }, 31.5);
  } catch {
    fail('模型加载失败');
  }
  const samples = samplesFromPcm(pcmFromWav(bytes) ?? pcmViaFfmpeg(file));
  const texts = [];
  const drain = () => {
    while (!addon.voiceActivityDetectorIsEmpty(detector)) {
      const segment = addon.voiceActivityDetectorFront(detector, false);
      const stream = addon.createOfflineStream(recognizer);
      addon.acceptWaveformOffline(stream, { sampleRate: SAMPLE_RATE, samples: segment.samples });
      addon.decodeOfflineStream(recognizer, stream);
      texts.push(JSON.parse(addon.getOfflineStreamResultAsJson(stream)).text.trim());
      addon.voiceActivityDetectorPop(detector);
    }
  };
  for (let offset = 0; offset < samples.length; offset += WINDOW) {
    addon.voiceActivityDetectorAcceptWaveform(detector, samples.subarray(offset, offset + WINDOW));
    drain();
  }
  addon.voiceActivityDetectorFlush(detector);
  drain();
  process.stdout.write(texts.filter(Boolean).join(' ').trim());
}

main();
