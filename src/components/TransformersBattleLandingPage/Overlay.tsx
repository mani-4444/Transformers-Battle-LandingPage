import { forwardRef, useImperativeHandle, useRef } from 'react';
import { CHAPTERS, pulse, remap } from '../../scene/timeline';

export interface OverlayHandle {
  /** Per-frame update from the render loop (no React re-render). */
  update(p: number): void;
}

interface OverlayProps {
  activeChapter: number;
  onJump(index: number): void;
}

/** Minimal cinematic HUD: title card, chapter captions, closing line, chapter rail. */
export const Overlay = forwardRef<OverlayHandle, OverlayProps>(function Overlay({ activeChapter, onJump }, ref) {
  const root = useRef<HTMLDivElement>(null);
  const hero = useRef<HTMLDivElement>(null);
  const hint = useRef<HTMLDivElement>(null);
  const closing = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const captions = useRef<(HTMLDivElement | null)[]>([]);

  useImperativeHandle(ref, () => ({
    update(p: number) {
      if (hero.current) {
        const k = 1 - remap(p, 0.035, 0.1);
        hero.current.style.opacity = String(k);
        hero.current.style.transform = `translate3d(0, ${(1 - k) * -24}px, 0)`;
        hero.current.style.visibility = k <= 0.001 ? 'hidden' : 'visible';
      }
      if (hint.current) hint.current.style.opacity = String(1 - remap(p, 0.005, 0.03));
      if (closing.current) {
        const k = remap(p, 0.93, 0.975);
        closing.current.style.opacity = String(k);
        closing.current.style.transform = `translate3d(0, ${(1 - k) * 18}px, 0)`;
        closing.current.style.visibility = k <= 0.001 ? 'hidden' : 'visible';
      }
      if (bar.current) bar.current.style.transform = `scaleX(${p})`;
      CHAPTERS.forEach((c, i) => {
        const el = captions.current[i];
        if (!el) return;
        const k = i === 0 || i === CHAPTERS.length - 1 ? 0 : pulse(p, c.start + 0.004, c.start + 0.02, c.end - 0.02, c.end - 0.004);
        el.style.opacity = String(k);
        el.style.transform = `translate3d(${(1 - k) * -16}px, 0, 0)`;
        el.style.visibility = k <= 0.001 ? 'hidden' : 'visible';
      });
      if (root.current) {
        const bars = pulse(p, 0.33, 0.37, 0.9, 0.94);
        root.current.style.setProperty('--tb-bars', String(bars));
      }
    },
  }));

  return (
    <div className="tb-overlay" ref={root}>
      <div className="tb-letterbox tb-letterbox--top" aria-hidden="true" />
      <div className="tb-letterbox tb-letterbox--bottom" aria-hidden="true" />
      <div className="tb-progress" aria-hidden="true">
        <div className="tb-progress__bar" ref={bar} />
      </div>

      <header className="tb-brand" aria-hidden="true">
        <span className="tb-brand__mark" />
        <span>Cybertron · Last Stand</span>
      </header>

      <div className="tb-hero" ref={hero}>
        <h1 className="tb-hero__title">
          <span className="tb-hero__name tb-hero__name--prime">Optimus Prime</span>
          <span className="tb-hero__vs">vs.</span>
          <span className="tb-hero__name tb-hero__name--megatron">Megatron</span>
        </h1>
        <p className="tb-hero__sub">One last battle for the fate of Cybertron.</p>
      </div>

      <div className="tb-hint" ref={hint} aria-hidden="true">
        <span>Scroll to engage</span>
        <span className="tb-hint__line" />
      </div>

      {CHAPTERS.map((c, i) => (
        <div
          key={c.id}
          className="tb-caption"
          ref={(el) => {
            captions.current[i] = el;
          }}
          aria-hidden="true"
        >
          <span className="tb-caption__num">{c.numeral}</span>
          <div>
            <div className="tb-caption__title">{c.title}</div>
            <div className="tb-caption__text">{c.caption}</div>
          </div>
        </div>
      ))}

      <div className="tb-closing" ref={closing}>
        <p className="tb-closing__line">The battle is not over.</p>
        <button type="button" className="tb-closing__replay" onClick={() => onJump(0)}>
          ↑ Scroll back to relive the fight
        </button>
      </div>

      <nav className="tb-rail" aria-label="Battle chapters">
        <ol>
          {CHAPTERS.map((c, i) => (
            <li key={c.id}>
              <button
                type="button"
                className={i === activeChapter ? 'is-active' : undefined}
                aria-current={i === activeChapter ? 'step' : undefined}
                aria-label={`Chapter ${c.numeral}: ${c.title}`}
                onClick={() => onJump(i)}
              >
                <span className="tb-rail__dot" />
                <span className="tb-rail__label">
                  {c.numeral} · {c.title}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </nav>
    </div>
  );
});
