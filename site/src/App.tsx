// Coord's website: one dark page. The name, one line on what Coord is, a download button for
// Windows and one for Linux (the newest stable build, read from GitHub Releases in the visitor's
// browser by releases.ts), and a screenshot of a plan. Hovering a feature shows its screenshot by the cursor.
import { useEffect, useState, type MouseEvent, type ReactNode } from 'react';
import logo from '../../assets/coord-logo-dark.svg';
import plan from '../../assets/plan-dark.png';
import attention from './shots/attention.png';
import dashboard from './shots/dashboard.png';
import diagrams from './shots/diagrams.png';
import grill from './shots/grill.png';
import { linuxPath } from './linuxPath.ts';
import { acceptedPath, claudePath, codexPath, diagramPath, draftPath, pagePath, yourTurnPath } from './marks.ts';
import { fetchBuilds, releasesPage, sourcePage, visitorPlatform, type Build, type Channel, type Platform } from './releases.ts';

type Builds = Record<Channel, Build | null> | 'loading' | 'failed';

export function App() {
  const [builds, setBuilds] = useState<Builds>('loading');
  useEffect(() => { fetchBuilds().then(setBuilds, () => setBuilds('failed')); }, []);
  const visitor = visitorPlatform({ userAgent: navigator.userAgent, platform: navigator.platform });
  const stable = typeof builds === 'object' ? builds.stable : null;
  const nightly = typeof builds === 'object' ? builds.nightly : null;
  // The visitor's system first.
  const platforms: Platform[] = visitor === 'linux' ? ['linux', 'windows'] : ['windows', 'linux'];
  return <>
    <header className="header">
      <a href="/" className="brand"><img src={logo} alt="Coord" width={711} height={241} /></a>
      <a href={sourcePage} className="quiet">GitHub</a>
    </header>
    <main>
      <div className="intro">
      <h1>A desktop app for planning bigger changes with <Agent name="Claude Code" path={claudePath} kind="claude" /> or <Agent name="Codex" path={codexPath} kind="codex" /></h1>
      <p className="lead">Agents are fast, and very happy to build the wrong thing. Coord makes yours agree on a plan with you first.</p>
      <Features />
      <p className="facts">Wherever you run your agent: a terminal, your editor, <span className="nowrap">T3 Code</span>. Windows and Linux. Free and open source, MIT.</p>
      <div className="downloads">
        {platforms.map(platform => <DownloadButton key={platform} platform={platform} build={stable} loading={builds === 'loading'} />)}
      </div>
      <p className="note">
        {stable ? <><a href={stable.page}>Version {stable.version}</a> · </> : null}
        <a href={releasesPage}>All releases</a>
      </p>
      </div>
      <img className="screenshot" src={plan} width={2163} height={1352}
        alt="A plan in Coord: its title, whose turn it is and what to do, its outcome and scope, and beside it the plan's progress, steps and statistics." />
      <section className="nightly" aria-labelledby="nightly-title">
        <h2 id="nightly-title">Nightly</h2>
        <p>Fresh off <code>dev</code> every night. Occasionally on fire. Switch channels in <span className="nowrap">Settings › Updates</span>.</p>
        {nightly ? <>
          <div className="downloads">
            {platforms.map(platform => <DownloadButton key={platform} platform={platform} build={nightly} loading={false} plain />)}
          </div>
          <p className="note"><a href={nightly.page}>Version {nightly.version}</a></p>
        </> : <p className="note">{builds === 'loading' ? 'Looking for the newest nightly…' : <>No nightly build yet. Every build is on the <a href={releasesPage}>releases page</a>.</>}</p>}
      </section>
    </main>
    <footer className="footer">© 2026 envsemble · MIT license</footer>
  </>;
}

/** A Material Symbol from envUI, on its 960-unit grid. */
function Symbol({ path }: { path: string }) {
  return <svg className="symbol" viewBox="0 -960 960 960" aria-hidden="true"><path fill="currentColor" d={path} /></svg>;
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
  { key: 'grill', text: <>Your agent grills you until the plan goes from <State kind="draft">Draft</State> to <span className="nowrap"><State kind="accepted">Accepted</State>.</span></>, shot: grill, alt: 'A draft plan being settled: its items marked Settled or Proposed, and its planning steps.' },
  { key: 'diagrams', text: <>It can capture your code and database in a <Ref kind="diagram">class diagram</Ref>, before and after.</>, shot: diagrams, alt: "An agent's proposal drawn over the captured code, with what it adds and changes marked." },
  { key: 'dashboards', text: <>It builds live <Ref kind="page">dashboards</Ref> inside the plan while it works.</>, shot: dashboard, alt: "A page inside a plan: two layouts to choose between, above the proposal's diagram." },
  { key: 'attention', text: <>Coord shows every plan that’s <span className="nowrap"><State kind="turn">Your turn</State>,</span> and what it needs from you.</>, shot: attention, alt: 'The hub: Your turn first, saying what to do, then Waiting and Later.' },
];

/** The features; with a mouse, each one's screenshot follows the cursor while it is hovered. */
function Features() {
  const [peek, setPeek] = useState<{ index: number; x: number; y: number } | null>(null);
  // Load the screenshots up front, so the first hover shows at once.
  useEffect(() => { for (const feature of features) new Image().src = feature.shot; }, []);
  const follow = (index: number) => (event: MouseEvent) => {
    // Beside the cursor, flipped to the other side near the window's right and bottom edges.
    const width = Math.min(520, window.innerWidth * 0.6), height = width * 1364 / 2184, gap = 20;
    const x = event.clientX + gap + width > window.innerWidth ? event.clientX - gap - width : event.clientX + gap;
    const y = Math.max(gap, Math.min(event.clientY + gap, window.innerHeight - height - gap));
    setPeek({ index, x, y });
  };
  return <>
    <ul className="features">
      {features.map((feature, index) => <li key={feature.key} onMouseMove={follow(index)} onMouseLeave={() => setPeek(null)}>{feature.text}</li>)}
    </ul>
    {peek && <img className="peek" src={features[peek.index]!.shot} alt={features[peek.index]!.alt} width={2184} height={1364}
      style={{ transform: `translate(${peek.x}px, ${peek.y}px)` }} />}
  </>;
}

const names: Record<Platform, string> = { windows: 'Windows', linux: 'Linux' };
const details: Record<Platform, string> = { windows: 'Windows 10 and 11 · .exe', linux: 'x86_64 · AppImage' };

/** A store-style download button: the system's logo, "Download for …", and what the file is; Windows's in its blue unless plain. */
function DownloadButton({ platform, build, loading, plain = false }: { platform: Platform; build: Build | null; loading: boolean; plain?: boolean }) {
  // Without a build to offer (GitHub did not answer), the button leads to the releases page.
  const href = build?.downloads[platform]?.url ?? releasesPage;
  return <a className={'download' + (plain ? '' : ' download-' + platform)} href={href} aria-busy={loading || undefined}>
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
