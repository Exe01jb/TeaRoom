import { bytesToBase64 } from './crypto.js';

/**
 * Checks if the browser supports Web Audio API and media recording
 */
export function checkAudioRecordingSupport() {
  const hasMediaDevices = Boolean(
    typeof navigator !== 'undefined' &&
    navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function'
  );
  const hasAudioContext = Boolean(
    typeof window !== 'undefined' &&
    (window.AudioContext || window.webkitAudioContext)
  );
  const hasMediaRecorder = Boolean(
    typeof window !== 'undefined' &&
    typeof window.MediaRecorder === 'function'
  );

  return hasMediaDevices && hasAudioContext && hasMediaRecorder;
}

/**
 * Formats duration in seconds to M:SS (e.g., 0:08, 1:23)
 */
export function formatAudioDuration(seconds) {
  if (!seconds || isNaN(seconds) || seconds < 0) return '0:00';
  const total = Math.round(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

/**
 * Select the optimal supported audio MIME type for WebM/Opus compression
 */
export function getSupportedAudioMimeType() {
  if (typeof window === 'undefined' || typeof window.MediaRecorder === 'undefined') {
    return 'audio/webm';
  }

  const preferredTypes = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
    'audio/aac',
  ];

  for (const mimeType of preferredTypes) {
    if (MediaRecorder.isTypeSupported(mimeType)) {
      return mimeType;
    }
  }

  return '';
}

/**
 * Convert base64 string to Blob
 */
export function base64ToBlob(base64Data, contentType = 'audio/webm') {
  const byteCharacters = atob(base64Data);
  const byteArrays = [];
  const sliceSize = 512;

  for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
    const slice = byteCharacters.slice(offset, offset + sliceSize);
    const byteNumbers = new Array(slice.length);
    for (let i = 0; i < slice.length; i++) {
      byteNumbers[i] = slice.charCodeAt(i);
    }
    byteArrays.push(new Uint8Array(byteNumbers));
  }

  return new Blob(byteArrays, { type: contentType });
}

/**
 * Compute normalized waveform bars (10-100) from AudioBuffer channel data
 */
export function extractWaveformFromAudioBuffer(audioBuffer, barCount = 36) {
  if (!audioBuffer) return new Array(barCount).fill(25);

  const channelData = audioBuffer.getChannelData(0);
  const totalSamples = channelData.length;
  if (totalSamples === 0) return new Array(barCount).fill(25);

  const blockSize = Math.floor(totalSamples / barCount);
  const peaks = [];

  for (let i = 0; i < barCount; i++) {
    const start = i * blockSize;
    const end = Math.min(start + blockSize, totalSamples);
    let sumSquares = 0;
    let count = 0;

    for (let j = start; j < end; j += 4) { // sample every 4th for speed
      const val = channelData[j];
      sumSquares += val * val;
      count++;
    }

    const rms = count > 0 ? Math.sqrt(sumSquares / count) : 0;
    peaks.push(rms);
  }

  // Normalize between 15% and 100%
  const maxPeak = Math.max(...peaks, 0.01);
  return peaks.map((p) => {
    const normalized = Math.round((p / maxPeak) * 85) + 15;
    return Math.min(100, Math.max(15, normalized));
  });
}

/**
 * VoiceRecorder manages recording session using Web Audio API and MediaRecorder
 */
export class VoiceRecorder {
  constructor(options = {}) {
    this.maxDurationSeconds = options.maxDurationSeconds || 120; // 2 minutes max
    this.stream = null;
    this.audioContext = null;
    this.analyser = null;
    this.source = null;
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.startTime = 0;
    this.timerInterval = null;
    this.animFrameId = null;
    this.isRecording = false;
    this.livePeakHistory = [];
    this._isCancelled = false;
  }

  /**
   * Release all audio tracks, disconnect Web Audio nodes, and close AudioContext.
   * Guarantees microphone hardware is released immediately by the browser and OS.
   */
  cleanup() {
    this._isCancelled = true;
    this.isRecording = false;

    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }

    // 1. Immediately disconnect audio source and analyser nodes
    if (this.source) {
      try {
        this.source.disconnect();
      } catch {
        // ignore
      }
      this.source = null;
    }

    if (this.analyser) {
      try {
        this.analyser.disconnect();
      } catch {
        // ignore
      }
      this.analyser = null;
    }

    // 2. Immediately disable and stop all microphone hardware tracks
    if (this.stream) {
      try {
        this.stream.getTracks().forEach((track) => {
          try {
            track.enabled = false;
            track.stop();
          } catch {
            // ignore
          }
        });
      } catch {
        // ignore
      }
      this.stream = null;
    }

    // 3. Stop MediaRecorder if still active
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop();
      } catch {
        // ignore
      }
    }

    // 4. Close AudioContext
    if (this.audioContext) {
      try {
        if (this.audioContext.state !== 'closed') {
          this.audioContext.close();
        }
      } catch {
        // ignore
      }
      this.audioContext = null;
    }

    this.recordedChunks = [];
    this.livePeakHistory = [];
  }

  /**
   * Starts recording audio from user microphone with real-time Web Audio API visualizer
   */
  async start({ onVisualizerData, onTick, onMaxDurationReached } = {}) {
    if (this.isRecording) {
      throw new Error('Recording is already in progress');
    }

    if (!checkAudioRecordingSupport()) {
      throw new Error('Voice note recording is not supported on this browser/device');
    }

    this._isCancelled = false;
    let stream = null;

    try {
      // 1. Request microphone access
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      // Handle race condition: if cancelled while user prompt or getUserMedia was pending
      if (this._isCancelled) {
        if (stream) {
          stream.getTracks().forEach((track) => {
            try {
              track.enabled = false;
              track.stop();
            } catch {
              // ignore
            }
          });
        }
        throw new Error('Recording session was cancelled');
      }

      this.stream = stream;

      // 2. Initialize Web Audio API AudioContext & AnalyserNode
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioContextClass();
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      if (this._isCancelled) {
        this.cleanup();
        throw new Error('Recording session was cancelled');
      }

      this.source = this.audioContext.createMediaStreamSource(this.stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 64;
      this.analyser.smoothingTimeConstant = 0.75;
      this.source.connect(this.analyser);

      // 3. Configure MediaRecorder
      const mimeType = getSupportedAudioMimeType();
      const recorderOptions = mimeType ? { mimeType, audioBitsPerSecond: 32000 } : {};
      this.mediaRecorder = new MediaRecorder(this.stream, recorderOptions);
      this.recordedChunks = [];
      this.livePeakHistory = [];

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          this.recordedChunks.push(e.data);
        }
      };

      // 4. Start MediaRecorder with 100ms time slices
      this.mediaRecorder.start(100);
      this.isRecording = true;
      this.startTime = Date.now();

      // 5. Real-time visualizer loop using Web Audio API AnalyserNode
      const freqData = new Uint8Array(this.analyser.frequencyBinCount);
      let lastSampleTime = Date.now();

      const renderLoop = () => {
        if (!this.isRecording || !this.analyser) return;

        this.analyser.getByteFrequencyData(freqData);

        // Calculate overall volume amplitude (0 - 100)
        let sum = 0;
        for (let i = 0; i < freqData.length; i++) {
          sum += freqData[i];
        }
        const avg = sum / (freqData.length || 1);
        const normalizedVolume = Math.min(100, Math.round((avg / 255) * 100));

        if (onVisualizerData) {
          onVisualizerData({
            frequencies: Array.from(freqData.slice(0, 16)),
            volume: normalizedVolume,
          });
        }

        // Sample every 150ms for live waveform building
        const now = Date.now();
        if (now - lastSampleTime >= 150) {
          this.livePeakHistory.push(normalizedVolume);
          lastSampleTime = now;
        }

        this.animFrameId = requestAnimationFrame(renderLoop);
      };

      this.animFrameId = requestAnimationFrame(renderLoop);

      // 6. Elapsed timer interval
      this.timerInterval = setInterval(() => {
        if (!this.isRecording) return;
        const elapsedSeconds = (Date.now() - this.startTime) / 1000;
        if (onTick) {
          onTick(elapsedSeconds);
        }

        if (elapsedSeconds >= this.maxDurationSeconds) {
          if (onMaxDurationReached) {
            onMaxDurationReached();
          }
        }
      }, 100);

      return true;
    } catch (err) {
      if (stream) {
        stream.getTracks().forEach((track) => {
          try {
            track.enabled = false;
            track.stop();
          } catch {
            // ignore
          }
        });
      }
      this.cleanup();
      throw err;
    }
  }

  /**
   * Stops recording and returns finalized audio payload with Web Audio API decoded duration & waveform.
   * Immediately stops all microphone hardware tracks and disconnects nodes to prevent background mic use.
   */
  async stop() {
    if (!this.isRecording) {
      throw new Error('No active recording session');
    }

    this.isRecording = false;

    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }

    // CRITICAL: Stop microphone hardware tracks and disconnect source node IMMEDIATELY.
    // Do not wait for onstop or decodeAudioData. MediaRecorder already captured all buffers.
    // Releasing the mic tracks right now ensures the OS microphone indicator turns off immediately.
    if (this.source) {
      try {
        this.source.disconnect();
      } catch {
        // ignore
      }
      this.source = null;
    }

    if (this.analyser) {
      try {
        this.analyser.disconnect();
      } catch {
        // ignore
      }
      this.analyser = null;
    }

    if (this.stream) {
      try {
        this.stream.getTracks().forEach((track) => {
          try {
            track.enabled = false;
            track.stop();
          } catch {
            // ignore
          }
        });
      } catch {
        // ignore
      }
      this.stream = null;
    }

    return new Promise((resolve, reject) => {
      this.mediaRecorder.onstop = async () => {
        try {
          const finalMimeType = this.mediaRecorder.mimeType || 'audio/webm';
          const audioBlob = new Blob(this.recordedChunks, { type: finalMimeType });

          // Read blob as ArrayBuffer to decode via Web Audio API
          const arrayBuffer = await audioBlob.arrayBuffer();

          // Convert to Base64 for zero-leak client-side encryption
          const uint8Array = new Uint8Array(arrayBuffer);
          const base64Data = bytesToBase64(uint8Array);

          // Use Web Audio API to decode audio data for 100% accurate duration & waveform peaks
          let accurateDuration = (Date.now() - this.startTime) / 1000;
          let waveform = [];

          try {
            if (this.audioContext && arrayBuffer.byteLength > 0 && this.audioContext.state !== 'closed') {
              const decodedBuffer = await this.audioContext.decodeAudioData(arrayBuffer.slice(0));
              if (decodedBuffer && decodedBuffer.duration > 0) {
                accurateDuration = decodedBuffer.duration;
              }
              waveform = extractWaveformFromAudioBuffer(decodedBuffer, 36);
            }
          } catch {
            // Fallback waveform from live peak history if decodeAudioData has codec quirks
            waveform = this._generateFallbackWaveform(this.livePeakHistory, 36);
          }

          // Clean up AudioContext completely
          if (this.audioContext) {
            try {
              if (this.audioContext.state !== 'closed') {
                await this.audioContext.close();
              }
            } catch {
              // ignore
            }
            this.audioContext = null;
          }

          resolve({
            blob: audioBlob,
            data: base64Data,
            mimeType: finalMimeType,
            size: audioBlob.size,
            duration: accurateDuration,
            waveform,
            name: `voice-note-${Date.now()}.${finalMimeType.includes('ogg') ? 'ogg' : finalMimeType.includes('mp4') ? 'm4a' : 'webm'}`,
          });
        } catch (err) {
          if (this.audioContext) {
            try {
              if (this.audioContext.state !== 'closed') {
                this.audioContext.close();
              }
            } catch {
              // ignore
            }
            this.audioContext = null;
          }
          reject(err);
        }
      };

      try {
        if (this.mediaRecorder.state !== 'inactive') {
          this.mediaRecorder.stop();
        } else if (typeof this.mediaRecorder.onstop === 'function') {
          this.mediaRecorder.onstop();
        }
      } catch (err) {
        this.cleanup();
        reject(err);
      }
    });
  }

  /**
   * Cancel and discard recording without generating payload.
   * Completely cleans up all hardware mic tracks and Web Audio nodes.
   */
  cancel() {
    this.cleanup();
  }

  _generateFallbackWaveform(history, barCount = 36) {
    if (!history || history.length === 0) {
      // Default natural speech simulation waveform
      return [20, 35, 60, 45, 80, 75, 40, 25, 65, 85, 90, 50, 30, 45, 70, 60, 80, 40, 25, 35, 55, 75, 65, 45, 30, 50, 85, 70, 40, 25, 35, 60, 50, 30, 20, 25];
    }

    const result = [];
    const step = history.length / barCount;
    for (let i = 0; i < barCount; i++) {
      const idx = Math.min(Math.floor(i * step), history.length - 1);
      const val = history[idx] || 20;
      result.push(Math.min(100, Math.max(15, val)));
    }
    return result;
  }
}
