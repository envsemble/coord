// Reads, checks and writes Atlas's PlantUML subset. The grammar
// (plantuml.peggy) splits a file into statements; this reader turns them into
// a diagram and reports every line outside the subset with its position and
// what to do instead. `checkDiagram` adds the model rules and the rules of the
// `' atlas` headers, which may need the files a header names.
const { createHash } = require("node:crypto");
const { posix } = require("node:path");
const { parse } = require("./parser.cjs");

const MULTIPLICITY = /^(?:\d+|\*)(?:\.\.(?:\d+|\*))?$/;
// Crow's feet: the count of the entity each end touches.
const CROWS_FEET = {
  left: { "|o": "0..1", "||": "1", "}o": "0..*", "}|": "1..*" },
  right: { "o|": "0..1", "||": "1", "o{": "0..*", "|{": "1..*" },
};
const FEET_OF = Object.fromEntries(
  ["left", "right"].map((side) => [
    side,
    Object.fromEntries(
      Object.entries(CROWS_FEET[side]).map(([foot, count]) => [count, foot]),
    ),
  ]),
);
// Class diagram arrows. `reversed` arrows point from right to left: the
// relation's source is written on the right.
const CLASS_ARROWS = {
  "--": { kind: "association" },
  "-->": { kind: "association", navigable: true },
  "<--": { kind: "association", navigable: true, reversed: true },
  "--|>": { kind: "inheritance" },
  "<|--": { kind: "inheritance", reversed: true },
  "..|>": { kind: "implementation" },
  "<|..": { kind: "implementation", reversed: true },
  "o--": { kind: "aggregation" },
  "--o": { kind: "aggregation", reversed: true },
  "*--": { kind: "composition" },
  "--*": { kind: "composition", reversed: true },
  "..>": { kind: "dependency" },
  "<..": { kind: "dependency", reversed: true },
};
const OBJECT_ARROWS = {
  "--": { kind: "link" },
  "-->": { kind: "link", navigable: true },
  "<--": { kind: "link", navigable: true, reversed: true },
};
// How each kind is written, from its source to its target.
const WRITTEN = {
  association: "--",
  inheritance: "--|>",
  implementation: "..|>",
  aggregation: "o--",
  composition: "*--",
  dependency: "..>",
  link: "--",
};
const KINDS = {
  class: "class",
  "abstract class": "class",
  interface: "class",
  enum: "class",
  entity: "entity",
  object: "object",
};
const CREOLE = [
  "**",
  "//",
  '""',
  "__",
  "~~",
  "[[",
  "<&",
  "<$",
  "<b>",
  "<i>",
  "<u>",
  "<s>",
  "<color",
  "<size",
  "<font",
  "<back",
  "<img",
  "<code",
];
// Single lines Atlas rejects, with what to do instead. The first pattern a line
// matches names it.
const REJECTED_LINES = [
  [
    /^skinparam\b/i,
    "Atlas lays out and styles diagrams itself; remove `{line}`.",
  ],
  [
    /^(?:left to right|top to bottom) direction$/i,
    "Atlas lays out diagrams itself; remove `{line}`.",
  ],
  [/^!theme\b/i, "Atlas styles diagrams itself; remove the theme `{line}`."],
  [
    /^!/,
    "Atlas does not run the PlantUML preprocessor; write the diagram out in full instead of `{line}`.",
  ],
  [
    /^(?:hide|show|remove|restore)\b/i,
    "Atlas decides what a diagram shows; remove `{line}` and leave out what should not be in the diagram.",
  ],
  [
    /^(?:note|legend|header|footer|caption|newpage|mainframe)\b/i,
    "Atlas diagrams have no notes, legends, headers, footers or captions; the rationale belongs in the plan. Remove `{line}`.",
  ],
  [/^title$/i, "Write the title on one line: `title Name`."],
  [
    /^(?:scale|allowmixing|allow_mixing|set|sprite|hide|skin)\b/i,
    "Atlas lays out and styles diagrams itself; remove `{line}`.",
  ],
  [
    /^(?:namespace|folder|frame|node|rectangle|cloud|database|card|file|stack|queue|storage|artifact|agent|boundary|control|collections|hexagon|label|person|portin|portout)\b/i,
    "Atlas diagrams group classes only with `package`; `{word}` is not part of Atlas's subset.",
  ],
  [
    /^(?:component|usecase|actor|participant|state|start|stop|activity|partition|map|json|diamond|circle|annotation|protocol|struct|exception|metaclass|stereotype|dataclass|record|abstract)\b/i,
    "Atlas supports class, object and entity diagrams with `class`, `abstract class`, `interface`, `enum`, `entity` and `object`; `{word}` is not part of its subset.",
  ],
  [
    /^@start(?!uml)\w*/i,
    "Atlas supports only @startuml class, object and entity diagrams.",
  ],
  [/^\/'/, "Write comments as lines starting with `'`."],
  [/^[{}]/, "This brace does not open or close an element or package."],
];

const problem = (line, column, code, message) => ({
  line,
  column,
  code,
  message,
  severity: "error",
});
// The column of the first character a statement writes.
const columnOf = (lines, line) => (lines[line - 1] || "").search(/\S/) + 1 || 1;

// Member modifiers, which PlantUML reads anywhere in a member's line.
const MODIFIER = /\{(?:static|abstract|classifier|field|method)\}/i;

// The first Creole or HTML formatting a text uses, if any. PlantUML formats
// an attribute, operation, slot or relation label only between a pair of
// markers (`//a//`, `<u>a</u>`), and never with `__`, so a member's `List<U>`,
// one `//` in a URL or a `__proto__` stays as written; titles, names and
// packages are formatted from a single marker on. (A body line that starts
// and ends with `__`, such as an enum literal `__A__`, is a separator.)
function formattingIn(text, member = false) {
  const lower = (text || "").toLowerCase();
  if (!member) return CREOLE.find((token) => lower.includes(token)) || null;
  return (
    CREOLE.find((token) => {
      if (token === "__") return false;
      const at = lower.indexOf(token);
      if (at < 0) return false;
      const tag = /^<([a-z]+)>$/.exec(token);
      if (tag) return lower.includes(`</${tag[1]}>`, at);
      return ["**", "//", '""', "~~"].includes(token)
        ? lower.includes(token, at + token.length)
        : true;
    }) || null
  );
}

// The problem of a file the grammar cannot read; without an error, of one
// that is not worth reading.
function syntaxProblem(error, text) {
  if (!/^\s*@startuml/m.test(text))
    return problem(1, 1, "SYNTAX", "A diagram starts with a line `@startuml`.");
  if (!/^\s*@enduml/m.test(text)) {
    const line = text.split(/\r?\n/).length;
    return problem(line, 1, "SYNTAX", "A diagram ends with a line `@enduml`.");
  }
  if (!error) return null;
  const starts = text
    .split(/\r?\n/)
    .flatMap((l, i) => (/^\s*@startuml/.test(l) ? [i + 1] : []));
  if (starts.length > 1)
    return problem(
      starts[1],
      1,
      "SYNTAX",
      "A file holds one diagram; move the diagram from this `@startuml` to its `@enduml` into a file of its own.",
    );
  const { line, column } = error.location?.start || { line: 1, column: 1 };
  return problem(
    line,
    column,
    "SYNTAX",
    "Atlas could not read this line; check that every `{` that opens a body or package is closed by a `}` on a line of its own.",
  );
}

/**
 * Reads a diagram. Problems are the lines outside Atlas's subset and the
 * headers it cannot read; `diagram` is null only when the file cannot be read
 * at all. Model rules are `checkDiagram`'s.
 */
function parseDiagram(text, options = {}) {
  if (typeof text !== "string")
    throw new TypeError("parseDiagram needs the diagram's text");
  const source = text.replace(/^\uFEFF/, "");
  const lines = source.split(/\r?\n/);
  const unreadable = syntaxProblem(null, source);
  if (unreadable) return { diagram: null, problems: [unreadable] };
  let tree;
  try {
    tree = parse(source.endsWith("\n") ? source : `${source}\n`);
  } catch (error) {
    if (!error.location) throw error;
    return { diagram: null, problems: [syntaxProblem(error, source)] };
  }
  const reader = new Reader(lines);
  const problems = reader.read(tree);
  if (options.path) for (const p of problems) p.path = options.path;
  return { diagram: reader.diagram, problems };
}

class Reader {
  constructor(lines) {
    this.lines = lines;
    this.problems = [];
    this.pending = [];
    this.kinds = new Set();
    // Where each header is written.
    this.headers = {};
    this.diagram = {
      kind: "class",
      title: null,
      capture: null,
      fingerprint: null,
      proposal: null,
      compares: null,
      scenario: null,
      elements: [],
      relations: [],
    };
  }
  fail(line, code, message, column = columnOf(this.lines, line)) {
    this.problems.push(problem(line, column, code, message));
  }
  read(tree) {
    for (const outside of [...tree.lead, ...tree.trail])
      this.fail(
        outside.line,
        "OUTSIDE",
        "Write nothing before `@startuml` or after `@enduml`.",
      );
    if (tree.start.rest)
      this.fail(
        tree.start.line,
        "START",
        "Write `@startuml` alone on its line; the diagram's name belongs in `title`.",
      );
    if (tree.end.rest)
      this.fail(tree.end.line, "END", "Write `@enduml` alone on its line.");
    this.lines.forEach((text, i) => {
      if (/\\\s*$/.test(text))
        this.fail(
          i + 1,
          "CONTINUATION",
          "PlantUML joins a line that ends in `\\` with the next one; end this line with something other than a backslash.",
          text.lastIndexOf("\\") + 1,
        );
    });
    this.statements(tree.statements, null);
    this.annotate(null);
    if (this.kinds.size > 1)
      this.fail(
        tree.start.line,
        "MIXED_DIAGRAM",
        `A diagram is a class, object or entity diagram; this one declares ${[...this.kinds].join(" and ")} elements. Put each in its own file.`,
      );
    this.diagram.kind = [...this.kinds][0] || "class";
    for (const pending of this.relationsToRead)
      this.relation(pending.statement, pending.packageName);
    this.headerRules();
    return this.problems;
  }
  get relationsToRead() {
    return (this._relations ||= []);
  }
  statements(statements, packageName) {
    for (const statement of statements) {
      if (statement.type !== "atlas") this.annotate(statement);
      // The lines of a body opened on a line of its own are reported once,
      // with its `{`.
      if (this.strayBody) {
        if (statement.type === "unknown" && statement.text === "}") {
          this.strayBody = false;
          continue;
        }
        if (
          ["memberLine", "unknown", "blank", "comment"].includes(statement.type)
        )
          continue;
        this.strayBody = false;
      }
      switch (statement.type) {
        case "blank":
        case "comment":
          break;
        case "atlas":
          this.atlas(statement, packageName);
          break;
        case "title":
          if (packageName)
            this.fail(
              statement.line,
              "TITLE",
              "Write `title` outside packages.",
            );
          else if (this.diagram.title !== null)
            this.fail(statement.line, "TITLE", "A diagram has one `title`.");
          if (!/[\p{L}\p{N}]/u.test(statement.text))
            this.fail(
              statement.line,
              "TITLE",
              `Give the title a word; PlantUML cannot read a title of symbols only (\`${statement.text}\`).`,
            );
          else this.checkText(statement.line, statement.text, "The title");
          this.diagram.title ??= statement.text;
          break;
        case "package":
          this.package(statement, packageName);
          break;
        case "element":
          this.element(statement, packageName);
          break;
        case "relation":
          // Relations are read once every element's kind is known.
          this.relationsToRead.push({ statement, packageName });
          break;
        case "memberLine":
          this.memberLine(statement);
          break;
        case "unclosed":
          this.fail(
            statement.line,
            "UNCLOSED",
            `Close the body of ${statement.what} ${statement.name} with a \`}\` on a line of its own.`,
          );
          break;
        case "rejected":
          this.rejected(statement);
          if (statement.body) this.statements(statement.body, packageName);
          break;
        default:
          this.unknown(statement);
      }
      if (!["blank", "comment", "atlas"].includes(statement.type))
        this.previous = statement;
    }
  }
  // Evidence and snippets describe the element, member or relation that
  // follows them directly.
  annotate(statement) {
    if (!this.pending.length) return;
    const describable = ["element", "relation", "field", "method", "literal"];
    if (statement && describable.includes(statement.type)) {
      for (const { key, value } of this.pending) statement[key] = value;
    } else
      for (const { line, key } of this.pending)
        this.fail(
          line,
          "ATLAS_PLACEMENT",
          `Write \`' atlas ${key}\` directly above the element, member or relation it describes.`,
        );
    this.pending = [];
  }
  atlas(statement, packageName, inBody = false) {
    const [, keyword = "", rest = ""] =
      /^(\S*)\s*([\s\S]*)$/.exec(statement.text) || [];
    const line = statement.line;
    const json = () => {
      try {
        const value = JSON.parse(rest);
        if (value && typeof value === "object" && !Array.isArray(value))
          return value;
      } catch {}
      this.fail(
        line,
        "ATLAS_JSON",
        `Write \`' atlas ${keyword}\` with a JSON object on the same line.`,
      );
      return null;
    };
    if (keyword === "evidence" || keyword === "snippet") {
      const value = json();
      if (value) {
        const wrong =
          keyword === "evidence"
            ? !(typeof value.file === "string" && value.file)
              ? "Evidence names at least its `file`."
              : value.url !== undefined &&
                  !(
                    typeof value.url === "string" &&
                    /^https?:\/\//.test(value.url)
                  )
                ? "Evidence links a `url` starting with http:// or https://."
                : null
            : !(
                  typeof value.code === "string" &&
                  typeof value.language === "string"
                )
              ? "A snippet has its `language` and `code`."
              : value.code.split(/\r?\n/).length > 12
                ? "A snippet is at most twelve lines; shorten its `code`."
                : null;
        if (wrong) this.fail(line, "ATLAS_JSON", wrong);
        else this.pending.push({ line, key: keyword, value });
      }
      return;
    }
    const header = [
      "capture",
      "fingerprint",
      "proposal",
      "compares",
      "scenario",
    ];
    if (!header.includes(keyword)) {
      this.fail(
        line,
        "ATLAS_UNKNOWN",
        `Atlas reads \`' atlas\` comments of these kinds: ${[...header, "evidence", "snippet"].join(", ")}; \`${keyword || "(none)"}\` is not one of them. Write other remarks as plain \`'\` comments.`,
      );
      return;
    }
    if (packageName || inBody) {
      this.fail(
        line,
        "ATLAS_PLACEMENT",
        `Write \`' atlas ${keyword}\` at the top of the diagram, outside packages and bodies.`,
      );
      return;
    }
    if (this.diagram[keyword] !== null) {
      this.fail(
        line,
        "ATLAS_REPEATED",
        `A diagram has one \`' atlas ${keyword}\`.`,
      );
      return;
    }
    this.headers[keyword] ??= line;
    if (keyword === "capture") {
      const value = json();
      if (!value) return;
      const valid =
        typeof value.capturedAt === "string" &&
        !Number.isNaN(Date.parse(value.capturedAt)) &&
        typeof value.adapter?.id === "string" &&
        typeof value.source?.kind === "string" &&
        typeof value.source?.identity === "string" &&
        ["complete", "partial"].includes(value.coverage?.status);
      if (!valid)
        this.fail(
          line,
          "ATLAS_CAPTURE",
          "A capture header names `capturedAt`, `adapter.id`, `source.kind`, `source.identity` and `coverage.status` (complete or partial).",
        );
      this.diagram.capture = value;
    } else if (keyword === "fingerprint") {
      if (!/^[0-9a-f]{64}$/.test(rest))
        this.fail(
          line,
          "ATLAS_FINGERPRINT",
          "A capture's fingerprint is the SHA-256 Atlas wrote; do not write one by hand.",
        );
      this.diagram.fingerprint = rest;
    } else if (keyword === "scenario") {
      const match = /^(.+?)\s+expected\s+(valid|invalid)$/.exec(rest);
      if (!match)
        this.fail(
          line,
          "ATLAS_SCENARIO",
          "Write `' atlas scenario <class diagram> expected valid` (or `expected invalid`).",
        );
      else this.diagram.scenario = { of: match[1], expected: match[2] };
    } else if (!rest)
      this.fail(
        line,
        "ATLAS_REFERENCE",
        `Write \`' atlas ${keyword} <path>\` with the path of the diagram it ${keyword === "proposal" ? "starts from" : "compares with"}, relative to this file.`,
      );
    else this.diagram[keyword] = rest;
  }
  headerRules() {
    const d = this.diagram;
    const at = (keyword) => this.headers[keyword] || 1;
    if (d.capture && d.proposal)
      this.fail(
        at("proposal"),
        "ATLAS_HEADER",
        "A proposal is not a capture: replace the `' atlas capture` and `' atlas fingerprint` lines with `' atlas proposal <capture path>`.",
      );
    if (d.compares && !this.headers.capture)
      this.fail(
        at("compares"),
        "ATLAS_HEADER",
        "Only a capture compares with an earlier capture; `' atlas compares` needs `' atlas capture`.",
      );
    if (this.headers.fingerprint && !this.headers.capture)
      this.fail(
        at("fingerprint"),
        "ATLAS_HEADER",
        "`' atlas fingerprint` belongs to a capture header.",
      );
    if (d.capture && !this.headers.fingerprint)
      this.fail(
        at("capture"),
        "ATLAS_HEADER",
        "A capture records its fingerprint; capture again rather than writing one by hand.",
      );
    if (d.scenario && d.kind !== "object")
      this.fail(
        at("scenario"),
        "ATLAS_HEADER",
        "A scenario is an object diagram of example instances.",
      );
    if (d.kind === "object" && (d.proposal || d.capture))
      this.fail(
        at(d.proposal ? "proposal" : "capture"),
        "ATLAS_HEADER",
        "Object diagrams are scenarios; they are not captured or proposed.",
      );
  }
  // Text PlantUML would read as more than text: formatting, a stereotype and,
  // in a member, a modifier such as `{static}`. `member` reads formatting as
  // PlantUML reads a member's (and a label's).
  checkText(line, text, what, member = false, modifiers = member) {
    const token = formattingIn(text, member);
    const stereotype = /<<[^<>]*>>/.exec(text || "");
    const modifier = modifiers && MODIFIER.exec(text || "");
    if (token)
      this.fail(
        line,
        "FORMATTING",
        `${what} uses formatting (\`${token}\`); Atlas diagrams are plain text.`,
      );
    else if (stereotype)
      this.fail(
        line,
        "STEREOTYPE",
        `${what} has a stereotype (\`${stereotype[0]}\`); Atlas has none but <<PK>> and <<FK>> after an entity column. Remove it.`,
      );
    else if (modifier)
      this.fail(
        line,
        "MEMBER",
        `Atlas has no member modifiers; remove \`${modifier[0]}\`.`,
      );
  }
  package(statement, packageName) {
    if (statement.extra)
      this.fail(
        statement.line,
        "PACKAGE",
        `Write \`package ${statement.name} {\` without \`${statement.extra}\`; Atlas styles packages itself.`,
      );
    this.checkText(statement.line, statement.name, "The package name");
    const name = packageName
      ? `${packageName}.${statement.name}`
      : statement.name;
    this.statements(statement.body, name);
    this.annotate(null);
  }
  element(statement, packageName) {
    const kind = statement.kind;
    const diagramKind = KINDS[kind];
    this.kinds.add(diagramKind);
    let { extra } = statement;
    let members = statement.members;
    if (members === null && /^\{\s*\}$/.test(extra)) {
      members = [];
      extra = "";
    }
    if (extra) this.rejectExtra(statement.line, kind, statement.id, extra);
    if (statement.quoted && statement.name.trim() === "")
      this.fail(statement.line, "NAME", "Give the element a name.");
    this.checkText(statement.line, statement.name, "The name");
    const element = {
      id: statement.id,
      name: statement.name + (statement.generic || ""),
      kind,
      package: packageName,
      attributes: [],
      operations: [],
      literals: [],
      slots: [],
      line: statement.line,
      ...this.annotations(statement),
    };
    if (kind === "object") {
      const instance = /^\s*([^:]*?)\s*:\s*(.+?)\s*$/.exec(statement.name);
      element.classes = instance
        ? instance[2].split(",").map((name) => name.trim())
        : [];
      if (instance?.[2].split(",").some((name) => !name.trim()))
        this.fail(
          statement.line,
          "OBJECT",
          "Name each of the object's classes.",
        );
    }
    if (
      statement.generic &&
      !["class", "abstract class", "interface"].includes(kind)
    )
      this.fail(
        statement.line,
        "GENERIC",
        `Only classes and interfaces take type parameters; remove \`${statement.generic}\`.`,
      );
    let separator = null;
    for (const member of members || []) {
      if (member.type !== "atlas") this.annotate(member);
      if (member.type === "atlas") this.atlas(member, packageName, true);
      else if (member.type === "separator") {
        if (kind !== "entity")
          this.fail(
            member.line,
            "SEPARATOR",
            "Only entities take the `--` separator below their key columns; remove it.",
          );
        else if (separator)
          this.fail(
            member.line,
            "SEPARATOR",
            "An entity has one `--` separator.",
          );
        else
          separator = { line: member.line, above: element.attributes.length };
      } else if (member.type === "field") this.field(element, member);
      else if (member.type === "method") this.operation(element, member);
      else if (member.type === "literal") {
        if (
          kind === "enum" &&
          /^__/.test(member.name) &&
          /__$/.test(member.name)
        )
          this.fail(
            member.line,
            "MEMBER",
            `PlantUML reads \`${member.name}\` as a separator with a title; rename the literal so that it does not both start and end with \`__\`.`,
          );
        else if (kind === "enum")
          element.literals.push({
            name: member.name,
            line: member.line,
            ...this.annotations(member),
          });
        else
          this.fail(
            member.line,
            "MEMBER",
            kind === "object"
              ? `Give the slot a value: \`${member.name} = value\`.`
              : `Give the attribute a type: \`${member.name} : Type\`.`,
          );
      } else if (member.type === "slot") {
        if (kind === "object") {
          this.checkText(member.line, member.value, "The slot's value", true);
          element.slots.push({
            name: member.name,
            value: member.value,
            line: member.line,
          });
        } else
          this.fail(
            member.line,
            "MEMBER",
            kind === "enum"
              ? `Enum literals have no values in Atlas; write the literal's name alone, \`${member.name}\`.`
              : "Only objects have slot values (`name = value`); write an attribute as `name : Type`.",
          );
      } else if (member.type === "unknown") this.unknownMember(member, kind);
    }
    this.annotate(null);
    if (kind === "entity") this.entityKeys(element, separator);
    this.diagram.elements.push(element);
  }
  // An entity's primary key columns stand above its `--` separator, and its
  // other columns below it.
  entityKeys(element, separator) {
    const columns = element.attributes;
    if (!separator) {
      const other = columns.find((a) => a.key !== "PK");
      if (other && columns.some((a) => a.key === "PK"))
        this.fail(
          other.line,
          "SEPARATOR",
          `List ${element.id}'s <<PK>> columns first, with a \`--\` line below them and its other columns below that.`,
        );
      return;
    }
    const keyed = columns.slice(0, separator.above).some((a) => a.key === "PK");
    if (!keyed)
      this.fail(
        separator.line,
        "SEPARATOR",
        "The `--` separator stands below an entity's <<PK>> columns; write them above it, or remove it when the entity has none.",
      );
    columns.forEach((a, i) => {
      if (i >= separator.above && a.key === "PK")
        this.fail(
          a.line,
          "SEPARATOR",
          `Move the <<PK>> column ${a.name} above the \`--\` separator.`,
        );
      else if (keyed && i < separator.above && a.key !== "PK")
        this.fail(
          a.line,
          "SEPARATOR",
          `Only <<PK>> columns stand above the \`--\` separator; move ${a.name} below it.`,
        );
    });
  }
  annotations(statement) {
    return {
      ...(statement.evidence ? { evidence: statement.evidence } : {}),
      ...(statement.snippet ? { snippet: statement.snippet } : {}),
    };
  }
  rejectExtra(line, kind, id, extra) {
    const message = /<</.test(extra)
      ? `Atlas has no stereotypes on ${kind === "entity" ? "entities" : "elements"}; remove \`${extra}\`.`
      : /^#/.test(extra)
        ? `Atlas colours diagrams itself; remove \`${extra}\`.`
        : /^(?:extends|implements)\b/.test(extra)
          ? `Draw inheritance as a relation of its own, \`${id} ${extra.startsWith("extends") ? "--|>" : "..|>"} ${extra.split(/\s+/)[1] || "Parent"}\`, instead of \`${extra}\`.`
          : /^as\b/.test(extra)
            ? `Write a display name first: \`${kind} "Display name" as ${id}\`.`
            : /^[\uD800-\uDFFF]/.test(extra)
              ? `PlantUML cannot relate an element whose name has a character such as \`${String.fromCodePoint(extra.codePointAt(0))}\`; give it a display name, \`${kind} "${id}${extra.split(/[\s{]/)[0]}" as ${id}\`.`
              : `Atlas does not support \`${extra}\` after a declaration.`;
    this.fail(line, "DECLARATION", message);
  }
  field(element, member) {
    const line = member.line;
    if (element.kind === "object") {
      this.fail(
        line,
        "MEMBER",
        "An object's slot is written `name = value`, without a type.",
      );
      return;
    }
    if (element.kind === "enum") {
      this.fail(
        line,
        "MEMBER",
        "An enum lists its literals, one name per line.",
      );
      return;
    }
    const match = /^(.*?)\s*(?:\[([^\[\]]+)\])?\s*((?:<<[^<>]*>>\s*)*)$/.exec(
      member.rest,
    );
    const type = match[1].trim();
    const stereotypes = [...match[3].matchAll(/<<\s*([^<>]*?)\s*>>/g)].map(
      (m) => m[1],
    );
    if (!type)
      this.fail(
        line,
        "MEMBER",
        `Give the attribute a type: \`${member.name} : Type\`.`,
      );
    this.checkText(line, `${member.name} ${type}`, "The attribute", true);
    let key = null;
    for (const stereotype of stereotypes)
      if (
        element.kind === "entity" &&
        ["PK", "FK"].includes(stereotype) &&
        !key
      )
        key = stereotype;
      else
        this.fail(
          line,
          "STEREOTYPE",
          element.kind === "entity"
            ? `A column takes one of <<PK>> and <<FK>>; remove <<${stereotype}>>.`
            : `Atlas has no stereotypes on attributes; remove <<${stereotype}>>.`,
        );
    if (member.mandatory && element.kind !== "entity")
      this.fail(
        line,
        "MEMBER",
        "Only entity columns are marked mandatory with `*`; give the attribute a multiplicity such as `[1]` instead.",
      );
    if (element.kind === "entity" && match[2] !== undefined)
      this.fail(
        line,
        "MEMBER",
        "Mark a mandatory column with `*` in front of its name instead of a multiplicity.",
      );
    element.attributes.push({
      name: member.name,
      type,
      multiplicity:
        element.kind === "entity" ? null : (match[2]?.trim() ?? null),
      visibility: member.visibility,
      ...(element.kind === "entity"
        ? { mandatory: member.mandatory, key }
        : {}),
      line,
      ...this.annotations(member),
    });
  }
  operation(element, member) {
    if (["entity", "object", "enum"].includes(element.kind)) {
      this.fail(
        member.line,
        "MEMBER",
        `${element.kind === "entity" ? "Entities" : element.kind === "object" ? "Objects" : "Enums"} have no operations; remove \`${member.name}(…)\`.`,
      );
      return;
    }
    this.checkText(
      member.line,
      `${member.name}(${member.parameters}) ${member.returns || ""}`,
      "The operation",
      true,
    );
    element.operations.push({
      name: member.name,
      parameters: member.parameters,
      returns: member.returns || null,
      visibility: member.visibility,
      line: member.line,
      ...this.annotations(member),
    });
  }
  unknownMember(member, kind) {
    const text = member.text;
    const message = /^(?:\.\.|==|__|---)/.test(text)
      ? "Atlas does not draw separators in bodies; remove this line."
      : MODIFIER.test(text)
        ? `Atlas has no member modifiers; remove \`${MODIFIER.exec(text)[0]}\`.`
        : /<</.test(text)
          ? "Atlas has no stereotypes on members."
          : kind === "object"
            ? "Write an object's slot as `name = value`."
            : kind === "enum"
              ? "Write an enum literal as a name on its own line."
              : kind === "entity"
                ? "Write a column as `name : type`, with `*` in front for a mandatory column and <<PK>> or <<FK>> after it for a key."
                : "Write an attribute as `name : Type [0..1]` or an operation as `name(parameters) : Type`.";
    this.fail(member.line, "MEMBER", `${message} (\`${text}\`)`);
  }
  memberLine(statement) {
    const element = this.diagram.elements.find(
      (e) => e.id === statement.target,
    );
    const slot = /^([A-Za-z_][\w]*)\s*=\s*(.+)$/.exec(statement.text);
    const { target, text } = statement;
    if (element?.kind === "object" && slot) {
      this.checkText(statement.line, slot[2], "The slot's value", true);
      element.slots.push({
        name: slot[1],
        value: slot[2].trim(),
        line: statement.line,
      });
      return;
    }
    this.fail(
      statement.line,
      "MEMBER_LINE",
      element && element.kind !== "object"
        ? `Write ${element.id}'s members inside its body: \`${element.kind} ${element.id} {\` … \`}\`.`
        : element
          ? `Write a slot of ${target} as \`${target} : name = value\`.`
          : target === "title"
            ? `Write the title without a colon: \`title ${text}\`.`
            : slot
              ? `Declare the object ${target} before its slots, and write a slot as \`${target} : name = value\`.`
              : `\`${target} : ${text}\` stands outside any body; write members inside their element's body, \`class Name {\` … \`}\`, and relations with an arrow, \`A -- B : label\`.`,
    );
  }
  rejected(statement) {
    const messages = {
      note: "Atlas diagrams have no notes; the rationale belongs in the plan. Remove the note.",
      legend: "Atlas diagrams have no legends; remove it.",
      header: "Atlas diagrams have no headers; remove it.",
      footer: "Atlas diagrams have no footers; remove it.",
      title: "Write the title on one line: `title Name`.",
      skinparam:
        "Atlas lays out and styles diagrams itself; remove the `skinparam` block.",
      style: "Atlas styles diagrams itself; remove the `<style>` block.",
      "block comment": "Write comments as lines starting with `'`.",
      together:
        "Atlas lays out diagrams itself; remove `together` and keep its elements.",
    };
    this.fail(statement.line, "UNSUPPORTED", messages[statement.what]);
  }
  unknown(statement) {
    const text = statement.text;
    const word = /^[^\s{(]*/.exec(text)[0];
    const previous = this.previous;
    if (
      text === "{" &&
      previous?.type === "element" &&
      previous.members === null &&
      !previous.extra
    ) {
      this.fail(
        statement.line,
        "UNSUPPORTED",
        `Open ${previous.id}'s body at the end of its declaration, \`${previous.kind} ${previous.quoted ? `"${previous.name}" as ${previous.id}` : previous.id}${previous.generic || ""} {\`; Atlas reads no body from a \`{\` on a line of its own.`,
      );
      this.strayBody = true;
      return;
    }
    for (const [pattern, message] of REJECTED_LINES)
      if (pattern.test(text)) {
        this.fail(
          statement.line,
          "UNSUPPORTED",
          message.replace("{line}", text).replace("{word}", word),
        );
        return;
      }
    const message =
      /^(?:class|interface|enum|entity|object|abstract class)\b/.test(text)
        ? `Atlas could not read this declaration (\`${text}\`); write it as \`class Name\`, \`class "Display name" as Name\`, or with a body \`class Name {\`.`
        : /^package\b/.test(text)
          ? `Write a package as \`package name {\`, its elements on the lines below and \`}\` on a line of its own (\`${text}\`).`
          : /\s[-.<>|*o{}]*[-.]{1,}[-.<>|*o{}]*\s/.test(` ${text} `) ||
              /[-.]>|<[-.]/.test(text)
            ? `Atlas could not read this relation (\`${text}\`); write it as \`A "1" -- "0..*" B : label\` with spaces around the arrow and names declared above.`
            : `\`${text}\` is not part of Atlas's PlantUML subset.`;
    this.fail(statement.line, "UNSUPPORTED", message);
  }
  relation(statement, packageName) {
    const line = statement.line;
    const column =
      (this.lines[line - 1] || "").indexOf(statement.arrow) + 1 || 1;
    const fail = (message) => this.fail(line, "RELATION", message, column);
    const { arrow } = statement;
    const body = /[-.][\s\S]*[-.]|[-.]/.exec(arrow)[0];
    if (body.includes("[")) {
      fail(
        /\[\s*hidden\s*\]/i.test(body)
          ? "Atlas lays out diagrams itself; remove the `[hidden]` link."
          : `Atlas styles relations itself; remove \`${/\[[^\]]*\]/.exec(body)[0]}\` from the arrow.`,
      );
      return;
    }
    if (/[a-z]/i.test(body)) {
      fail(
        `Atlas lays out diagrams itself; remove the direction \`${/[a-z]+/i.exec(body)[0]}\` from the arrow \`${arrow}\`.`,
      );
      return;
    }
    if (body.includes("-") && body.includes("."))
      return fail(
        `Draw the arrow \`${arrow}\` with dashes or with dots, not both.`,
      );
    if (body.length === 1)
      return fail(
        `Write the arrow with two ${body === "-" ? "dashes" : "dots"}: \`${arrow.replace(body, body + body)}\`; a single one asks PlantUML to draw it sideways.`,
      );
    if (body.length > 2)
      return fail(
        `Write the arrow with two ${body[0] === "-" ? "dashes" : "dots"}: \`${arrow.replace(body, body.slice(0, 2))}\`; a longer arrow is a layout hint, and Atlas lays out diagrams itself.`,
      );
    const kind = this.diagram.kind;
    const label = statement.label || null;
    if (label !== null) {
      this.checkText(line, label, "The label", true, false);
      if (/^[<>]\s|\s[<>]$|^[<>]$/.test(label))
        fail(
          "Atlas draws relations itself; remove the reading direction (`<` or `>`) from the label.",
        );
    }
    if (statement.label === "")
      fail("Write the relation's label after the colon, or remove the colon.");
    const relation = {
      kind: null,
      source: statement.left,
      target: statement.right,
      sourceMultiplicity: statement.leftCount,
      targetMultiplicity: statement.rightCount,
      label,
      line,
      ...this.annotations(statement),
    };
    if (kind === "entity") {
      const [, left, right] = /^([^-.]*)--([^-.]*)$/.exec(arrow) || [];
      const leftCount = CROWS_FEET.left[left],
        rightCount = CROWS_FEET.right[right];
      if (!leftCount || !rightCount)
        return fail(
          `Join entities with a crow's-foot relation such as \`||--o{\`; each end takes one of |o, ||, }o, }| (left) and o|, ||, o{, |{ (right), not \`${arrow}\`.`,
        );
      if (statement.leftCount !== null || statement.rightCount !== null)
        return fail(
          "A crow's-foot relation already gives its counts; remove the quoted multiplicities.",
        );
      Object.assign(relation, {
        kind: "relationship",
        sourceMultiplicity: leftCount,
        targetMultiplicity: rightCount,
      });
    } else {
      const table = kind === "object" ? OBJECT_ARROWS : CLASS_ARROWS;
      const meaning = table[arrow];
      if (!meaning)
        return fail(
          kind === "object"
            ? `Link objects with \`--\` or \`-->\`, not \`${arrow}\`.`
            : `Atlas draws ${Object.keys(CLASS_ARROWS)
                .map((a) => `\`${a}\``)
                .join(", ")}; \`${arrow}\` is not one of them.`,
        );
      relation.kind = meaning.kind;
      if (meaning.navigable) relation.navigable = true;
      if (meaning.reversed)
        Object.assign(relation, {
          source: statement.right,
          target: statement.left,
          sourceMultiplicity: statement.rightCount,
          targetMultiplicity: statement.leftCount,
        });
      if (
        ["inheritance", "implementation", "link"].includes(meaning.kind) &&
        (statement.leftCount !== null || statement.rightCount !== null)
      )
        return fail(
          meaning.kind === "link"
            ? "Links between objects have no multiplicities; remove them."
            : "Inheritance has no multiplicities; remove them.",
        );
      if (["inheritance", "implementation"].includes(meaning.kind) && label)
        return fail("Inheritance has no label; remove it.");
    }
    this.diagram.relations.push(relation);
  }
}

// --- Model rules -----------------------------------------------------------

const multiplicityProblem = (value) => {
  if (value === null || value === undefined) return null;
  if (!MULTIPLICITY.test(value))
    return `\`${value}\` is not a multiplicity; write one such as 1, 0..1, 0..*, 1..* or 2..5.`;
  const [lower, upper] = value.split("..");
  if (lower === "*" && upper !== undefined)
    return `\`${value}\` is not a multiplicity; its lower bound is a number.`;
  if (upper && upper !== "*" && +lower > +upper)
    return `\`${value}\` has a lower bound above its upper bound.`;
  return null;
};
const operationKey = (operation) =>
  `${operation.name}(${operation.parameters.replace(/\s+/g, "")})`;

/** The model rules of one diagram, without the files it names. */
function modelProblems(diagram) {
  const problems = [];
  const fail = (line, code, message) =>
    problems.push(problem(line || 1, 1, code, message));
  const elements = new Map();
  for (const element of diagram.elements) {
    const other = elements.get(element.id);
    if (other)
      fail(
        element.line,
        "DUPLICATE",
        `${element.id} is declared twice (also on line ${other.line}); element names are unique across packages.`,
      );
    else elements.set(element.id, element);
    const seen = new Map();
    const once = (key, line, what) => {
      if (seen.has(key))
        fail(line, "DUPLICATE", `${element.id} lists ${what} twice.`);
      seen.set(key, line);
    };
    for (const a of element.attributes) {
      once(`a:${a.name}`, a.line, `the attribute ${a.name}`);
      const wrong = multiplicityProblem(a.multiplicity);
      if (wrong) fail(a.line, "MULTIPLICITY", wrong);
    }
    for (const o of element.operations)
      once(
        `o:${operationKey(o)}`,
        o.line,
        `the operation ${o.name}(${o.parameters})`,
      );
    for (const l of element.literals)
      once(`l:${l.name}`, l.line, `the literal ${l.name}`);
    for (const s of element.slots)
      once(`s:${s.name}`, s.line, `the slot ${s.name}`);
    if (
      element.kind === "object" &&
      !element.classes.length &&
      diagram.scenario
    )
      fail(
        element.line,
        "OBJECT",
        `Say which class ${element.id} is an instance of: \`object "${element.id} : Class" as ${element.id}\`.`,
      );
  }
  const parents = new Map();
  const relationIds = new Set();
  for (const r of diagram.relations) {
    const ends = [r.source, r.target].map((id) => elements.get(id));
    const missing = [r.source, r.target].filter((id) => !elements.has(id));
    if (missing.length) {
      fail(
        r.line,
        "UNDECLARED",
        `Declare ${[...new Set(missing)].join(" and ")} before relating ${missing.length > 1 ? "them" : "it"}; Atlas does not create elements from relations.`,
      );
      continue;
    }
    for (const value of [r.sourceMultiplicity, r.targetMultiplicity]) {
      const wrong = multiplicityProblem(value);
      if (wrong) fail(r.line, "MULTIPLICITY", wrong);
    }
    const [source, target] = ends;
    if (r.kind === "implementation" && target.kind !== "interface")
      fail(
        r.line,
        "INHERITANCE",
        `${target.id} is not an interface; ${source.id} inherits a class with \`--|>\`.`,
      );
    if (r.kind === "inheritance") {
      if (target.kind === "interface" && source.kind !== "interface")
        fail(
          r.line,
          "INHERITANCE",
          `${source.id} implements the interface ${target.id} with \`..|>\`.`,
        );
      if (source.kind === "interface" && target.kind !== "interface")
        fail(
          r.line,
          "INHERITANCE",
          `The interface ${source.id} can only extend interfaces.`,
        );
      if (source.kind === "enum" || target.kind === "enum")
        fail(r.line, "INHERITANCE", "Enums take no part in inheritance.");
    }
    if (r.kind === "inheritance" || r.kind === "implementation") {
      if (r.source === r.target) {
        fail(r.line, "INHERITANCE_CYCLE", `${r.source} cannot inherit itself.`);
        continue;
      }
      if (!parents.has(r.source)) parents.set(r.source, []);
      parents.get(r.source).push({ id: r.target, line: r.line });
      const key = `${r.source}>${r.target}`;
      if (relationIds.has(key))
        fail(r.line, "DUPLICATE", `${r.source} inherits ${r.target} twice.`);
      relationIds.add(key);
    }
  }
  // Inheritance cycles, each reported once.
  const state = new Map();
  const visit = (id, trail) => {
    state.set(id, 1);
    for (const parent of parents.get(id) || []) {
      if (state.get(parent.id) === 1) {
        const cycle = [...trail.slice(trail.indexOf(parent.id)), id, parent.id];
        fail(
          parent.line,
          "INHERITANCE_CYCLE",
          `Inheritance runs in a cycle: ${[...new Set(cycle)].join(" → ")} → ${parent.id}.`,
        );
      } else if (!state.has(parent.id)) visit(parent.id, [...trail, id]);
    }
    state.set(id, 2);
  };
  for (const id of parents.keys()) if (!state.has(id)) visit(id, []);
  if (diagram.kind === "entity") {
    for (const element of diagram.elements) {
      for (const column of element.attributes.filter((a) => a.key === "FK")) {
        const linked = diagram.relations.some(
          (r) =>
            r.kind === "relationship" &&
            foreignKeyColumns(r, elements)?.table === element.id &&
            foreignKeyColumns(r, elements).columns.includes(column.name),
        );
        if (!linked)
          fail(
            column.line,
            "FOREIGN_KEY",
            `${element.id}.${column.name} is a foreign key, but no relation names it; relate ${element.id} to the table it refers to with the column as the label, such as \`other ||--o{ ${element.id} : ${column.name}\`.`,
          );
      }
    }
  }
  if (diagram.kind === "object")
    for (const r of diagram.relations)
      if (r.label === null && diagram.scenario)
        fail(
          r.line,
          "LINK",
          "Label each link with the relation it instantiates.",
        );
  return problems;
}

/**
 * The foreign key a crow's-foot relation stands for: the table holding it and
 * its columns, when the label lists that table's <<FK>> columns. Null for a
 * relation whose label is only a name.
 */
function foreignKeyColumns(relation, elements) {
  if (!relation.label) return null;
  const columns = relation.label.split(",").map((c) => c.trim());
  for (const id of [relation.target, relation.source]) {
    const keys = new Set(
      (elements.get(id)?.attributes || [])
        .filter((a) => a.key === "FK")
        .map((a) => a.name),
    );
    if (columns.every((c) => keys.has(c))) return { table: id, columns };
  }
  return null;
}

// --- Fingerprints ----------------------------------------------------------

const FINGERPRINT_LINE = /^\s*'\s*atlas\s+fingerprint\b.*$/;
/** A capture's fingerprint: SHA-256 of its text without the fingerprint line. */
function diagramFingerprint(text) {
  const lines = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => !FINGERPRINT_LINE.test(line));
  return createHash("sha256")
    .update(lines.join("\n").replace(/\n+$/, ""))
    .digest("hex");
}

// --- Checking with the files a header names --------------------------------

/**
 * Every problem of a diagram: its syntax, its model rules and its headers.
 * `read(reference)` returns the text of a file the headers name, written as
 * the header writes it (relative to this file), or null when there is none.
 */
function checkDiagram(text, options = {}) {
  const { diagram, problems } = parseDiagram(text, options);
  if (!diagram) return problems;
  problems.push(...modelProblems(diagram));
  if (
    diagram.capture &&
    diagram.fingerprint &&
    /^[0-9a-f]{64}$/.test(diagram.fingerprint) &&
    diagramFingerprint(text) !== diagram.fingerprint
  )
    problems.push(
      problem(
        1,
        1,
        "CAPTURE_EDITED",
        "This capture was edited after Atlas wrote it, and captures are frozen. To show a change, copy it to a new file and replace its `' atlas capture` and `' atlas fingerprint` lines with `' atlas proposal <this file>`; to refresh it, capture again.",
      ),
    );
  const read = options.read;
  const reference = (keyword, line) => {
    const name =
      diagram[keyword] &&
      (keyword === "scenario" ? diagram.scenario.of : diagram[keyword]);
    if (!name) return null;
    const at =
      (text || "")
        .split(/\r?\n/)
        .findIndex((l) =>
          new RegExp(`^\\s*'\\s*atlas\\s+${keyword}\\b`).test(l),
        ) + 1 || line;
    const fail = (code, message) =>
      problems.push(problem(at, 1, code, message));
    if (typeof read !== "function") return null;
    const other = read(name);
    if (typeof other !== "string") {
      fail(
        "REFERENCE",
        `${name} does not exist; name the diagram by its path relative to this file.`,
      );
      return null;
    }
    const parsed = parseDiagram(other);
    if (!parsed.diagram || parsed.problems.length) {
      fail("REFERENCE", `${name} has problems of its own; check it first.`);
      return null;
    }
    return { name, diagram: parsed.diagram, fail };
  };
  const baseline = reference("proposal", 1);
  if (baseline && baseline.diagram.kind !== diagram.kind)
    baseline.fail(
      "REFERENCE",
      `${baseline.name} is ${article(baseline.diagram.kind)} diagram; a proposal keeps its baseline's kind.`,
    );
  const before = reference("compares", 1);
  for (const found of [baseline, before])
    if (found) {
      const cycle = baselineCycle(found.name, read, options.path);
      if (cycle)
        found.fail(
          "REFERENCE_CYCLE",
          `The baselines run in a cycle (${cycle.join(" → ")}); a proposal or a capture names an earlier diagram, never itself or one that leads back to it.`,
        );
    }
  if (before) {
    if (!before.diagram.capture)
      before.fail(
        "REFERENCE",
        `${before.name} is not a capture; a capture compares only with an earlier capture.`,
      );
    else if (before.diagram.kind !== diagram.kind)
      before.fail(
        "REFERENCE",
        `${before.name} is ${article(before.diagram.kind)} diagram, and this capture is ${article(diagram.kind)} one.`,
      );
  }
  const classes = reference("scenario", 1);
  if (classes) {
    if (classes.diagram.kind !== "class")
      classes.fail(
        "REFERENCE",
        `${classes.name} is not a class diagram; a scenario exemplifies a class diagram.`,
      );
    else if (!problems.length) {
      const { scenarioOf } = require("./model.cjs");
      const { scenario, problems: found } = scenarioOf(
        diagram,
        classes.diagram,
        { path: options.path },
      );
      problems.push(...found);
      if (!found.length) {
        const { assessScenario } = require("../learning/scenarios.cjs");
        const { diagramViewerModel } = require("./model.cjs");
        const result = assessScenario(
          diagramViewerModel(classes.diagram),
          scenario,
        );
        if (result.expectationMet === false)
          classes.fail(
            "SCENARIO",
            diagram.scenario.expected === "valid"
              ? `This scenario is expected to be valid, but ${classes.name} rejects it: ${result.issues.map((i) => i.message).join(" ")}`
              : `This scenario is expected to be invalid, but ${classes.name} accepts it.`,
          );
        else if (result.expectationMet === null)
          problems.push({
            ...problem(
              1,
              1,
              "SCENARIO_UNASSESSED",
              `Atlas cannot fully assess this scenario: ${result.unassessed.map((u) => u.message).join(" ")}`,
            ),
            severity: "warning",
          });
      }
    }
  }
  if (options.path) for (const p of problems) p.path ??= options.path;
  return problems.sort((a, b) => a.line - b.line || a.column - b.column);
}
const article = (kind) =>
  kind === "object" || kind === "entity" ? `an ${kind}` : `a ${kind}`;
/**
 * The chain of baselines from the one named `name` when it comes round again,
 * to this file or to one of its own; null when it ends. Names are relative to
 * this file, `file` being its path.
 */
function baselineCycle(name, read, file) {
  const named = (reference) => posix.normalize(reference.replace(/\\/g, "/"));
  const chain = file ? [posix.basename(named(file))] : [];
  for (let path = named(name); chain.length < 100; ) {
    if (chain.includes(path)) return [...chain, path];
    chain.push(path);
    const text = read(path);
    const diagram = typeof text === "string" && parseDiagram(text).diagram;
    const next = diagram && (diagram.proposal || diagram.compares);
    if (!next) return null;
    path = named(posix.join(posix.dirname(path), named(next)));
  }
  return null;
}

// --- Writing ---------------------------------------------------------------

const quoted = (text) => {
  if (/["\r\n]/.test(text))
    throw new Error(
      `FORMAT_NAME: ${JSON.stringify(text)} cannot be written in a diagram`,
    );
  return `"${text}"`;
};
const NAME =
  /^[A-Za-z_\u00C0-\uD7FF\uE000-\uFFEF][A-Za-z0-9_\u00C0-\uD7FF\uE000-\uFFEF]*$/;
function declaredName(element) {
  if (!NAME.test(element.id))
    throw new Error(
      `FORMAT_NAME: ${JSON.stringify(element.id)} is not a PlantUML name`,
    );
  if (element.name === element.id) return element.id;
  const generic = element.name.slice(element.id.length);
  if (
    element.name.startsWith(element.id) &&
    /^<.*>$/.test(generic) &&
    element.kind !== "object"
  )
    return element.name;
  return `${quoted(element.name)} as ${element.id}`;
}
const annotationLines = (item, indent) => [
  ...(item.evidence
    ? [`${indent}' atlas evidence ${JSON.stringify(item.evidence)}`]
    : []),
  ...(item.snippet
    ? [`${indent}' atlas snippet ${JSON.stringify(item.snippet)}`]
    : []),
];
function elementLines(element, indent) {
  const inner = `${indent}  `;
  const body = [];
  const attributes =
    element.kind === "entity"
      ? [
          ...element.attributes.filter((a) => a.key === "PK"),
          ...element.attributes.filter((a) => a.key !== "PK"),
        ]
      : element.attributes;
  const keys =
    element.kind === "entity"
      ? element.attributes.filter((a) => a.key === "PK").length
      : 0;
  attributes.forEach((a, i) => {
    if (keys && i === keys && i < attributes.length) body.push(`${inner}--`);
    body.push(...annotationLines(a, inner));
    body.push(
      element.kind === "entity"
        ? `${inner}${a.mandatory || a.key === "PK" ? "*" : ""}${a.name} : ${a.type}${a.key ? ` <<${a.key}>>` : ""}`
        : `${inner}${a.visibility || ""}${a.name} : ${a.type}${a.multiplicity ? ` [${a.multiplicity}]` : ""}`,
    );
  });
  for (const o of element.operations) {
    body.push(...annotationLines(o, inner));
    body.push(
      `${inner}${o.visibility || ""}${o.name}(${o.parameters})${o.returns ? ` : ${o.returns}` : ""}`,
    );
  }
  for (const l of element.literals) {
    body.push(...annotationLines(l, inner));
    body.push(`${inner}${l.name}`);
  }
  for (const s of element.slots) body.push(`${inner}${s.name} = ${s.value}`);
  const head = `${indent}${element.kind} ${declaredName(element)}`;
  return [
    ...annotationLines(element, indent),
    ...(body.length ? [`${head} {`, ...body, `${indent}}`] : [head]),
  ];
}
function relationLines(r) {
  let arrow,
    left = r.source,
    right = r.target;
  let leftCount = r.sourceMultiplicity,
    rightCount = r.targetMultiplicity;
  if (r.kind === "relationship") {
    arrow = `${FEET_OF.left[leftCount]}--${FEET_OF.right[rightCount]}`;
    leftCount = rightCount = null;
    if (arrow.includes("undefined"))
      throw new Error(
        `FORMAT_RELATION: ${r.source} and ${r.target} need crow's-foot counts`,
      );
  } else if (r.kind === "association" || r.kind === "link")
    arrow = r.navigable ? "-->" : "--";
  else arrow = WRITTEN[r.kind];
  if (!arrow) throw new Error(`FORMAT_RELATION: unknown kind ${r.kind}`);
  const count = (value) => (value ? ` ${quoted(value)}` : "");
  return [
    ...annotationLines(r, ""),
    `${left}${count(leftCount)} ${arrow}${count(rightCount)} ${right}${r.label ? ` : ${r.label}` : ""}`,
  ];
}

/**
 * Writes a diagram in Atlas's canonical form. A capture (a diagram with
 * `capture`) gets its fingerprint, computed over the text written.
 */
function formatDiagram(diagram) {
  const lines = ["@startuml"];
  if (diagram.title) lines.push(`title ${diagram.title}`);
  if (diagram.capture) {
    lines.push(`' atlas capture ${JSON.stringify(diagram.capture)}`);
    lines.push("' atlas fingerprint ");
  }
  if (diagram.proposal) lines.push(`' atlas proposal ${diagram.proposal}`);
  if (diagram.compares) lines.push(`' atlas compares ${diagram.compares}`);
  if (diagram.scenario)
    lines.push(
      `' atlas scenario ${diagram.scenario.of} expected ${diagram.scenario.expected}`,
    );
  // Elements in the order they are listed, each package's in one block where
  // its first element is.
  const blocks = [];
  const packages = new Map();
  for (const element of diagram.elements) {
    const name = element.package || null;
    if (name === null) blocks.push({ name, elements: [element] });
    else if (packages.has(name)) packages.get(name).elements.push(element);
    else {
      const block = { name, elements: [element] };
      packages.set(name, block);
      blocks.push(block);
    }
  }
  for (const { name, elements } of blocks) {
    lines.push("");
    if (name === null) {
      lines.push(...elementLines(elements[0], ""));
      continue;
    }
    lines.push(
      `package ${/^[A-Za-z0-9_.]+$/.test(name) ? name : quoted(name)} {`,
    );
    elements.forEach((element, i) => {
      if (i) lines.push("");
      lines.push(...elementLines(element, "  "));
    });
    lines.push("}");
  }
  if (diagram.relations.length) lines.push("");
  for (const r of diagram.relations) lines.push(...relationLines(r));
  lines.push("@enduml", "");
  let text = lines.join("\n");
  if (diagram.capture)
    text = text.replace(
      "' atlas fingerprint \n",
      `' atlas fingerprint ${diagramFingerprint(text)}\n`,
    );
  return text;
}

module.exports = {
  parseDiagram,
  checkDiagram,
  formatDiagram,
  modelProblems,
  diagramFingerprint,
  foreignKeyColumns,
  formattingIn,
};
