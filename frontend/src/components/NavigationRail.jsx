import React, { useState } from 'react';

/**
 * Slim Icon Navigation Rail matching the leftmost column of the inspiration UI
 * Includes 3D geometric brand mark top button with smooth cascading sub-button animation,
 * active state pill, admin launcher, theme toggle, and user profile photo avatar.
 */
export function NavigationRail({
  nickname,
  userId,
  userProfile,
  activeView = 'messages', // 'messages' | 'admin' | 'profile'
  onSelectView,
  onOpenNewRoom,
  onOpenDirectChat,
  onOpenAdmin,
  onOpenProfile,
  onOpenIntro,
  theme = 'dark',
  onToggleTheme,
  presenceCount = 0,
}) {
  // State for toggling and re-triggering smooth modern cascade animation of buttons beneath top button
  const [isNavOpen, setIsNavOpen] = useState(true);
  const [cascadeCycle, setCascadeCycle] = useState(0);

  const handleTopButtonClick = () => {
    // Toggle menu closed or open with smooth animation
    setIsNavOpen((prev) => !prev);
    setCascadeCycle((prev) => prev + 1);
  };

  const navButtons = [
    {
      id: 'messages',
      title: 'Messages (Home)',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
        </svg>
      ),
      onClick: () => onSelectView('messages'),
      isActive: activeView === 'messages',
      badge: null,
    },
    {
      id: 'new-room',
      title: 'Join or Create Encrypted Room',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      onClick: onOpenNewRoom,
      isActive: false,
      hoverClass: 'hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40',
    },
    {
      id: 'direct-chat',
      title: 'Start Private Direct Message',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
      ),
      onClick: onOpenDirectChat,
      isActive: false,
      hoverClass: 'hover:text-cyan-600 dark:hover:text-cyan-400 hover:bg-cyan-50 dark:hover:bg-cyan-950/40',
    },
    {
      id: 'admin',
      title: 'Admin Moderation Console',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
      ),
      onClick: onOpenAdmin,
      isActive: activeView === 'admin',
      activeClass: 'bg-amber-600 text-white shadow-md scale-105',
      hoverClass: 'hover:text-amber-600 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40',
    },
    {
      id: 'intro',
      title: 'Platform Overview & Architecture Guide',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      onClick: onOpenIntro,
      isActive: false,
      hoverClass: 'hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40',
    },
  ];

  return (
    <nav
      aria-label="Sidebar navigation"
      className="hidden md:flex w-16 sm:w-20 bg-[#f4f6f5]/90 dark:bg-zinc-950/95 border-r border-zinc-200/80 dark:border-zinc-800 flex-col items-center justify-between py-5 shrink-0 select-none z-20 transition-colors duration-200 card-3d"
    >
      {/* Top: Geometric Brand Icon & Navigation */}
      <div className="flex flex-col items-center gap-4 w-full">
        {/* Top Button with 3D tactile press and toggle capability */}
        <div className="flex flex-col items-center">
          <button
            type="button"
            onClick={handleTopButtonClick}
            title={isNavOpen ? 'Close navigation buttons (Click to hide)' : 'Open navigation buttons (Click to show)'}
            aria-expanded={isNavOpen}
            aria-label={isNavOpen ? 'Close navigation buttons' : 'Open navigation buttons'}
            className={`top-button-3d w-11 h-11 rounded-2xl bg-zinc-950 dark:bg-zinc-900 border text-white flex items-center justify-center cursor-pointer group relative transition-all duration-300 ${
              isNavOpen
                ? 'border-emerald-500/50 shadow-[0_0_16px_rgba(16,185,129,0.3)]'
                : 'border-zinc-700/60 hover:border-emerald-500/60 shadow-md hover:scale-105'
            }`}
          >
            {/* Geometric 4-circle clover mark matching screenshot */}
            <svg
              className={`w-6 h-6 text-emerald-400 transition-all duration-300 ${
                isNavOpen ? 'group-hover:rotate-12 group-hover:scale-105' : 'opacity-80 group-hover:scale-110 group-hover:opacity-100'
              }`}
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <circle cx="8" cy="8" r="3.2" />
              <circle cx="16" cy="8" r="3.2" />
              <circle cx="8" cy="16" r="3.2" />
              <circle cx="16" cy="16" r="3.2" />
            </svg>

            {/* Toggle state indicator: Chevron / Dot */}
            <span
              className={`absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full border-2 border-white dark:border-zinc-950 flex items-center justify-center transition-all duration-300 ${
                isNavOpen
                  ? 'bg-emerald-500 text-zinc-950 ring-2 ring-emerald-500/40 scale-100 shadow-sm'
                  : 'bg-zinc-600 text-zinc-300 scale-95 ring-1 ring-zinc-500 group-hover:bg-emerald-500 group-hover:text-zinc-950 group-hover:scale-105'
              }`}
              title={isNavOpen ? 'Menu open • Click to close' : 'Menu closed • Click to reopen'}
            >
              <svg
                className={`w-2 h-2 transition-transform duration-300 ${
                  isNavOpen ? 'rotate-0' : '-rotate-90'
                }`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="3.5"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </span>
          </button>

          {/* When closed, subtle expand affordance */}
          {!isNavOpen && (
            <button
              type="button"
              onClick={handleTopButtonClick}
              title="Click to reopen navigation menu"
              aria-label="Reopen navigation menu"
              className="mt-2 text-[10px] text-zinc-400 dark:text-zinc-500 hover:text-emerald-500 dark:hover:text-emerald-400 flex flex-col items-center gap-0.5 animate-pulse cursor-pointer transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          )}
        </div>

        {/* Buttons Beneath It: Smooth Collapse on Close & Cascading Spring Animation on Reopen */}
        <div
          className={`w-full overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
            isNavOpen
              ? 'max-h-[380px] opacity-100 scale-100 pointer-events-auto'
              : 'max-h-0 opacity-0 scale-90 pointer-events-none -translate-y-2'
          }`}
        >
          <div
            key={`cascade-${cascadeCycle}`}
            className="flex flex-col items-center gap-3.5 w-full pt-1 pb-1"
          >
            {navButtons.map((btn, index) => {
              const delayMs = index * 45;
              const isSelected = btn.isActive;

              return (
                <button
                  key={btn.id}
                  type="button"
                  onClick={btn.onClick}
                  title={btn.title}
                  style={{
                    animationDelay: `${delayMs}ms`,
                  }}
                  className={`btn-3d ${
                    isNavOpen ? 'animate-cascade-reveal' : ''
                  } w-10 h-10 rounded-xl flex items-center justify-center cursor-pointer transition-all duration-200 ${
                    isSelected
                      ? btn.activeClass || 'bg-zinc-950 dark:bg-zinc-800 text-white shadow-md ring-1 ring-zinc-700/60 scale-105'
                      : `text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200/70 dark:hover:bg-zinc-800/60 ${btn.hoverClass || ''}`
                  }`}
                >
                  {btn.icon}
                </button>
              );
            })}

            {/* Optional dedicated close button at the bottom of the list */}
            <button
              type="button"
              onClick={handleTopButtonClick}
              title="Close navigation menu"
              aria-label="Close navigation menu"
              className="mt-1 w-7 h-7 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50 flex items-center justify-center text-xs transition-colors cursor-pointer"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Bottom: Theme Toggle & User Avatar */}
      <div className="flex flex-col items-center gap-3.5">
        {/* Dark / Light Mode Toggle Button */}
        {onToggleTheme && (
          <button
            type="button"
            onClick={onToggleTheme}
            title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            aria-label="Toggle dark/light theme"
            className="btn-3d w-10 h-10 rounded-xl text-zinc-500 dark:text-zinc-400 hover:text-amber-500 dark:hover:text-amber-400 hover:bg-zinc-200/70 dark:hover:bg-zinc-800/60 flex items-center justify-center cursor-pointer"
          >
            {theme === 'dark' ? (
              <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            ) : (
              <svg className="w-5 h-5 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            )}
          </button>
        )}

        {/* Clickable Profile Avatar Button (Displays Uploaded Photo if present) */}
        <button
          type="button"
          onClick={onOpenProfile || (() => onSelectView && onSelectView('profile'))}
          title={`My Profile & Settings: ${nickname || 'You'} (Click to view & edit)`}
          className="relative group cursor-pointer focus:outline-none"
        >
          <div
            className={`w-10 h-10 rounded-full shadow-md overflow-hidden border-2 flex items-center justify-center text-xs font-bold transition-all ${
              activeView === 'profile'
                ? 'border-emerald-500 ring-2 ring-emerald-500/40 scale-105'
                : 'border-white dark:border-zinc-800 group-hover:scale-105'
            } ${
              !userProfile?.avatarImage || (!userProfile.avatarImage.startsWith('data:image/') && !userProfile.avatarImage.startsWith('blob:'))
                ? `bg-gradient-to-tr ${userProfile?.avatarGradient || 'from-zinc-800 to-zinc-750'} text-white`
                : 'bg-zinc-800'
            }`}
          >
            {userProfile?.avatarImage && (userProfile.avatarImage.startsWith('data:image/') || userProfile.avatarImage.startsWith('blob:')) ? (
              <img
                src={userProfile.avatarImage}
                alt={nickname || 'Profile photo'}
                className="w-full h-full object-cover"
              />
            ) : (
              userProfile?.avatarEmoji || (nickname ? nickname.slice(0, 2).toUpperCase() : 'ME')
            )}
          </div>

          {/* Green Online Status Dot */}
          <span
            className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-500 border-2 border-white dark:border-zinc-950 shadow-xs"
            title="Connected to relay"
          />
        </button>
      </div>
    </nav>
  );
}
