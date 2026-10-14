# Diagrams

Diagrams are `.puml` files in a work item, in Atlas's subset of PlantUML. Write and edit them as ordinary files; there are no diagram tools. The hooks run `atlas check` after each edit and hand back what is wrong, line by line; run `atlas check <file>` yourself when hooks are not installed. The full guide is `docs/diagrams.md` in the Atlas repository.

## When to make one

Offer a diagram when the work settles domain concepts, boundaries or data structure, and make it if the user agrees. Plain UI or tooling work gets none. Capture code or a database when the work changes them, and build proposals on the capture.

## Where it goes

Put diagrams under the work folder's `diagrams/`. Link each from the plan with an ordinary Markdown link under the heading it explains: `[Order model](diagrams/orders.puml)`, or `diagrams/orders.puml#Order` for one element (its PlantUML name, or a class's display name URL-encoded). The rationale goes in the plan, not in the diagram.

## Syntax

```plantuml
@startuml
title Orders
package sales {
  abstract class Party {
    name : String
  }
  class Customer {
    +email : String
    -points : Integer [0..1]
    +placeOrder(lines : Line[]) : Order
  }
}
interface Payable {
  total() : Money
}
enum OrderState {
  Open
  Paid
}
class Order {
  state : OrderState
}
class Line
class "Postal address" as Address
Customer --|> Party
Order ..|> Payable
Customer "1" -- "0..*" Order : places
Order "1" *-- "1..*" Line : lines
Order --> "0..1" Address : ships to
Order ..> OrderState
@enduml
```

- One diagram per file: a class diagram (`class`, `abstract class`, `interface`, `enum`), an entity diagram (`entity`) or an object diagram (`object`). Never mix kinds.
- Names are identities and unique across packages. Use `class "Display name" as Name` for names with spaces.
- Attributes `name : Type [0..1]`; operations `name(params) : Type`; visibility `+ - # ~`.
- Relations between declared elements, spaces around the arrow: `--` association, `-->` navigable, `--|>` inherits (classes from classes, interfaces from interfaces), `..|>` implements an interface, `o--` aggregation and `*--` composition (whole on the left), `..>` dependency. Quoted multiplicities at either end, label after `:`. Inheritance takes neither.
- Entities: the `*name : type <<PK>>` columns above one `--` line and all other columns below it (no `--` without a key), `<<FK>>` on foreign keys; crow's-foot relations `customer ||--o{ orders : customer_id` whose label lists the FK columns as named. Feet: `|o`/`o|` `0..1`, `||` `1`, `}o`/`o{` `0..*`, `}|`/`|{` `1..*`.
- Objects: `object "ada : Person" as ada {`, then slots such as `name = "Ada"` each on its own line, then `}`; links `e1 -- ada : learner` labelled with the relation's name.
- A body's `{` ends the declaration line and its `}` stands on a line of its own.

Rejected, with the reason in the error: arrow directions and lengths (`-up->`, `--->`), `left to right direction`, `[hidden]`, colours, `skinparam`, `<style>`, `!theme`, `hide`/`show`/`together`, notes, legends, headers, footers, stereotypes other than `<<PK>>`/`<<FK>>` (also in members, labels and titles), member modifiers such as `{static}` anywhere in a member, Creole or HTML formatting, the preprocessor (`!include`, `!define`), and every other diagram type. Atlas lays out and styles diagrams itself. Also rejected because PlantUML would misread them: a line ending in `\` (it joins the next line), a title of symbols only, a name with an emoji or another character beyond the Basic Multilingual Plane (use a display name), and an enum literal that starts and ends with `__` (a separator).

## `' atlas` lines

At the top of the file:

- `' atlas proposal <path>`: this file is a proposal of the diagram at `path` (relative to this file), never itself or a diagram whose baselines lead back to it.
- `' atlas scenario <path> expected valid` (or `invalid`): this object diagram exemplifies the class diagram at `path`.
- `' atlas capture {json}`, `' atlas fingerprint …` and `' atlas compares <path>`: written by `atlas capture`; never write or edit them.

Directly above an element, member or relation: `' atlas evidence {"file": "src/x.ts", "line": 12}` (where it is declared; a `url` starts with `http://` or `https://`) and `' atlas snippet {"language": "typescript", "code": "…"}` (at most twelve lines). Other `' atlas` words are errors; use plain `'` comments for remarks.

## Captures

Capture with a source configuration file (JSON, paths relative to it, usually kept in the repository it captures):

```json
{
  "formatVersion": 1,
  "adapter": "typescript",
  "identity": "shop",
  "projects": [{ "identity": "api", "path": "." }]
}
```

Adapters: `typescript` (`projects` with `path`, optional `tsconfig`), `java` (`projects` with `path` and `files`, optional `classpath`; needs a JDK 21 or newer), `sqlite` (`file`), `postgresql` (`connectionEnv`, `schemas`), `d1-local` (`config`, `database`).

```sh
atlas capture capture.json --work work-0012 --name before
atlas capture capture.json --work work-0012 --name after --compares before.puml
```

Without `--name` the file is `diagrams/<identity>-<date>.puml`; `--out <file>` writes elsewhere; an existing file needs `--force`. The command prints a JSON summary; exit 1 means the capture failed or was refused (the reason is on stderr). A capture is frozen: never edit it. At the start of implementing a plan that changes captured code or data, capture `before`; at the end capture `after --compares before.puml`.

## Proposals

Copy the capture to a new file, replace its `' atlas capture` and `' atlas fingerprint` lines with `' atlas proposal <capture file>`, then edit. Atlas compares by name, so keep the names of what stays; a rename shows as a removal and an addition. Keep the copied evidence lines; give a new class `' atlas evidence {"file": "src/new.ts"}` to say where it goes. For alternatives, write one proposal per option from the same capture and give each a `title`.

## Scenarios

Write an object diagram with `' atlas scenario ../model.puml expected valid` (or `invalid`) to check an example against a class diagram. Objects name their classes, slots must be attributes of those classes, links carry the relation's name. The check covers inherited classes and implemented interfaces, abstract classes and interfaces (an object needs a concrete class) and multiplicities at both ends of every relation; an example Atlas cannot fully assess is a warning.
