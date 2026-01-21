const initUseCaseSwitcher = () => {
  const cards = Array.from(
    document.querySelectorAll<HTMLButtonElement>('[data-use-case-card]')
  );
  const titleEl = document.querySelector<HTMLElement>('[data-use-case-title]');
  const bodyEl = document.querySelector<HTMLElement>('[data-use-case-body]');
  const codeEl = document.querySelector<HTMLElement>('[data-use-case-code]');
  if (!cards.length || !titleEl || !bodyEl || !codeEl) {
    return;
  }

  const selectCard = (card: HTMLButtonElement) => {
    cards.forEach((btn) => {
      const isActive = btn === card;
      btn.classList.toggle('bg-indigo-50', isActive);
      btn.classList.toggle('border-indigo-300', isActive);
      btn.classList.toggle('border-gray-200', !isActive);
      btn.classList.toggle('ring-2', isActive);
      btn.classList.toggle('ring-indigo-200', isActive);
      btn.classList.toggle('ring-offset-2', isActive);
      btn.classList.toggle('ring-offset-white', isActive);
      btn.classList.toggle('shadow-lg', isActive);
      btn.classList.toggle('shadow-sm', !isActive);
      btn.classList.toggle('opacity-60', !isActive);
      btn.classList.toggle('opacity-100', isActive);
      btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });

    titleEl.textContent = card.dataset.title ?? '';
    bodyEl.textContent = card.dataset.body ?? '';

    const highlighted = card.dataset.codeHtml;
    const language = card.dataset.codeLanguage || 'typescript';
    if (highlighted) {
      codeEl.innerHTML = decodeURIComponent(highlighted);
      codeEl.className = `language-${language}`;
    }
  };

  cards.forEach((card) => {
    card.addEventListener('click', () => selectCard(card));
  });

  selectCard(cards[0]);
};

const initHeroTerminal = () => {
  const area = document.querySelector<HTMLElement>('[data-hero-terminal]');
  if (!area) return;

  const shell = area.querySelector<HTMLElement>('[data-hero-terminal-shell]');
  const commandEl = area.querySelector<HTMLElement>('[data-terminal-command]');
  const logEl = area.querySelector<HTMLElement>('[data-terminal-log]');
  if (!shell || !commandEl || !logEl) return;

  const sequences = [
    {
      command: 'npx hypequery init',
      lines: [
        'Scaffolding project...',
        'Creating ClickHouse types...',
        'Linking metrics to code...',
        'Done in 1.8s',
      ],
    },
    {
      command: 'npx hypequery generate',
      lines: [
        'Reading ClickHouse schema...',
        'Mapping columns → TypeScript...',
        'Writing analytics/schema.ts',
        'Types refreshed.',
      ],
    },
    {
      command: 'npx hypequery dev',
      lines: [
        'Booting local runner...',
        'Watching metrics for edits...',
        'Exposing API on http://localhost:8787',
        'Ready for requests.',
      ],
    },
  ];

  let timers: number[] = [];
  let sequenceIndex = 0;
  let running = false;

  const clearTimers = () => {
    timers.forEach((id) => window.clearTimeout(id));
    timers = [];
  };

  const resetLog = () => {
    logEl.innerHTML =
      '<p class="text-xs font-mono text-emerald-200/70">Waiting for command...</p>';
    commandEl.textContent = 'npx hypequery init';
  };

  const playSequence = () => {
    const current = sequences[sequenceIndex % sequences.length];
    sequenceIndex += 1;
    commandEl.textContent = current.command;
    logEl.innerHTML = '';

    current.lines.forEach((line, idx) => {
      const timer = window.setTimeout(() => {
        const lineEl = document.createElement('p');
        lineEl.textContent = line;
        lineEl.className = 'text-xs font-mono text-emerald-100/90';
        logEl.appendChild(lineEl);
      }, idx * 700);
      timers.push(timer);
    });

    const total = current.lines.length * 700 + 800;
    const loopTimer = window.setTimeout(() => {
      if (!running) return;
      playSequence();
    }, total);
    timers.push(loopTimer);
  };

  const start = () => {
    if (running) return;
    running = true;
    shell.classList.add('terminal-active');
    playSequence();
  };

  const stop = () => {
    running = false;
    shell.classList.remove('terminal-active');
    clearTimers();
    resetLog();
  };

  resetLog();
  area.addEventListener('mouseenter', start);
  area.addEventListener('mouseleave', stop);
  area.addEventListener('focusin', start);
  area.addEventListener('focusout', stop);
  area.addEventListener('touchstart', start, { passive: true });
  area.addEventListener('touchend', stop);
};

const initPageInteractions = () => {
  initUseCaseSwitcher();
  initHeroTerminal();
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPageInteractions);
} else {
  initPageInteractions();
}

export {};
