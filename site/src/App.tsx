// Coord's website: one near-black page, with its privacy and terms pages (legal.tsx). The name, one line on what Coord is, a download button for
// Windows and one for Linux under a Stable or Nightly switch (the newest build of each, read from GitHub Releases in the visitor's
// browser by releases.ts), and what Coord does, one feature at a time under its screenshot.
import { useEffect, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import logo from '../../assets/coord-horizontal-on-dark.svg';
import envsembleLogo from '../../assets/envsemble-horizontal-on-dark.svg';
import diagram from './shots/diagram.png';
import hub from './shots/hub.png';
import plan from './shots/plan.png';
import statistics from './shots/statistics.png';
import { Privacy, Terms } from './legal.tsx';
import { linuxPath } from './linuxPath.ts';
import { acceptedPath, claudePath, codexPath, diagramPath, draftPath, moonPath, pagePath, yourTurnPath } from './marks.ts';
import { fetchBuilds, releasesPage, sourcePage, visitorPlatform, type Build, type Channel, type Platform } from './releases.ts';

type Builds = Record<Channel, Build | null> | 'loading' | 'failed';

/** The site: the home page, or the privacy or terms page by its path, under one header and footer. */
export function App() {
  const path = location.pathname.replace(/\/+$/, '');
  const Page = path === '/privacy' ? Privacy : path === '/terms' ? Terms : Home;
  return <>
    <header className="header">
      <a href="/" className="brand"><img src={logo} alt="Coord" width={711} height={208} /></a>
      <a href={sourcePage} className="quiet">GitHub</a>
    </header>
    <Page />
    <footer className="footer">
      {/* Coord is made by envsemble: the copyright, with the company's lockup as its name, linking to its site. */}
      <div className="maker">
        <span>© 2026</span>
        <a href="https://envsemble.com" className="maker-logo"><img src={envsembleLogo} alt="envsemble" width={303} height={63} /></a>
      </div>
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
  // The visitor's system first.
  const platforms: Platform[] = visitor === 'linux' ? ['linux', 'windows'] : ['windows', 'linux'];
  return <main>
      {/* One box as wide as its longest line, centred; its lines break where they read best. */}
      <div className="intro">
        <h1>A desktop app for planning <br />with <Agent name="Claude" path={claudePath} kind="claude" /> or <Agent name="Codex" path={codexPath} kind="codex" /></h1>
        <p className="lead">Agents are fast, and happy to build the wrong thing. Coord gets you both on the same page, then tracks the work and tells you when it's your turn.</p>
      </div>
      <ChannelPicker channel={channel} onChange={setChannel} />
      <div className="downloads" data-channel={channel}>
        {platforms.map(platform => <DownloadButton key={platform} platform={platform} build={build} loading={builds === 'loading'} />)}
      </div>
      <p className="note">
        {/* One quiet line: what the channel is, its version, all releases, and the licence. Each part
            keeps its words together, with the dot after it, so a narrow line breaks only after a dot. */}
        <span className="nowrap">{channel === 'stable' ? 'Tested, for everyday use' : 'Built every night, expect rough edges'} ·</span>
        {' '}{build ? <span className="nowrap"><a href={build.page}>Version {build.version}</a> ·</span> : channel === 'nightly' && builds !== 'loading' ? <span className="nowrap">No nightly build yet ·</span> : null}
        {' '}<span className="nowrap"><a href={releasesPage}>All releases</a> ·</span> <span className="nowrap">Free and open source</span>
      </p>
      <Screenshots />
    </main>;
}

/**
 * What Coord does, a feature at a time with its screenshot. text is the caption, with the app's badges;
 * label names it for a screen reader; focus is the part a phone's cropped frame keeps, across the
 * screenshot's width (site.css). The screenshots are of Coord's own plans, at 2x in the dark theme.
 */
const screenshots: { key: string; label: string; text: ReactNode; shot: string; focus: string; alt: string }[] = [
  { key: 'turn', label: 'Shows which plans are Your turn', text: <>Shows which plans are <State kind="turn">Your turn</State></>,
    shot: hub, focus: '0%', alt: "Coord's own plans: Your turn first, each saying what to do, then Waiting and Later, with the models that worked on them." },
  { key: 'plan', label: 'Grills you until the plan goes Draft to Accepted', text: <>Grills you until the plan goes <span className="nowrap"><State kind="draft">Draft</State> → <State kind="accepted">Accepted</State></span></>,
    shot: plan, focus: '38%', alt: "One of Coord's own plans, complete: what the user asked for in their own words, and its steps from understanding the request to accepted and done." },
  { key: 'diagram', label: 'Captures your code and database as a class diagram', text: <>Captures your code and database as a <Ref kind="diagram">class diagram</Ref></>,
    shot: diagram, focus: '67%', alt: "Coord's own home database captured as a diagram: projects, sessions and the agents' reports, with their columns and relations." },
  { key: 'statistics', label: "Counts every model's agent time and tokens", text: <>Counts every model's agent time and tokens</>,
    shot: statistics, focus: '38%', alt: "The statistics of one plan's work: agent time, tokens and sessions, and a timeline of the main agent and its subagents working." },
];
const screenshotTime = 6000;

/**
 * The features in turn, one every six seconds, each screenshot fading into the next with its caption
 * under it, and timed dots as on Apple's product pages, kept as small as the site's other controls. A
 * dot shows its feature; pausing holds the shown one. With reduced motion they start paused. All stay
 * in the page, stacked, so the change is a fade, not a load, and the captions keep the tallest one's height.
 */
function Screenshots() {
  const [shown, setShown] = useState(0);
  const [playing, setPlaying] = useState(() => !matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => setShown(index => (index + 1) % screenshots.length), screenshotTime);
    return () => clearTimeout(timer);
  }, [shown, playing]);
  return <section className="screenshots" aria-label="What Coord does" aria-roledescription="carousel">
    <div className="screenshot">
      {screenshots.map((item, index) => <img key={item.key} src={item.shot} alt={item.alt} width={2180} height={1364}
        decoding="async" style={{ '--focus': item.focus } as CSSProperties} data-shown={index === shown ? '' : undefined} aria-hidden={index === shown ? undefined : true} />)}
    </div>
    <div className="screenshot-captions" aria-live={playing ? 'off' : 'polite'}>
      {screenshots.map((item, index) => <p key={item.key} data-shown={index === shown ? '' : undefined} aria-hidden={index === shown ? undefined : true}>{item.text}</p>)}
    </div>
    {/* One small capsule, like the Stable and Nightly switch: a dot for each feature (the shown one a
        bar that fills with its time) and a pause button. */}
    <div className="screenshot-controls">
      <div className="screenshot-dots" role="group" aria-label="Show a feature">
        {screenshots.map((item, index) => <button key={item.key} type="button" className="screenshot-dot" aria-label={item.label}
          aria-current={index === shown ? 'true' : undefined} onClick={() => setShown(index)}>
          {index === shown && <span className="screenshot-fill" data-paused={playing ? undefined : ''} />}
        </button>)}
      </div>
      <button type="button" className="screenshot-play" aria-label={playing ? 'Pause' : 'Play'} onClick={() => setPlaying(value => !value)}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          {playing ? <path fill="currentColor" d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /> : <path fill="currentColor" d="M8 5.5v13l10.5-6.5z" />}
        </svg>
      </button>
    </div>
  </section>;
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
