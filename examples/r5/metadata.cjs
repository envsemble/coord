const cfg = require("./model.cjs");
const settings = require("./views.cjs");
function createEvidence() {
  const primary = {
    ClientApplication: "R9",
    ClientSlot: "R2",
    SessionParticipant: "R2",
    SessionParticipation: "R2",
    ActiveClientSlot: "R2",
  };
  return {
    title: "R5Reloaded / Apex Season 3",
    version: cfg.version,
    status:
      "Public-source interpretation; native engine internals partially opaque",
    repositories: [
      { repo: "Mauler125/r5sdk", commit: cfg.sdk },
      { repo: "Mauler125/r5_flowstate", commit: cfg.scripts },
    ],
    sources: cfg.sources,
    constraints: cfg.constraints,
    unknowns: cfg.unknowns,
    elements: Object.fromEntries(
      cfg.classes.map(([name, stereotype, pkg, description, evidence]) => [
        `class-${name}`,
        {
          evidence,
          status: "inferred",
          ...(primary[name] ? { primarySource: primary[name] } : {}),
          rationale: description,
          questions:
            name === "GameSession"
              ? [
                  {
                    question: "What preserves a game session's identity?",
                    why: "The SDK declarations do not establish reconnect or match-boundary behavior.",
                    resolve:
                      "Inspect lifecycle callers and compare reconnect, map-change, and match-restart traces.",
                  },
                ]
              : name === "Snapshot"
                ? [
                    {
                      question:
                        "Does each snapshot represent a complete world state?",
                      why: "The declarations expose snapshot sending but leave its native contents opaque.",
                      resolve:
                        "Inspect authorized native implementation or documented replication behavior before tightening its counts.",
                    },
                  ]
                : [],
        },
      ]),
    ),
  };
}
function createViews(project) {
  const byId = new Map(project.elements.map((e) => [e.id, e]));
  const classPkg = new Map();
  for (const e of project.elements.filter((e) => e.type === "Package"))
    for (const id of e.contents) classPkg.set(id, e.id);
  return Object.entries(settings).map(([key, view]) => {
    const nodeIds = cfg.classes
      .filter(
        ([name, stereo, pkg]) =>
          view.packages.includes(pkg) || view.includeNames.includes(name),
      )
      .map(([name]) => `class-${name}`);
    const visible = new Set(nodeIds);
    return {
      key,
      label: view.label,
      title: view.title,
      nodeIds,
      focusIds: view.focusNames.map((name) => `class-${name}`),
      columns: view.columns.map((col) => col.map((name) => `class-${name}`)),
      edgeIds: project.elements
        .filter((e) =>
          e.type === "Generalization"
            ? visible.has(e.specific) && visible.has(e.general)
            : e.type === "BinaryRelation" &&
              e.properties.every((id) =>
                visible.has(byId.get(id).propertyType),
              ) &&
              ["package-shared", `package-${key}`].includes(classPkg.get(e.id)),
        )
        .map((e) => e.id),
    };
  });
}
module.exports = { createEvidence, createViews };
