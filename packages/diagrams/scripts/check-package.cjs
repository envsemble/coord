const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const stage = fs.mkdtempSync(path.join(os.tmpdir(), "ontouml-package-"));
const npm = process.env.npm_execpath;
try {
  if (!npm) throw new Error("Run this check through npm run check:package");
  const result = JSON.parse(
    execFileSync(
      process.execPath,
      [npm, "pack", "--json", "--pack-destination", stage],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ),
  );
  const packed = Array.isArray(result) ? result[0] : Object.values(result)[0];
  assert(
    packed.files.every(
      (file) => !/^(examples|downloads|tests|\.git)\//.test(file.path),
    ),
    "Example or development files leaked into the library package",
  );
  assert(
    packed.files.some((file) => file.path === "dist/react.mjs"),
    "Missing compiled React entry point",
  );
  execFileSync(
    process.execPath,
    [
      npm,
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      path.join(stage, packed.filename),
    ],
    { cwd: stage, stdio: ["ignore", "pipe", "pipe"] },
  );
  const smoke = `
    const assert = require('node:assert/strict');
    const {Project,validateModel,buildViewer,writeViewer,captureTypeScript,captureJava}=require('ontouml-atlas');
    const p=new Project(); p.name.add('Installed package test');
    const root=p.packageBuilder().root().name('Orders').build();
    root.classBuilder().kind().name('Order').build();
    const project=JSON.parse(JSON.stringify(p));
    assert(validateModel(project).valid);
    (async()=>{
      const fs=require('node:fs');
      fs.writeFileSync('tsconfig.json',JSON.stringify({files:['consumer.ts'],compilerOptions:{target:'ES2022',skipLibCheck:true}}));
      fs.writeFileSync('consumer.ts','export class Consumer { value!: string; }');
      const ts=await captureTypeScript({identity:'consumer',projects:[{identity:'ts',path:process.cwd()}]});
      assert.equal(ts.model.nodes[0].name,'Consumer');
      fs.writeFileSync('Consumer.java','class Consumer { String value; }');
      const java=await captureJava({identity:'consumer',projects:[{identity:'java',path:process.cwd(),files:['Consumer.java']}]});
      assert.equal(java.model.nodes[0].name,'Consumer');
      const react=await import('ontouml-atlas/react');
      assert.equal(typeof react.OntoUMLViewer,'function');
      assert.equal(typeof react.AtlasPanel,'function');
      assert(require('node:fs').existsSync(require.resolve('ontouml-atlas/embedded.css')));
      const built=await buildViewer({project});
      assert(built.html.includes('Installed package test'));
      assert(built.payload.views.length===1);
      writeViewer(built,'site');
      console.log('Passed: clean tarball install, TypeScript and Java captures, public Node and React APIs, and offline viewer build.');
    })().catch(e=>{console.error(e);process.exitCode=1});
  `;
  process.stdout.write(
    execFileSync(process.execPath, ["-e", smoke], {
      cwd: stage,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
} catch (error) {
  console.error(error.stderr?.toString() || error.message);
  process.exitCode = 1;
} finally {
  if (!path.resolve(stage).startsWith(path.resolve(os.tmpdir()) + path.sep))
    throw new Error("Unsafe package-check cleanup path");
  fs.rmSync(stage, { recursive: true, force: true });
}
