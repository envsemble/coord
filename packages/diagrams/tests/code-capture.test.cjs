// Code captures: class diagrams written from TypeScript and Java through their
// compilers, with the capture header, evidence and snippets.
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const {
  captureTypeScript,
  captureJava,
  captureFromConfig,
  checkDiagram,
  parseDiagram,
  prepareDiagrams,
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
// A capture is a valid diagram with no problems; returns what it reads as.
function read(text) {
  assert.deepEqual(checkDiagram(text), [], text);
  const { diagram } = parseDiagram(text);
  assert(diagram.capture && diagram.fingerprint);
  return diagram;
}
const element = (diagram, id) => diagram.elements.find((e) => e.id === id);
const related = (diagram, kind, source, target) =>
  diagram.relations.some(
    (r) => r.kind === kind && r.source === source && r.target === target,
  );
// Two captures of one source differ only in their date and fingerprint.
const undated = (text) =>
  text
    .replace(/"capturedAt":"[^"]*"/, "")
    .replace(/' atlas fingerprint \w+/, "");
const commit = (root) => {
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
  return git;
};

test("TypeScript captures write a class diagram with declarations, signatures, places and pinned excerpts", async (t) => {
  const root = fixture(t),
    project = tsProject(
      root,
      `export interface HasId { id: string }
export abstract class Base { id!: string; }
export class User extends Base implements HasId { friend?: User; private secret = 1; get(other: Base, limit?: number): User { return this; } }
export enum State { Active, Suspended }
export type Choice = User | Base;`,
    );
  commit(root);
  const options = { identity: "classes", projects: [project] };
  const text = await captureTypeScript(options);
  const d = read(text);
  assert.equal(d.kind, "class");
  assert.equal(d.title, "classes classes");
  assert.deepEqual(d.elements.map((e) => [e.id, e.kind]).sort(), [
    ["Base", "abstract class"],
    ["Choice", "class"],
    ["HasId", "interface"],
    ["State", "enum"],
    ["User", "class"],
  ]);
  const user = element(d, "User");
  assert.equal(user.evidence.line, 3);
  assert.equal(user.evidence.file, "model.ts");
  assert.equal(user.evidence.repo, "example/fixture");
  assert.match(user.evidence.url, /\/blob\/[0-9a-f]{40}\/model\.ts#L3$/);
  assert.equal(user.snippet.language, "typescript");
  assert.match(user.snippet.code, /^export class User/);
  assert.deepEqual(
    user.attributes.map((a) => [a.name, a.type, a.multiplicity, a.visibility]),
    [
      ["friend", "User", "0..1", null],
      ["secret", "number", null, "-"],
    ],
  );
  assert.deepEqual(user.operations, [
    {
      name: "get",
      parameters: "other: Base, limit?: number",
      returns: "User",
      visibility: null,
      line: user.operations[0].line,
      evidence: { file: "model.ts", line: 3 },
    },
  ]);
  assert.deepEqual(
    element(d, "State").literals.map((l) => l.name),
    ["Active", "Suspended"],
  );
  assert(element(d, "Choice").snippet.code.includes("User | Base"));
  assert(related(d, "inheritance", "User", "Base"));
  assert(related(d, "implementation", "User", "HasId"));
  assert(related(d, "dependency", "Choice", "User"));
  assert.equal(d.capture.adapter.id, "atlas-typescript");
  assert.equal(d.capture.adapter.compilerVersion, "6.0.3");
  assert.equal(d.capture.source.kind, "typescript");
  assert.deepEqual(d.capture.source.scope, ["fixture:model.ts"]);
  assert.equal(d.capture.source.projects[0].pinnedSelectedFiles, true);
  assert.match(
    d.capture.source.projects[0].contentFingerprint,
    /^[0-9a-f]{64}$/,
  );
  assert.equal(d.capture.coverage.status, "complete");
  // Captured again, it differs only in its date and fingerprint.
  assert.equal(undated(await captureTypeScript(options)), undated(text));
  fs.appendFileSync(
    path.join(root, "model.ts"),
    "\nexport class NewClass {}\n",
  );
  const later = read(await captureTypeScript(options));
  assert.equal(later.elements.length, 6);
  assert(later.elements.every((e) => !e.evidence.url && !e.evidence.commit));
  // Same names in two projects stay apart, each in its project's package.
  const other = fixture(t),
    second = tsProject(other, "export class User {}\n");
  second.identity = "other";
  const multi = read(
    await captureTypeScript({
      identity: "combined",
      projects: [project, second],
    }),
  );
  assert.deepEqual(
    multi.elements
      .filter((e) => e.name.endsWith("User"))
      .map((e) => [e.package, e.id, e.name]),
    [
      ["fixture", "fixture_User", "User"],
      ["other", "other_User", "User"],
    ],
  );
});

test("a capture and the same capture later compare element by element in the viewer", async (t) => {
  const root = fixture(t),
    project = tsProject(root, "export class Order { total!: number; }\n");
  const options = { identity: "shop", projects: [project] };
  const before = await captureTypeScript(options);
  fs.writeFileSync(
    path.join(root, "model.ts"),
    "export class Order { total!: string; lines!: Line[]; }\nexport class Line {}\n",
  );
  const after = (await captureTypeScript(options)).replace(
    /^(' atlas fingerprint .*)$/m,
    "$1\n' atlas compares before.puml",
  );
  // The added header line makes the fingerprint stale: write it again.
  const { formatDiagram } = require("../lib/index.cjs");
  const rewritten = formatDiagram(parseDiagram(after).diagram);
  const files = [
    { path: "before.puml", text: before },
    { path: "after.puml", text: rewritten },
  ];
  assert.deepEqual(checkDiagram(rewritten, { read: () => before }), []);
  const { diagrams, prepared } = await prepareDiagrams({ files });
  assert.deepEqual(
    diagrams.map((d) => [d.path, d.role, d.profile, d.family]),
    [
      ["before.puml", "capture", "code", "before.puml"],
      ["after.puml", "capture", "code", "before.puml"],
    ],
  );
  const { changes } = prepared.get("after.puml").payload.comparison;
  assert.deepEqual(
    changes.changes
      .filter((c) => c.elementId)
      .map((c) => [c.kind, c.elementId])
      .sort(),
    [
      ["added", "Line"],
      ["added", "Order.lines"],
      ["added", "relation:Order:Line"],
      ["modified", "Order"],
      ["modified", "Order.total"],
    ],
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
  const d = read(
    await captureTypeScript({
      identity: "cross-project",
      projects: [first, second],
    }),
  );
  assert.deepEqual(d.elements.map((e) => [e.package, e.id, e.name]).sort(), [
    ["a", "Base", "Base"],
    ["b", "Child", "Child"],
    ["b", "Named", "Domain.Named"],
  ]);
  const child = element(d, "Child");
  assert.deepEqual(
    child.attributes.map((a) => [a.name, a.type, a.visibility]),
    [
      ["friend", "Base<string>", "+"],
      ["count", "number", "#"],
    ],
  );
  assert.deepEqual(
    child.operations.map((o) => `${o.name}(${o.parameters})`),
    [
      "constructor(friend: Base<string>, count: number)",
      "get(value: string)",
      "get(value: number)",
      "get(value: string | number)",
    ],
  );
  assert(related(d, "inheritance", "Child", "Base"));
  assert(related(d, "dependency", "Child", "Base"));
  assert(
    d.capture.coverage.diagnostics.some((x) => x.code === "LOCAL_DECLARATION"),
  );
  const { prepared } = await prepareDiagrams({
    files: [
      { path: "c.puml", text: require("../lib/index.cjs").formatDiagram(d) },
    ],
  });
  const scene = prepared.get("c.puml").views[0].diagramFields;
  assert(scene.nodes.find((n) => n.id === "Base").isAbstract);
  assert.equal(scene.nodes.find((n) => n.id === "Child").methods.length, 4);
});

test("names that PlantUML would read as formatting or that are not PlantUML names are written so the capture stays valid", async (t) => {
  const root = fixture(t),
    project = tsProject(
      root,
      `export class __Meta__ { __proto2__!: string; "quoted-key"!: number; link!: "a//b//c"; tuple!: [string, number]; pick<U>(value: U): U { return value; } }
export class Weird { 1st!: string; }
`.replace("1st!", "'1st'!"),
    );
  const d = read(
    await captureTypeScript({ identity: "odd", projects: [project] }),
  );
  const meta = d.elements.find((e) => e.name === "_Meta_");
  assert.equal(meta.id, "_Meta_");
  assert.deepEqual(
    meta.attributes.map((a) => [a.name, a.type]),
    [
      ["__proto2__", "string"],
      ["_quoted_key_", "number"],
      ["link", '"a/ /b/ /c"'],
      ["tuple", "([string, number])"],
    ],
  );
  assert.equal(meta.operations[0].returns, "U");
  assert.deepEqual(
    element(d, "Weird").attributes.map((a) => a.name),
    ["_1st_"],
  );
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
    captureFromConfig(path.join(root, "source.json")),
    /CAPTURE_LIMIT/,
  );
});

test("a source configuration captures with its paths relative to it, and a wrong one is refused with its reason", async (t) => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, "app"));
  tsProject(path.join(root, "app"), "export class Item { name!: string; }\n");
  const file = path.join(root, "capture.json");
  const write = (config) =>
    fs.writeFileSync(file, JSON.stringify({ formatVersion: 1, ...config }));
  write({
    adapter: "typescript",
    identity: "shop",
    title: "Shop code",
    projects: [{ identity: "app", path: "app" }],
  });
  const d = read(await captureFromConfig(file));
  assert.equal(d.title, "Shop code");
  assert.deepEqual(
    d.elements.map((e) => e.id),
    ["Item"],
  );
  write({ adapter: "typescript", identity: "shop", projects: [], extra: 1 });
  await assert.rejects(
    captureFromConfig(file),
    /CAPTURE_CONFIG: .*code-source/,
  );
  write({ adapter: "cobol", identity: "shop" });
  await assert.rejects(
    captureFromConfig(file),
    /CAPTURE_CONFIG: name the adapter/,
  );
  fs.writeFileSync(file, "{");
  await assert.rejects(captureFromConfig(file), /CAPTURE_CONFIG/);
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
export class Odd implements Item {}
`,
    );
  const d = read(
    await captureTypeScript({ identity: "declarations", projects: [project] }),
  );
  assert.deepEqual(
    d.elements.filter((e) => e.name === "Shared").map((e) => e.id),
    ["Shared", "Shared_2"],
  );
  assert(related(d, "dependency", "Container", "Item"));
  assert(related(d, "dependency", "Outer", "Item"));
  assert(!d.elements.some((e) => e.name.includes("Local")));
  // A class implementing a class has no UML arrow: it is a labelled use.
  assert(
    d.relations.some(
      (r) =>
        r.kind === "dependency" &&
        r.source === "Odd" &&
        r.target === "Item" &&
        r.label === "implements",
    ),
  );
  assert(
    d.capture.coverage.diagnostics.some((x) => x.code === "MERGED_DECLARATION"),
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

test("TypeScript missing dependencies are partial and syntax/scope failures write no capture", async (t) => {
  const root = fixture(t),
    project = tsProject(
      root,
      "import { Missing } from './unavailable'; export class Uses { field!: Missing; }\n",
    );
  const d = read(
    await captureTypeScript({ identity: "partial", projects: [project] }),
  );
  assert.equal(d.capture.coverage.status, "partial");
  assert(
    d.capture.coverage.diagnostics.some(
      (x) => x.code === "COMPILER_DIAGNOSTIC",
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
  const git = commit(root);
  git("update-index", "--assume-unchanged", "model.ts");
  fs.writeFileSync(path.join(root, "model.ts"), "export class Changed {}\n");
  const d = read(
    await captureTypeScript({ identity: "hidden-edit", projects: [project] }),
  );
  assert.equal(d.elements[0].id, "Changed");
  assert.equal(d.capture.source.projects[0].pinnedSelectedFiles, false);
  assert.equal(d.elements[0].evidence.url, undefined);
  assert.equal(d.elements[0].evidence.commit, undefined);
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
 Model() {}
 void use(String value) {}
 void use(int value) {}
 void local() { class Hidden {} }
}
`,
    );
    const d = read(
      await captureJava({
        identity: "nested",
        projects: [
          {
            identity: "fixture",
            path: root,
            files: ["Model.java"],
            classpath: ["."],
          },
        ],
      }),
    );
    assert.deepEqual(d.elements.map((e) => [e.id, e.name, e.package]).sort(), [
      ["Model", "Model", null],
      ["Nested", "Model.Nested", null],
    ]);
    assert.deepEqual(
      element(d, "Model").operations.map(
        (o) =>
          `${o.visibility}${o.name}(${o.parameters})${o.returns ? ` : ${o.returns}` : ""}`,
      ),
      [
        "~Model()",
        "~use(value: java.lang.String) : void",
        "~use(value: int) : void",
        "~local() : void",
      ],
    );
    assert(
      d.capture.coverage.diagnostics.some(
        (x) => x.code === "LOCAL_DECLARATION",
      ),
    );
    assert(
      d.capture.coverage.diagnostics.some(
        (x) => x.code === "CLASSPATH_DIRECTORY",
      ),
    );
  },
);

test(
  "Java captures preserve interfaces, generics, records, enums and exact source locations",
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
enum State { Active, Suspended; int code; }
`,
    );
    const options = {
      identity: "java-classes",
      projects: [{ identity: "fixture", path: root, files: ["Model.java"] }],
    };
    const text = await captureJava(options);
    const d = read(text);
    assert.deepEqual(d.elements.map((e) => [e.package, e.id, e.kind]).sort(), [
      ["fixture", "Base", "class"],
      ["fixture", "Enrollment", "class"],
      ["fixture", "HasId", "interface"],
      ["fixture", "State", "enum"],
      ["fixture", "User", "class"],
    ]);
    assert.deepEqual(
      element(d, "State").literals.map((l) => l.name),
      ["Active", "Suspended"],
    );
    const user = element(d, "User");
    assert.equal(user.evidence.line, 4);
    assert.equal(user.snippet.language, "java");
    assert(
      user.operations.some((o) => o.name === "id" && o.visibility === "+"),
    );
    assert.deepEqual(element(d, "HasId").operations[0].visibility, "+");
    assert(related(d, "inheritance", "User", "Base"));
    assert(related(d, "implementation", "User", "HasId"));
    assert(related(d, "dependency", "Enrollment", "User"));
    assert.match(d.capture.adapter.compilerVersion, /^\d+/);
    assert.equal(undated(await captureJava(options)), undated(text));
    fs.appendFileSync(path.join(root, "Model.java"), "\nclass NewClass {}\n");
    assert.equal(read(await captureJava(options)).elements.length, 6);
    const second = fixture(t);
    fs.copyFileSync(
      path.join(root, "Model.java"),
      path.join(second, "Model.java"),
    );
    const multi = read(
      await captureJava({
        identity: "multi",
        projects: [
          ...options.projects,
          { identity: "other", path: second, files: ["Model.java"] },
        ],
      }),
    );
    assert.equal(
      new Set(multi.elements.map((e) => e.id)).size,
      multi.elements.length,
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
    assert.equal(
      read(await captureFromConfig(path.join(root, "source.json"))).elements
        .length,
      6,
    );
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
    assert.equal(
      read(await captureJava(options)).capture.coverage.status,
      "partial",
    );
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
    const d = read(
      await captureJava({
        identity: "heritage",
        projects: [{ identity: "fixture", path: root, files: ["Model.java"] }],
      }),
    );
    assert(related(d, "dependency", "Container", "Item"));
    assert(
      element(d, "User").operations.some((o) =>
        o.returns.includes("throws Problem"),
      ),
    );
    assert(related(d, "dependency", "User", "Problem"));
    assert(related(d, "dependency", "Child", "Item"));
  },
);

test(
  "Captures describe declarations and members by the first sentence of their documentation comments",
  { timeout: 60000 },
  async (t) => {
    const root = fixture(t);
    const ts = read(
      await captureTypeScript({
        identity: "described",
        projects: [
          tsProject(
            root,
            `/** A person who uses the shop. Kept for audits. */
export class User {
  /**
   * The name shown to others, see {@link User}.
   *
   * More detail.
   */
  name = "";
  /** Greets **loudly** in <b>bold</b>. @returns nothing */
  greet(): void {}
  /** Friends as a List<User>, in {@code Map<A, B>} order, made by <<create>>. */
  friends: User[] = [];
  /** ${"long ".repeat(70)}*/
  long = 1;
  constructor(/** Where the user lives. */ public city: string) {}
}
/** How far an order is. */
export enum State {
  /** Not paid yet. */
  Open,
}`,
          ),
        ],
      }),
    );
    const user = element(ts, "User");
    assert.equal(user.description, "A person who uses the shop.");
    const field = (name) => user.attributes.find((a) => a.name === name);
    assert.equal(
      field("name").description,
      "The name shown to others, see User.",
    );
    assert.equal(field("long").description, undefined);
    // Generics and stereotype text stay; only HTML tags go.
    assert.equal(
      field("friends").description,
      "Friends as a List<User>, in Map<A, B> order, made by < < create>>.",
    );
    assert.equal(field("city").description, "Where the user lives.");
    assert.equal(
      user.operations.find((o) => o.name === "greet").description,
      "Greets * *loudly* * in bold.",
    );
    assert.equal(element(ts, "State").description, "How far an order is.");
    assert.equal(element(ts, "State").literals[0].description, "Not paid yet.");
    fs.writeFileSync(
      path.join(root, "Model.java"),
      `/** A person who uses the shop. */
class User {
  /** The name shown to others. */
  String name;
  /**
   * Greets them.
   * @param loud whether to shout
   */
  void greet(boolean loud) {}
  int plain;
}
`,
    );
    const java = element(
      read(
        await captureJava({
          identity: "described",
          projects: [
            { identity: "fixture", path: root, files: ["Model.java"] },
          ],
        }),
      ),
      "User",
    );
    assert.equal(java.description, "A person who uses the shop.");
    assert.deepEqual(
      [...java.attributes, ...java.operations].map((m) => [
        m.name,
        m.description,
      ]),
      [
        ["name", "The name shown to others."],
        ["plain", undefined],
        ["greet", "Greets them."],
      ],
    );
  },
);

// PlantUML itself accepts the captures. Opt in with the path of a PlantUML
// jar: ATLAS_TEST_PLANTUML_JAR=/path/to/plantuml.jar.
test(
  "PlantUML renders captures",
  {
    skip:
      !process.env.ATLAS_TEST_PLANTUML_JAR &&
      "set ATLAS_TEST_PLANTUML_JAR to a PlantUML jar",
  },
  async (t) => {
    const root = fixture(t),
      project = tsProject(
        root,
        `export interface HasId { id: string }
export abstract class Base<T> { id!: string; }
/** A user, see <code>a//b</code> and **this** \\ */
export class User extends Base<number> implements HasId { friend?: User; tuple!: [string, number]; link!: "a//b//c"; get<U>(other: Base<U>): User { return this; } }
export enum State { Active, Suspended }
export type Choice = User | Base<string>;`,
      );
    const file = path.join(root, "capture.puml");
    fs.writeFileSync(
      file,
      await captureTypeScript({ identity: "classes", projects: [project] }),
    );
    const text = fs.readFileSync(file, "utf8");
    // Its description is broken up and has no backslash at its end.
    assert.match(
      text,
      /^' atlas description A user, see a\/ \/b and \* \*this\* \*$/m,
    );
    const result = spawnSync(
      "java",
      [
        "-Djava.awt.headless=true",
        "-jar",
        process.env.ATLAS_TEST_PLANTUML_JAR,
        "-checkonly",
        file,
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
  },
);
