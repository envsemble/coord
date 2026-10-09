const { renderSVG } = require("../layout/renderSVG.cjs");
const {
  assessScenario,
  explainModel,
  LIMITATIONS,
} = require("./scenarios.cjs");
function prepareReport(document, model, views) {
  return {
    title: model.title,
    profile: document?.profile || "ontouml",
    state: document?.state || "authored",
    revision: document?.revision || null,
    scope:
      document?.reporting?.scope ||
      "Scope follows the included model, selected views and retained source evidence.",
    author: document?.reporting?.author || null,
    imported: !!document?.imported,
    snapshots: document?.snapshots.map(({ model: omitted, ...s }) => s) || [],
    baselineId: document?.baselineId || null,
    context: document?.context || { records: [], links: [] },
    walkthroughs: document?.learning?.walkthroughs || [],
    scenarios: (document?.learning?.scenarios || []).map((scenario) => ({
      ...scenario,
      result: assessScenario(model, scenario),
    })),
    explanations: explainModel(model),
    limitations: [
      ...LIMITATIONS,
      ...model.validation.limitations,
      ...(model.unknowns || []),
    ],
    diagrams: views.map((view) => ({
      key: view.key,
      title: view.title,
      svg: renderSVG(view.diagramFields, { theme: "light" }),
    })),
  };
}
module.exports = { prepareReport };
