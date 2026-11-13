# Atlas diagrams

Atlas draws the diagrams that explain a plan. This glossary covers the diagram package (`packages/diagrams`) and [diagrams](docs/diagrams.md); the planning vocabulary lives in the planning contract the `atlas` skill installs.

## Language

**Diagram**:
A file in a work item, written in Atlas's subset of PlantUML: a class, entity or object diagram that Atlas renders with its own viewer.
_Avoid_: Model document, diagram script

**Subset**:
The PlantUML that Atlas accepts: class, entity and object diagrams without layout, styling, notes or the preprocessor. Anything outside it is an error at its line.
_Avoid_: Dialect, PlantUML profile

**Capture**:
A diagram Atlas generates from code (through the compiler) or from a database's catalog at a stated date, with its source, coverage and fingerprint in its header. Frozen once written.
_Avoid_: Snapshot, import

**Proposal**:
A diagram that starts as a copy of a capture (or another diagram) and is edited to show an intended change. Several proposals of one diagram are alternatives.
_Avoid_: Revision, draft model

**Scenario**:
An object diagram of example instances, assessed against the class diagram it names, with the outcome it is expected to have.
_Avoid_: Test case, walkthrough

**Family**:
A diagram and everything compared with it, directly or through another member: its proposals and later captures. The viewer lays a family out once, so its members keep their classes in the same places.
_Avoid_: Version set

**Identity**:
What a comparison matches by: an element's PlantUML name, a member's `Element.name`, a relation's kind, ends and label. A renamed element is a removal and an addition.
_Avoid_: ID, handle

**Evidence**:
Where an element, member or relation is declared, and a short excerpt of its source, written as `' atlas evidence` and `' atlas snippet` lines above it.
_Avoid_: Proof, source record

**Description**:
One short sentence of what an element or member is for, written as an `' atlas description` line above it. The viewer shows it as the element's tooltip; the rationale stays in the plan.
_Avoid_: Note, comment

**Coverage**:
Whether a capture read everything in its scope (`complete`) or left something out (`partial`), with the diagnostics that say what.
_Avoid_: Accuracy, validation

**Diagram scene**:
The positions, orthogonal routes and labels Atlas lays out to display a diagram.
_Avoid_: Semantic model, layout hints

**Change view**:
A proposal, or a capture compared with an earlier one, drawn with what it removes kept in place and every change marked.
_Avoid_: Diff, baseline view
