// Atlas's PlantUML subset: the grammar, the `' atlas` comments, the model
// rules, the viewer's model, writing diagrams back, and a work folder's
// families and comparisons.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");
const atlas = require("../lib/index.cjs");
const { parserIsCurrent } = require("../scripts/build-parser.cjs");

const CLASSES = `@startuml
title Shop
package shop.orders {
  abstract class Order {
    +id : string [1]
    lines : Line [1..*]
    +total(currency : string) : Money
  }
  class "Order line" as Line {
    quantity : int
  }
}
interface Priced
class Money
class Repository<T>
enum Status {
  OPEN
  CLOSED
}
' A plain comment.
Order "1" *-- "1..*" Line : lines
Line ..|> Priced
Order --> Status
Money <|-- Line
Order ..> Money
Repository "0..1" o-- "0..*" Order : holds
@enduml
`;
const ENTITIES = `@startuml
title Shop schema
entity customers {
  *id : integer <<PK>>
  --
  name : text
}
entity orders {
  *id : integer <<PK>>
  --
  *customer_id : integer <<FK>>
  note : text
}
customers ||--o{ orders : customer_id
@enduml
`;
const OBJECTS = `@startuml
object "o1 : Order" as o1 {
  id = "A1"
}
object "l1 : Line" as l1
l1 : quantity = 2
o1 -- l1 : lines
@enduml
`;
const parse = (text) => atlas.parseDiagram(text);
// A class diagram with one line added to its body.
const withLine = (line) => `@startuml\nclass A\nclass B\n${line}\n@enduml\n`;
const codes = (problems) => problems.map((p) => p.code);

test("the generated parser is the grammar's", () => {
  assert(parserIsCurrent(), "run node scripts/build-parser.cjs");
});

test("the subset reads class diagrams: elements, packages, members and every relation kind", () => {
  const { diagram, problems } = parse(CLASSES);
  assert.deepEqual(problems, []);
  assert.equal(diagram.kind, "class");
  assert.equal(diagram.title, "Shop");
  assert.deepEqual(
    diagram.elements.map((e) => [e.id, e.name, e.kind, e.package]),
    [
      ["Order", "Order", "abstract class", "shop.orders"],
      ["Line", "Order line", "class", "shop.orders"],
      ["Priced", "Priced", "interface", null],
      ["Money", "Money", "class", null],
      ["Repository", "Repository<T>", "class", null],
      ["Status", "Status", "enum", null],
    ],
  );
  const order = diagram.elements[0];
  assert.deepEqual(
    order.attributes.map((a) => [a.name, a.type, a.multiplicity, a.visibility]),
    [
      ["id", "string", "1", "+"],
      ["lines", "Line", "1..*", null],
    ],
  );
  assert.deepEqual(
    order.operations.map((o) => [o.name, o.parameters, o.returns]),
    [["total", "currency : string", "Money"]],
  );
  assert.deepEqual(
    diagram.elements[5].literals.map((l) => l.name),
    ["OPEN", "CLOSED"],
  );
  // Relations run from source to target whichever way they are written:
  // the whole to its part, the subclass to its superclass.
  assert.deepEqual(
    diagram.relations.map((r) => [
      r.kind,
      r.source,
      r.target,
      r.sourceMultiplicity,
      r.targetMultiplicity,
      r.label,
      !!r.navigable,
    ]),
    [
      ["composition", "Order", "Line", "1", "1..*", "lines", false],
      ["implementation", "Line", "Priced", null, null, null, false],
      ["association", "Order", "Status", null, null, null, true],
      ["inheritance", "Line", "Money", null, null, null, false],
      ["dependency", "Order", "Money", null, null, null, false],
      ["aggregation", "Repository", "Order", "0..1", "0..*", "holds", false],
    ],
  );
  assert.deepEqual(atlas.checkDiagram(CLASSES), []);
});

test("the subset reads entity and object diagrams", () => {
  const entities = parse(ENTITIES).diagram;
  assert.equal(entities.kind, "entity");
  assert.deepEqual(
    entities.elements[1].attributes.map((a) => [a.name, a.mandatory, a.key]),
    [
      ["id", true, "PK"],
      ["customer_id", true, "FK"],
      ["note", false, null],
    ],
  );
  assert.deepEqual(entities.relations, [
    {
      kind: "relationship",
      source: "customers",
      target: "orders",
      sourceMultiplicity: "1",
      targetMultiplicity: "0..*",
      label: "customer_id",
      line: 14,
    },
  ]);
  const objects = parse(OBJECTS).diagram;
  assert.equal(objects.kind, "object");
  assert.deepEqual(
    objects.elements.map((e) => [
      e.id,
      e.classes,
      e.slots.map((s) => `${s.name}=${s.value}`),
    ]),
    [
      ["o1", ["Order"], ['id="A1"']],
      ["l1", ["Line"], ["quantity=2"]],
    ],
  );
  assert.equal(objects.relations[0].kind, "link");
});

test("everything outside the subset is an error at its line and column that says what to do", () => {
  const cases = [
    [
      "skinparam linetype ortho",
      /lays out and styles diagrams itself; remove `skinparam linetype ortho`/,
    ],
    [
      "left to right direction",
      /lays out diagrams itself; remove `left to right direction`/,
    ],
    ["top to bottom direction", /remove `top to bottom direction`/],
    ["A -up-> B", /remove the direction `up` from the arrow `-up->`/],
    ["A -left-|> B", /remove the direction `left`/],
    [
      "A ---> B",
      /Write the arrow with two dashes: `-->`; a longer arrow is a layout hint/,
    ],
    [
      "A -> B",
      /two dashes: `-->`; a single one asks PlantUML to draw it sideways/,
    ],
    ["A -[hidden]- B", /remove the `\[hidden\]` link/],
    ["A -[#red]-> B", /remove `\[#red\]` from the arrow/],
    ["A -.-> B", /with dashes or with dots, not both/],
    ["A <--> B", /`<-->` is not one of them/],
    ["A .. B", /`\.\.` is not one of them/],
    ["class C #red", /colours diagrams itself; remove `#red`/],
    ["class C <<Entity>>", /no stereotypes on elements; remove `<<Entity>>`/],
    ["class C extends A", /`C --\|> A`, instead of `extends A`/],
    ["hide empty members", /decides what a diagram shows/],
    ["show A", /decides what a diagram shows/],
    ["remove B", /decides what a diagram shows/],
    ["note left of A : why", /no notes, legends/],
    [
      "note left of A\n  why\nend note",
      /no notes; the rationale belongs in the plan/,
    ],
    ["legend\n  key\nendlegend", /no legends/],
    ["header\n  page\nend header", /no headers/],
    ["footer x", /no notes, legends, headers, footers or captions/],
    ["caption Figure 1", /no notes, legends, headers, footers or captions/],
    ["title\n  Two lines\nend title", /title on one line/],
    [
      "skinparam class {\n  BackgroundColor red\n}",
      /remove the `skinparam` block/,
    ],
    ["<style>\nclass { }\n</style>", /remove the `<style>` block/],
    ["together {\n  class C\n}", /remove `together` and keep its elements/],
    ["!include common.puml", /does not run the PlantUML preprocessor/],
    ["!define X 1", /does not run the PlantUML preprocessor/],
    ["!theme plain", /remove the theme `!theme plain`/],
    ["/' a block comment '/", /Write comments as lines starting with `'`/],
    ["namespace shop {\n}", /`namespace` is not part of Atlas's subset/],
    ["participant Alice", /`participant` is not part of its subset/],
    ["actor Bob", /`actor` is not part of its subset/],
    ["component Web", /`component` is not part of its subset/],
    ["usecase Pay", /`usecase` is not part of its subset/],
    ["scale 2", /lays out and styles diagrams itself; remove `scale 2`/],
    [
      "class **Bold**",
      /not part of Atlas's PlantUML subset|could not read this declaration/,
    ],
    ["title <b>Shop</b>", /The title uses formatting \(`<b>`\)/],
    ["A --> B : owns >", /remove the reading direction/],
    ["A --> B : **owns**", /The label uses formatting/],
    ['class C {\n  link : "a//b//c"\n}', /The attribute uses formatting/],
    ["class C {\n  x : <u>int</u>\n}", /The attribute uses formatting/],
    ["class C {\n  f(x : **y**) : int\n}", /The operation uses formatting/],
    ['A "many" --> B', /`many` is not a multiplicity/],
    ['A "2..1" --> B', /lower bound above its upper bound/],
    ["A --|> B : is", /Inheritance has no label/],
    ['A "1" --|> B', /Inheritance has no multiplicities/],
    ["A --> C", /Declare C before relating it/],
    [
      "class C {\n  {static} count : int\n}",
      /no member modifiers; remove `\{static\}`/,
    ],
    [
      "class C {\n  x : int <<Key>>\n}",
      /no stereotypes on attributes; remove <<Key>>/,
    ],
    ["class C {\n  *x : int\n}", /Only entity columns are marked mandatory/],
    ["class C {\n  x : int [many]\n}", /`many` is not a multiplicity/],
    ["class C {\n  ..\n}", /does not draw separators in bodies/],
    ["class C {\n  --\n}", /Only entities take the `--` separator/],
    ["class C {\n  x\n}", /Give the attribute a type: `x : Type`/],
    ["class C {\n  x = 1\n}", /Only objects have slot values/],
    ["A : x : int", /Write A's members inside its body/],
    ["}", /This brace does not open or close/],
    ["abstract Thing", /`abstract class`/],
  ];
  for (const [line, message] of cases) {
    const problems = atlas.checkDiagram(withLine(line));
    assert(problems.length, `${line} is rejected`);
    assert(
      problems.some((p) => message.test(p.message)),
      `${line}: ${JSON.stringify(problems.map((p) => p.message))}`,
    );
    assert(
      problems.every((p) => p.line >= 4 && p.severity === "error"),
      `${line} is reported on its own line: ${JSON.stringify(problems)}`,
    );
  }
  // The column points at what is wrong.
  const [arrow] = atlas.checkDiagram(withLine("A   -up-> B"));
  assert.deepEqual([arrow.line, arrow.column], [4, 5]);
  const [member] = atlas.checkDiagram(
    "@startuml\nclass C {\n    {static} x : int\n}\n@enduml\n",
  );
  assert.deepEqual([member.line, member.column], [3, 5]);
  // Several problems are reported at once, in order, with the path.
  const many = atlas.checkDiagram(withLine("skinparam x y\nhide A\nA ---> B"), {
    path: "model.puml",
  });
  assert.deepEqual(
    many.map((p) => [p.line, p.path]),
    [
      [4, "model.puml"],
      [5, "model.puml"],
      [6, "model.puml"],
    ],
  );
  // PlantUML formats a member only between a pair of markers, and never with
  // `__`, so code such as a type parameter or one URL reads as written.
  assert.deepEqual(
    atlas.checkDiagram(
      withLine(
        'class C {\n  __proto__ : List<U>\n  home : "http://example.com"\n  map(f : Fn<B, I>) : Map<S, U>\n}',
      ),
    ),
    [],
  );
  assert.match(
    atlas.checkDiagram(withLine("title List<U>"))[0].message,
    /title uses formatting/,
  );
});

test("a file must be one @startuml … @enduml diagram of one kind", () => {
  const only = (text) =>
    atlas.checkDiagram(text).map((p) => [p.line, p.code, p.message]);
  assert.match(only("class A\n")[0][2], /starts with a line `@startuml`/);
  assert.match(
    only("@startuml\nclass A\n")[0][2],
    /ends with a line `@enduml`/,
  );
  assert.deepEqual(
    only("@startuml\nclass A {\n  x : int\n@enduml\n")[0].slice(0, 2),
    [2, "UNCLOSED"],
  );
  assert.deepEqual(
    only("@startuml\npackage p {\nclass A\n@enduml\n")[0].slice(0, 2),
    [2, "UNCLOSED"],
  );
  assert.deepEqual(only("intro\n@startuml\n@enduml\n")[0].slice(0, 2), [
    1,
    "OUTSIDE",
  ]);
  assert.deepEqual(only("@startuml shop\n@enduml\n")[0].slice(0, 2), [
    1,
    "START",
  ]);
  assert.deepEqual(
    only("@startuml\nclass A\nentity b\n@enduml\n")[0].slice(1, 2),
    ["MIXED_DIAGRAM"],
  );
  assert.deepEqual(
    only("@startuml\ntitle A\ntitle B\n@enduml\n")[0].slice(0, 2),
    [3, "TITLE"],
  );
  // Windows line endings, a byte order mark and a missing final newline read alike.
  assert.deepEqual(atlas.checkDiagram("﻿@startuml\r\nclass A\r\n@enduml"), []);
  // An empty diagram is a class diagram with nothing in it.
  assert.equal(parse("@startuml\n@enduml\n").diagram.kind, "class");
});

test("model rules: unique names and members, valid multiplicities, declared ends, sound inheritance and foreign keys", () => {
  const rules = (body) =>
    atlas.checkDiagram(`@startuml\n${body}\n@enduml\n`).map((p) => p.code);
  assert.deepEqual(rules("class A\npackage p {\n  class A\n}"), ["DUPLICATE"]);
  assert.deepEqual(rules("class A {\n  x : int\n  x : string\n}"), [
    "DUPLICATE",
  ]);
  assert.deepEqual(
    rules("class A {\n  f(a : int)\n  f(a : int)\n  f(b : int)\n}"),
    ["DUPLICATE"],
  );
  assert.deepEqual(rules('class A\nclass B\nA "*..1" -- B'), ["MULTIPLICITY"]);
  assert.deepEqual(
    rules("class A\nclass B\nclass C\nA --|> B\nB --|> C\nC --|> A"),
    ["INHERITANCE_CYCLE"],
  );
  assert.deepEqual(rules("class A\nA --|> A"), ["INHERITANCE_CYCLE"]);
  assert.deepEqual(rules("class A\nclass B\nA ..|> B"), ["INHERITANCE"]);
  assert.deepEqual(rules("class A\ninterface B\nA --|> B"), ["INHERITANCE"]);
  assert.deepEqual(rules("interface A\nclass B\nA --|> B"), ["INHERITANCE"]);
  assert.deepEqual(rules("class A\nclass B\nA --|> B\nA --|> B"), [
    "DUPLICATE",
  ]);
  // A foreign key names the relation to its table.
  assert.deepEqual(
    rules(
      "entity a {\n  *id : int <<PK>>\n}\nentity b {\n  *a_id : int <<FK>>\n}\na ||--o{ b",
    ),
    ["FOREIGN_KEY"],
  );
  assert.deepEqual(
    rules(
      "entity a {\n  *id : int <<PK>>\n}\nentity b {\n  *a_id : int <<FK>>\n}\na ||--o{ b : a_id",
    ),
    [],
  );
  assert.deepEqual(rules("entity a\nentity b\na --> b"), ["RELATION"]);
  assert.deepEqual(rules('entity a\nentity b\na "1" ||--o{ b'), ["RELATION"]);
  assert.deepEqual(rules("entity a {\n  x : int [0..1]\n}"), ["MEMBER"]);
  assert.deepEqual(rules("entity a {\n  x : int <<PK>> <<FK>>\n}"), [
    "STEREOTYPE",
  ]);
  assert.deepEqual(rules("object o\nobject p\no --> p\no *-- p"), ["RELATION"]);
  assert.deepEqual(rules('object o\nobject p\no "1" -- p'), ["RELATION"]);
});

const CAPTURE = {
  capturedAt: "2026-10-01T10:00:00.000Z",
  adapter: { id: "atlas-typescript", version: "1.0.0" },
  source: { kind: "typescript", identity: "shop", scope: ["src"] },
  coverage: {
    status: "partial",
    diagnostics: [{ message: "One file did not compile." }],
  },
  limitations: ["Declared types only."],
};
function captureText(
  body = 'class Order {\n  id : string\n}\nclass Line\nOrder "1" *-- "0..*" Line : lines',
) {
  const { diagram } = parse(`@startuml\ntitle Shop\n${body}\n@enduml\n`);
  diagram.capture = CAPTURE;
  diagram.elements[0].evidence = {
    file: "src/order.ts",
    line: 3,
    endLine: 9,
    repo: "shop",
    commit: "abc",
  };
  diagram.elements[0].snippet = {
    language: "ts",
    startLine: 3,
    code: "export class Order {}",
  };
  diagram.elements[0].attributes[0].evidence = {
    file: "src/order.ts",
    line: 4,
  };
  return atlas.formatDiagram(diagram);
}

test("' atlas comments carry captures, proposals, comparisons, scenarios and evidence", () => {
  const text = captureText();
  assert.match(
    text,
    /^' atlas capture \{"capturedAt":"2026-10-01T10:00:00.000Z",/m,
  );
  assert.match(text, /^' atlas fingerprint [0-9a-f]{64}$/m);
  assert.match(
    text,
    /^' atlas evidence \{"file":"src\/order.ts","line":3,"endLine":9,"repo":"shop","commit":"abc"\}\n' atlas snippet .*\nclass Order \{\n  ' atlas evidence \{"file":"src\/order.ts","line":4\}\n  id : string/m,
  );
  assert.deepEqual(atlas.checkDiagram(text), []);
  const { diagram } = parse(text);
  assert.deepEqual(diagram.capture, CAPTURE);
  assert.equal(diagram.fingerprint, atlas.diagramFingerprint(text));
  assert.deepEqual(diagram.elements[0].snippet, {
    language: "ts",
    startLine: 3,
    code: "export class Order {}",
  });
  assert.equal(diagram.elements[0].attributes[0].evidence.line, 4);
  const header = (lines) => parse(`@startuml\n${lines}\nclass A\n@enduml\n`);
  assert.equal(
    header("' atlas proposal ../captures/shop.puml").diagram.proposal,
    "../captures/shop.puml",
  );
  assert.deepEqual(
    parse(
      "@startuml\n' atlas scenario model one.puml expected invalid\nobject o\n@enduml\n",
    ).diagram.scenario,
    { of: "model one.puml", expected: "invalid" },
  );
  const wrong = (lines) => header(lines).problems.map((p) => [p.line, p.code]);
  assert.deepEqual(wrong("' atlas wat"), [[2, "ATLAS_UNKNOWN"]]);
  assert.deepEqual(wrong("' atlas proposal"), [[2, "ATLAS_REFERENCE"]]);
  assert.deepEqual(wrong("' atlas proposal a.puml\n' atlas proposal b.puml"), [
    [3, "ATLAS_REPEATED"],
  ]);
  assert.deepEqual(wrong("' atlas capture {not json}\n' atlas fingerprint x"), [
    [2, "ATLAS_JSON"],
    [3, "ATLAS_FINGERPRINT"],
  ]);
  assert.deepEqual(wrong("' atlas capture {}"), [
    [2, "ATLAS_CAPTURE"],
    [2, "ATLAS_HEADER"],
  ]);
  assert.deepEqual(wrong('\' atlas evidence {"file":"a.ts"}\n'), [
    [2, "ATLAS_PLACEMENT"],
  ]);
  assert.deepEqual(wrong('\' atlas evidence {"line":3}'), [[2, "ATLAS_JSON"]]);
  assert.deepEqual(
    wrong("' atlas scenario a.puml"),
    [
      [2, "ATLAS_SCENARIO"],
      [2, "ATLAS_HEADER"],
    ].slice(0, 1),
  );
  assert.deepEqual(
    parse(
      "@startuml\npackage p {\n' atlas proposal a.puml\n}\n@enduml\n",
    ).problems.map((p) => p.code),
    ["ATLAS_PLACEMENT"],
  );
  assert.deepEqual(
    parse(
      `@startuml\n' atlas compares a.puml\nclass A\n@enduml\n`,
    ).problems.map((p) => p.code),
    ["ATLAS_HEADER"],
  );
  assert.deepEqual(
    parse(
      `@startuml\n' atlas scenario a.puml expected valid\nclass A\n@enduml\n`,
    ).problems.map((p) => p.code),
    ["ATLAS_HEADER"],
  );
  // A capture copied into a proposal must give up its capture header.
  const copied = text.replace(
    "title Shop",
    "title Shop\n' atlas proposal shop.puml",
  );
  assert(
    parse(copied).problems.some((p) =>
      /replace the `' atlas capture`/.test(p.message),
    ),
  );
});

test("a capture is frozen: an edit no longer matches its fingerprint", () => {
  const text = captureText();
  assert.deepEqual(atlas.checkDiagram(text.replace(/\n/g, "\r\n")), []);
  const edited = atlas.checkDiagram(text.replace("id : string", "id : number"));
  assert.deepEqual(
    edited.map((p) => p.code),
    ["CAPTURE_EDITED"],
  );
  assert.match(
    edited[0].message,
    /copy it to a new file and replace its `' atlas capture` and `' atlas fingerprint` lines with `' atlas proposal/,
  );
  assert.deepEqual(
    parse(text.replace(/^' atlas fingerprint .*\n/m, "")).problems.map(
      (p) => p.code,
    ),
    ["ATLAS_HEADER"],
  );
});

test("a proposal's and a comparison's baselines must exist, read and be of their kind", () => {
  const files = {
    "shop.puml": captureText(),
    "broken.puml": "@startuml\nskinparam x y\n@enduml\n",
    "schema.puml": ENTITIES,
  };
  const check = (text) =>
    atlas
      .checkDiagram(text, { path: "p.puml", read: (r) => files[r] ?? null })
      .map((p) => p.message);
  const proposal = (of) =>
    `@startuml\n' atlas proposal ${of}\nclass Order\n@enduml\n`;
  assert.deepEqual(check(proposal("shop.puml")), []);
  assert.match(
    check(proposal("missing.puml"))[0],
    /missing.puml does not exist/,
  );
  assert.match(
    check(proposal("broken.puml"))[0],
    /broken.puml has problems of its own/,
  );
  assert.match(
    check(proposal("schema.puml"))[0],
    /schema.puml is an entity diagram; a proposal keeps its baseline's kind/,
  );
  const after = (of) => {
    const { diagram } = parse(captureText());
    diagram.compares = of;
    return atlas.formatDiagram(diagram);
  };
  assert.deepEqual(check(after("shop.puml")), []);
  assert.match(check(after("schema.puml"))[0], /schema.puml is not a capture/);
});

test("a diagram becomes the viewer's model, identified by names", () => {
  const { diagram } = parse(CLASSES);
  const model = atlas.diagramViewerModel(diagram);
  assert.deepEqual(
    model.classes.map((c) => [
      c.id,
      c.name,
      c.stereotype,
      !!c.isAbstract,
      c.namespace ?? null,
    ]),
    [
      ["Order", "Order", "class", true, "shop.orders"],
      ["Line", "Order line", "class", false, "shop.orders"],
      ["Priced", "Priced", "interface", false, null],
      ["Money", "Money", "class", false, null],
      ["Repository", "Repository<T>", "class", false, null],
      ["Status", "Status", "enum", false, null],
    ],
  );
  assert.deepEqual(
    model.classes[0].attributes.map((a) => a.id),
    ["Order.id", "Order.lines"],
  );
  assert.deepEqual(
    model.classes[0].methods.map((m) => [m.id, m.type]),
    [["Order.total(currency:string)", "total(currency : string): Money"]],
  );
  assert.deepEqual(
    model.classes[5].attributes.map((a) => [a.id, a.type]),
    [
      ["Status.OPEN", ""],
      ["Status.CLOSED", ""],
    ],
  );
  assert.deepEqual(
    model.relations.map((r) => [
      r.id,
      r.stereotype,
      r.sourceAggregation ?? null,
      !!r.navigable,
    ]),
    [
      ["relation:Order:Line:lines", "", "COMPOSITE", false],
      ["relation:Order:Status", "", null, true],
      ["relation:Order:Money", "dependency", null, false],
      ["relation:Repository:Order:holds", "", "SHARED", false],
    ],
  );
  assert.deepEqual(
    model.generalizations.map((g) => [
      g.id,
      g.specificId,
      g.generalId,
      !!g.realization,
    ]),
    [
      ["generalization:Line:Priced", "Line", "Priced", true],
      ["generalization:Line:Money", "Line", "Money", false],
    ],
  );
  // Entities draw as tables, with their keys in the inspector.
  const tables = atlas.diagramViewerModel(parse(ENTITIES).diagram);
  const orders = tables.classes.find((c) => c.id === "orders");
  assert.equal(orders.stereotype, "table");
  assert.deepEqual(
    orders.attributes.map((a) => [
      a.name,
      a.multiplicity,
      a.nullable,
      a.primaryKeyOrder,
    ]),
    [
      ["id", "1", false, 1],
      ["customer_id", "1", false, null],
      ["note", "0..1", true, null],
    ],
  );
  assert.deepEqual(orders.keys, [
    { name: "PRIMARY KEY", columns: ["id"], primary: true },
  ]);
  assert.deepEqual(orders.foreignKeys, [
    { columns: ["customer_id"], target: "customers", targetColumns: ["id"] },
  ]);
  // The relation runs from the table holding the key, with the count at each end.
  assert.deepEqual(
    tables.relations.map((r) => [
      r.id,
      r.sourceId,
      r.targetId,
      r.sourceMultiplicity,
      r.targetMultiplicity,
      r.stereotype,
      r.columns,
    ]),
    [
      [
        "relation:orders:customers:customer_id",
        "orders",
        "customers",
        "0..*",
        "1",
        "foreign key",
        ["customer_id"],
      ],
    ],
  );
  // Evidence becomes sources, places and snippets.
  const { model: captured, snippets } =
    require("../lib/plantuml/model.cjs").convert(parse(captureText()).diagram);
  const order = captured.classes.find((c) => c.id === "Order");
  assert.deepEqual(order.evidence, ["source:Order"]);
  assert.deepEqual(order.location, {
    file: "src/order.ts",
    startLine: 3,
    endLine: 9,
  });
  assert.deepEqual(order.attributes[0].location, {
    file: "src/order.ts",
    startLine: 4,
    endLine: 4,
  });
  assert.deepEqual(
    captured.sources.map((s) => [s.id, s.file, s.repo, s.commit, s.line]),
    [
      ["source:Order", "src/order.ts", "shop", "abc", 3],
      ["source:Order.id", "src/order.ts", undefined, undefined, 4],
    ],
  );
  assert.deepEqual(snippets["source:Order"], {
    repo: "shop",
    commit: "abc",
    file: "src/order.ts",
    startLine: 3,
    language: "ts",
    code: "export class Order {}",
  });
  assert.deepEqual(captured.unknowns, [
    "Declared types only.",
    "One file did not compile.",
  ]);
  assert.equal(captured.date, "2026-10-01");
});

test("writing a diagram gives Atlas's canonical text, which reads back the same", () => {
  const strip = (value) =>
    JSON.parse(
      JSON.stringify(value, (key, v) => (key === "line" ? undefined : v)),
    );
  for (const text of [CLASSES, ENTITIES, OBJECTS, captureText()]) {
    const { diagram } = parse(text);
    const written = atlas.formatDiagram(diagram);
    const reread = parse(written);
    assert.deepEqual(reread.problems, [], written);
    assert.deepEqual(
      strip(reread.diagram),
      strip({ ...diagram, fingerprint: reread.diagram.fingerprint }),
    );
    assert.equal(atlas.formatDiagram(reread.diagram), written);
    assert.deepEqual(atlas.checkDiagram(written), []);
  }
  assert.equal(
    atlas
      .formatDiagram(parse(CLASSES).diagram)
      .split("\n")
      .slice(0, 4)
      .join("\n"),
    "@startuml\ntitle Shop\n\npackage shop.orders {",
  );
  const { diagram } = parse(CLASSES);
  diagram.elements[0].name = 'Say "hi"';
  assert.throws(() => atlas.formatDiagram(diagram), /FORMAT_NAME/);
});

// A work folder: a capture before a plan, two alternative proposals of it, a
// capture after the plan compared with the first, a proposal of that, and an
// unrelated diagram.
function workFolder() {
  const before = captureText();
  const proposal = (title, extra) =>
    before
      .replace(
        /^' atlas capture .*\n' atlas fingerprint .*\n/m,
        "' atlas proposal ../captures/before.puml\n",
      )
      .replace("title Shop", `title ${title}`)
      .replace("  id : string\n", `  id : string\n${extra}`);
  const { diagram: later } = parse(
    captureText(
      'class Order {\n  id : string\n  discount : Money [0..1]\n}\nclass Line\nclass Money\nOrder "1" *-- "1..*" Line : lines',
    ),
  );
  later.compares = "before.puml";
  later.capture = { ...CAPTURE, capturedAt: "2026-10-20T10:00:00.000Z" };
  const after = atlas.formatDiagram(later);
  return [
    { path: "captures/before.puml", text: before },
    {
      path: "proposals/discounts.puml",
      text: proposal("Discounts", "  discount : Money [0..1]\n"),
    },
    {
      path: "proposals/coupons.puml",
      text: proposal("Coupons", "  coupon : string [0..1]\n"),
    },
    { path: "captures/after.puml", text: after },
    {
      path: "captures/next.puml",
      text: after
        .replace(
          /^' atlas capture .*\n' atlas fingerprint .*\n' atlas compares .*\n/m,
          "' atlas proposal after.puml\n",
        )
        .replace("title Shop", "title Next"),
    },
    { path: "glossary.puml", text: CLASSES },
    { path: "broken.puml", text: withLine("A -up-> B") },
  ];
}

test("a work folder's diagrams are described with their roles, profiles, baselines and families", () => {
  const described = atlas.describeDiagrams(workFolder());
  assert.deepEqual(
    described.map((d) => [
      d.path,
      d.role,
      d.profile,
      d.baseline,
      d.family,
      d.valid,
    ]),
    [
      [
        "captures/before.puml",
        "capture",
        "code",
        null,
        "captures/before.puml",
        true,
      ],
      [
        "proposals/discounts.puml",
        "proposal",
        "code",
        "captures/before.puml",
        "captures/before.puml",
        true,
      ],
      [
        "proposals/coupons.puml",
        "proposal",
        "code",
        "captures/before.puml",
        "captures/before.puml",
        true,
      ],
      [
        "captures/after.puml",
        "capture",
        "code",
        "captures/before.puml",
        "captures/before.puml",
        true,
      ],
      [
        "captures/next.puml",
        "proposal",
        "code",
        "captures/after.puml",
        "captures/before.puml",
        true,
      ],
      ["glossary.puml", "diagram", "class", null, null, true],
      ["broken.puml", "diagram", "class", null, null, false],
    ],
  );
  assert.equal(described[0].capture.capturedAt, "2026-10-01T10:00:00.000Z");
  assert.deepEqual(
    described[6].problems.map((p) => [p.path, p.line, p.code]),
    [["broken.puml", 4, "RELATION"]],
  );
  assert.equal(
    atlas.resolveReference("captures/next.puml", "../proposals/a.puml"),
    "proposals/a.puml",
  );
});

test("a family lays out once: proposals and a later capture compare with their baselines by name", async () => {
  const { prepared } = await atlas.prepareDiagrams({ files: workFolder() });
  assert.deepEqual([...prepared.keys()].sort(), [
    "captures/after.puml",
    "captures/before.puml",
    "captures/next.puml",
    "glossary.puml",
    "proposals/coupons.puml",
    "proposals/discounts.puml",
  ]);
  const payload = (p) => prepared.get(p).payload;
  for (const member of [
    "captures/before.puml",
    "proposals/discounts.puml",
    "proposals/coupons.puml",
    "captures/after.puml",
    "captures/next.puml",
  ])
    assert.equal(payload(member).family, "captures/before.puml");
  assert.equal(payload("glossary.puml").family, undefined);
  assert.equal(payload("captures/before.puml").comparison, undefined);
  // A proposal shows what it changes: the attribute it adds, by name.
  const discounts = payload("proposals/discounts.puml").comparison;
  assert.deepEqual(
    discounts.changes.changes
      .filter((c) => c.elementId)
      .map((c) => [c.kind, c.elementId]),
    [
      ["modified", "Order"],
      ["added", "Order.discount"],
    ],
  );
  const order = discounts.changeView.model.classes.find(
    (c) => c.id === "Order",
  );
  assert.equal(order.changeStatus, "modified");
  assert.deepEqual(
    order.attributes.map((a) => [a.name, a.changeStatus]),
    [
      ["id", "unchanged"],
      ["discount", "added"],
    ],
  );
  // The later capture compares with the earlier one.
  const after = payload("captures/after.puml");
  assert.deepEqual(
    after.comparison.changes.changes
      .filter((c) => c.elementId)
      .map((c) => [c.kind, c.elementId]),
    [
      ["added", "Money"],
      ["modified", "Order"],
      ["added", "Order.discount"],
      ["modified", "relation:Order:Line:lines"],
    ],
  );
  // Every member draws its classes where the others do.
  const places = (p) =>
    Object.fromEntries(
      payload(p).views[0].diagram.nodes.map((n) => [n.id, [n.x, n.y]]),
    );
  const base = places("captures/before.puml");
  for (const member of [
    "proposals/coupons.puml",
    "captures/after.puml",
    "captures/next.puml",
  ])
    for (const [id, place] of Object.entries(places(member)))
      if (base[id]) assert.deepEqual(place, base[id], `${member} ${id}`);
  // Where each comes from.
  const { describeProvenance } =
    require("./load-components.cjs").loadComponents("src/viewer/provenance.js");
  assert.match(
    describeProvenance(after.model.document).detail,
    /TypeScript · shop · captured Oct 20, 2026 · partial coverage/,
  );
  assert.equal(
    describeProvenance(payload("proposals/coupons.puml").model.document).detail,
    "Changes to source captured Oct 1, 2026",
  );
  assert.equal(
    describeProvenance(payload("glossary.puml").model.document).detail,
    "Class diagram",
  );
  assert.equal(payload("glossary.puml").model.document.path, "glossary.puml");
  // Asking for one diagram lays out its family only.
  const one = await atlas.prepareDiagrams({
    files: workFolder(),
    paths: ["glossary.puml"],
  });
  assert.deepEqual([...one.prepared.keys()], ["glossary.puml"]);
});

test("an offline viewer carries its diagram, and its downloads its PlantUML", async () => {
  const files = [{ path: "glossary.puml", text: CLASSES }];
  const { prepared } = await atlas.prepareDiagrams({
    files,
    slug: "glossary",
    includeArtifacts: true,
  });
  const viewer = prepared.get("glossary.puml");
  assert.equal(viewer.artifacts.get("glossary.puml"), CLASSES);
  const built = await atlas.buildViewer({ prepared: viewer, file: files[0] });
  assert(!/<script\b[^>]*src=/i.test(built.html));
  const carried = built.html.match(
    /<script id="atlas-diagram" type="application\/json">([\s\S]*?)<\/script>/,
  )[1];
  assert.deepEqual(JSON.parse(carried), files[0]);
  const data = built.html.match(/^\s*(const MODEL=.*)$/m)[1];
  new vm.Script(`${data}\n;({MODEL,VIEWS,EXPORTS,SNIPPETS})`).runInNewContext();
  assert(!built.html.includes("OntoUML"));
});

test("a self association keeps both its counts", async () => {
  const text =
    '@startuml\nclass Node\nNode "0..*" -- "0..*" Node : connected to\n@enduml\n';
  const { prepared } = await atlas.prepareDiagrams({
    files: [{ path: "n.puml", text }],
  });
  const viewer = prepared.get("n.puml");
  assert.equal(viewer.views[0].diagram.edges.length, 1);
  assert.equal(viewer.report.diagrams[0].multiplicityLabels, 2);
});

// PlantUML itself accepts every diagram Atlas accepts. Opt in with the path of
// a PlantUML jar: ATLAS_TEST_PLANTUML_JAR=/path/to/plantuml.jar.
test(
  "PlantUML renders every diagram Atlas accepts",
  {
    skip:
      !process.env.ATLAS_TEST_PLANTUML_JAR &&
      "set ATLAS_TEST_PLANTUML_JAR to a PlantUML jar",
  },
  (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-plantuml-"));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const files = [
      ...[CLASSES, ENTITIES, OBJECTS].map((text, i) => ({
        path: `fixture-${i}.puml`,
        text,
      })),
      ...workFolder().filter((f) => f.path !== "broken.puml"),
    ];
    const names = [];
    for (const [i, file] of files.entries()) {
      for (const text of [
        file.text,
        atlas.formatDiagram(parse(file.text).diagram),
      ]) {
        const name = path.join(directory, `${i}-${names.length}.puml`);
        fs.writeFileSync(name, text);
        names.push(name);
      }
    }
    const result = spawnSync(
      "java",
      [
        "-Djava.awt.headless=true",
        "-jar",
        process.env.ATLAS_TEST_PLANTUML_JAR,
        "-checkonly",
        ...names,
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    // And it rejects what Atlas reports as unclosed.
    const broken = path.join(directory, "broken.puml");
    fs.writeFileSync(broken, "@startuml\nclass A {\n@enduml\n");
    assert.notEqual(
      spawnSync("java", [
        "-jar",
        process.env.ATLAS_TEST_PLANTUML_JAR,
        "-checkonly",
        broken,
      ]).status,
      0,
    );
  },
);
