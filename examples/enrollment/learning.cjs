const { createEnrollmentModel } = require("./model.cjs");
const { createDocument } = require("../../lib/index.cjs");
function createEnrollmentDocument() {
  const input = createEnrollmentModel();
  const instances = [
    { id: "registration-1", classIds: ["active", "undergraduate"] },
    { id: "student-1", classIds: ["person"] },
    { id: "university-1", classIds: ["institution"] },
  ];
  const links = [
    {
      relationId: "mediates-person",
      sourceId: "registration-1",
      targetId: "student-1",
    },
    {
      relationId: "mediates-institution",
      sourceId: "registration-1",
      targetId: "university-1",
    },
  ];
  return createDocument({
    id: "enrollment-learning",
    title: "Enrollment · a guided model",
    project: input.project,
    createdAt: "2026-10-08T00:00:00.000Z",
    views: [
      ...input.views,
      {
        key: "participants",
        title: "Enrollment and its participants",
        nodeIds: ["enrollment", "person", "institution"],
        label: "Participants",
      },
    ],
    reporting: {
      scope:
        "Authored teaching example: enrollment state, degree level and mandatory participants. The individuals are fictional, not database rows.",
    },
    context: {
      records: [
        {
          id: "enrollment-definition",
          kind: "glossary",
          title: "Enrollment",
          text: "A relation instance connecting a person with an institution. State and degree classify that same enrollment.",
        },
        {
          id: "phase-question",
          kind: "plan",
          title: "State transition question",
          text: "Can one enrollment be active and suspended simultaneously? This example makes those states exclusive; temporal transition behavior needs a separate assessment.",
        },
      ],
      links: [
        { elementId: "enrollment", recordId: "enrollment-definition" },
        { elementId: "enrollment-state", recordId: "phase-question" },
      ],
    },
    evidence: {
      elements: {
        enrollment: {
          rationale: "An enrollment mediates a person and an institution.",
          questions: [
            {
              question: "What event suspends an enrollment?",
              why: "A static phase partition does not specify transitions.",
              resolve: "Agree on the transition rules in the linked plan.",
            },
          ],
        },
      },
    },
    learning: {
      walkthroughs: [
        {
          id: "enrollment-tour",
          title: "Read an enrollment",
          contextIds: ["enrollment-definition", "phase-question"],
          steps: [
            {
              text: "Begin with the enrollment and its two mandatory participants. Read the count beside each participant as the number for one enrollment.",
              viewKey: "participants",
              elementIds: [
                "enrollment",
                "mediates-person",
                "mediates-institution",
              ],
            },
            {
              text: "The same enrollment has exactly one state and one degree level. Shared inheritance trunks express two independently named sets.",
              viewKey: "inheritance",
              elementIds: ["enrollment-state", "degree-level"],
            },
          ],
        },
      ],
      scenarios: [
        {
          id: "valid-enrollment",
          title: "One active undergraduate enrollment",
          expected: "valid",
          description:
            "The example has one participant of each required type and exactly one membership in each partition.",
          contextIds: ["enrollment-definition"],
          instances,
          links,
        },
        {
          id: "invalid-overlap",
          title: "Active and suspended together",
          expected: "invalid",
          contextIds: ["phase-question"],
          instances: [
            {
              ...instances[0],
              classIds: ["active", "suspended", "undergraduate"],
            },
            ...instances.slice(1),
          ],
          links,
        },
        {
          id: "invalid-unclassified",
          title: "Enrollment without a state or degree",
          expected: "invalid",
          instances: [
            { ...instances[0], classIds: ["enrollment"] },
            ...instances.slice(1),
          ],
          links,
        },
        {
          id: "invalid-participation",
          title: "Enrollment without its institution",
          expected: "invalid",
          instances,
          links: links.slice(0, 1),
        },
      ],
    },
  });
}
module.exports = { createEnrollmentDocument };
