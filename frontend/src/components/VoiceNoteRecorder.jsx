import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  VoiceRecorder,
  checkAudioRecordingSupport,
  formatAudioDuration,
} from '../utils/audioRecorder.js';
import { VoiceNotePlayer } from './VoiceNotePlayer.jsx';
import { AlertCircle, X, Lock, Headphones } from 'lucide-react';

/**
 * VoiceNoteRecorder component
 * Integrated into ChatBox footer for Web Audio API recording, visualizer, preview, and sending.
 */
export function VoiceNoteRecorder({
  isRecordingMode,
  autoStart = false,
  onStartRecording,
  onCancelRecording,
  onSendVoiceNote,
  disabled = false,
}) {
  const [recorderState, setRecorderState] = useState(autoStart ? 'recording' : 'idle'); // 'idle' | 'recording' | 'previewing'
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [visualizerFrequencies, setVisualizerFrequencies] = useState([10, 15, 25, 20, 35, 25, 15, 10]);
  const [micVolume, setMicVolume] = useState(0);
  const [recordedData, setRecordedData] = useState(null); // { blob, data, mimeType, size, duration, waveform, name }
  const [errorMessage, setErrorMessage] = useState('');

  const recorderRef = useRef(null);

  // Clean up recorder on unmount to guarantee microphone hardware is released
  useEffect(() => {
    return () => {
      if (recorderRef.current) {
        recorderRef.current.cleanup();
        recorderRef.current = null;
      }
    };
  }, []);

  // Sync with external cancellation (e.g. user leaves room or cancels)
  useEffect(() => {
    if (!isRecordingMode && recorderState !== 'idle') {
      if (recorderRef.current) {
        recorderRef.current.cleanup();
        recorderRef.current = null;
      }
      setRecorderState('idle');
      setRecordedData(null);
      setElapsedSeconds(0);
      setErrorMessage('');
    }
  }, [isRecordingMode, recorderState]);

  // Start recording
  const handleStart = useCallback(async () => {
    if (disabled) return;
    setErrorMessage('');

    if (!checkAudioRecordingSupport()) {
      setErrorMessage('Microphone recording is not supported on this device/browser.');
      if (onCancelRecording) onCancelRecording();
      return;
    }

    // Clean up any stale recorder before creating a fresh one
    if (recorderRef.current) {
      recorderRef.current.cleanup();
      recorderRef.current = null;
    }

    try {
      const recorder = new VoiceRecorder({ maxDurationSeconds: 120 });
      recorderRef.current = recorder;

      setRecorderState('recording');
      setElapsedSeconds(0);
      setRecordedData(null);

      if (onStartRecording) {
        onStartRecording();
      }

      await recorder.start({
        onVisualizerData: ({ frequencies, volume }) => {
          setVisualizerFrequencies(frequencies);
          setMicVolume(volume);
        },
        onTick: (elapsed) => {
          setElapsedSeconds(elapsed);
        },
        onMaxDurationReached: () => {
          handleStopToPreview();
        },
      });
    } catch (err) {
      if (recorderRef.current) {
        recorderRef.current.cleanup();
        recorderRef.current = null;
      }
      setRecorderState('idle');
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setErrorMessage('Microphone permission was denied. Please allow microphone access to record voice notes.');
      } else {
        setErrorMessage(err.message || 'Unable to access microphone.');
      }
      if (onCancelRecording) onCancelRecording();
    }
  }, [disabled, onStartRecording, onCancelRecording]);

  // Auto-start recording if requested on mount
  useEffect(() => {
    if (autoStart) {
      handleStart();
    }
  }, []);

  // Stop recording to preview mode
  const handleStopToPreview = async () => {
    if (!recorderRef.current || recorderState !== 'recording') return;

    try {
      const activeRecorder = recorderRef.current;
      const result = await activeRecorder.stop();
      // Notice: stop() already shut down all microphone hardware tracks and disconnected nodes
      setRecordedData(result);
      setRecorderState('previewing');
    } catch (err) {
      setErrorMessage('Failed to finalize voice recording: ' + err.message);
      handleCancel();
    }
  };

  // Stop recording and send immediately
  const handleStopAndSend = async () => {
    if (!recorderRef.current || recorderState !== 'recording') return;

    try {
      const activeRecorder = recorderRef.current;
      const result = await activeRecorder.stop();
      activeRecorder.cleanup();
      recorderRef.current = null;

      setRecorderState('idle');
      setRecordedData(null);
      setElapsedSeconds(0);

      onSendVoiceNote({
        name: result.name,
        type: result.mimeType,
        size: result.size,
        data: result.data,
        duration: result.duration,
        waveform: result.waveform,
        isVoiceNote: true,
      });

      if (onCancelRecording) onCancelRecording();
    } catch (err) {
      setErrorMessage('Failed to send voice recording: ' + err.message);
      handleCancel();
    }
  };

  // Send from preview mode
  const handleSendFromPreview = () => {
    if (!recordedData) return;

    if (recorderRef.current) {
      recorderRef.current.cleanup();
      recorderRef.current = null;
    }

    onSendVoiceNote({
      name: recordedData.name,
      type: recordedData.mimeType,
      size: recordedData.size,
      data: recordedData.data,
      duration: recordedData.duration,
      waveform: recordedData.waveform,
      isVoiceNote: true,
    });

    setRecorderState('idle');
    setRecordedData(null);
    setElapsedSeconds(0);
    if (onCancelRecording) onCancelRecording();
  };

  // Cancel recording and reset
  const handleCancel = useCallback(() => {
    if (recorderRef.current) {
      recorderRef.current.cleanup();
      recorderRef.current = null;
    }
    setRecorderState('idle');
    setRecordedData(null);
    setElapsedSeconds(0);
    if (onCancelRecording) onCancelRecording();
  }, [onCancelRecording]);

  // If in idle state, render the mic icon button
  if (recorderState === 'idle') {
    return (
      <div className="flex items-center">
        <button
          type="button"
          onClick={handleStart}
          disabled={disabled}
          title="Record encrypted voice note (Web Audio API)"
          aria-label="Record voice note"
          className="p-2 rounded hover:bg-zinc-800 text-zinc-400 hover:text-emerald-400 transition-colors shrink-0 cursor-pointer disabled:opacity-40"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
            />
          </svg>
        </button>

        {errorMessage && (
          <div className="fixed bottom-20 left-1/2 -translate-x-1/2 max-w-md w-[90%] z-50 p-3 rounded-xl bg-rose-950/90 border border-rose-800 text-rose-200 text-xs font-mono shadow-xl flex items-center justify-between gap-3 animate-fade-in">
            <span className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{errorMessage}</span>
            </span>
            <button
              onClick={() => setErrorMessage('')}
              className="text-rose-400 hover:text-white p-1 rounded-lg hover:bg-rose-900/50 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    );
  }

  // Active recording UI
  if (recorderState === 'recording') {
    return (
      <div className="w-full flex flex-col gap-1.5 p-2.5 bg-zinc-900 dark:bg-zinc-950 border border-rose-500/40 dark:border-rose-900/60 rounded-2xl sm:rounded-full shadow-md animate-bubble text-white">
        <div className="flex items-center justify-between gap-2 sm:gap-3">
          {/* Pulsing REC badge & timer */}
          <div className="flex items-center gap-1.5 sm:gap-2 font-mono text-xs shrink-0">
            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-rose-950/80 border border-rose-800/80 text-rose-300">
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
              <span className="font-bold text-[11px]">REC</span>
            </span>
            <span className="tabular-nums text-rose-200 font-semibold text-xs">
              {formatAudioDuration(elapsedSeconds)}
            </span>
            <span className="text-zinc-500 text-[10px] hidden xs:inline">/ 2:00</span>
          </div>

          {/* Web Audio API Real-time Frequency Visualizer */}
          <div className="flex-1 max-w-xs h-6 flex items-center justify-center gap-1 px-1 sm:px-2 overflow-hidden">
            {visualizerFrequencies.slice(0, 16).map((f, i) => {
              const height = Math.min(100, Math.max(15, Math.round((f / 255) * 100)));
              return (
                <div
                  key={i}
                  className="w-1 sm:w-1.5 rounded-full bg-rose-500/80 transition-all duration-75 shrink-0"
                  style={{
                    height: `${height}%`,
                    opacity: 0.4 + (height / 100) * 0.6,
                  }}
                />
              );
            })}
          </div>

          {/* Action buttons: Discard, Stop & Preview, or Send Directly */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Discard button */}
            <button
              type="button"
              onClick={handleCancel}
              title="Discard voice recording"
              aria-label="Discard recording"
              className="p-1.5 rounded-full hover:bg-zinc-800 text-zinc-400 hover:text-rose-400 transition-colors cursor-pointer"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>

            {/* Stop & Preview button */}
            <button
              type="button"
              onClick={handleStopToPreview}
              title="Stop & preview audio"
              aria-label="Preview audio"
              className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-mono flex items-center gap-1 transition-colors cursor-pointer"
            >
              <span className="w-2.5 h-2.5 bg-amber-400 rounded-xs inline-block" />
              <span>Preview</span>
            </button>

            {/* Send directly button */}
            <button
              type="button"
              onClick={handleStopAndSend}
              title="Send encrypted voice note"
              aria-label="Send voice note"
              className="px-3 py-1 rounded bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-mono text-xs font-semibold flex items-center gap-1.5 shadow-[0_0_10px_rgba(16,185,129,0.4)] cursor-pointer"
            >
              <span>Send</span>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between text-[10px] font-mono text-zinc-500 px-1">
          <span>Web Audio API active • Mic level: {micVolume}%</span>
          <span className="flex items-center gap-1">
            <Lock className="w-3 h-3 text-emerald-500" />
            <span>Encrypted with AES-256-GCM before relay</span>
          </span>
        </div>
      </div>
    );
  }

  // Preview state before sending
  if (recorderState === 'previewing' && recordedData) {
    return (
      <div className="w-full flex flex-col gap-2 p-2.5 bg-zinc-900 dark:bg-zinc-950 border border-emerald-500/40 dark:border-emerald-900/40 rounded-2xl shadow-md text-white animate-bubble">
        <div className="flex items-center justify-between text-xs font-mono text-emerald-400 px-1">
          <span className="flex items-center gap-1.5 font-semibold">
            <Headphones className="w-3.5 h-3.5 text-emerald-400" />
            <span>Preview Encrypted Voice Note</span>
          </span>
          <span className="text-zinc-500 text-[10px]">Ready to encrypt & relay</span>
        </div>

        {/* Embedded player for preview */}
        <div className="flex justify-center">
          <VoiceNotePlayer
            file={{
              name: recordedData.name,
              type: recordedData.mimeType,
              size: recordedData.size,
              data: recordedData.data,
              duration: recordedData.duration,
              waveform: recordedData.waveform,
              isVoiceNote: true,
            }}
            isOwn={true}
          />
        </div>

        {/* Action buttons: Re-record / Cancel or Send */}
        <div className="flex items-center justify-end gap-2 pt-1 border-t border-zinc-900">
          <button
            type="button"
            onClick={handleCancel}
            className="px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-mono transition-colors cursor-pointer"
          >
            Discard
          </button>

          <button
            type="button"
            onClick={handleStart}
            className="px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-amber-300 text-xs font-mono transition-colors cursor-pointer flex items-center gap-1"
          >
            <span>↺</span>
            <span>Re-record</span>
          </button>

          <button
            type="button"
            onClick={handleSendFromPreview}
            className="px-4 py-1 rounded bg-emerald-500 hover:bg-emerald-400 text-zinc-950 text-xs font-mono font-semibold transition-all shadow-[0_0_12px_rgba(16,185,129,0.3)] cursor-pointer flex items-center gap-1.5"
          >
            <span>Send Encrypted Note</span>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  return null;
}
