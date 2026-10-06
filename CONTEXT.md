# OntoUML Atlas

OntoUML Atlas connects an agent's evidence-backed domain model to a read-only viewer and learning experience.

## Language

**Modeling job**:
A user's modeling question together with the source projects to inspect and the resulting model artifacts.
_Avoid_: Diagram task, AI session

**Source project**:
A codebase or other source collection inspected as evidence for a domain model; several source projects may inform one model.
_Avoid_: OntoUML project, diagram

**OntoUML project**:
The standard exchange object containing a domain model's identified elements and packages.
_Avoid_: Source project, custom diagram format

**Model evidence**:
Source observations, interpretation rationale, and unresolved questions attached to model identities.
_Avoid_: Proof, recovered ontology

**View**:
A chosen subset of model identities presented together without changing their meanings.
_Avoid_: Separate ontology, model copy

**Diagram scene**:
The positions, orthogonal routes, and labels used to display a view.
_Avoid_: Semantic model, diagram script

**Validation finding**:
A reported violation of an implemented structural or ontology rule, with its affected identity and explanation.
_Avoid_: Domain fact, proof of correctness

**Learning guidance**:
A model-specific explanation or question that helps a reader assess an interpretation and its evidence.
_Avoid_: Automatic answer, model repair
