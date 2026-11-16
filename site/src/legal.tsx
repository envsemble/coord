// Coord's privacy and terms pages, in plain words, from what the app and this site do (the app's
// README, Security and privacy, says the same of the app). Change them when that changes.
import { useEffect, type ReactNode } from 'react';
import { releasesPage, repository, sourcePage } from './releases.ts';

const updated = 'November 14, 2026';
const issues = sourcePage + '/issues';

function Legal({ title, children }: { title: string; children: ReactNode }) {
  useEffect(() => { document.title = `${title} · Coord`; }, [title]);
  return <main className="legal">
    <h1>{title}</h1>
    <p className="legal-updated">Last updated {updated}</p>
    {children}
  </main>;
}

export function Privacy() {
  return <Legal title="Privacy">
    <p>Coord is a desktop app made by envsemble. It keeps your plans on your computer. This page says what the app and this website do with your data.</p>

    <h2>The app</h2>
    <ul>
      <li><strong>No account, no telemetry.</strong> Coord has no sign-in, collects no usage statistics and uploads no crash reports.</li>
      <li><strong>Your plans stay on your computer.</strong> Plans, diagrams, pages and statistics live in the Coord home (<code>~/.coord</code>) and the folders you add. Statistics are read from your agents' session logs on your computer, and stay there.</li>
      <li><strong>The update check.</strong> When it starts and every four hours, Coord reads the list of releases of <code>{repository}</code> from GitHub. It sends nothing of yours, but GitHub sees the request and your IP address, as with any request to it. An update downloads only when you click Update.</li>
      <li><strong>Remote access, if you turn it on.</strong> It is off until you turn it on. Then the devices you pair can work on this computer's projects, over the address you choose. Nothing passes through envsemble.</li>
      <li><strong>Your agents.</strong> Coord works with Claude Code and Codex on your computer. What you and your agent send to Anthropic or OpenAI is between you and them, under their terms and privacy policies. Coord sends them nothing itself.</li>
      <li><strong>Pages.</strong> A plan's pages are code your agent writes. They run apart from the rest of the app, and reach the internet only if your agent wrote them to.</li>
      <li><strong>Logs</strong> stay on your computer, in <code>logs/</code> in the Coord home. You decide whether to share them in a bug report.</li>
    </ul>

    <h2>This website</h2>
    <ul>
      <li>No cookies, no analytics and no tracking.</li>
      <li>To show the download buttons, your browser asks GitHub for the newest releases. The answer is kept in your browser for ten minutes. GitHub sees that request.</li>
      <li>The site is hosted on Cloudflare, which handles each request, your IP address included, to serve and protect the site, under Cloudflare's privacy policy.</li>
      <li>Downloads come from <a href={releasesPage}>GitHub Releases</a>.</li>
    </ul>

    <h2>Changes and questions</h2>
    <p>If this changes, this page changes with it, and its date above. Questions go to <a href={issues}>the issues on GitHub</a>.</p>
  </Legal>;
}

export function Terms() {
  return <Legal title="Terms">
    <p>Coord is free and open source. These terms cover using the app and this website.</p>

    <h2>The license</h2>
    <p>Coord is under the <a href={sourcePage + '/blob/main/LICENSE'}>MIT license</a>, and that license is the terms of the software: you may use, copy, change and share it, as long as you keep its copyright and license notice. It comes as is, without warranty of any kind, and envsemble is not liable for what comes of using it.</p>

    <h2>Builds</h2>
    <ul>
      <li>Get Coord from this site or the <a href={releasesPage}>GitHub Releases</a> of <code>{repository}</code>. The builds are not code-signed, so Windows may warn before the first start.</li>
      <li>Stable builds are the tested releases. Nightly builds are made every six hours from unreleased changes and may have bugs; keep copies of what matters to you.</li>
    </ul>

    <h2>Your work and your agents</h2>
    <ul>
      <li>Your plans and everything you make with Coord are yours.</li>
      <li>Coord helps you and your agent agree on a plan. Your agent does the work, on your computer: check what it changes, as you would anyone's work.</li>
      <li>Claude Code, Codex, GitHub, Tailscale and the other services Coord works with are other companies' products, under their own terms. Coord is not affiliated with Anthropic or OpenAI; their product names here say what Coord works with.</li>
    </ul>

    <h2>Changes and questions</h2>
    <p>If these terms change, this page changes with them, and its date above. Questions go to <a href={issues}>the issues on GitHub</a>.</p>
  </Legal>;
}
