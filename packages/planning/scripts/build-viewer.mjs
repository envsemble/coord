// Build the plan viewer into one committed HTML template, dist/plan-viewer.html.
// Plan exports fill its title and payload markers; the viewer script's hash is fixed in
// its content security policy. Run with `npm run build --workspace @envsemble/atlas-planning`.
import { build } from "esbuild";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const output = path.join(root, "dist", "plan-viewer.html");

/** Package folder, name and license of a bundled node_modules input. */
function bundledPackage(input) {
  const parts = input.split(/[\\/]/);
  const index = parts.lastIndexOf("node_modules");
  if (index < 0) return null;
  const length = parts[index + 1].startsWith("@") ? 2 : 1;
  const directory = path.resolve(root, ...parts.slice(0, index + 1 + length));
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8"));
  return { directory, name: manifest.name, version: manifest.version, license: manifest.license ?? "see package" };
}
function licenseText(directory) {
  const file = fs.readdirSync(directory).sort().find((name) => /^(?:licen[cs]e|copying)(?:\.(?:md|txt))?$/i.test(name));
  return file ? fs.readFileSync(path.join(directory, file), "utf8").replace(/\r\n/g, "\n").trim() : null;
}
function notices(metafile) {
  const packages = new Map();
  for (const input of Object.keys(metafile.inputs)) {
    const found = bundledPackage(input);
    if (found) packages.set(found.name, found);
  }
  const sorted = [...packages.values()].sort((a, b) => a.name.localeCompare(b.name));
  const texts = new Map();
  for (const item of sorted) {
    const text = licenseText(item.directory);
    if (text) texts.set(text, [...(texts.get(text) ?? []), item.name]);
  }
  const lines = [
    "Atlas plan viewer. Bundled third-party software:",
    ...sorted.map((item) => `${item.name}@${item.version} (${item.license})`),
    "",
    ...[...texts].flatMap(([text, names]) => [`License of ${names.join(", ")}:`, text, ""]),
  ];
  return "/*!\n" + lines.join("\n").replaceAll("*/", "* /") + "\n*/\n";
}

export async function buildViewer() {
  const result = await build({
    absWorkingDir: root,
    entryPoints: ["viewer/main.tsx"],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2020",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    minify: true,
    charset: "utf8",
    legalComments: "none",
    outdir: "out",
    write: false,
    metafile: true,
    logLevel: "silent",
  });
  const js = result.outputFiles.find((file) => file.path.endsWith(".js")).text;
  const css = result.outputFiles.find((file) => file.path.endsWith(".css")).text;
  if (/<\/style/i.test(css)) throw new Error("The viewer styles cannot contain a closing style tag.");
  const script = (notices(result.metafile) + js).replace(/<\/script/gi, "<\\/script");
  // `<!--` could switch the HTML parser into a state where `</script>` no longer ends the script.
  if (script.includes("<!--")) throw new Error("The viewer script cannot contain an HTML comment opener.");
  const hash = createHash("sha256").update(script).digest("base64");
  const policy = [
    "default-src 'none'",
    `script-src 'sha256-${hash}'`,
    "style-src 'unsafe-inline'",
    "img-src data: blob:",
    "font-src data:",
    "connect-src 'none'",
    "media-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "manifest-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
  const diagrams = path.dirname(require.resolve("@envsemble/atlas-diagrams"));
  const icon = fs.readFileSync(path.join(diagrams, "../assets/atlas-icon.svg"), "utf8");
  const html = `<!doctype html>
<html lang="en" data-color-mode="dark" data-dark-theme="dark_dimmed">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${policy}">
<meta name="referrer" content="no-referrer">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#212830">
<meta name="generator" content="Atlas plan export">
<title><!--ATLAS_TITLE--> | Atlas plan</title>
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(icon)}">
<style>
${css}</style>
</head>
<body>
<noscript>This read-only plan export needs JavaScript to show its contents. Import it into a planning folder with atlas plan import.</noscript>
<div id="root"></div>
<!--ATLAS_PAYLOAD-->
<script>${script}</script>
</body>
</html>
`;
  for (const marker of ["<!--ATLAS_TITLE-->", "<!--ATLAS_PAYLOAD-->"])
    if (html.split(marker).length !== 2) throw new Error(`The viewer template must contain ${marker} once.`);
  return html;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const html = await buildViewer();
  const current = fs.existsSync(output) ? fs.readFileSync(output, "utf8") : null;
  if (current === html) console.log("Plan viewer is up to date.");
  else if (process.argv.includes("--check")) {
    console.error("dist/plan-viewer.html is stale; run npm run build --workspace @envsemble/atlas-planning and commit it.");
    process.exitCode = 1;
  } else {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, html);
    console.log(`Built dist/plan-viewer.html (${Math.round(Buffer.byteLength(html) / 1024)} KB).`);
  }
}
