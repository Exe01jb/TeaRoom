import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Search, X, Clock, Sparkles, Lock } from 'lucide-react';
import { EMOJI_CATEGORIES } from '../utils/emojiData.js';

const RECENT_STORAGE_KEY = 'pcr_recent_emojis';
const DEFAULT_RECENTS = ['🔒', '🔑', '👍', '❤️', '🔥', '✨', '😂', '👋'];

function getStoredRecents() {
  try {
    const raw = localStorage.getItem(RECENT_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.slice(0, 16);
      }
    }
  } catch {
    // Ignore storage issues
  }
  return DEFAULT_RECENTS;
}

function saveStoredRecents(emojis) {
  try {
    localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(emojis.slice(0, 16)));
  } catch {
    // Ignore
  }
}

/**
 * Lightweight, privacy-focused offline Emoji Picker component
 * - Zero 3rd party CDN or telemetry dependencies
 * - Full client-side instant search across keywords
 * - Recents tracking in local storage
 * - Accessible keyboard navigation & hover preview
 */
export function EmojiPicker({
  isOpen,
  onClose,
  onSelectEmoji,
  position = 'top', // 'top' | 'bottom'
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [hoveredEmoji, setHoveredEmoji] = useState(null);
  const [recentEmojis, setRecentEmojis] = useState(getStoredRecents);

  const containerRef = useRef(null);
  const searchInputRef = useRef(null);

  // Focus search input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    } else {
      setSearchQuery('');
      setHoveredEmoji(null);
    }
  }, [isOpen]);

  // Handle outside click & escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleMouseDown = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        onClose();
      }
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  // Filtered emoji items based on search query or active category
  const filteredResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    if (query) {
      const matches = [];
      const seen = new Set();

      for (const cat of EMOJI_CATEGORIES) {
        for (const item of cat.emojis) {
          if (seen.has(item.emoji)) continue;

          const matchName = item.name.toLowerCase().includes(query);
          const matchKeywords = item.keywords.some((k) => k.toLowerCase().includes(query));

          if (matchName || matchKeywords || item.emoji === query) {
            seen.add(item.emoji);
            matches.push(item);
          }
        }
      }
      return matches;
    }

    if (activeCategory === 'recent') {
      return recentEmojis.map((em) => {
        // find item metadata if exists
        for (const cat of EMOJI_CATEGORIES) {
          const found = cat.emojis.find((e) => e.emoji === em);
          if (found) return found;
        }
        return { emoji: em, name: 'Recently used', keywords: [] };
      });
    }

    if (activeCategory === 'all') {
      const all = [];
      for (const cat of EMOJI_CATEGORIES) {
        all.push(...cat.emojis);
      }
      return all;
    }

    const selectedCat = EMOJI_CATEGORIES.find((c) => c.id === activeCategory);
    return selectedCat ? selectedCat.emojis : [];
  }, [searchQuery, activeCategory, recentEmojis]);

  const handleEmojiClick = (item) => {
    const selectedChar = typeof item === 'string' ? item : item.emoji;

    // Update recents
    const nextRecents = [selectedChar, ...recentEmojis.filter((e) => e !== selectedChar)].slice(0, 16);
    setRecentEmojis(nextRecents);
    saveStoredRecents(nextRecents);

    onSelectEmoji(selectedChar);
  };

  const handleClearRecents = () => {
    setRecentEmojis([]);
    saveStoredRecents([]);
  };

  if (!isOpen) return null;

  return (
    <div
      ref={containerRef}
      className={`absolute z-40 w-[min(340px,calc(100vw-2rem))] sm:max-w-96 bg-white dark:bg-zinc-950 border border-zinc-200/90 dark:border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col font-sans select-none animate-bubble text-zinc-900 dark:text-zinc-100 transition-colors ${
        position === 'top'
          ? 'bottom-full mb-3 left-0 sm:left-auto'
          : 'top-full mt-3 left-0 sm:left-auto'
      }`}
      style={{ maxHeight: '380px' }}
    >
      {/* Header bar: Search input & Privacy Tag */}
      <div className="p-2.5 pb-2 border-b border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-950/80">
        <div className="relative flex items-center">
          <Search className="w-3.5 h-3.5 absolute left-2.5 text-zinc-400 dark:text-zinc-500 pointer-events-none" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search emojis (e.g. smile, lock, fire)…"
            className="w-full pl-8 pr-7 py-1.5 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-lg text-xs text-zinc-900 dark:text-zinc-200 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:border-emerald-500 font-sans"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2 text-zinc-400 hover:text-zinc-700 dark:hover:text-white p-0.5 rounded cursor-pointer"
              title="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Category Tabs */}
        {!searchQuery && (
          <div className="flex items-center gap-1 mt-2 overflow-x-auto scrollbar-none pb-0.5">
            <button
              type="button"
              onClick={() => setActiveCategory('recent')}
              title="Recently Used"
              className={`px-2 py-1 rounded-md text-xs transition-colors cursor-pointer shrink-0 flex items-center gap-1 ${
                activeCategory === 'recent'
                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 dark:border-emerald-500/40 font-semibold'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/80'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span className="text-[10px] hidden sm:inline">Recent</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveCategory('all')}
              title="All Emojis"
              className={`px-2 py-1 rounded-md text-xs transition-colors cursor-pointer shrink-0 flex items-center gap-1 ${
                activeCategory === 'all'
                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 dark:border-emerald-500/40 font-semibold'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/80'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span className="text-[10px] hidden sm:inline">All</span>
            </button>

            {EMOJI_CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setActiveCategory(cat.id)}
                title={cat.name}
                className={`p-1 px-1.5 rounded-md text-sm transition-colors cursor-pointer shrink-0 ${
                  activeCategory === cat.id
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 dark:border-emerald-500/40'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/80'
                }`}
              >
                {cat.icon}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Grid of emojis */}
      <div className="flex-1 overflow-y-auto p-2 scrollbar-thin">
        {activeCategory === 'recent' && !searchQuery && recentEmojis.length > 0 && (
          <div className="flex items-center justify-between text-[10px] font-mono text-zinc-500 px-1 mb-1.5">
            <span>Recently Used ({recentEmojis.length})</span>
            <button
              type="button"
              onClick={handleClearRecents}
              className="text-zinc-400 hover:text-rose-500 cursor-pointer"
            >
              Clear
            </button>
          </div>
        )}

        {filteredResults.length === 0 ? (
          <div className="py-8 text-center text-zinc-400 dark:text-zinc-500 text-xs font-mono">
            <Search className="w-6 h-6 mx-auto mb-1 text-zinc-400 dark:text-zinc-600 stroke-[1.5]" />
            <div className="mt-1">No matching emojis found</div>
          </div>
        ) : (
          <div className="grid grid-cols-7 sm:grid-cols-8 gap-1">
            {filteredResults.map((item, idx) => (
              <button
                key={`${item.emoji}-${idx}`}
                type="button"
                onClick={() => handleEmojiClick(item)}
                onMouseEnter={() => setHoveredEmoji(item)}
                className="w-9 h-9 sm:w-10 sm:h-10 text-xl sm:text-2xl flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:scale-115 active:scale-95 transition-all cursor-pointer select-none"
                aria-label={item.name}
                title={item.name}
              >
                {item.emoji}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Footer bar: Hover preview & Privacy indicator */}
      <div className="p-2 border-t border-zinc-200/80 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 flex items-center justify-between text-[11px] font-mono text-zinc-500 dark:text-zinc-400">
        {hoveredEmoji ? (
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xl shrink-0">{hoveredEmoji.emoji}</span>
            <span className="truncate text-zinc-800 dark:text-zinc-200 font-sans font-medium">
              {hoveredEmoji.name}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-zinc-500 text-[10px]">
            <Lock className="w-3 h-3 text-emerald-500 shrink-0" />
            <span>100% Offline • Zero Telemetry</span>
          </div>
        )}

        <span className="text-[10px] text-zinc-400 dark:text-zinc-500 shrink-0">Esc to close</span>
      </div>
    </div>
  );
}
