// Coord's website: one dark page. The name, one line on what Coord is, a download button for
// Windows and one for Linux (the newest stable build, read from GitHub Releases in the visitor's
// browser by releases.ts), and a screenshot of a plan.
import { useEffect, useState } from 'react';
import logo from '../../assets/coord-logo-dark.svg';
import plan from '../../assets/plan-dark.png';
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
      <h1>Coord is a desktop app for planning work with Claude Code and Codex.</h1>
      <p className="lead">You and your agent write the plan together: what to build, the steps and the decisions. The agent then implements it step by step, and Coord shows the plan, its progress and what the agent is waiting on you for.</p>
      <ul className="facts">
        <li>Connects to Claude Code and Codex through a plugin.</li>
        <li>Plans are Markdown files in a Git folder on your computer.</li>
        <li>Windows and Linux. Free and open source (MIT).</li>
      </ul>
      <div className="downloads">
        {platforms.map(platform => <DownloadButton key={platform} platform={platform} build={stable} loading={builds === 'loading'} />)}
      </div>
      <p className="note">
        {stable ? <>Version {stable.version} · </> : null}
        {nightly ? <><a href={nightly.page}>Nightly build</a> · </> : null}
        <a href={releasesPage}>All releases</a>
      </p>
      <img className="screenshot" src={plan} width={2163} height={1352}
        alt="A plan in Coord: its title, whose turn it is and what to do, its outcome and scope, and beside it the plan's progress, steps and statistics." />
    </main>
    <footer className="footer">© 2026 envsemble · MIT license</footer>
  </>;
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
