import test from 'node:test';
import assert from 'node:assert/strict';
import { io as ioClient } from 'socket.io-client';
import { createServer } from '../backend/server.js';
import { deriveRoomKey, encryptMessage, decryptMessage } from '../frontend/src/utils/crypto.js';
import {
  generateDecryptedJsonExport,
  generateTextTranscriptExport,
} from '../frontend/src/utils/exportChat.js';
import { formatAudioDuration, VoiceRecorder } from '../frontend/src/utils/audioRecorder.js';

function connectSocket(url, options = {}) {
  return new Promise((resolve) => {
    const socket = ioClient(url, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      timeout: 3000,
      ...options,
    });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', () => resolve(socket));
  });
}

function emitWithAck(socket, event, data) {
  return new Promise((resolve) => {
    socket.emit(event, data, (response) => {
      resolve(response);
    });
  });
}

test('audio helper: formatAudioDuration formats seconds accurately', () => {
  assert.equal(formatAudioDuration(0), '0:00');
  assert.equal(formatAudioDuration(5), '0:05');
  assert.equal(formatAudioDuration(45), '0:45');
  assert.equal(formatAudioDuration(72), '1:12');
  assert.equal(formatAudioDuration(135), '2:15');
});

test('voice notes: encryptMessage and decryptMessage preserve voice note duration and waveform', async () => {
  const room = 'voice-lounge';
  const password = 'voice-secret-key-12345';
  const key = await deriveRoomKey({ password, room, iterations: 300000 });

  // Mock Opus audio data (base64)
  const mockAudioData = 'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYECGFOAZwEAAAAAAAFAAF';
  const voiceFile = {
    name: 'voice-note-1700000000.webm',
    type: 'audio/webm;codecs=opus',
    size: 52,
    data: mockAudioData,
    isVoiceNote: true,
    duration: 14.5,
    waveform: [20, 45, 80, 95, 60, 30, 75, 40],
  };

  const encrypted = await encryptMessage({
    key,
    room,
    text: '',
    nickname: 'VoiceSender',
    userId: 'USR-VOICE-1',
    file: voiceFile,
  });

  // Verify wire payload is strictly encrypted (v, id, room, iv, ct)
  assert.equal(encrypted.v, 1);
  assert.equal(encrypted.room, room);
  assert.ok(typeof encrypted.iv === 'string');
  assert.ok(typeof encrypted.ct === 'string');

  // Ensure wire payload does NOT contain any plaintext audio or file metadata
  const wireString = JSON.stringify(encrypted);
  assert.ok(!wireString.includes('voice-note'));
  assert.ok(!wireString.includes('audio/webm'));
  assert.ok(!wireString.includes(mockAudioData));

  // Decrypt client-side
  const decrypted = await decryptMessage({ key, payload: encrypted });
  assert.equal(decrypted.nickname, 'VoiceSender');
  assert.equal(decrypted.userId, 'USR-VOICE-1');
  assert.ok(decrypted.file);
  assert.equal(decrypted.file.name, voiceFile.name);
  assert.equal(decrypted.file.type, voiceFile.type);
  assert.equal(decrypted.file.size, voiceFile.size);
  assert.equal(decrypted.file.data, mockAudioData);
  assert.equal(decrypted.file.isVoiceNote, true);
  assert.equal(decrypted.file.duration, 14.5);
  assert.deepEqual(decrypted.file.waveform, [20, 45, 80, 95, 60, 30, 75, 40]);
});

test('voice notes: relay server transmits encrypted voice note with zero server plaintext inspection', async () => {
  const { server, io, listen, close } = createServer({
    NODE_ENV: 'development',
    PORT: 0,
    MAX_MESSAGE_BYTES: 1048576,
  });

  const { port } = await listen(0);
  const serverUrl = `http://127.0.0.1:${port}`;
  const room = 'secure-audio-room';
  const password = 'ultra-secure-audio-passphrase-888';

  const key1 = await deriveRoomKey({ password, room, iterations: 300000 });
  const key2 = await deriveRoomKey({ password, room, iterations: 300000 });

  const client1 = await connectSocket(serverUrl);
  const client2 = await connectSocket(serverUrl);

  try {
    await emitWithAck(client1, 'join', { v: 1, room });
    await emitWithAck(client2, 'join', { v: 1, room });

    const receivedPromise = new Promise((resolve) => {
      client2.on('message', (payload) => {
        resolve(payload);
      });
    });

    const mockAudioBase64 = 'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYECGFOAZwE=';
    const encryptedPayload = await encryptMessage({
      key: key1,
      room,
      text: 'Check this encrypted audio update',
      nickname: 'Bob',
      userId: 'USR-BOB',
      file: {
        name: 'voice-note-sample.webm',
        type: 'audio/webm',
        size: 42,
        data: mockAudioBase64,
        isVoiceNote: true,
        duration: 8.2,
        waveform: [30, 60, 90, 40, 70],
      },
    });

    const ack = await emitWithAck(client1, 'message', encryptedPayload);
    assert.equal(ack.ok, true);

    const receivedPayload = await receivedPromise;
    assert.equal(receivedPayload.id, encryptedPayload.id);

    const decrypted = await decryptMessage({ key: key2, payload: receivedPayload });
    assert.equal(decrypted.nickname, 'Bob');
    assert.equal(decrypted.text, 'Check this encrypted audio update');
    assert.equal(decrypted.file.isVoiceNote, true);
    assert.equal(decrypted.file.duration, 8.2);
    assert.equal(decrypted.file.data, mockAudioBase64);
  } finally {
    client1.disconnect();
    client2.disconnect();
    await close();
  }
});

test('voice notes: exportChat formats voice notes in JSON and text transcript', () => {
  const messages = [
    {
      id: 'msg-audio-1',
      nickname: 'Charlie',
      userId: 'USR-CHARLIE',
      text: '',
      timestamp: 1710000000000,
      isOwn: false,
      file: {
        name: 'voice-note-1.webm',
        type: 'audio/webm',
        size: 15400,
        isVoiceNote: true,
        duration: 12.4,
        waveform: [20, 50, 80],
        data: 'AAAA',
      },
    },
  ];

  const jsonExport = generateDecryptedJsonExport({
    room: 'general',
    chatType: 'room',
    messages,
  });

  assert.equal(jsonExport.messages.length, 1);
  assert.equal(jsonExport.messages[0].file.isVoiceNote, true);
  assert.equal(jsonExport.messages[0].file.duration, 12.4);

  const textExport = generateTextTranscriptExport({
    room: 'general',
    chatType: 'room',
    messages,
  });

  assert.ok(textExport.includes('Encrypted Voice Note: voice-note-1.webm - 12s'));
});

test('voice recorder: cleanup() releases all tracks, disconnects nodes, and closes AudioContext', () => {
  const recorder = new VoiceRecorder();
  let track1Stopped = false;
  let track2Stopped = false;
  let sourceDisconnected = false;
  let analyserDisconnected = false;
  let audioContextClosed = false;

  const mockTrack1 = {
    enabled: true,
    stop: () => { track1Stopped = true; },
  };
  const mockTrack2 = {
    enabled: true,
    stop: () => { track2Stopped = true; },
  };

  recorder.stream = {
    getTracks: () => [mockTrack1, mockTrack2],
  };
  recorder.source = {
    disconnect: () => { sourceDisconnected = true; },
  };
  recorder.analyser = {
    disconnect: () => { analyserDisconnected = true; },
  };
  recorder.audioContext = {
    state: 'running',
    close: () => { audioContextClosed = true; },
  };
  recorder.mediaRecorder = {
    state: 'recording',
    stop: () => { recorder.mediaRecorder.state = 'inactive'; },
  };
  recorder.isRecording = true;

  recorder.cleanup();

  assert.equal(track1Stopped, true);
  assert.equal(track2Stopped, true);
  assert.equal(mockTrack1.enabled, false);
  assert.equal(mockTrack2.enabled, false);
  assert.equal(sourceDisconnected, true);
  assert.equal(analyserDisconnected, true);
  assert.equal(audioContextClosed, true);
  assert.equal(recorder.stream, null);
  assert.equal(recorder.source, null);
  assert.equal(recorder.analyser, null);
  assert.equal(recorder.audioContext, null);
  assert.equal(recorder.isRecording, false);
  assert.equal(recorder._isCancelled, true);
});

test('voice recorder: stop() cuts microphone tracks and disconnects nodes immediately', async () => {
  const recorder = new VoiceRecorder();
  let trackStopped = false;
  let sourceDisconnected = false;

  const mockTrack = {
    enabled: true,
    stop: () => { trackStopped = true; },
  };

  recorder.stream = {
    getTracks: () => [mockTrack],
  };
  recorder.source = {
    disconnect: () => { sourceDisconnected = true; },
  };
  recorder.analyser = {
    disconnect: () => {},
  };
  recorder.isRecording = true;
  recorder.recordedChunks = [Buffer.from('mock-audio-chunk')];
  recorder.startTime = Date.now() - 3000;

  recorder.mediaRecorder = {
    state: 'recording',
    mimeType: 'audio/webm',
    stop() {
      recorder.mediaRecorder.state = 'inactive';
      // simulate asynchronous onstop dispatch
      setImmediate(() => {
        if (this.onstop) this.onstop();
      });
    },
  };

  // Calling stop() should turn off mic tracks immediately before onstop completes
  const stopPromise = recorder.stop();

  assert.equal(trackStopped, true, 'Track must be stopped immediately upon calling stop()');
  assert.equal(mockTrack.enabled, false, 'Track must be disabled immediately');
  assert.equal(sourceDisconnected, true, 'Source must be disconnected immediately');
  assert.equal(recorder.stream, null, 'Stream reference must be cleared immediately');

  const payload = await stopPromise;
  assert.ok(payload);
  assert.equal(payload.mimeType, 'audio/webm');
  assert.ok(payload.data);
  assert.ok(payload.duration > 0);
  assert.ok(Array.isArray(payload.waveform));
});

