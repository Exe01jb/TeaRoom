import React, { useState, useRef, useEffect, useMemo } from 'react';
import { base64ToBlob, formatAudioDuration } from '../utils/audioRecorder.js';

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/**
 * Encrypted Voice Note Player matching the inspiration screenshot's sleek pill design
 * Features:
 * - Circular dark play/pause button (▶ / ⏸)
 * - Dense, expressive sound wave bars
 * - Real-time duration / progress tracking
 * - Interactive seek on click & drag
 * - Speed cycle (1x, 1.5x, 2x)
 * - Download decrypted audio action
 */
export function VoiceNotePlayer({ file, isOwn = false }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(file.duration || 0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [hoverSeekPercent, setHoverSeekPercent] = useState(null);

  const audioRef = useRef(null);
  const blobUrlRef = useRef(null);
  const waveformContainerRef = useRef(null);

  // Fallback natural-looking waveform if none provided
  const waveformBars = useMemo(() => {
    if (Array.isArray(file.waveform) && file.waveform.length > 0) {
      return file.waveform;
    }
    const seed = (file.size || 42) + (file.name ? file.name.length : 12);
    const bars = [];
    for (let i = 0; i < 38; i++) {
      const sinVal = Math.sin((i + seed) * 0.45) * 35 + Math.cos((i * 2 + seed) * 0.3) * 25 + 50;
      bars.push(Math.min(95, Math.max(18, Math.round(sinVal))));
    }
    return bars;
  }, [file.waveform, file.size, file.name]);

  // Construct audio blob URL on mount/update
  useEffect(() => {
    try {
      const mime = file.type || 'audio/webm';
      const blob = base64ToBlob(file.data, mime);
      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;

      const audio = new Audio(url);
      audioRef.current = audio;

      audio.onloadedmetadata = () => {
        if (audio.duration && !isNaN(audio.duration) && isFinite(audio.duration)) {
          setDuration(audio.duration);
        } else if (file.duration) {
          setDuration(file.duration);
        }
      };

      audio.ontimeupdate = () => {
        setCurrentTime(audio.currentTime);
      };

      audio.onended = () => {
        setIsPlaying(false);
        setCurrentTime(0);
      };

      audio.onerror = () => {
        setIsPlaying(false);
      };

      return () => {
        audio.pause();
        audio.src = '';
        if (blobUrlRef.current) {
          URL.revokeObjectURL(blobUrlRef.current);
          blobUrlRef.current = null;
        }
      };
    } catch {
      // Audio parsing error
    }
  }, [file.data, file.type, file.duration]);

  const togglePlay = () => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.playbackRate = playbackRate;
      audioRef.current
        .play()
        .then(() => setIsPlaying(true))
        .catch(() => setIsPlaying(false));
    }
  };

  const cyclePlaybackRate = () => {
    const nextRate = playbackRate === 1 ? 1.5 : playbackRate === 1.5 ? 2 : 1;
    setPlaybackRate(nextRate);
    if (audioRef.current) {
      audioRef.current.playbackRate = nextRate;
    }
  };

  const handleWaveformClick = (e) => {
    if (!waveformContainerRef.current || !audioRef.current) return;
    const rect = waveformContainerRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percent = Math.max(0, Math.min(1, clickX / rect.width));
    const targetDuration = duration || file.duration || 1;
    const newTime = percent * targetDuration;

    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const handleMouseMove = (e) => {
    if (!waveformContainerRef.current) return;
    const rect = waveformContainerRef.current.getBoundingClientRect();
    const hoverX = e.clientX - rect.left;
    const percent = Math.max(0, Math.min(1, hoverX / rect.width));
    setHoverSeekPercent(percent);
  };

  const handleMouseLeave = () => {
    setHoverSeekPercent(null);
  };

  const effectiveDuration = duration || file.duration || 0;
  const progressPercent = effectiveDuration > 0 ? (currentTime / effectiveDuration) * 100 : 0;

  return (
    <div
      className={`p-2 sm:p-2.5 rounded-full select-none transition-all duration-200 my-1 min-w-[240px] sm:min-w-[300px] max-w-sm flex items-center gap-2.5 sm:gap-3 ${
        isOwn
          ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-[0_2px_12px_rgba(0,0,0,0.06)] dark:shadow-[0_2px_14px_rgba(0,0,0,0.4)] border border-zinc-200/80 dark:border-zinc-700'
          : 'bg-[#181a1d] dark:bg-zinc-900 text-white shadow-sm border border-zinc-800'
      }`}
    >
      {/* Black / Dark Play Button matching screenshot */}
      <button
        type="button"
        onClick={togglePlay}
        aria-label={isPlaying ? 'Pause voice note' : 'Play voice note'}
        className={`w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center shrink-0 shadow-md transition-all duration-200 cursor-pointer ${
          isOwn
            ? isPlaying
              ? 'bg-zinc-900 dark:bg-emerald-500 text-white dark:text-zinc-950 scale-95'
              : 'bg-zinc-900 dark:bg-zinc-100 hover:bg-zinc-800 dark:hover:bg-white text-white dark:text-zinc-900 hover:scale-105'
            : isPlaying
            ? 'bg-emerald-500 text-zinc-950 scale-95 shadow-emerald-500/30'
            : 'bg-white hover:bg-zinc-100 text-zinc-900 hover:scale-105'
        }`}
      >
        {isPlaying ? (
          <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
            <path d="M6 5h4v14H6zm8 0h4v14h-4z" />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5 fill-current ml-0.5" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>

      {/* Interactive Sound Wave Bars matching screenshot */}
      <div className="flex-1 min-w-0 flex items-center gap-2">
        <div
          ref={waveformContainerRef}
          onClick={handleWaveformClick}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          className="flex-1 h-7 flex items-center gap-[2px] cursor-pointer py-1 group/wave"
          title="Click anywhere to seek"
        >
          {waveformBars.map((heightPercent, index) => {
            const barPercent = ((index + 0.5) / waveformBars.length) * 100;
            const isPlayed = barPercent <= progressPercent;
            const isHovered =
              hoverSeekPercent !== null && barPercent <= hoverSeekPercent * 100;

            return (
              <div
                key={index}
                className="flex-1 min-w-[2px] max-w-[4px] rounded-full transition-all duration-75 relative"
                style={{
                  height: `${heightPercent}%`,
                }}
              >
                <div
                  className={`w-full h-full rounded-full transition-colors ${
                    isPlayed
                      ? isOwn
                        ? 'bg-zinc-900 dark:bg-emerald-400'
                        : 'bg-emerald-400'
                      : isHovered
                      ? isOwn
                        ? 'bg-zinc-400 dark:bg-zinc-400'
                        : 'bg-zinc-500'
                      : isOwn
                      ? 'bg-zinc-300 dark:bg-zinc-600 group-hover/wave:bg-zinc-400'
                      : 'bg-zinc-700 group-hover/wave:bg-zinc-600'
                  }`}
                />
              </div>
            );
          })}
        </div>

        {/* Duration Label matching screenshot's "2:19" placement */}
        <span
          className={`text-[10px] sm:text-[11px] font-sans font-medium tabular-nums shrink-0 ${
            isOwn ? 'text-zinc-500 dark:text-zinc-400' : 'text-zinc-400'
          }`}
        >
          {isPlaying
            ? formatAudioDuration(currentTime)
            : formatAudioDuration(effectiveDuration)}
        </span>

        {/* Speed toggle */}
        <button
          type="button"
          onClick={cyclePlaybackRate}
          title="Change playback speed"
          className={`text-[9px] font-sans font-bold px-1.5 py-0.5 rounded-full transition-colors cursor-pointer shrink-0 ${
            isOwn
              ? 'bg-zinc-100 dark:bg-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-600 text-zinc-700 dark:text-zinc-200'
              : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
          }`}
        >
          {playbackRate}x
        </button>

        {/* Save decrypted file */}
        {blobUrlRef.current && (
          <a
            href={blobUrlRef.current}
            download={file.name || 'voice-note.webm'}
            title="Download decrypted voice note"
            className={`p-1 rounded-full transition-colors shrink-0 ${
              isOwn
                ? 'text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700'
                : 'text-zinc-500 hover:text-white hover:bg-zinc-800'
            }`}
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          </a>
        )}
      </div>
    </div>
  );
}
