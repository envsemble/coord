// Coord's website: one dark page. On the left what Coord is, on the right a card with the
// downloads (the newest stable build, read from GitHub Releases in the visitor's browser by
// releases.ts); below, a panel with a tab per thing Coord does, each showing its screenshot; and the
// nightly builds.
import { useEffect, useState } from 'react';
import logo from '../../assets/coord-logo-dark.svg';
import plan from '../../assets/plan-dark.png';
import attention from './shots/attention.png';
import dashboard from './shots/dashboard.png';
import diagrams from './shots/diagrams.png';
import grill from './shots/grill.png';
import { linuxPath } from './linuxPath.ts';
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
      <section className="hero">
        <div className="intro">
          <h1>The <mark>planning</mark> app for your coding agent</h1>
          <p>Coord works with <mark>Claude Code</mark> and <mark>Codex</mark>. Your agent asks you everything it needs to know, writes the plan down, then builds it while you follow along.</p>
          <p className="aside">(Agents will happily build the wrong thing, very fast. This helps.)</p>
        </div>
        <div className="get">
          <h2>Get Coord</h2>
          <ul className="checks">
            <li>Free and open source, MIT</li>
            <li>Windows and Linux</li>
            <li>Wherever you run your agent: a terminal, your editor, T3 Code</li>
          </ul>
          <div className="downloads">
            {platforms.map(platform => <DownloadButton key={platform} platform={platform} build={stable} loading={builds === 'loading'} />)}
          </div>
          <p className="note">{stable ? <><a href={stable.page}>Version {stable.version}</a> · </> : null}<a href={releasesPage}>All releases</a></p>
        </div>
      </section>
      <Tour />
      <section className="nightly" aria-labelledby="nightly-title">
        <div>
          <h2 id="nightly-title">Nightly</h2>
          <p>Fresh off <code>dev</code> every night. Occasionally on fire. Switch channels any time in <span className="nowrap">Settings › Updates</span>.</p>
        </div>
        {nightly ? <div className="nightly-get">
          <div className="downloads">
            {platforms.map(platform => <DownloadButton key={platform} platform={platform} build={nightly} loading={false} plain />)}
          </div>
          <p className="note"><a href={nightly.page}>Version {nightly.version}</a></p>
        </div> : <p className="note">{builds === 'loading' ? 'Looking for the newest nightly…' : <>No nightly yet. It’s asleep. Every build is on the <a href={releasesPage}>releases page</a>.</>}</p>}
      </section>
    </main>
    <footer className="footer">© 2026 envsemble · MIT license · <a href={sourcePage}>Source</a></footer>
  </>;
}

const tabs: { key: string; label: string; line: string; shot: string; alt: string }[] = [
  { key: 'plan', label: 'The plan', shot: plan, line: 'What to build, the steps and the decisions. Markdown in Git, on your computer.', alt: "A plan in Coord: its outcome and scope, and beside it the plan's progress, steps and statistics." },
  { key: 'grill', label: 'Getting grilled', shot: grill, line: 'One question at a time, until you both know what you’re building. Thorough. Sometimes annoyingly so.', alt: 'A draft plan being settled: its items marked Settled or Proposed, and its planning steps.' },
  { key: 'diagrams', label: 'Diagrams', shot: diagrams, line: 'Your code and database, drawn, with the agent’s proposal on top. See what’s about to change before it does.', alt: "An agent's proposal drawn over the captured code, with what it adds and changes marked." },
  { key: 'dashboards', label: 'Live dashboards', shot: dashboard, line: 'The agent builds pages inside the plan: a choice to make, numbers to watch, a before and after.', alt: "A page inside a plan: two layouts to choose between, above the proposal's diagram." },
  { key: 'attention', label: 'Your turn', shot: attention, line: 'What’s waiting on you comes first, with what it needs. Everything else can wait.', alt: 'The hub: Your turn first, saying what to do, then Waiting and Later.' },
];

/** A tab per thing Coord does, each with its screenshot; hovering a tab shows it, as clicking does. */
function Tour() {
  const [current, setCurrent] = useState(0);
  // Load the screenshots up front, so switching shows them at once.
  useEffect(() => { for (const tab of tabs) new Image().src = tab.shot; }, []);
  const tab = tabs[current]!;
  return <section className="tour" aria-label="What Coord does">
    <div className="tour-tabs" role="tablist" aria-label="What Coord does">
      {tabs.map((item, index) => <button key={item.key} type="button" role="tab" id={'tab-' + item.key} aria-selected={index === current}
        aria-controls="tour-panel" className="tour-tab" onClick={() => setCurrent(index)} onMouseEnter={() => setCurrent(index)}>{item.label}</button>)}
    </div>
    <div className="tour-panel" id="tour-panel" role="tabpanel" aria-labelledby={'tab-' + tab.key}>
      <p className="tour-line">{tab.line}</p>
      <img src={tab.shot} alt={tab.alt} width={2184} height={1364} />
    </div>
  </section>;
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
