// TypeScript code captures: class diagrams written through the TypeScript
// compiler, with the capture header, evidence and snippets. Each test runs the
// compiler over a real project.
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  captureTypeScript,
  captureFromConfig,
  checkDiagram,
  formatDiagram,
  parseDiagram,
  prepareDiagrams,
} = require("../lib/index.cjs");
const {
  fixture,
  tsProject,
  read,
  element,
  related,
  undated,
  commit,
} = require("./codeFixtures.cjs");

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
    files: [{ path: "c.puml", text: formatDiagram(d) }],
  });
  const scene = prepared.get("c.puml").views[0].diagram;
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

test("a source configuration captures with its paths relative to it", async (t) => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, "app"));
  tsProject(path.join(root, "app"), "export class Item { name!: string; }\n");
  const file = path.join(root, "capture.json");
  fs.writeFileSync(
    file,
    JSON.stringify({
      formatVersion: 1,
      adapter: "typescript",
      identity: "shop",
      title: "Shop code",
      projects: [{ identity: "app", path: "app" }],
    }),
  );
  const d = read(await captureFromConfig(file));
  assert.equal(d.title, "Shop code");
  assert.deepEqual(
    d.elements.map((e) => e.id),
    ["Item"],
  );
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

test("TypeScript captures describe declarations and members by the first sentence of their documentation comments", async (t) => {
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
  /** Friends as a List<User> or List<Table>, in {@code Map<A, B>} order, as Optional<Span>, made by <<create>>. */
  friends: User[] = [];
  /** Rows as a {@code Map<Code, Row>}. */
  rows = 0;
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
  // Generics (also those named like HTML tags) and stereotype text stay; only HTML tags go.
  assert.equal(
    field("friends").description,
    "Friends as a List<User> or List<Table>, in Map<A, B> order, as Optional<Span>, made by < < create>>.",
  );
  // `<Code` would read as PlantUML's code tag: it is broken up, not dropped.
  assert.equal(field("rows").description, "Rows as a Map< Code, Row>.");
  assert.equal(field("city").description, "Where the user lives.");
  assert.equal(
    user.operations.find((o) => o.name === "greet").description,
    "Greets * *loudly* * in bold.",
  );
  assert.equal(element(ts, "State").description, "How far an order is.");
  assert.equal(element(ts, "State").literals[0].description, "Not paid yet.");
});

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
