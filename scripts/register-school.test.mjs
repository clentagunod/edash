import { describe, expect, it } from "vitest";
import { buildSchoolDocument, validateRegistration } from "./register-school.mjs";

const validRegistration = {
  id: "sanroque-es",
  name: "San Roque Elementary School",
  nickname: "San Roque ES",
  tagline: "Everyone is an Achiever",
  colorGradientTag: "#50A61E",
  logoUrl: "/assets/school-logo.png",
  videoUrl: "",
  schoolInfo: {
    region: "IX",
    divisionOffice: "Schools Division Office of Davao de Oro",
    district: "New Bataan",
  },
  schoolHead: { name: "", position: "", email: "", phoneNumber: "" },
  firebaseConfig: {
    apiKey: "public-api-key",
    authDomain: "san-roquees.firebaseapp.com",
    projectId: "san-roquees",
    storageBucket: "san-roquees.firebasestorage.app",
    messagingSenderId: "123456789",
    appId: "1:123456789:web:example",
  },
  auditLogApiUrl: "",
  feedbackApiUrl: "",
};

describe("school registration schema", () => {
  it("preserves colorGradientTag in the document written to the central registry", () => {
    expect(validateRegistration({ ...validRegistration, colorGradientTag: "#50a61e" }).colorGradientTag)
      .toBe("#50a61e");
  });

  it("keeps colorGradientTag optional and preserves its supplied value", () => {
    const { colorGradientTag, ...withoutColorGradientTag } = validRegistration;
    expect(validateRegistration(withoutColorGradientTag)).not.toHaveProperty("colorGradientTag");
    expect(validateRegistration({ ...validRegistration, colorGradientTag: "#50a61e" }).colorGradientTag)
      .toBe("#50a61e");
  });

  it("keeps canUseEduAI optional, preserves booleans, and rejects non-boolean values", () => {
    expect(validateRegistration({ ...validRegistration, canUseEduAI: true }).canUseEduAI).toBe(true);
    expect(validateRegistration({ ...validRegistration, canUseEduAI: false }).canUseEduAI).toBe(false);
    expect(() => validateRegistration({ ...validRegistration, canUseEduAI: "true" }))
      .toThrow("canUseEduAI must be a boolean");
  });

  it.each(["", "green", "#50A61", "#50A61E00"])(
    "rejects an invalid colorGradientTag: %s",
    (colorGradientTag) => {
      expect(() => validateRegistration({ ...validRegistration, colorGradientTag }))
        .toThrow("colorGradientTag must be a six-digit hexadecimal color");
    },
  );

  it("preserves additional top-level and nested fields from the uploaded JSON", () => {
    const registration = validateRegistration({
      ...validRegistration,
      brand: { accent: "#123456" },
      schoolInfo: { ...validRegistration.schoolInfo, municipality: "New Bataan" },
      schoolHead: { ...validRegistration.schoolHead, officeHours: { start: "08:00" } },
      firebaseConfig: { ...validRegistration.firebaseConfig, measurementId: "G-EXAMPLE" },
    });

    expect(registration.brand).toEqual({ accent: "#123456" });
    expect(registration.schoolInfo.municipality).toBe("New Bataan");
    expect(registration.schoolHead.officeHours).toEqual({ start: "08:00" });
    expect(registration.firebaseConfig.measurementId).toBe("G-EXAMPLE");
  });

  it("updates the same document in place and retains fields omitted from the new JSON", () => {
    const serverTimestamp = { generated: true };
    const registration = validateRegistration({
      ...validRegistration,
      schoolHead: { ...validRegistration.schoolHead, name: "Updated Principal" },
      firebaseConfig: {
        ...validRegistration.firebaseConfig,
        measurementId: "G-UPDATED",
      },
    });
    const existingDocument = {
      legacySchemaField: { retained: true },
      schoolHead: {
        name: "Previous Principal",
        customField: "keep",
        updatedAt: "old timestamp",
      },
      firebaseConfig: { measurementId: "G-OLD", existingExtension: "keep" },
    };
    const document = buildSchoolDocument(registration, existingDocument, serverTimestamp);

    expect(document.legacySchemaField).toEqual({ retained: true });
    expect(document.schoolHead.name).toBe("Updated Principal");
    expect(document.schoolHead.customField).toBe("keep");
    expect(document.schoolHead.updatedAt).toBe(serverTimestamp);
    expect(document.firebaseConfig.measurementId).toBe("G-UPDATED");
    expect(document.firebaseConfig.existingExtension).toBe("keep");
    expect(document.updatedAt).toBe(serverTimestamp);
    expect(document.enabled).toBe(true);
  });

  it("preserves all optional fields when they are omitted from the update JSON", () => {
    const registrationWithoutOptionalFields = Object.fromEntries(
      Object.entries(validRegistration).filter(([field]) =>
        !["schoolInfo", "schoolHead", "auditLogApiUrl", "feedbackApiUrl"].includes(field),
      ),
    );
    const registration = validateRegistration(registrationWithoutOptionalFields);
    const existingDocument = {
      schoolInfo: { region: "IX" },
      schoolHead: { name: "Current Principal" },
      auditLogApiUrl: "https://example.test/audit",
      feedbackApiUrl: "https://example.test/feedback",
    };
    const document = buildSchoolDocument(registration, existingDocument, "server-time");

    expect(document.schoolInfo).toEqual(existingDocument.schoolInfo);
    expect(document.schoolHead).toEqual(existingDocument.schoolHead);
    expect(document.auditLogApiUrl).toBe(existingDocument.auditLogApiUrl);
    expect(document.feedbackApiUrl).toBe(existingDocument.feedbackApiUrl);
  });

  it("replaces array fields rather than merging their elements", () => {
    const registration = validateRegistration({
      ...validRegistration,
      customTags: ["new"],
    });
    const document = buildSchoolDocument(
      registration,
      { customTags: ["old", "retained?"] },
      "server-time",
    );

    expect(document.customTags).toEqual(["new"]);
  });
});
