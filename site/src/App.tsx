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
      <h1>Coord is a desktop app for planning work with your coding agents.</h1>
      <ul className="features">
        <li>Your agent grills you until the plan is settled.</li>
        <li>It can capture your code and databases as diagrams.</li>
        <li>It builds live dashboards inside the plan as it works.</li>
        <li>Coord shows which plans need your attention, and why.</li>
      </ul>
      <p className="facts">Works with Claude Code and Codex wherever you run them, such as a terminal or T3 Code. Used internally at envsemble. Windows and Linux, free and open source (MIT).</p>
      <div className="downloads">
        {platforms.map(platform => <DownloadButton key={platform} platform={platform} build={stable} loading={builds === 'loading'} />)}
      </div>
      <p className="note">
        {stable ? <><a href={stable.page}>Version {stable.version}</a> · </> : null}
        <a href={releasesPage}>All releases</a>
      </p>
      <img className="screenshot" src={plan} width={2163} height={1352}
        alt="A plan in Coord: its title, whose turn it is and what to do, its outcome and scope, and beside it the plan's progress, steps and statistics." />
      <section className="nightly" aria-labelledby="nightly-title">
        <h2 id="nightly-title">Nightly</h2>
        <p>The newest changes, built every night. It can break. Switch channels in <span className="nowrap">Settings › Updates</span>.</p>
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
