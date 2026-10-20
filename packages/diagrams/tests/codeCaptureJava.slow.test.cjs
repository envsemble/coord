// Java code captures: class diagrams written through the JDK's compiler, with
// the capture header, evidence and snippets. Each capture starts a JVM.
const { describe, test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const { captureJava, captureFromConfig } = require("../lib/index.cjs");
const {
  fixture,
  read,
  element,
  related,
  undated,
} = require("./codeFixtures.cjs");

// Each capture starts its own JVMs and the tests share nothing, so they run
// side by side.
describe("Java captures", { concurrency: true }, () => {
  test("Java capture rejects escaped scopes and bounds before publication", async (t) => {
    const root = fixture(t),
      outside = fixture(t);
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
  });

  test(
    "Java preserves nested declarations, overloads and heritage type arguments, excludes local classes, and discloses directory classpaths",
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
class Base<T> {} class Item {} class Child extends Base<Item> {} class Container<T extends Item> { T value; } class Problem extends Exception {} class User { void use() throws Problem {} }
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
      assert.deepEqual(
        d.elements.map((e) => [e.id, e.name, e.package]).sort(),
        [
          ["Base", "Base", null],
          ["Child", "Child", null],
          ["Container", "Container", null],
          ["Item", "Item", null],
          ["Model", "Model", null],
          ["Nested", "Model.Nested", null],
          ["Problem", "Problem", null],
          ["User", "User", null],
        ],
      );
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
      // Heritage type arguments, bounds and thrown types are type uses.
      assert(related(d, "dependency", "Container", "Item"));
      assert(related(d, "dependency", "Child", "Item"));
      assert(
        element(d, "User").operations.some((o) =>
          o.returns.includes("throws Problem"),
        ),
      );
      assert(related(d, "dependency", "User", "Problem"));
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
      // Captured twice, it differs only in its date and fingerprint.
      const [text, again] = await Promise.all([
        captureJava(options),
        captureJava(options),
      ]);
      assert.equal(undated(again), undated(text));
      const d = read(text);
      assert.deepEqual(
        d.elements.map((e) => [e.package, e.id, e.kind]).sort(),
        [
          ["fixture", "Base", "class"],
          ["fixture", "Enrollment", "class"],
          ["fixture", "HasId", "interface"],
          ["fixture", "State", "enum"],
          ["fixture", "User", "class"],
        ],
      );
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
      fs.appendFileSync(path.join(root, "Model.java"), "\nclass NewClass {}\n");
      const second = fixture(t);
      fs.copyFileSync(
        path.join(root, "Model.java"),
        path.join(second, "Model.java"),
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
      // A configuration captures the edited source again, and the same names in
      // two projects stay apart.
      const [configured, multi] = await Promise.all([
        captureFromConfig(path.join(root, "source.json")),
        captureJava({
          identity: "multi",
          projects: [
            ...options.projects,
            { identity: "other", path: second, files: ["Model.java"] },
          ],
        }),
      ]);
      assert.equal(read(configured).elements.length, 6);
      const members = read(multi).elements;
      assert.equal(new Set(members.map((e) => e.id)).size, members.length);
      assert.equal(members.length, 12);
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
    "Java captures describe declarations and members by the first sentence of their documentation comments",
    { timeout: 60000 },
    async (t) => {
      const root = fixture(t);
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
});
