// Coord's website: one dark page, with its privacy and terms pages (legal.tsx). The name, one line on what Coord is, a download button for
// Windows and one for Linux under a Stable or Nightly switch (the newest build of each, read from GitHub Releases in the visitor's
// browser by releases.ts), and a screenshot of a big run's statistics. Hovering a feature shows its screenshot by the cursor.
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import logo from '../../assets/coord-logo-dark.svg';
import attention from './shots/attention.png';
import dashboard from './shots/dashboard.png';
import diagrams from './shots/diagrams.png';
import grill from './shots/grill.png';
import statistics from './shots/statistics.png';
import { Privacy, Terms } from './legal.tsx';
import { linuxPath } from './linuxPath.ts';
import { acceptedPath, claudePath, codexPath, diagramPath, draftPath, moonPath, pagePath, previewPath, yourTurnPath } from './marks.ts';
import { fetchBuilds, releasesPage, sourcePage, visitorPlatform, type Build, type Channel, type Platform } from './releases.ts';

type Builds = Record<Channel, Build | null> | 'loading' | 'failed';

/** The site: the home page, or the privacy or terms page by its path, under one header and footer. */
export function App() {
  const path = location.pathname.replace(/\/+$/, '');
  const Page = path === '/privacy' ? Privacy : path === '/terms' ? Terms : Home;
  return <>
    <div className="sky" aria-hidden="true"><span className="sky-far" /><span className="sky-a" /><span className="sky-b" /><span className="sky-sparks" /></div>
    <header className="header">
      <a href="/" className="brand"><img src={logo} alt="Coord" width={711} height={241} /></a>
      <a href={sourcePage} className="quiet">GitHub</a>
    </header>
    <Page />
    <footer className="footer">
      <span>© 2026 envsemble</span>
      <nav aria-label="Site">
        <a href={releasesPage}>Releases</a>
        <a href={sourcePage + '/blob/main/LICENSE'}>MIT license</a>
        <a href="/privacy">Privacy</a>
        <a href="/terms">Terms</a>
      </nav>
    </footer>
  </>;
}

function Home() {
  const [builds, setBuilds] = useState<Builds>('loading');
  useEffect(() => {
    // In development, /?sample shows sample releases (sample.ts) in place of GitHub's.
    const builds = import.meta.env.DEV && new URLSearchParams(location.search).has('sample') ? import('./sample.ts').then(sample => sample.sampleBuilds()) : fetchBuilds();
    builds.then(setBuilds, () => setBuilds('failed'));
  }, []);
  const visitor = visitorPlatform({ userAgent: navigator.userAgent, platform: navigator.platform });
  const [channel, setChannel] = useState<Channel>('stable');
  const build = typeof builds === 'object' ? builds[channel] : null;
  // Nightly shows stars behind the page.
  useEffect(() => { document.documentElement.dataset.channel = channel; }, [channel]);
  // The visitor's system first.
  const platforms: Platform[] = visitor === 'linux' ? ['linux', 'windows'] : ['windows', 'linux'];
  return <main>
      {/* One box as wide as its longest line, centred; its lines break where they read best. */}
      <div className="intro">
        <h1>A desktop app for planning <br />with <Agent name="Claude Code" path={claudePath} kind="claude" /> or <Agent name="Codex" path={codexPath} kind="codex" /></h1>
        <p className="lead">Agents are fast, and happy to build the wrong thing. <br />Coord makes sure you and your agent mean the same thing.</p>
        <Features />
        <p className="facts">In any terminal, editor or <span className="nowrap">T3 Code</span>. Windows and Linux. Free, MIT.</p>
      </div>
      <ChannelPicker channel={channel} onChange={setChannel} />
      <div className="downloads">
        {platforms.map(platform => <DownloadButton key={platform} platform={platform} build={build} loading={builds === 'loading'} />)}
      </div>
      <p className="note">
        {channel === 'stable' ? 'The tested release, for everyday use.' : 'Built every night from the newest changes. Expect rough edges.'}<br />
        {build ? <a href={build.page}>Version {build.version}</a> : channel === 'nightly' && builds !== 'loading' ? 'No nightly build yet' : null}
        {(build || channel === 'nightly' && builds !== 'loading') && ' · '}<a href={releasesPage}>All releases</a>
      </p>
      <img className="screenshot" src={statistics} width={2184} height={1364}
        alt="A plan's statistics in Coord: 4 hours of agent time in 2 hours, and its timeline, where one Claude Opus session hands work to eleven Claude Haiku subagents at once, then to Opus and Fable." />
    </main>;
}

/** A Material Symbol from envUI, on its 960-unit grid. */
function Symbol({ path, className = 'symbol' }: { path: string; className?: string }) {
  return <svg className={className} viewBox="0 -960 960 960" aria-hidden="true"><path fill="currentColor" d={path} /></svg>;
}
/** An agent by its name, with its maker's mark, as the app shows a model. */
function Agent({ name, path, kind }: { name: string; path: string; kind: 'claude' | 'codex' }) {
  return <span className={'agent agent-' + kind}><svg className="agent-mark" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d={path} /></svg>{name}</span>;
}
/** A plan's state as the app's badge shows it: Draft, Accepted or Your turn. */
function State({ kind, children }: { kind: 'draft' | 'accepted' | 'turn'; children: ReactNode }) {
  const path = kind === 'draft' ? draftPath : kind === 'accepted' ? acceptedPath : yourTurnPath;
  return <span className={'state state-' + kind}><Symbol path={path} />{children}</span>;
}
/** A plan's link to one of its diagrams or pages, in the app's colours: purple, and teal. */
function Ref({ kind, children }: { kind: 'diagram' | 'page'; children: ReactNode }) {
  return <span className={'ref ref-' + kind}><Symbol path={kind === 'diagram' ? diagramPath : pagePath} />{children}</span>;
}

const features: { key: string; text: ReactNode; shot: string; alt: string }[] = [
  { key: 'grill', text: <>Grills you until the plan goes <span className="nowrap"><State kind="draft">Draft</State> → <State kind="accepted">Accepted</State></span></>, shot: grill, alt: 'A draft plan being settled: its items marked Settled or Proposed, and its planning steps.' },
  { key: 'diagrams', text: <>Captures your code and database as a <Ref kind="diagram">class diagram</Ref></>, shot: diagrams, alt: "Classes of the captured code, with the ones an agent's proposal adds marked New." },
  { key: 'dashboards', text: <>Builds live <Ref kind="page">dashboards</Ref> inside the plan</>, shot: dashboard, alt: 'A dashboard inside a plan: a rollout with its key figures and its progress by market.' },
  { key: 'attention', text: <>Shows which plans are <State kind="turn">Your turn</State></>, shot: attention, alt: 'The plans: Your turn first, saying what to do, then Waiting and Later.' },
];

/**
 * The features, each with a faint image mark after it; with a mouse, a feature's screenshot follows the
 * cursor while it is hovered. The screenshots stay in the page, decoded once, and the cursor moves them
 * without React: hovering only swaps which one shows.
 */
function Features() {
  const [shown, setShown] = useState<number | null>(null);
  const peek = useRef<HTMLDivElement>(null);
  const follow = (event: MouseEvent) => {
    const element = peek.current;
    if (!element) return;
    // Beside the cursor, flipped to the other side near the window's right and bottom edges.
    const width = element.offsetWidth, height = element.offsetHeight, gap = 20;
    const x = event.clientX + gap + width > window.innerWidth ? event.clientX - gap - width : event.clientX + gap;
    const y = Math.max(gap, Math.min(event.clientY + gap, window.innerHeight - height - gap));
    element.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  };
  return <>
    <ul className="features">
      {features.map((feature, index) => <li key={feature.key} onMouseEnter={event => { follow(event); setShown(index); }} onMouseMove={follow} onMouseLeave={() => setShown(null)}>
        {feature.text}<Symbol path={previewPath} className="peek-hint" />
      </li>)}
    </ul>
    <div ref={peek} className="peek" data-shown={shown === null ? undefined : ''} aria-hidden="true">
      {features.map((feature, index) => <img key={feature.key} src={feature.shot} alt={feature.alt} width={960} height={600} data-shown={index === shown ? '' : undefined} />)}
    </div>
  </>;
}

const channels: { value: Channel; label: string }[] = [{ value: 'stable', label: 'Stable' }, { value: 'nightly', label: 'Nightly' }];

/** Stable or Nightly, as a segmented control above the download buttons; the arrow keys move between them. */
function ChannelPicker({ channel, onChange }: { channel: Channel; onChange: (channel: Channel) => void }) {
  const move = (event: KeyboardEvent) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const next = channel === 'stable' ? 'nightly' : 'stable';
    onChange(next);
    (event.currentTarget.parentElement?.querySelector(`[data-value="${next}"]`) as HTMLElement | null)?.focus();
  };
  return <div className="channels" role="radiogroup" aria-label="Release channel">
    {channels.map(item => <button key={item.value} type="button" role="radio" data-value={item.value} aria-checked={item.value === channel}
      tabIndex={item.value === channel ? 0 : -1} onClick={() => onChange(item.value)} onKeyDown={move}>{item.value === 'nightly' && <Symbol path={moonPath} />}{item.label}</button>)}
  </div>;
}

const names: Record<Platform, string> = { windows: 'Windows', linux: 'Linux' };
const details: Record<Platform, string> = { windows: 'Windows 10 and 11 · .exe', linux: 'x86_64 · AppImage' };

/** A store-style download button: the system's logo, "Download for …", and what the file is; Windows's in its blue. */
function DownloadButton({ platform, build, loading }: { platform: Platform; build: Build | null; loading: boolean }) {
  // Without a build to offer (GitHub did not answer), the button leads to the releases page.
  const href = build?.downloads[platform]?.url ?? releasesPage;
  return <a className={'download download-' + platform} href={href} aria-busy={loading || undefined}>
    {platform === 'windows' ? <WindowsLogo /> : <LinuxLogo />}
    <span className="download-text">
      <span className="download-label">Download for {names[platform]}</span>
      <span className="download-detail">{details[platform]}</span>
    </span>
  </a>;
}

function WindowsLogo() {
  return <svg className="logo" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="currentColor" d="M0 0h11.377v11.372H0zm12.623 0H24v11.372H12.623zM0 12.623h11.377V24H0zm12.623 0H24V24H12.623z" />
  </svg>;
}

function LinuxLogo() {
  return <svg className="logo" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d={linuxPath} /></svg>;
}
