/**
 * Antigravity Chat Timeline (Codex Style)
 * 
 * 🧭 Codex-style session timeline anchor & mini-map for Antigravity desktop app.
 * - Minimalist monochrome theme (no bright/purple colors, matches system theme).
 * - Left-docked next to the main scroll divider.
 * - Numbered turns (1 —, 2 —, 3 —) with bolded active turn.
 * - Hover card with question title and response excerpt.
 * - Smooth scroll jump with 76px top safe margin (never clipped by sticky headers).
 * - Virtualization-resistant Turn Registry: fixes missing ticks & reset numbering in long chats.
 * - Proactive background history preloader.
 */

(function initAntigravityTimeline() {
  try {
    let currentPath = '';
    let recordedTurns = []; // [{ key, userText, aiText, el, lastScrollTop }]
    let activeIndex = -1;
    let observer = null;
    let isPreloadingHistory = false;

    // Extract user prompt & AI reply summary
    function extractTurnData(turn) {
      const userBlock = turn.querySelector('.sticky.top-0');
      let userText = '';
      let aiText = '';
      if (userBlock) {
        const lines = userBlock.innerText.trim().split('\n').filter(l => !/^\d{1,2}:\d{2}$/.test(l.trim()));
        userText = lines.join(' ').trim();
      }
      const col = turn.firstElementChild;
      if (col && col.children.length > 1) {
        const aiBlock = col.children[1];
        if (aiBlock) {
          const lines = aiBlock.innerText.trim().split('\n').filter(l => !l.startsWith('运行耗时') && !l.startsWith('Ran ') && l.trim().length > 0);
          aiText = lines.slice(0, 3).join('\n').trim();
        }
      }
      return { userText, aiText };
    }

    // Smooth scroll with 76px safe margin, supporting unmounted virtualized turns
    function scrollToTurn(turnRecord, scrollContainer) {
      if (!scrollContainer) return;
      if (turnRecord.el && turnRecord.el.isConnected) {
        const cRect = scrollContainer.getBoundingClientRect();
        const tRect = turnRecord.el.getBoundingClientRect();
        const currentScrollTop = scrollContainer.scrollTop;
        const targetScrollTop = currentScrollTop + (tRect.top - cRect.top) - 76;
        scrollContainer.scrollTo({
          top: Math.max(0, targetScrollTop),
          behavior: 'smooth'
        });
      } else {
        // Virtualized turn unmounted from DOM: fallback to estimated / boundary scroll
        const total = recordedTurns.length;
        const idx = recordedTurns.indexOf(turnRecord);
        if (idx === 0) {
          scrollContainer.scrollTo({ top: 0, behavior: 'smooth' });
        } else if (idx === total - 1) {
          scrollContainer.scrollTo({ top: scrollContainer.scrollHeight, behavior: 'smooth' });
        } else if (turnRecord.lastScrollTop !== undefined && turnRecord.lastScrollTop > 0) {
          scrollContainer.scrollTo({ top: Math.max(0, turnRecord.lastScrollTop - 76), behavior: 'smooth' });
        } else {
          const ratio = idx / Math.max(1, total - 1);
          scrollContainer.scrollTo({ top: scrollContainer.scrollHeight * ratio, behavior: 'smooth' });
        }
      }
    }

    // Proactively preload older messages in background without jumping scroll position
    function autoPreloadHistory() {
      if (isPreloadingHistory) return;
      const btn = Array.from(document.querySelectorAll('button')).find(b => 
        b.textContent.includes('Load older messages')
      );
      if (!btn) return;
      isPreloadingHistory = true;

      let attempts = 0;
      const maxAttempts = 25;

      function step() {
        const b = Array.from(document.querySelectorAll('button')).find(btnEl => 
          btnEl.textContent.includes('Load older messages')
        );
        if (b && attempts < maxAttempts) {
          attempts++;
          const key = Object.keys(b).find(k => k.startsWith('__reactProps'));
          if (key && b[key] && typeof b[key].onClick === 'function') {
            b[key].onClick({ preventDefault: () => {}, stopPropagation: () => {} });
          } else {
            b.click();
          }
          setTimeout(step, 180);
        } else {
          isPreloadingHistory = false;
        }
      }
      step();
    }

    // Bidirectional merge preserving chronological turn order across DOM virtualization
    function mergeTurns(recorded, mounted) {
      if (recorded.length === 0) return [...mounted];
      if (mounted.length === 0) return recorded;

      let bestOverlap = null;
      for (let r = 0; r < recorded.length; r++) {
        for (let m = 0; m < mounted.length; m++) {
          if (recorded[r].key === mounted[m].key) {
            let len = 1;
            while (
              r + len < recorded.length &&
              m + len < mounted.length &&
              recorded[r + len].key === mounted[m + len].key
            ) {
              len++;
            }
            if (!bestOverlap || len > bestOverlap.length) {
              bestOverlap = { rStart: r, mStart: m, length: len };
            }
          }
        }
      }

      if (bestOverlap) {
        const { rStart, mStart, length } = bestOverlap;
        const prefix = [];
        for (let m = 0; m < mStart; m++) {
          if (!recorded.some(r => r.key === mounted[m].key)) {
            prefix.push(mounted[m]);
          }
        }
        const suffix = [];
        for (let m = mStart + length; m < mounted.length; m++) {
          if (!recorded.some(r => r.key === mounted[m].key)) {
            suffix.push(mounted[m]);
          }
        }
        for (let i = 0; i < length; i++) {
          const rec = recorded[rStart + i];
          const mnt = mounted[mStart + i];
          rec.el = mnt.el;
          rec.lastScrollTop = mnt.lastScrollTop;
          if (mnt.aiText) rec.aiText = mnt.aiText;
        }
        return [...prefix, ...recorded, ...suffix];
      } else {
        const firstMountedTop = mounted[0].lastScrollTop || 0;
        const lastRecordedTop = recorded[recorded.length - 1]?.lastScrollTop || 0;
        if (firstMountedTop >= lastRecordedTop) {
          return [...recorded, ...mounted];
        } else {
          return [...mounted, ...recorded];
        }
      }
    }

    // Synchronize currently mounted DOM nodes with persistent session registry
    function syncTurns(turnsWrapper, scrollContainer) {
      if (!turnsWrapper || !scrollContainer) return;
      const mountedEls = Array.from(turnsWrapper.querySelectorAll(':scope > .flex.items-start'));
      if (mountedEls.length === 0) return;

      const mountedTurns = [];
      mountedEls.forEach(el => {
        const data = extractTurnData(el);
        if (!data.userText || data.userText.length === 0) return;
        const cRect = scrollContainer.getBoundingClientRect();
        const tRect = el.getBoundingClientRect();
        const offsetTop = scrollContainer.scrollTop + (tRect.top - cRect.top);
        mountedTurns.push({
          key: data.userText.slice(0, 120),
          userText: data.userText,
          aiText: data.aiText,
          el: el,
          lastScrollTop: offsetTop
        });
      });

      if (mountedTurns.length === 0) return;

      if (window.location.pathname !== currentPath) {
        currentPath = window.location.pathname;
        recordedTurns = [];
        activeIndex = -1;
      }

      recordedTurns = mergeTurns(recordedTurns, mountedTurns);

      mountedEls.forEach(el => { el.style.scrollMarginTop = '76px'; });

      renderTimeline(scrollContainer);
    }

    // Render timeline UI
    function renderTimeline(scrollContainer) {
      const turnsWrapper = document.querySelector('.relative.flex.flex-col.gap-y-3');
      if (!turnsWrapper || !scrollContainer || !scrollContainer.parentElement) return;

      const parent = scrollContainer.parentElement;
      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches ||
                     document.documentElement.classList.contains('dark') ||
                     window.getComputedStyle(document.body).backgroundColor.includes('rgb(19') ||
                     window.getComputedStyle(document.body).backgroundColor.includes('rgb(25');

      const primaryColor = isDark ? '#f4f4f5' : '#18181b';
      const mutedColor = isDark ? 'rgba(255, 255, 255, 0.35)' : 'rgba(0, 0, 0, 0.28)';
      const numColor = isDark ? 'rgba(255, 255, 255, 0.45)' : 'rgba(0, 0, 0, 0.4)';
      const numActiveColor = isDark ? '#ffffff' : '#09090b';

      let bar = document.getElementById('chat-message-timeline');
      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'chat-message-timeline';
        bar.style.cssText = `
          position: absolute;
          left: 10px;
          top: 60px;
          bottom: 80px;
          margin: auto 0;
          height: fit-content;
          max-height: calc(100% - 140px);
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 2px;
          padding: 4px 2px;
          z-index: 45;
          user-select: none;
          pointer-events: auto;
          overflow-y: auto;
          scrollbar-width: none;
          -ms-overflow-style: none;
        `;
        parent.appendChild(bar);
      } else {
        bar.style.left = '10px';
        bar.style.right = 'auto';
      }

      let previewCard = document.getElementById('timeline-preview-card');
      if (!previewCard) {
        previewCard = document.createElement('div');
        previewCard.id = 'timeline-preview-card';
        parent.appendChild(previewCard);
      }

      previewCard.style.cssText = `
        position: absolute;
        left: 46px;
        width: 300px;
        border-radius: 12px;
        padding: 12px 14px;
        pointer-events: none;
        z-index: 100;
        opacity: 0;
        transform: translateX(-8px);
        transition: opacity 0.15s ease, transform 0.15s ease;
        ${isDark 
          ? 'background: #1c1d22; border: 1px solid rgba(255, 255, 255, 0.12); box-shadow: 0 12px 28px rgba(0,0,0,0.5); color: #f3f4f6;' 
          : 'background: #ffffff; border: 1px solid rgba(0, 0, 0, 0.09); box-shadow: 0 10px 25px -4px rgba(0, 0, 0, 0.12), 0 4px 10px -2px rgba(0, 0, 0, 0.05); color: #1f2937;'}
      `;

      previewCard.innerHTML = `
        <div style="display: flex; align-items: baseline; gap: 6px; margin-bottom: 6px;">
          <span id="preview-turn-badge" style="font-size: 11px; font-weight: 700; padding: 1px 6px; border-radius: 4px; ${isDark ? 'background: rgba(255,255,255,0.1); color: #fff;' : 'background: rgba(0,0,0,0.06); color: #18181b;'}"></span>
          <div id="preview-user-text" style="font-size: 13px; font-weight: 600; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; flex: 1;"></div>
        </div>
        <div style="height: 1px; background: ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}; margin: 6px 0;"></div>
        <div id="preview-ai-text" style="font-size: 12px; line-height: 1.45; opacity: 0.75; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; white-space: pre-line;"></div>
      `;

      const existingItems = bar.querySelectorAll('.timeline-item');
      if (existingItems.length !== recordedTurns.length) {
        bar.innerHTML = '';
        recordedTurns.forEach((turn, idx) => {
          const item = document.createElement('div');
          item.className = 'timeline-item';
          item.dataset.index = idx;
          item.style.cssText = 'height: 14px; display: flex; align-items: center; cursor: pointer; padding: 2px 0; gap: 5px; flex-shrink: 0;';

          const num = document.createElement('span');
          num.className = 'timeline-num';
          num.textContent = (idx + 1);
          num.style.cssText = `
            font-size: 10px;
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            font-weight: ${idx === activeIndex ? '700' : '500'};
            min-width: 14px;
            text-align: right;
            color: ${idx === activeIndex ? numActiveColor : numColor};
            transition: color 0.2s, font-weight 0.2s;
          `;
          item.appendChild(num);

          const line = document.createElement('div');
          line.className = 'timeline-line';
          line.style.cssText = `
            width: ${idx === activeIndex ? '24px' : '12px'};
            height: ${idx === activeIndex ? '2.5px' : '2px'};
            border-radius: 1px;
            background: ${idx === activeIndex ? primaryColor : mutedColor};
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          `;
          item.appendChild(line);

          item.onmouseenter = () => {
            if (idx !== activeIndex) {
              line.style.width = '20px';
              line.style.background = primaryColor;
              num.style.color = numActiveColor;
              num.style.fontWeight = '700';
            }
            const badgeEl = document.getElementById('preview-turn-badge');
            const userEl = document.getElementById('preview-user-text');
            const aiEl = document.getElementById('preview-ai-text');
            if (badgeEl) badgeEl.textContent = '#' + (idx + 1);
            if (userEl) userEl.textContent = turn.userText || `对话 #${idx + 1}`;
            if (aiEl) aiEl.textContent = turn.aiText || '(无回复或正在生成中)';

            const itemRect = item.getBoundingClientRect();
            const parentRect = parent.getBoundingClientRect();
            const cardH = previewCard.offsetHeight || 150;
            let targetTop = itemRect.top - parentRect.top - 20;

            if (targetTop < 10) targetTop = 10;
            if (targetTop + cardH > parentRect.height - 10) {
              targetTop = parentRect.height - cardH - 10;
            }

            previewCard.style.top = targetTop + 'px';
            previewCard.style.opacity = '1';
            previewCard.style.transform = 'translateX(0)';
          };

          item.onmouseleave = () => {
            if (idx !== activeIndex) {
              line.style.width = '12px';
              line.style.background = mutedColor;
              num.style.color = numColor;
              num.style.fontWeight = '500';
            }
            previewCard.style.opacity = '0';
            previewCard.style.transform = 'translateX(-8px)';
          };

          item.onclick = (e) => {
            e.stopPropagation();
            scrollToTurn(turn, scrollContainer);
          };

          bar.appendChild(item);
        });
      }

      function updateActiveHighlight(newIndex) {
        if (newIndex === activeIndex || newIndex < 0 || newIndex >= recordedTurns.length) return;
        activeIndex = newIndex;
        const items = bar.querySelectorAll('.timeline-item');
        items.forEach((it, i) => {
          const ln = it.querySelector('.timeline-line');
          const nm = it.querySelector('.timeline-num');
          if (!ln) return;
          if (i === activeIndex) {
            ln.style.width = '24px';
            ln.style.height = '2.5px';
            ln.style.background = primaryColor;
            if (nm) {
              nm.style.color = numActiveColor;
              nm.style.fontWeight = '700';
            }
            it.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          } else {
            ln.style.width = '12px';
            ln.style.height = '2px';
            ln.style.background = mutedColor;
            if (nm) {
              nm.style.color = numColor;
              nm.style.fontWeight = '500';
            }
          }
        });
      }

      if (observer) observer.disconnect();
      observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const matchedIdx = recordedTurns.findIndex(r => r.el === entry.target);
            if (matchedIdx !== -1) {
              updateActiveHighlight(matchedIdx);
            }
          }
        });
      }, {
        root: scrollContainer,
        rootMargin: '-35% 0px -35% 0px',
        threshold: 0
      });

      recordedTurns.forEach(r => {
        if (r.el && r.el.isConnected) {
          observer.observe(r.el);
        }
      });

      // Top and bottom scroll boundary fallback for 100% accurate highlights
      if (!scrollContainer.__timelineScrollBound) {
        scrollContainer.__timelineScrollBound = true;
        scrollContainer.addEventListener('scroll', () => {
          if (scrollContainer.scrollTop <= 10) {
            updateActiveHighlight(0);
          } else if (scrollContainer.scrollHeight - scrollContainer.scrollTop <= scrollContainer.clientHeight + 25) {
            updateActiveHighlight(recordedTurns.length - 1);
          }
        }, { passive: true });
      }
    }

    function setupTimeline() {
      const turnsWrapper = document.querySelector('.relative.flex.flex-col.gap-y-3');
      if (!turnsWrapper) return;
      const scrollContainer = turnsWrapper.closest('.overflow-y-auto');
      if (!scrollContainer) return;

      if (turnsWrapper.__timelineObserver) {
        turnsWrapper.__timelineObserver.disconnect();
      }
      const domObserver = new MutationObserver(() => {
        autoPreloadHistory();
        syncTurns(turnsWrapper, scrollContainer);
      });
      domObserver.observe(turnsWrapper, { childList: true, subtree: false });
      turnsWrapper.__timelineObserver = domObserver;

      autoPreloadHistory();
      syncTurns(turnsWrapper, scrollContainer);
    }

    // SPA navigation watcher & periodic check
    window.__antigravityTimelineTimer = setInterval(() => {
      const turnsWrapper = document.querySelector('.relative.flex.flex-col.gap-y-3');
      const scrollContainer = turnsWrapper?.closest('.overflow-y-auto');
      const bar = document.getElementById('chat-message-timeline');
      if (turnsWrapper && scrollContainer) {
        autoPreloadHistory();
        if (!bar || !bar.isConnected || bar.style.left !== '10px') {
          setupTimeline();
        } else {
          syncTurns(turnsWrapper, scrollContainer);
        }
      }
    }, 1000);

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', setupTimeline);
    } else {
      setupTimeline();
    }
  } catch (err) {
    console.error('[Antigravity Timeline] Init error:', err);
  }
})();
