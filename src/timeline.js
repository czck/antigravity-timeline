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
 * - Viewport scroll anchoring & anti-swapping engine: guarantees turns never swap or jump.
 * - Deterministic reading-line active tracker.
 */

(function initAntigravityTimeline() {
  try {
    let currentPath = '';
    let recordedTurns = []; // [{ key, userText, aiText, el, lastScrollTop }]
    let activeIndex = -1;
    let isPreloadingHistory = false;
    let historyPreloadedForPath = '';

    // 1. Deep user prompt normalization: thoroughly clean date/timestamp variations and edited tags
    function cleanUserText(raw) {
      if (!raw) return '';
      let t = raw;
      // Strip time patterns: HH:MM, HH:MM:SS
      t = t.replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, '');
      // Strip date patterns: YYYY/MM/DD, YYYY-MM-DD, MM/DD/YYYY
      t = t.replace(/\b\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}\b/g, '');
      t = t.replace(/\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}\b/g, '');
      // Strip edited badges
      t = t.replace(/\(已编辑\)|已编辑|\(edited\)|edited/gi, '');
      // Collapse whitespace and trim
      t = t.replace(/[,，\s]+/g, ' ').trim();
      return t;
    }

    // Extract user prompt & AI reply summary
    function extractTurnData(turn) {
      const userBlock = turn.querySelector('.sticky.top-0');
      let userText = '';
      let aiText = '';
      if (userBlock) {
        userText = cleanUserText(userBlock.innerText);
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

    // 2. 带有视口锚定锁的静默历史补全（单会话仅执行一次，彻底杜绝轮询引发的滚动突跳）
    function autoPreloadHistory(scrollContainer) {
      if (isPreloadingHistory || historyPreloadedForPath === window.location.pathname) return;
      const btn = Array.from(document.querySelectorAll('button')).find(b => 
        (b.textContent && b.textContent.includes('Load older messages')) ||
        (b.getAttribute('aria-label') && b.getAttribute('aria-label').includes('Load older messages'))
      );
      if (!btn) return;

      historyPreloadedForPath = window.location.pathname;
      isPreloadingHistory = true;
      let attempts = 0;
      const maxAttempts = 25;

      function step() {
        const b = Array.from(document.querySelectorAll('button')).find(btnEl => 
          btnEl.textContent.includes('Load older messages')
        );
        if (b && attempts < maxAttempts) {
          attempts++;
          const prevHeight = scrollContainer ? scrollContainer.scrollHeight : 0;
          const prevTop = scrollContainer ? scrollContainer.scrollTop : 0;

          const key = Object.keys(b).find(k => k.startsWith('__reactProps'));
          if (key && b[key] && typeof b[key].onClick === 'function') {
            b[key].onClick({ preventDefault: () => {}, stopPropagation: () => {} });
          } else {
            b.click();
          }

          // Viewport scroll compensation: keep currently viewed turn fixed in viewport
          setTimeout(() => {
            if (scrollContainer && prevTop > 50) {
              const delta = scrollContainer.scrollHeight - prevHeight;
              if (delta > 0) {
                scrollContainer.scrollTop = prevTop + delta;
              }
            }
            step();
          }, 200);
        } else {
          isPreloadingHistory = false;
        }
      }
      step();
    }

    // 3. Strict DOM topology order sync: strictly prevents duplicates and turn swapping
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
          key: data.userText.slice(0, 100),
          userText: data.userText,
          aiText: data.aiText,
          el: el,
          lastScrollTop: offsetTop
        });
      });

      if (mountedTurns.length === 0) return;

      // Reset when navigating to a different conversation
      if (window.location.pathname !== currentPath) {
        currentPath = window.location.pathname;
        recordedTurns = [];
        activeIndex = -1;
        historyPreloadedForPath = '';
      }

      if (recordedTurns.length === 0) {
        recordedTurns = [...mountedTurns];
      } else {
        // Locate matching turn anchor points in recordedTurns
        let firstMatchMountedIdx = -1;
        let firstMatchRecordedIdx = -1;
        let lastMatchMountedIdx = -1;
        let lastMatchRecordedIdx = -1;

        for (let m = 0; m < mountedTurns.length; m++) {
          const rIdx = recordedTurns.findIndex(r => r.key === mountedTurns[m].key);
          if (rIdx !== -1) {
            if (firstMatchMountedIdx === -1) {
              firstMatchMountedIdx = m;
              firstMatchRecordedIdx = rIdx;
            }
            lastMatchMountedIdx = m;
            lastMatchRecordedIdx = rIdx;
            // In-place refresh of DOM reference, lastScrollTop, and aiText
            recordedTurns[rIdx].el = mountedTurns[m].el;
            recordedTurns[rIdx].lastScrollTop = mountedTurns[m].lastScrollTop;
            if (mountedTurns[m].aiText) recordedTurns[rIdx].aiText = mountedTurns[m].aiText;
          }
        }

        if (firstMatchRecordedIdx !== -1) {
          // Prepend older history (only turns strictly preceding the first match)
          if (firstMatchMountedIdx > 0) {
            const older = mountedTurns.slice(0, firstMatchMountedIdx).filter(
              ot => !recordedTurns.some(r => r.key === ot.key)
            );
            if (older.length > 0) {
              recordedTurns.unshift(...older);
            }
          }

          // Append newer turns (only turns strictly following the last match)
          if (lastMatchMountedIdx < mountedTurns.length - 1) {
            const newer = mountedTurns.slice(lastMatchMountedIdx + 1).filter(
              nt => !recordedTurns.some(r => r.key === nt.key)
            );
            if (newer.length > 0) {
              recordedTurns.push(...newer);
            }
          }
        } else {
          // Completely new conversation without pathname change
          recordedTurns = [...mountedTurns];
        }
      }

      mountedEls.forEach(el => { el.style.scrollMarginTop = '76px'; });

      renderTimeline(scrollContainer);
      computeAndSetActiveTurn(scrollContainer);
    }

    // 4. Safe smooth scroll jump with 76px top safe margin
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

    // 5. Direct internal scroll of timeline bar only (never bubbles to ancestor containers)
    function scrollBarToItem(bar, it) {
      if (!bar || !it) return;
      const barRect = bar.getBoundingClientRect();
      const itRect = it.getBoundingClientRect();
      if (itRect.top < barRect.top + 6) {
        bar.scrollTop -= (barRect.top + 6 - itRect.top);
      } else if (itRect.bottom > barRect.bottom - 6) {
        bar.scrollTop += (itRect.bottom - (barRect.bottom - 6));
      }
    }

    // 6. Deterministic reading-line active turn calculation
    function computeAndSetActiveTurn(scrollContainer) {
      if (!scrollContainer || recordedTurns.length === 0) return;
      const bar = document.getElementById('chat-message-timeline');
      if (!bar) return;

      let targetIdx = -1;
      const scrollTop = scrollContainer.scrollTop;
      const scrollHeight = scrollContainer.scrollHeight;
      const clientHeight = scrollContainer.clientHeight;

      if (scrollTop <= 20) {
        targetIdx = 0;
      } else if (scrollHeight - scrollTop <= clientHeight + 35) {
        targetIdx = recordedTurns.length - 1;
      } else {
        const cRect = scrollContainer.getBoundingClientRect();
        const readingLine = cRect.top + 110;

        for (let i = 0; i < recordedTurns.length; i++) {
          const turn = recordedTurns[i];
          if (turn.el && turn.el.isConnected) {
            const tRect = turn.el.getBoundingClientRect();
            if (tRect.top <= readingLine && tRect.bottom > readingLine) {
              targetIdx = i;
              break;
            }
            if (tRect.top > readingLine && targetIdx === -1) {
              targetIdx = Math.max(0, i - 1);
              break;
            }
          }
        }
        if (targetIdx === -1) targetIdx = recordedTurns.length - 1;
      }

      if (targetIdx !== -1 && targetIdx !== activeIndex) {
        activeIndex = targetIdx;
        const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches ||
                       document.documentElement.classList.contains('dark') ||
                       window.getComputedStyle(document.body).backgroundColor.includes('rgb(19') ||
                       window.getComputedStyle(document.body).backgroundColor.includes('rgb(25');
        const primaryColor = isDark ? '#f4f4f5' : '#18181b';
        const mutedColor = isDark ? 'rgba(255, 255, 255, 0.35)' : 'rgba(0, 0, 0, 0.28)';
        const numColor = isDark ? 'rgba(255, 255, 255, 0.45)' : 'rgba(0, 0, 0, 0.4)';
        const numActiveColor = isDark ? '#ffffff' : '#09090b';

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
            scrollBarToItem(bar, it);
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
    }

    // 7. Render timeline DOM
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

      // Native throttled scroll listener for accurate active highlight without side effects
      if (!scrollContainer.__timelineScrollBound) {
        scrollContainer.__timelineScrollBound = true;
        let ticking = false;
        scrollContainer.addEventListener('scroll', () => {
          if (!ticking) {
            ticking = true;
            requestAnimationFrame(() => {
              ticking = false;
              computeAndSetActiveTurn(scrollContainer);
            });
          }
        }, { passive: true });
      }
    }

    // 8. 智能防强制吸底滚动守护 (Smart Auto-Scroll & Streaming Interruption Guard)
    function setupSmartAutoScrollGuard(scrollContainer) {
      if (!scrollContainer || scrollContainer.__smartAutoScrollGuardInstalled) return;
      scrollContainer.__smartAutoScrollGuardInstalled = true;

      const script = document.createElement('script');
      script.textContent = `
        (function() {
          const turnsWrapper = document.querySelector('.relative.flex.flex-col.gap-y-3');
          const scrollContainer = turnsWrapper?.closest('.overflow-y-auto');
          if (!scrollContainer || scrollContainer.__smartAutoScrollGuardActive) return;
          scrollContainer.__smartAutoScrollGuardActive = true;

          let isAutoScrollEnabled = false;
          let lastScrollTop = scrollContainer.scrollTop;

          // 1. 拦截并接管 scrollTo (支持对象形式与双参数形式)
          const origScrollTo = scrollContainer.scrollTo;
          scrollContainer.scrollTo = function(xOrOptions, y, ...rest) {
            let targetTop = null;
            if (typeof xOrOptions === 'object' && xOrOptions !== null) {
              targetTop = xOrOptions.top;
            } else if (typeof y === 'number') {
              targetTop = y;
            }
            if (typeof targetTop === 'number') {
              const maxScroll = this.scrollHeight - this.clientHeight;
              // 若目标位置为触底（>= maxScroll - 60），且用户正向上阅读历史 -> 拦截自动吸底
              if (targetTop >= maxScroll - 60 && !isAutoScrollEnabled) {
                return;
              }
            }
            return origScrollTo.call(this, xOrOptions, y, ...rest);
          };

          // 2. 拦截并接管 scrollTop setter，屏蔽来自内部逻辑的强制直接触底赋值
          const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
          if (desc && desc.set) {
            Object.defineProperty(scrollContainer, 'scrollTop', {
              get: function() { return desc.get.call(this); },
              set: function(val) {
                const maxScroll = this.scrollHeight - this.clientHeight;
                if (val >= maxScroll - 60 && !isAutoScrollEnabled) {
                  return;
                }
                return desc.set.call(this, val);
              },
              configurable: true
            });
          }

          // 3. 监听滚轮事件 (向上滚瞬间锁定，绝不允许向上滚动被重置为吸底)
          scrollContainer.addEventListener('wheel', (e) => {
            if (e.deltaY < 0) {
              isAutoScrollEnabled = false;
            } else if (e.deltaY > 0 && (scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight) <= 10) {
              isAutoScrollEnabled = true;
            }
          }, { passive: true });

          // 4. 监听触控板与触摸移动
          let touchStartY = 0;
          scrollContainer.addEventListener('touchstart', (e) => {
            if (e.touches && e.touches[0]) touchStartY = e.touches[0].clientY;
          }, { passive: true });

          scrollContainer.addEventListener('touchmove', (e) => {
            if (e.touches && e.touches[0]) {
              const delta = e.touches[0].clientY - touchStartY;
              if (delta > 5) {
                isAutoScrollEnabled = false;
              } else if (delta < -5 && (scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight) <= 10) {
                isAutoScrollEnabled = true;
              }
            }
          }, { passive: true });

          // 5. 监听滚动事件：只要在向上滚动，坚决保持锁定；仅在明确向下滑动到底部时才恢复吸底
          scrollContainer.addEventListener('scroll', () => {
            const curr = scrollContainer.scrollTop;
            const dist = scrollContainer.scrollHeight - curr - scrollContainer.clientHeight;
            if (curr < lastScrollTop - 2) {
              isAutoScrollEnabled = false;
            } else if (dist <= 5 && curr > lastScrollTop + 2) {
              isAutoScrollEnabled = true;
            }
            lastScrollTop = curr;
          }, { passive: true });

          // 6. 点击“回到底部”按钮时瞬间恢复吸底
          document.addEventListener('click', (e) => {
            const btn = e.target?.closest?.('button[aria-label*="Bottom"], button[aria-label*="底部"], [data-testid="scroll-to-bottom"]');
            if (btn) {
              isAutoScrollEnabled = true;
            }
          }, true);
        })();
      `;
      (document.head || document.documentElement).appendChild(script);
      script.remove();
    }

    // 9. 全局滚动平滑与防抖动守护 (Anti-Jitter & Scroll Stabilization Engine)
    function setupScrollStabilizer() {
      if (document.getElementById('antigravity-scroll-stabilizer')) return;
      const style = document.createElement('style');
      style.id = 'antigravity-scroll-stabilizer';
      style.textContent = `
        /* 1. 彻底禁用全容器及子节点滚动锚定与吸附，杜绝向上滚动时的锚点偏移抖动 */
        [data-testid="autoscroll-viewport"],
        [data-testid="autoscroll-viewport"] * {
          overflow-anchor: none !important;
          scroll-snap-type: none !important;
          scroll-snap-align: none !important;
        }

        /* 2. 保证原生即时滚动响应，启用硬件加速独立合成层，杜绝文字重叠残影与闪烁 */
        [data-testid="autoscroll-viewport"] {
          scroll-behavior: auto !important;
          overscroll-behavior-y: contain;
          transform: translateZ(0);
          will-change: scroll-position;
        }

        /* 3. 隔离子节点重排重绘，防止尺寸过渡动画引发连环 Reflow */
        .relative.flex.flex-col.gap-y-3 > div {
          contain: style;
        }
      `;
      (document.head || document.documentElement).appendChild(style);
    }

    function setupTimeline() {
      const turnsWrapper = document.querySelector('.relative.flex.flex-col.gap-y-3');
      if (!turnsWrapper) return;
      const scrollContainer = turnsWrapper.closest('.overflow-y-auto');
      if (!scrollContainer) return;

      setupSmartAutoScrollGuard(scrollContainer);
      setupScrollStabilizer();

      if (turnsWrapper.__timelineObserver) {
        turnsWrapper.__timelineObserver.disconnect();
      }
      let syncDebounce = null;
      const domObserver = new MutationObserver(() => {
        if (syncDebounce) clearTimeout(syncDebounce);
        syncDebounce = setTimeout(() => {
          syncTurns(turnsWrapper, scrollContainer);
        }, 150);
      });
      domObserver.observe(turnsWrapper, { childList: true, subtree: false });
      turnsWrapper.__timelineObserver = domObserver;

      autoPreloadHistory(scrollContainer);
      syncTurns(turnsWrapper, scrollContainer);
    }

    // SPA navigation watcher & periodic light check
    if (window.__antigravityTimelineTimer) {
      clearInterval(window.__antigravityTimelineTimer);
    }
    window.__antigravityTimelineTimer = setInterval(() => {
      const turnsWrapper = document.querySelector('.relative.flex.flex-col.gap-y-3');
      const scrollContainer = turnsWrapper?.closest('.overflow-y-auto');
      const bar = document.getElementById('chat-message-timeline');
      if (turnsWrapper && scrollContainer) {
        setupSmartAutoScrollGuard(scrollContainer);
        setupScrollStabilizer();
        if (!bar || !bar.isConnected || bar.style.left !== '10px') {
          setupTimeline();
        } else {
          const mountedCount = turnsWrapper.querySelectorAll(':scope > .flex.items-start').length;
          if (mountedCount !== recordedTurns.length) {
            syncTurns(turnsWrapper, scrollContainer);
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
