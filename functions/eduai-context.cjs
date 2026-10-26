const rolePolicies = require("./eduai-role-policies.json");

const PROFILE_PERIODS = [
  { key: "bosy", label: "BOSY" },
  { key: "mosy", label: "MOSY" },
  { key: "eosy", label: "EOSY" },
];
const CRLA_CATEGORIES = ["Grade Ready", "Transitioning", "Developing", "High Emerging", "Low Emerging"];
const PHIL_IRI_CATEGORIES = ["Independent", "Instructional", "Frustration", "Non reader"];
const RMA_CATEGORIES = ["Not Proficient", "Low Proficient", "Nearly-Proficient", "Proficient", "High-Proficient"];
const NUTRITION_CATEGORIES = ["Normal", "Wasted", "Severely Wasted", "Overweight", "Obese"];

function normalizeProfileCategory(value) {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/[^a-z]/g, "");
  return normalized === "highlyproficient" ? "highproficient" : normalized;
}

function normalizeProfileGrade(value) {
  const grade = String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (["k", "kg", "kinder", "kindergarten"].includes(grade)) return "kinder";
  const match = grade.match(/^(?:grade\s*)?(\d+)$/);
  return match ? `grade${Number(match[1])}` : grade.replace(/[^a-z0-9]/g, "");
}

function numericGradeSort(left, right) {
  return left.localeCompare(right, undefined, { numeric: true });
}

function profileGraph(title, records, fields, categories, grades) {
  const categoryMap = new Map(categories.map((label) => [normalizeProfileCategory(label), label]));
  const counts = new Map();
  records.forEach((record) => {
    const grade = grades.find((value) => normalizeProfileGrade(value) === normalizeProfileGrade(record.gradeLevel));
    if (!grade) return;
    PROFILE_PERIODS.forEach(({ key }, periodIndex) => {
      const category = categoryMap.get(normalizeProfileCategory(record[fields[periodIndex]]));
      if (!category) return;
      const valueKey = `${grade}\u0000${key}\u0000${category}`;
      counts.set(valueKey, (counts.get(valueKey) || 0) + 1);
    });
  });
  const points = [];
  grades.forEach((grade) => {
    PROFILE_PERIODS.forEach(({ key, label: periodLabel }) => {
      const total = categories.reduce((sum, category) =>
        sum + (counts.get(`${grade}\u0000${key}\u0000${category}`) || 0), 0);
      categories.forEach((label) => {
        const count = counts.get(`${grade}\u0000${key}\u0000${label}`) || 0;
        points.push({
          label: `${grade} · ${periodLabel} · ${label}`,
          count,
          percent: total ? Math.round((count / total) * 1000) / 10 : 0,
        });
      });
    });
  });
  return {
    title,
    description: "Aggregated learner counts and shares by grade, assessment period, and chart category. No individual assessment records are included.",
    points,
  };
}

function emptyNutritionCounts() {
  return Object.fromEntries(NUTRITION_CATEGORIES.map((label) => [label, 0]));
}

function findNutritionStatus(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return NUTRITION_CATEGORIES.find((label) => label.toLowerCase() === normalized);
}

function nutritionPercentages(counts, total) {
  return Object.fromEntries(NUTRITION_CATEGORIES.map((label) => [
    label,
    total ? counts[label] * 100 / total : 0,
  ]));
}

function buildNutritionGraphData(records) {
  const periods = [
    { key: "bosy", label: "Baseline" },
    { key: "mosy", label: "Midline" },
    { key: "eosy", label: "Endline" },
  ].map(({ key, label }) => {
    const counts = emptyNutritionCounts();
    records.forEach((record) => {
      const status = findNutritionStatus(record[`${key}NutritionalStatus`]);
      if (status) counts[status] += 1;
    });
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    return { label, values: nutritionPercentages(counts, total), counts };
  });

  const latestStatuses = emptyNutritionCounts();
  const genderCounts = new Map([
    ["Male", emptyNutritionCounts()],
    ["Female", emptyNutritionCounts()],
  ]);
  records.forEach((record) => {
    const status = findNutritionStatus(record.eosyNutritionalStatus)
      || findNutritionStatus(record.mosyNutritionalStatus)
      || findNutritionStatus(record.bosyNutritionalStatus);
    if (!status) return;
    latestStatuses[status] += 1;
    const counts = genderCounts.get(record.gender ?? "");
    if (counts) counts[status] += 1;
  });
  const latestByGender = ["Male", "Female", "Total"].map((label) => {
    const counts = label === "Total" ? latestStatuses : genderCounts.get(label) || emptyNutritionCounts();
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    return { label, values: nutritionPercentages(counts, total), counts };
  });
  return { periods, latestStatuses, latestByGender };
}

function buildEduAiGraphs(learners) {
  const grades = [...new Set(learners
    .map((learner) => String(learner.gradeLevel || "").trim())
    .filter(Boolean))]
    .sort(numericGradeSort);
  const enrollmentByGrade = {
    title: "Dashboard and Reports: enrollment by grade",
    description: "Active learner counts by grade level.",
    points: grades.map((grade) => ({
      label: grade,
      count: learners.filter((learner) => String(learner.gradeLevel || "").trim() === grade).length,
    })),
  };
  const programEntries = [
    ["Not Tagged", (learner) => !learner.is4Ps && !learner.isIP && !learner.isSNED && !learner.isARAL && !learner.isMuslim],
    ["4Ps Beneficiaries", (learner) => learner.is4Ps === true],
    ["IP Learners", (learner) => learner.isIP === true],
    ["SNED Learners", (learner) => learner.isSNED === true],
    ["ARAL Tagged", (learner) => learner.isARAL === true],
    ["Muslim Learners", (learner) => learner.isMuslim === true],
  ];
  const programPoints = programEntries.map(([label, predicate]) => ({
    label,
    count: learners.filter(predicate).length,
  }));
  const segmentTotal = programPoints.reduce((sum, point) => sum + point.count, 0) || 1;
  const programMix = {
    title: "Dashboard: program-tag distribution",
    description: "Counts and shares shown in the Dashboard and Reports donut. Program tags can overlap; percentages are shares of all displayed segments, not shares of total enrollment.",
    points: programPoints.map((point) => ({
      ...point,
      percent: Math.round((point.count / segmentTotal) * 1000) / 10,
    })),
  };
  const coverage = (title, fields) => ({
    title,
    description: "Number of learners with at least one chart assessment value, by grade.",
    points: grades.map((grade) => ({
      label: grade,
      count: learners.filter((learner) =>
        String(learner.gradeLevel || "").trim() === grade && fields.some((field) => Boolean(learner[field])),
      ).length,
    })),
  });
  const readingCrla = learners.filter((learner) => ["grade1", "grade2", "grade3"].includes(normalizeProfileGrade(learner.gradeLevel)));
  const readingPhilIri = learners.filter((learner) => ["grade4", "grade5", "grade6"].includes(normalizeProfileGrade(learner.gradeLevel)));
  const graphList = [
    enrollmentByGrade,
    programMix,
    coverage("Reports: reading-profile coverage by grade", ["bosyCRLA", "mosyCRLA", "eosyCRLA", "bosyPhilIRI", "mosyPhilIRI", "eosyPhilIRI"]),
    coverage("Reports: math-profile coverage by grade", ["bosyRMA", "mosyRMA", "eosyRMA"]),
    coverage("Reports: nutritional-record coverage by grade", ["bosyNutritionalStatus", "mosyNutritionalStatus", "eosyNutritionalStatus"]),
    profileGraph("Reading Profile: CRLA distribution", readingCrla, ["bosyCRLA", "mosyCRLA", "eosyCRLA"], CRLA_CATEGORIES,
      grades.filter((grade) => ["grade1", "grade2", "grade3"].includes(normalizeProfileGrade(grade)))),
    profileGraph("Reading Profile: Phil-IRI distribution", readingPhilIri, ["bosyPhilIRI", "mosyPhilIRI", "eosyPhilIRI"], PHIL_IRI_CATEGORIES,
      grades.filter((grade) => ["grade4", "grade5", "grade6"].includes(normalizeProfileGrade(grade)))),
    profileGraph("Math Profile: RMA distribution", learners, ["bosyRMA", "mosyRMA", "eosyRMA"], RMA_CATEGORIES, grades),
  ];
  const nutrition = buildNutritionGraphData(learners);
  graphList.push({
    title: "Nutritional Status: distribution by assessment period",
    description: "Aggregated counts and percentages by nutrition-status category. No individual height, weight, or learner record is included.",
    points: nutrition.periods.flatMap((period) => NUTRITION_CATEGORIES.map((label) => ({
      label: `${period.label} · ${label}`,
      count: period.counts[label],
      percent: Math.round(period.values[label] * 10) / 10,
    }))),
  }, {
    title: "Nutritional Status: latest status mix",
    description: "One latest available recorded status per learner; endline is preferred, then midline, then baseline.",
    points: NUTRITION_CATEGORIES.map((label) => ({ label, count: nutrition.latestStatuses[label] })),
  }, {
    title: "Nutritional Status: latest status by sex",
    description: "Aggregated percentages and assessed counts for each status by sex and overall.",
    points: nutrition.latestByGender.flatMap((group) => NUTRITION_CATEGORIES.map((label) => ({
      label: `${group.label} · ${label}`,
      count: group.counts[label],
      percent: Math.round(group.values[label] * 10) / 10,
    }))),
  });
  return graphList;
}

function learnerDisplayName(learner) {
  const storedName = typeof learner.name === "string" ? learner.name.trim() : "";
  if (storedName) return storedName.slice(0, 120);
  return [learner.firstName, learner.middleName, learner.lastName, learner.suffix]
    .filter((part) => typeof part === "string" && part.trim())
    .map((part) => part.trim())
    .join(" ")
    .slice(0, 120);
}

function buildEduAiContext(role, schoolYear, learners) {
  const byGrade = new Map();
  const byGradeAndSection = new Map();
  const genderCounts = { male: 0, female: 0, otherOrUnspecified: 0 };
  const programCounts = { fourPs: 0, indigenousPeoples: 0, sned: 0, aral: 0, muslim: 0 };
  const learnerNames = [];
  learners.forEach((learner) => {
    const name = learnerDisplayName(learner);
    if (name) learnerNames.push(name);
    const gradeLevel = typeof learner.gradeLevel === "string" ? learner.gradeLevel.trim() : "";
    const section = typeof learner.section === "string" ? learner.section.trim() : "";
    if (gradeLevel) byGrade.set(gradeLevel, (byGrade.get(gradeLevel) || 0) + 1);
    if (gradeLevel && section) {
      const key = `${gradeLevel}\u0000${section}`;
      const group = byGradeAndSection.get(key) || { gradeLevel, section, count: 0 };
      group.count += 1;
      byGradeAndSection.set(key, group);
    }
    const gender = typeof learner.gender === "string" ? learner.gender.trim().toLowerCase() : "";
    if (gender === "male") genderCounts.male += 1;
    else if (gender === "female") genderCounts.female += 1;
    else genderCounts.otherOrUnspecified += 1;
    if (learner.is4Ps === true) programCounts.fourPs += 1;
    if (learner.isIP === true) programCounts.indigenousPeoples += 1;
    if (learner.isSNED === true) programCounts.sned += 1;
    if (learner.isARAL === true) programCounts.aral += 1;
    if (learner.isMuslim === true) programCounts.muslim += 1;
  });
  return {
    role,
    schoolYear,
    summary: {
      totalLearners: learners.length,
      byGradeLevel: [...byGrade.entries()]
        .map(([gradeLevel, count]) => ({ gradeLevel, count }))
        .sort((left, right) => numericGradeSort(left.gradeLevel, right.gradeLevel)),
      byGradeAndSection: [...byGradeAndSection.values()]
        .sort((left, right) => numericGradeSort(left.gradeLevel, right.gradeLevel)
          || numericGradeSort(left.section, right.section)),
      genderCounts,
      programCounts,
    },
    learnerNames: learnerNames.slice(0, 150),
    learnerNameCount: learnerNames.length,
    graphs: buildEduAiGraphs(learners),
  };
}

function normalizeSchoolYear(value) {
  const text = String(value || "").trim().replace(/[–—]/g, "-").replace(/\s+/g, "");
  const match = text.match(/^(\d{4})[-/]?(\d{4})$/);
  return match ? `${match[1]}-${match[2]}` : "";
}

function normalizeTeacherGrade(value) {
  const text = String(value || "").trim();
  const normalized = text.toLowerCase().replace(/\s+/g, " ");
  if (["kinder", "kindergarten", "kg", "0"].includes(normalized)) return "Kinder";
  const match = normalized.match(/^grade\s*(\d+)$/) || normalized.match(/^(\d+)$/);
  return match ? `Grade ${match[1]}` : text;
}

function teacherAssignmentsForYear(profile, schoolYear) {
  const candidates = Array.isArray(profile.teacherAssignments) && profile.teacherAssignments.length
    ? profile.teacherAssignments
    : profile.teacherAssignment ? [profile.teacherAssignment] : [];
  const seen = new Set();
  return candidates.flatMap((assignment) => {
    const year = normalizeSchoolYear(assignment?.schoolYear || profile.schoolYear);
    const gradeLevel = normalizeTeacherGrade(assignment?.gradeLevel || assignment?.gradeKey || profile.gradeLevel);
    const section = String(assignment?.section || assignment?.sectionKey || profile.section || "").trim();
    const key = `${year}|${gradeLevel}|${section}`.toLowerCase();
    if (year !== schoolYear || !gradeLevel || !section || seen.has(key)) return [];
    seen.add(key);
    return [{ gradeLevel, section }];
  });
}

function isActiveLearner(learner) {
  const enrollmentStatus = String(learner.enrollmentStatus || "ACTIVE").toUpperCase().replace(/[ -]+/g, "_");
  const eosyStatus = String(learner.eosyStatus || "").toLowerCase().replace(/[_-]+/g, " ");
  return enrollmentStatus !== "TRANSFERRED_OUT" && enrollmentStatus !== "DROPPED_OUT"
    && eosyStatus !== "dropped out" && !learner.transferOut;
}

async function loadTrustedEduAiContext(db, role, profile) {
  if (!Object.hasOwn(rolePolicies, role)) throw new Error('Your account role is not allowed to use EduAI.');
  let toggles;
  try { toggles = (await db.collection('settings').doc('toggles').get()).data() || {}; }
  catch { /* Optional settings remain explicitly unverified when not readable. */ }
  const configuredYearSnapshot = await db.collection("settings").doc("currentSchoolYear").get();
  let schoolYear = normalizeSchoolYear(configuredYearSnapshot.data()?.value);
  if (!schoolYear) {
    const yearsSnapshot = await db.collection("schoolYears").get();
    const years = yearsSnapshot.docs.map((document) => ({
      schoolYear: normalizeSchoolYear(document.id),
      isCurrent: document.data()?.isCurrent === true,
    })).filter(({ schoolYear: year }) => year).sort((left, right) => {
      const number = (value) => Number(value.replace("-", ""));
      return number(right.schoolYear) - number(left.schoolYear);
    });
    schoolYear = years.find((year) => year.isCurrent)?.schoolYear || years[0]?.schoolYear || "";
  }
  const withAccess = learners => ({
    ...buildEduAiContext(role, schoolYear, learners),
    applicationAccess: buildEduAiApplicationAccess(role, profile, schoolYear, toggles),
  });
  if (!schoolYear) return withAccess([]);
  const collection = db.collection("schoolYears").doc(schoolYear).collection("learners");
  let documents;
  if (role === "Teacher") {
    const assignments = teacherAssignmentsForYear(profile, schoolYear);
    if (!assignments.length) return withAccess([]);
    const snapshots = await Promise.all(assignments.map(({ gradeLevel, section }) =>
      collection.where("gradeLevel", "==", gradeLevel).where("section", "==", section).get()));
    const unique = new Map();
    snapshots.forEach((snapshot) => snapshot.docs.forEach((document) => unique.set(document.id, document)));
    documents = [...unique.values()];
  } else {
    const snapshot = await collection.get();
    documents = snapshot.docs;
  }
  const learners = documents
    .map((document) => ({ learnerId: document.id, ...document.data() }))
    .filter(isActiveLearner);
  return withAccess(learners);
}

function buildEduAiApplicationAccess(role, profile, schoolYear, toggles) {
  if (!Object.hasOwn(rolePolicies, role)) throw new Error('Your account role is not allowed to use EduAI.');
  const verified = Boolean(toggles && typeof toggles === 'object' && !Array.isArray(toggles));
  const flag = (key, fallback) => !verified ? null : toggles[key] === undefined ? fallback : typeof toggles[key] === 'boolean' ? toggles[key] : null;
  const teacherPromotionEnabled = flag('canPromoteStudents', false);
  const assignments = role === 'Teacher' ? teacherAssignmentsForYear(profile || {}, schoolYear) : [];
  return {
    capturedAt: new Date().toISOString(),
    dataScope: rolePolicies[role].dataScope,
    capabilities: { ...rolePolicies[role].capabilities, progression: role === 'Teacher' ? teacherPromotionEnabled : true },
    assignedClasses: assignments.slice(0, 50).map(assignment => ({ gradeLevel: assignment.gradeLevel.slice(0, 80), section: assignment.section.slice(0, 80) })),
    assignmentCount: assignments.length,
    assignmentsTruncated: assignments.length > 50,
    schoolSettings: {
      status: verified ? 'verified' : 'unavailable',
      teacherPromotionEnabled,
      parentPortalEnabled: flag('canParentAccess', true),
      trashRetention: verified && (toggles.trashConfg === undefined || ['7', '15', '30', 'never'].includes(String(toggles.trashConfg))) ? String(toggles.trashConfg ?? '30') : null,
      finalGradeRounding: verified && (toggles.roundType === undefined || ['nearest_integer', 'none'].includes(toggles.roundType)) ? (toggles.roundType ?? 'nearest_integer') : null,
    },
  };
}

module.exports = {
  buildEduAiContext,
  buildEduAiApplicationAccess,
  loadTrustedEduAiContext,
};
