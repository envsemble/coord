// Coord's subset of PlantUML: class, object and entity diagrams.
//
// Derived from the PlantUML grammar of plantuml-parser
// (https://github.com/Enteee/plantuml-parser, src/plantuml.pegjs, 0.4.0),
// by Ente and the plantuml-parser contributors, licensed under the Apache
// License, Version 2.0 (http://www.apache.org/licenses/LICENSE-2.0; a copy is
// in licenses/plantuml-parser-LICENSE). Distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// Coord changed it into a strict allowlist: the diagram is read line by line,
// every statement Coord supports has its own rule, and any other line becomes
// an `unknown` statement (or, for a block such as a note, a `rejected` one)
// that the reader in diagram.cjs reports with its position, instead of being
// skipped. The C4, component, use case, note and skin parameter rules are
// gone; objects, slots, entity columns, `' coord` comments and the arrow
// tokens are new.
//
// Regenerate lib/plantuml/parser.cjs with `node scripts/build-parser.cjs`.

{
  const at = () => {
    const { start } = location();
    return { line: start.line, column: start.column };
  };
}

Diagram
  = lead:Outside* start:Start statements:Top* end:End trail:Outside*
    { return { lead: lead.filter(Boolean), start, statements, end, trail: trail.filter(Boolean) }; }

Start
  = _ "@startuml" rest:$(!NL .)* NL
    { return { ...at(), rest: rest.trim() }; }

End
  = _ "@enduml" rest:$(!NL .)* (NL / !.)
    { return { ...at(), rest: rest.trim() }; }

// Text outside @startuml … @enduml: only blank lines are allowed.
Outside
  = !(_ "@startuml") _ text:$(!NL .)+ (NL / !.)
    { return text.trim() ? { type: "outside", ...at(), text: text.trim() } : null; }
  / _ NL
    { return null; }

Top
  = Statement
  / Unknown

Inner
  = Statement
  / InnerUnknown

Statement
  = Blank
  / CoordComment
  / Comment
  / RejectedBlock
  / Title
  / Package
  / Element
  / Relation
  / MemberLine

Blank
  = _ NL
    { return { type: "blank" }; }

// `' coord …` comments carry what PlantUML cannot: capture headers, proposal,
// comparison and scenario references, and evidence and descriptions for the
// next element.
CoordComment
  = _ "'" _ "coord" text:(Space @$(!NL .)*)? NL
    { return { type: "coord", ...at(), text: (text || "").trim() }; }

Comment
  = _ "'" $(!NL .)* NL
    { return { type: "comment" }; }

Title
  = _ "title" Space text:$(!NL .)+ NL
    { return { type: "title", ...at(), text: text.trim() }; }

// A package, or one whose body runs to `@enduml`. Each is read once, so
// nested unclosed packages take no longer than closed ones.
Package
  = _ "package" Space name:PackageName extra:Extra "{" _ NL body:Inner* closed:Close
    { return closed ? { type: "package", ...at(), name, extra, body } : { type: "unclosed", ...at(), what: "package", name }; }

// The `}` that closes a body, or `@enduml` where it is missing.
Close
  = _ "}" _ NL
    { return true; }
  / &End
    { return false; }

PackageName
  = Quoted
  / $(Name ("." Name)*)

// A class, abstract class, interface, enum, entity or object, with or without
// a body.
Element
  = _ kind:ElementKind Space name:ElementName generic:Generic? extra:Extra "{" _ NL members:Member* closed:Close
    { return closed ? { type: "element", ...at(), kind, ...name, generic, extra, members } : { type: "unclosed", ...at(), what: kind, name: name.name }; }
  / _ kind:ElementKind Space name:ElementName generic:Generic? extra:Extra NL
    { return { type: "element", ...at(), kind, ...name, generic, extra, members: null }; }

ElementKind
  = "abstract" Space "class" { return "abstract class"; }
  / "class"
  / "interface"
  / "enum"
  / "entity"
  / "object"

ElementName
  = display:Quoted Space "as" Space id:Name
    { return { id, name: display, quoted: true }; }
  / id:Name
    { return { id, name: id, quoted: false }; }

// Type parameters right after a name: `Repository<T>`, `Map<K, List<V>>`.
Generic
  = $("<" !"<" (GenericText / Generic)+ ">")

GenericText
  = [^<>\n\r]+

// What stands between a declaration's name and its body: nothing, in the
// subset. Stereotypes, colours and inline `extends` are captured here so they
// can be reported.
Extra
  = text:$(!("{" _ NL) !NL .)*
    { return text.trim(); }

Member
  = Blank
  / CoordComment
  / Comment
  / Separator
  / Method
  / Field
  / Slot
  / Literal
  / MemberUnknown

Separator
  = _ "--" _ NL
    { return { type: "separator", ...at() }; }

Method
  = _ visibility:Visibility? _ name:Name _ "(" parameters:Parameters ")" returns:(_ ":" _ @$(!NL .)+)? _ NL
    { return { type: "method", ...at(), visibility, name, parameters: parameters.trim(), returns: returns ? returns.trim() : null }; }

Parameters
  = $([^()\n\r] / "(" Parameters ")")*

// An attribute or an entity column: `name : Type [0..1]`, `*id : integer <<PK>>`.
Field
  = _ mandatory:"*"? _ visibility:Visibility? _ name:Name _ ":" _ rest:$(!NL .)+ NL
    { return { type: "field", ...at(), mandatory: !!mandatory, visibility, name, rest: rest.trim() }; }

// A slot of an object: `name = "Alice"`.
Slot
  = _ name:Name _ "=" _ value:$(!NL .)+ NL
    { return { type: "slot", ...at(), name, value: value.trim() }; }

// An enum literal.
Literal
  = _ name:Name _ NL
    { return { type: "literal", ...at(), name }; }

MemberUnknown
  = !(_ "}" _ NL) !(_ "@enduml") _ text:$(!NL .)+ NL
    { return { type: "unknown", ...at(), text: text.trim() }; }

// `A "1" *-- "0..*" B : label`. The arrow is read whole and checked by the
// reader, so direction hints, styles and lengths are named when rejected.
Relation
  = _ left:Name _ leftCount:Quoted? _ arrow:Arrow _ rightCount:Quoted? _ right:Name label:(_ ":" _ @$(!NL .)*)? _ NL
    { return { type: "relation", ...at(), left, leftCount, arrow, rightCount, right, label: label === null ? null : label.trim() }; }

Arrow
  = $(Head? Line Head?)

Head
  = [<>|*o#x}{+^]+

Line
  = [-.]+ (("[" [^\]\n\r]* "]" / [a-zA-Z]+) [-.]+)?

// `alice : name = "Alice"`: a member written outside its element.
MemberLine
  = _ target:Name _ ":" _ text:$(!NL .)+ NL
    { return { type: "memberLine", ...at(), target, text: text.trim() }; }

// Blocks Coord does not support, read to their end so their lines are reported
// once: notes, legends, headers, footers, multi-line titles, skin parameter
// and style blocks, block comments and `together` groups.
RejectedBlock
  = _ what:$("note" / "legend" / "header" / "footer") [^:"\n\r]* NL BlockLines _ "end" _ closing:BlockWord _ NL &{ return closing === what; }
    { return { type: "rejected", ...at(), what }; }
  / _ what:"title" _ NL BlockLines _ "end" _ closing:BlockWord _ NL &{ return closing === what; }
    { return { type: "rejected", ...at(), what }; }
  / _ "skinparam" $(!NL !"{" .)* "{" _ NL (!(_ "}" _ NL) !(_ "@enduml") $(!NL .)* NL)* _ "}" _ NL
    { return { type: "rejected", ...at(), what: "skinparam" }; }
  / _ "<style>" $(!NL .)* NL (!(_ "</style>") !(_ "@enduml") $(!NL .)* NL)* _ "</style>" _ NL
    { return { type: "rejected", ...at(), what: "style" }; }
  / _ "/'" (!"'/" .)* "'/" _ NL
    { return { type: "rejected", ...at(), what: "block comment" }; }
  / _ "together" _ "{" _ NL body:Inner* Close
    { return { type: "rejected", ...at(), what: "together", body }; }

Unknown
  = !(_ "@enduml") _ text:$(!NL .)+ NL
    { return { type: "unknown", ...at(), text: text.trim() }; }

InnerUnknown
  = !(_ "}" _ NL) !(_ "@enduml") _ text:$(!NL .)+ NL
    { return { type: "unknown", ...at(), text: text.trim() }; }

Quoted
  = "\"" text:$[^"\n\r]* "\""
    { return text; }

// Letters of the Basic Multilingual Plane, without surrogate halves: PlantUML
// reads no name with a character beyond it.
Name
  = $([A-Za-z_\u00C0-\uD7FF\uE000-\uFFEF] [A-Za-z0-9_\u00C0-\uD7FF\uE000-\uFFEF]*)

Visibility
  = [-#~+]

Space
  = [ \t]+

_
  = [ \t]*

NL
  = "\r\n"
  / "\n"

BlockLines
  = (!(_ "end" _ BlockWord _ NL) !(_ "@enduml") $(!NL .)* NL)*

BlockWord
  = "note" / "legend" / "header" / "footer" / "title"
