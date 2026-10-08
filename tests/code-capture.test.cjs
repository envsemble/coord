const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { execFileSync } = require("node:child_process");
const {
  captureTypeScript,
  captureJava,
  createWorkspace,
  validateDocument,
  buildViewer,
  importDocument,
  prepareViewer,
} = require("../lib/index.cjs");
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-code-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function tsProject(root, source) {
  fs.writeFileSync(path.join(root, "model.ts"), source);
  fs.writeFileSync(
    path.join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { strict: true, target: "ES2022", skipLibCheck: true },
      files: ["model.ts"],
    }),
  );
  return { identity: "fixture", path: root };
}
test("TypeScript compiler snapshots preserve declarations, aliases, signatures, source positions and pinned excerpts", async (t) => {
  const root = fixture(t),
    project = tsProject(
      root,
      `export interface HasId { id: string }
export abstract class Base { id!: string; }
export class User extends Base implements HasId { friend?: User; get(other: Base): User { return this; } }
export enum State { Active, Suspended }
export type Choice = User | Base;`,
    );
  const git = (...args) =>
    execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
  git("init");
  git("add", ".");
  git(
    "-c",
    "user.name=Atlas fixture",
    "-c",
    "user.email=atlas@example.test",
    "commit",
    "-m",
    "fixture",
  );
  git("remote", "add", "origin", "https://github.com/example/fixture.git");
  const options = { identity: "classes", projects: [project] };
  const d = await captureTypeScript(options);
  assert(validateDocument(d).valid);
  assert.equal(d.model.nodes.length, 5);
  const user = d.model.nodes.find((n) => n.name === "User");
  assert.equal(user.location.startLine, 3);
  assert.equal(user.attributes[0].optional, true);
  assert.equal(user.methods.length, 1);
  assert.equal(d.model.generalizations.length, 2);
  assert(d.model.generalizations.some((g) => g.realization));
  assert(
    d.model.relations.every(
      (r) => r.sourceMultiplicity === "?" && r.targetMultiplicity === "?",
    ),
  );
  assert(
    d.model.nodes.find((n) => n.name === "Choice").definition.includes("User"),
  );
  assert(Object.values(d.snippets).every((s) => s.url?.includes("/blob/")));
  assert.deepEqual((await captureTypeScript(options)).model, d.model);
  fs.appendFileSync(
    path.join(root, "model.ts"),
    "\nexport class NewClass {}\n",
  );
  const later = await captureTypeScript(options);
  assert.equal(later.model.nodes.length, 6);
  assert.equal(d.model.nodes.length, 5);
  assert(Object.values(later.snippets).every((s) => !s.url));
  const other = fixture(t),
    second = tsProject(other, "export class User {}\n");
  second.identity = "other";
  const multi = await captureTypeScript({
    identity: "combined",
    projects: [project, second],
  });
  assert.equal(multi.model.nodes.filter((n) => n.name === "User").length, 2);
  assert.equal(
    new Set(multi.model.nodes.map((n) => n.id)).size,
    multi.model.nodes.length,
  );
  const w = createWorkspace(root);
  fs.writeFileSync(
    path.join(root, "source.json"),
    JSON.stringify({
      formatVersion: 1,
      adapter: "typescript",
      identity: "classes",
      projects: [{ identity: "fixture", path: ".", tsconfig: "tsconfig.json" }],
    }),
  );
  const saved = await w.execute("atlas_capture_code", {
    file: "source.json",
    workId: "work-0008",
  });
  assert.equal(w.load(saved.handle).state, "snapshot");
  const reopened = importDocument((await buildViewer({ document: d })).html);
  assert.deepEqual(reopened.model, d.model);
  assert.equal(
    Object.values(reopened.snippets)[0].code,
    Object.values(d.snippets)[0].code,
  );
});
test("TypeScript resolves captured cross-project symbols and retains parameter properties, overloads and namespaces", async (t) => {
  const root = fixture(t),
    a = path.join(root, "a"),
    b = path.join(root, "b");
  fs.mkdirSync(a);
  fs.mkdirSync(b);
  const first = tsProject(a, "export abstract class Base<T> { value!: T; }\n");
  first.identity = "a";
  const second = tsProject(
    b,
    `import { Base } from '../a/model';
export class Child extends Base<string> {
 constructor(public readonly friend: Base<string>, protected count: number) { super(); }
 get(value: string): string;
 get(value: number): number;
 get(value: string | number): string | number { return value; }
}
export namespace Domain { export interface Named { name: string } }
function local() { class Hidden {} return Hidden; }
function localEnum() { enum HiddenEnum { A } return HiddenEnum; }
export const Anonymous = class {};
`,
  );
  second.identity = "b";
  const d = await captureTypeScript({
    identity: "cross-project",
    projects: [first, second],
  });
  assert(validateDocument(d).valid);
  assert.equal(d.model.nodes.length, 3);
  const child = d.model.nodes.find((n) => n.name === "Child"),
    base = d.model.nodes.find((n) => n.name === "Base");
  assert.equal(
    child.attributes.find((a) => a.name === "friend").type,
    "Base<string>",
  );
  assert.equal(child.methods.filter((m) => m.name === "get").length, 3);
  assert.equal(
    new Set(child.methods.map((m) => m.id)).size,
    child.methods.length,
  );
  assert(d.model.nodes.some((n) => n.name === "Domain.Named"));
  assert(
    d.model.generalizations.some(
      (g) => g.specificId === child.id && g.generalId === base.id,
    ),
  );
  assert(
    d.model.relations.some(
      (r) => r.sourceId === child.id && r.targetId === base.id,
    ),
  );
  assert(
    d.snapshots[0].capture.coverage.diagnostics.some(
      (d) => d.code === "LOCAL_DECLARATION",
    ),
  );
  const viewer = await prepareViewer({ document: d, includeArtifacts: false });
  const scene = viewer.payload.views[0].diagramFields;
  assert(scene.nodes.find((n) => n.id === base.id).isAbstract);
  assert(scene.nodes.find((n) => n.id === child.id).methods.length === 4);
});
test("Code capture rejects escaped scopes and bounds before publication", async (t) => {
  const root = fixture(t),
    outside = fixture(t);
  const project = tsProject(root, "export class Item {}\n");
  fs.writeFileSync(path.join(outside, "Else.java"), "class Else {}\n");
  await assert.rejects(
    captureJava({
      identity: "scope",
      projects: [
        {
          identity: "fixture",
          path: root,
          files: [path.join(outside, "Else.java")],
        },
      ],
    }),
    /CAPTURE_SCOPE/,
  );
  await assert.rejects(
    captureJava({
      identity: "scope",
      projects: [
        {
          identity: "fixture",
          path: root,
          files: Array.from({ length: 201 }, (_, i) => `X${i}.java`),
        },
      ],
    }),
    /CAPTURE_LIMIT/,
  );
  fs.writeFileSync(
    path.join(root, "model.ts"),
    " ".repeat(8 * 1024 * 1024 + 1),
  );
  await assert.rejects(
    captureTypeScript({ identity: "limit", projects: [project] }),
    /CAPTURE_LIMIT/,
  );
  const w = createWorkspace(root);
  fs.writeFileSync(
    path.join(root, "source.json"),
    JSON.stringify({
      formatVersion: 1,
      adapter: "typescript",
      identity: "bad",
      projects: [{ identity: "fixture", path: "." }],
    }),
  );
  await assert.rejects(
    w.execute("atlas_capture_code", { file: "source.json" }),
    /CAPTURE_LIMIT/,
  );
  assert.equal((await w.execute("atlas_list", {})).models.length, 0);
});
test("TypeScript declaration merging, local classes, heritage arguments and type queries have faithful coverage", async (t) => {
  const root = fixture(t),
    project = tsProject(
      root,
      `export interface Shared { a: string }
export interface Shared { b: number }
export class Item {}
export class Base<T> {}
export class Outer extends Base<Item> { ctor!: typeof Item; method(){ class Local {} return Local; } }
export class Container<T extends Item> { value!: T; }
`,
    );
  const d = await captureTypeScript({
    identity: "declarations",
    projects: [project],
  });
  assert(validateDocument(d).valid);
  assert.equal(d.model.nodes.filter((n) => n.name === "Shared").length, 2);
  assert(
    d.model.relations.some(
      (r) =>
        r.sourceId === d.model.nodes.find((n) => n.name === "Container").id &&
        r.targetId === d.model.nodes.find((n) => n.name === "Item").id,
    ),
  );
  assert(!d.model.nodes.some((n) => n.name.includes("Local")));
  const outer = d.model.nodes.find((n) => n.name === "Outer"),
    item = d.model.nodes.find((n) => n.name === "Item");
  assert(
    d.model.relations.some(
      (r) => r.sourceId === outer.id && r.targetId === item.id,
    ),
  );
  assert(
    d.snapshots[0].capture.coverage.diagnostics.some(
      (d) => d.code === "MERGED_DECLARATION",
    ),
  );
});
test("TypeScript compiler rejects oversized dependencies before reading them", async (t) => {
  const root = fixture(t),
    project = tsProject(
      root,
      "import type { Huge } from './dependency'; export class Item { value!: Huge; }\n",
    );
  const file = path.join(root, "dependency.d.ts");
  fs.writeFileSync(file, " ".repeat(32 * 1024 * 1024 + 1));
  const original = fs.readFileSync;
  let readOversized = false;
  fs.readFileSync = function (candidate, ...args) {
    if (path.resolve(String(candidate)) === file) readOversized = true;
    return original.call(this, candidate, ...args);
  };
  try {
    await assert.rejects(
      captureTypeScript({ identity: "bounded", projects: [project] }),
      /CAPTURE_LIMIT/,
    );
    assert(!readOversized);
  } finally {
    fs.readFileSync = original;
  }
});
test(
  "Java preserves nested declarations and overloads, excludes local classes, and discloses directory classpaths",
  { timeout: 60000 },
  async (t) => {
    const root = fixture(t);
    fs.writeFileSync(
      path.join(root, "Model.java"),
      `class Model {
 static class Nested {}
 void use(String value) {}
 void use(int value) {}
 void local() { class Hidden {} }
}
`,
    );
    const d = await captureJava({
      identity: "nested",
      projects: [
        {
          identity: "fixture",
          path: root,
          files: ["Model.java"],
          classpath: ["."],
        },
      ],
    });
    assert.equal(d.model.nodes.length, 2);
    const model = d.model.nodes.find((n) => n.name === "Model");
    assert.equal(model.methods.filter((m) => m.name === "use").length, 2);
    assert(d.model.nodes.some((n) => n.name === "Model.Nested"));
    assert(
      d.snapshots[0].capture.coverage.diagnostics.some(
        (d) => d.code === "LOCAL_DECLARATION",
      ),
    );
    assert(
      d.snapshots[0].capture.coverage.diagnostics.some(
        (d) => d.code === "CLASSPATH_DIRECTORY",
      ),
    );
  },
);
test("TypeScript missing dependencies are partial and syntax/scope failures cannot become snapshots", async (t) => {
  const root = fixture(t),
    project = tsProject(
      root,
      "import { Missing } from './unavailable'; export class Uses { field!: Missing; }\n",
    );
  const d = await captureTypeScript({
    identity: "partial",
    projects: [project],
  });
  assert.equal(d.snapshots[0].capture.coverage.status, "partial");
  assert(
    d.snapshots[0].capture.coverage.diagnostics.some(
      (d) => d.code === "COMPILER_DIAGNOSTIC",
    ),
  );
  fs.writeFileSync(path.join(root, "model.ts"), "export class { broken ?? }\n");
  await assert.rejects(
    captureTypeScript({ identity: "syntax", projects: [project] }),
    /CAPTURE_SYNTAX/,
  );
});
test("Hidden working-tree edits cannot receive revision-pinned evidence", async (t) => {
  const root = fixture(t),
    project = tsProject(root, "export class Original {}\n");
  const git = (...args) =>
    execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
  git("init");
  git("add", ".");
  git(
    "-c",
    "user.name=Atlas fixture",
    "-c",
    "user.email=atlas@example.test",
    "commit",
    "-m",
    "fixture",
  );
  git("remote", "add", "origin", "https://github.com/example/fixture.git");
  git("update-index", "--assume-unchanged", "model.ts");
  fs.writeFileSync(path.join(root, "model.ts"), "export class Changed {}\n");
  const d = await captureTypeScript({
    identity: "hidden-edit",
    projects: [project],
  });
  assert.equal(d.model.nodes[0].name, "Changed");
  assert.equal(
    d.snapshots[0].capture.source.projects[0].pinnedSelectedFiles,
    false,
  );
  assert.equal(d.evidence.sources[0].url, undefined);
  assert.equal(d.evidence.sources[0].commit, undefined);
});
test(
  "Java 21 compiler snapshots preserve interfaces, generics, records, enums and exact source locations",
  { timeout: 120000 },
  async (t) => {
    const root = fixture(t);
    fs.writeFileSync(
      path.join(root, "Model.java"),
      `package fixture;
interface HasId { String id(); }
class Base<T> { T value; }
class User extends Base<String> implements HasId { public String id(){return "id";} Base<String> friend; User(){} void consume(Base<String> value){} }
record Enrollment(User user, boolean active) {}
enum State { Active, Suspended }
`,
    );
    const options = {
      identity: "java-classes",
      projects: [{ identity: "fixture", path: root, files: ["Model.java"] }],
    };
    const d = await captureJava(options);
    assert(validateDocument(d).valid);
    assert.equal(d.model.nodes.length, 5);
    assert(d.model.nodes.some((n) => n.kind === "record"));
    assert(d.model.nodes.some((n) => n.kind === "enum"));
    const user = d.model.nodes.find((n) => n.name === "fixture.User");
    assert.equal(user.location.startLine, 4);
    assert(user.methods.length >= 2);
    assert.equal(d.model.generalizations.length, 2);
    assert(d.model.generalizations.some((g) => g.realization));
    assert(
      d.model.relations.some(
        (r) =>
          r.sourceId.endsWith("fixture.Enrollment") &&
          r.targetId.endsWith("fixture.User"),
      ),
    );
    assert.deepEqual((await captureJava(options)).model, d.model);
    fs.appendFileSync(path.join(root, "Model.java"), "\nclass NewClass {}\n");
    const later = await captureJava(options);
    assert.equal(later.model.nodes.length, 6);
    assert.equal(d.model.nodes.length, 5);
    const second = fixture(t);
    fs.copyFileSync(
      path.join(root, "Model.java"),
      path.join(second, "Model.java"),
    );
    const multi = await captureJava({
      identity: "multi",
      projects: [
        ...options.projects,
        { identity: "other", path: second, files: ["Model.java"] },
      ],
    });
    assert.equal(
      new Set(multi.model.nodes.map((n) => n.id)).size,
      multi.model.nodes.length,
    );
    fs.writeFileSync(
      path.join(root, "source.json"),
      JSON.stringify({
        formatVersion: 1,
        adapter: "java",
        identity: "classes",
        projects: [{ identity: "fixture", path: ".", files: ["Model.java"] }],
      }),
    );
    const w = createWorkspace(root);
    const saved = await w.execute("atlas_capture_code", {
      file: "source.json",
    });
    assert.equal(w.load(saved.handle).profile, "code");
    const reopened = importDocument((await buildViewer({ document: d })).html);
    assert.deepEqual(reopened.model, d.model);
  },
);
test(
  "Java unavailable toolchain, missing dependencies and malformed source have explicit outcomes",
  { timeout: 60000 },
  async (t) => {
    const root = fixture(t);
    fs.writeFileSync(
      path.join(root, "Model.java"),
      "class Uses { Missing field; }\n",
    );
    const options = {
      identity: "partial",
      projects: [{ identity: "fixture", path: root, files: ["Model.java"] }],
    };
    const d = await captureJava(options);
    assert.equal(d.snapshots[0].capture.coverage.status, "partial");
    await assert.rejects(
      captureJava({ ...options, java: path.join(root, "no-java") }),
      /CAPTURE_PREREQUISITE/,
    );
    fs.writeFileSync(path.join(root, "Model.java"), "class Uses { ?! }\n");
    await assert.rejects(captureJava(options), /CAPTURE_SYNTAX/);
  },
);
test(
  "Java heritage type arguments retain captured type-use edges",
  { timeout: 60000 },
  async (t) => {
    const root = fixture(t);
    fs.writeFileSync(
      path.join(root, "Model.java"),
      "class Base<T> {} class Item {} class Child extends Base<Item> {} class Container<T extends Item> { T value; } class Problem extends Exception {} class User { void use() throws Problem {} }\n",
    );
    const d = await captureJava({
      identity: "heritage",
      projects: [{ identity: "fixture", path: root, files: ["Model.java"] }],
    });
    const child = d.model.nodes.find((n) => n.name === "Child"),
      item = d.model.nodes.find((n) => n.name === "Item");
    assert(
      d.model.relations.some(
        (r) =>
          r.sourceId === d.model.nodes.find((n) => n.name === "Container").id &&
          r.targetId === item.id,
      ),
    );
    const user = d.model.nodes.find((n) => n.name === "User"),
      problem = d.model.nodes.find((n) => n.name === "Problem");
    assert(user.methods.some((m) => m.type.includes("throws Problem")));
    assert(
      d.model.relations.some(
        (r) => r.sourceId === user.id && r.targetId === problem.id,
      ),
    );
    assert(
      d.model.relations.some(
        (r) => r.sourceId === child.id && r.targetId === item.id,
      ),
    );
  },
);
