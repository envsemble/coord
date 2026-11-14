// Coord's website: one page. What Coord is, one button that downloads the newest stable build for
// the visitor's system, and every build of both channels below it. The builds come from GitHub
// Releases, asked in the visitor's browser (releases.ts).
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Alert, Button, Card, Graphic, Link, SegmentedControl, Spinner, Text, ThemeToggle } from '@envsemble/envui';
import { IconArrowOutward } from '@envsemble/envui/icons/ArrowOutward';
import { IconCode } from '@envsemble/envui/icons/Code';
import { IconDownload } from '@envsemble/envui/icons/Download';
import { CoordMark } from '@envsemble/coord-diagrams/mark';
import hub from '../../assets/hub.png';
import { fetchBuilds, releasesPage, sourcePage, visitorPlatform, type Build, type Channel, type Platform } from './releases.ts';

type Builds = Record<Channel, Build | null>;
type Loaded = { kind: 'loading' } | { kind: 'failed' } | { kind: 'loaded'; builds: Builds };

const platformNames: Record<Platform, string> = { windows: 'Windows', linux: 'Linux' };

/** The size of a download in megabytes. */
const megabytes = (bytes: number) => `${Math.round(bytes / 1_000_000)} MB`;
/** A release's day, such as 15 November 2026. */
const day = (iso: string | null) => iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : null;

export function App() {
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' });
  useEffect(() => { fetchBuilds().then(builds => setLoaded({ kind: 'loaded', builds }), () => setLoaded({ kind: 'failed' })); }, []);
  const platform = useMemo(() => visitorPlatform({ userAgent: navigator.userAgent, platform: navigator.platform }), []);
  return <div className="site">
    <Header />
    <main>
      <Hero loaded={loaded} platform={platform} />
      <Screenshot />
      <Features />
      <Downloads loaded={loaded} />
    </main>
    <Footer />
  </div>;
}

function Header() {
  return <header className="site-header">
    <Link className="site-brand" href="#top" underline={false} aria-label="Coord, to the top">
      <CoordMark size={28} label="" />
      <span className="site-wordmark">Coord</span>
    </Link>
    <nav className="site-nav" aria-label="Site">
      <Link href="#download" underline={false}>Download</Link>
      <Link href={sourcePage} underline={false}>GitHub</Link>
      <ThemeToggle />
    </nav>
  </header>;
}

/** The headline, and the one button: the newest stable build for the visitor's system. */
function Hero({ loaded, platform }: { loaded: Loaded; platform: Platform | 'mac' | null }) {
  return <section className="hero" id="top" aria-labelledby="hero-title">
    <Text variant="display" render={<h1 />} id="hero-title" className="hero-title">
      Where your coding agents’ <span className="hero-accent">plans</span> live.
    </Text>
    <Text variant="body" emphasis="muted" className="hero-lead">
      Coord keeps the plans you make with Claude Code and Codex, with their steps, decisions and diagrams, in a planning folder on your computer. Every session picks up where the last one stopped, and one desktop app shows what each agent is doing and what waits for you.
    </Text>
    <div className="hero-actions">
      <PrimaryDownload loaded={loaded} platform={platform} />
      <Button variant="text" href={sourcePage} startIcon={<IconCode />}>Read the source</Button>
    </div>
    <Text variant="body-sm" emphasis="subtle" className="hero-note">
      {platform === 'mac' ? 'Coord runs on Windows and Linux for now. ' : ''}Free and open source under the MIT license. No account, no service, no API key.
    </Text>
  </section>;
}

function PrimaryDownload({ loaded, platform }: { loaded: Loaded; platform: Platform | 'mac' | null }) {
  if (loaded.kind === 'loading') return <Button variant="primary" size="lg" pending startIcon={<IconDownload />}>Download</Button>;
  const file = loaded.kind === 'loaded' && (platform === 'windows' || platform === 'linux') ? loaded.builds.stable?.downloads[platform] : null;
  if (file && (platform === 'windows' || platform === 'linux')) {
    return <Button variant="primary" size="lg" href={file.url} startIcon={<IconDownload />}>Download for {platformNames[platform]}</Button>;
  }
  // Another system, or no build to offer it: the builds below, or GitHub when they cannot be listed.
  return <Button variant="primary" size="lg" href={loaded.kind === 'failed' ? releasesPage : '#download'} startIcon={<IconDownload />}>Download</Button>;
}

function Screenshot() {
  return <figure className="screenshot">
    <Graphic src={hub} size="fill" aspect="2184/1364" fit="cover"
      alt="The Coord hub: the plans of the project Northwind grouped as Your turn, Waiting and Later, each with what it waits for, its steps done and the models that worked on it." />
  </figure>;
}

const features: { title: string; text: string }[] = [
  { title: 'Plans that survive the session', text: 'A work item is a plan, its steps and its glossary, in a Git repository of its own. The next session, agent or model starts from what was agreed.' },
  { title: 'One place for every agent', text: 'The hub lists every plan of every project by whose turn it is: what waits for you first, then what agents work on and what comes later.' },
  { title: 'Plan before code', text: 'For work big enough to plan, the agent asks, questions you until the design is settled, then implements it step by step through pull requests.' },
  { title: 'Diagrams that match the code', text: 'Coord captures TypeScript, Java and databases as class and entity diagrams, and compares the system before and after a plan.' },
  { title: 'Numbers on how agents work', text: 'Agent time, tokens, models and subagents for every work item, so you see what a feature cost and how a new model does.' },
  { title: 'Yours, on your computer', text: 'Plans are Markdown in Git in your home folder. Nothing leaves your computer unless you pair another device of yours.' },
];

function Features() {
  return <section className="features" aria-labelledby="features-title">
    <Text variant="headline" render={<h2 />} id="features-title" className="section-title">Agents are good at doing work and bad at remembering it</Text>
    <div className="feature-grid">
      {features.map(feature => <Card key={feature.title} className="feature" background="default" title={feature.title} headingLevel={3} description={feature.text} />)}
    </div>
  </section>;
}

const channelText: Record<Channel, string> = {
  stable: 'Releases, after they are tested. For everyday use.',
  nightly: 'A build of the newest changes, every night. It can break.',
};

/** Every build: the channel, its version, and the file for each system. */
function Downloads({ loaded }: { loaded: Loaded }) {
  const [channel, setChannel] = useState<Channel>('stable');
  const build = loaded.kind === 'loaded' ? loaded.builds[channel] : null;
  return <section className="downloads" id="download" aria-labelledby="download-title">
    <Text variant="headline" render={<h2 />} id="download-title" className="section-title">Download Coord</Text>
    <SegmentedControl aria-label="Release channel" value={channel} onValueChange={value => setChannel(value as Channel)}
      items={[{ value: 'stable', label: 'Stable' }, { value: 'nightly', label: 'Nightly' }]} />
    <Text emphasis="muted" className="channel-text">{channelText[channel]}</Text>
    {loaded.kind === 'loading' && <div className="downloads-loading"><Spinner label="Looking for the newest builds" /></div>}
    {loaded.kind === 'failed' && <Alert tone="warning">GitHub did not answer. Every build is on the <Link href={releasesPage}>releases page</Link>.</Alert>}
    {loaded.kind === 'loaded' && !build && <Alert tone="info">No {channel} build yet. Every build is on the <Link href={releasesPage}>releases page</Link>.</Alert>}
    {build && <>
      <Text variant="body-sm" emphasis="muted" className="build-version">
        <Link href={build.page}>Coord {build.version}<IconArrowOutward className="inline-icon" aria-hidden /></Link>{day(build.publishedAt) ? `, ${day(build.publishedAt)}` : ''}
      </Text>
      <div className="platform-grid">
        <PlatformCard name="Windows" detail="Windows 10 and 11, 64-bit" file={build.downloads.windows} kind=".exe installer">
          Coord isn’t code-signed yet, so Windows may say it protected your PC: choose <b>More info</b>, then <b>Run anyway</b>.
        </PlatformCard>
        <PlatformCard name="Linux" detail="x86_64, most distributions" file={build.downloads.linux} kind="AppImage">
          Make it executable (<code>chmod +x</code>) and run it.
        </PlatformCard>
      </div>
    </>}
    <Text variant="body-sm" emphasis="muted" className="downloads-note">
      Coord updates itself: it says when a newer build is out, and <b>Settings › Updates</b> switches between stable and nightly. Every build is on <Link href={releasesPage}>GitHub Releases</Link>.
    </Text>
  </section>;
}

function PlatformCard({ name, detail, file, kind, children }: { name: string; detail: string; file: Build['downloads'][Platform]; kind: string; children: ReactNode }) {
  return <Card className="platform" background="default" title={name} headingLevel={3} meta={detail}
    description={<>{children}</>}
    actions={file
      ? <Button variant="primary" href={file.url} startIcon={<IconDownload />}>Download {kind} ({megabytes(file.size)})</Button>
      : <Button variant="secondary" href={releasesPage}>Not in this build</Button>} />;
}

function Footer() {
  return <footer className="site-footer">
    <Text variant="body-sm" emphasis="muted">© 2026 envsemble · MIT license</Text>
    <nav className="site-footer-links" aria-label="More">
      <Link href={sourcePage} underline={false}>Source</Link>
      <Link href={releasesPage} underline={false}>Releases</Link>
      <Link href={`${sourcePage}/issues`} underline={false}>Issues</Link>
    </nav>
  </footer>;
}
