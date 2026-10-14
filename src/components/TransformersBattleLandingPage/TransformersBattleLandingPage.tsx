import { useCallback, useEffect, useRef, useState } from 'react';
import { BattleScene, webglAvailable } from '../../scene/BattleScene';
import { CHAPTERS } from '../../scene/timeline';
import { Overlay, type OverlayHandle } from './Overlay';
import { scrollTopFor, trackProgress, usePrefersReducedMotion } from './useScrollProgress';
import './TransformersBattleLandingPage.css';

type Status = 'loading' | 'ready' | 'error';

/**
 * Scroll-driven cinematic: Optimus Prime vs. Megatron.
 * A tall scroll track drives a sticky WebGL stage; scroll position is the master
 * timeline for transformations, combat, camera and effects.
 */
export default function TransformersBattleLandingPage() {
  const trackRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<OverlayHandle>(null);
  const sceneRef = useRef<BattleScene | null>(null);
  const chapterRef = useRef(0);
  const [status, setStatus] = useState<Status>('loading');
  const [step, setStep] = useState({ label: 'Initialising', fraction: 0 });
  const [chapter, setChapter] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');
  const reducedMotion = usePrefersReducedMotion();
  const reducedRef = useRef(reducedMotion);
  reducedRef.current = reducedMotion;

  const onFrame = useCallback((p: number) => {
    overlayRef.current?.update(p);
    let idx = CHAPTERS.findIndex((c) => p < c.end);
    if (idx < 0) idx = CHAPTERS.length - 1;
    if (idx !== chapterRef.current) {
      chapterRef.current = idx;
      setChapter(idx);
    }
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    const track = trackRef.current;
    if (!host || !track) return;
    if (!webglAvailable()) {
      setErrorMessage('WebGL is unavailable in this browser, so the 3D battle cannot be rendered.');
      setStatus('error');
      return;
    }

    // The canvas is created per mount, so a remount (e.g. StrictMode) never reuses a disposed context.
    const canvas = document.createElement('canvas');
    canvas.className = 'tb-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    host.appendChild(canvas);

    let scene: BattleScene;
    try {
      scene = new BattleScene(canvas, { reducedMotion: reducedRef.current, onFrame });
    } catch (err) {
      canvas.remove();
      setErrorMessage('The 3D renderer could not start on this device.');
      setStatus('error');
      console.error(err);
      return;
    }
    sceneRef.current = scene;
    let disposed = false;
    // Dev-only hook for automated visual checks (stripped from production builds).
    if (import.meta.env.DEV) (window as unknown as { __battle?: BattleScene }).__battle = scene;

    const measure = () => {
      const r = host.getBoundingClientRect();
      scene.resize(r.width, r.height);
    };
    let lastP = trackProgress(track);
    let lastH = window.innerHeight;
    const readScroll = () => {
      lastP = trackProgress(track);
      scene.setTarget(lastP);
    };
    const onResize = () => {
      measure();
      // The track is sized in viewport units, so keep the same story position
      // (not the same pixel offset) when the viewport height changes.
      if (window.innerHeight !== lastH) {
        lastH = window.innerHeight;
        window.scrollTo({ top: scrollTopFor(track, lastP), behavior: 'instant' as ScrollBehavior });
      }
      readScroll();
    };
    measure();
    readScroll();
    const ro = new ResizeObserver(onResize);
    ro.observe(host);
    window.addEventListener('scroll', readScroll, { passive: true });
    window.addEventListener('resize', onResize);
    const onLost = (e: Event) => {
      e.preventDefault();
      setErrorMessage('The graphics context was lost. Reload the page to restart the battle.');
      setStatus('error');
    };
    canvas.addEventListener('webglcontextlost', onLost);

    scene
      .init((label, fraction) => setStep({ label, fraction }))
      .then(() => {
        if (!disposed) setStatus('ready');
      })
      .catch((err) => {
        if (disposed) return;
        console.error(err);
        setErrorMessage('The battlefield failed to initialise.');
        setStatus('error');
      });

    return () => {
      disposed = true;
      ro.disconnect();
      window.removeEventListener('scroll', readScroll);
      window.removeEventListener('resize', onResize);
      canvas.removeEventListener('webglcontextlost', onLost);
      scene.dispose();
      canvas.remove();
      sceneRef.current = null;
    };
  }, [onFrame]);

  useEffect(() => {
    sceneRef.current?.setReducedMotion(reducedMotion);
  }, [reducedMotion]);

  const jumpTo = useCallback(
    (index: number) => {
      const track = trackRef.current;
      if (!track) return;
      const c = CHAPTERS[index];
      const p = index === 0 ? 0 : c.start + 0.012;
      window.scrollTo({ top: scrollTopFor(track, p), behavior: reducedMotion ? 'auto' : 'smooth' });
    },
    [reducedMotion],
  );

  if (status === 'error') {
    return (
      <main className="tb-root tb-fallback">
        <div className="tb-fallback__inner">
          <h1 className="tb-hero__title">
            <span className="tb-hero__name tb-hero__name--prime">Optimus Prime</span>
            <span className="tb-hero__vs">vs.</span>
            <span className="tb-hero__name tb-hero__name--megatron">Megatron</span>
          </h1>
          <p className="tb-hero__sub">One last battle for the fate of Cybertron.</p>
          <p className="tb-fallback__msg" role="alert">
            {errorMessage}
          </p>
          <ol className="tb-fallback__list">
            {CHAPTERS.map((c) => (
              <li key={c.id}>
                <strong>
                  {c.numeral} · {c.title}
                </strong>{' '}
                — {c.caption}
              </li>
            ))}
          </ol>
          <p className="tb-closing__line">The battle is not over.</p>
        </div>
      </main>
    );
  }

  return (
    <main className={`tb-root${status === 'ready' ? ' is-ready' : ''}`}>
      <div className="tb-track" ref={trackRef}>
        <div className="tb-stage">
          <div className="tb-host" ref={hostRef} />
          <Overlay ref={overlayRef} activeChapter={chapter} onJump={jumpTo} />
          <div className={`tb-loader${status === 'ready' ? ' is-done' : ''}`} role="status" aria-live="polite" aria-hidden={status === 'ready'}>
            <div className="tb-loader__title">Optimus Prime vs. Megatron</div>
            <div className="tb-loader__bar">
              <div className="tb-loader__fill" style={{ transform: `scaleX(${step.fraction})` }} />
            </div>
            <div className="tb-loader__step">{step.label}…</div>
          </div>
        </div>

        {/* Scroll chapters: give the track real, navigable content for assistive tech. */}
        {CHAPTERS.map((c) => (
          <section
            key={c.id}
            id={`chapter-${c.id}`}
            className="tb-chapter"
            style={{ top: `calc(${c.start} * (100% - 100svh))`, height: `calc(${c.end - c.start} * (100% - 100svh))` }}
            aria-label={`Chapter ${c.numeral}: ${c.title}`}
          >
            <h2 className="tb-sr">
              {c.numeral}. {c.title}
            </h2>
            <p className="tb-sr">{c.caption}</p>
          </section>
        ))}
      </div>
    </main>
  );
}
