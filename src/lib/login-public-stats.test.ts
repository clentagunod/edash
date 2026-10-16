import { beforeEach, describe, expect, it } from "vitest";
import { clearLoginPublicStats, renderLoginPublicStats } from "./login-public-stats";

describe("login public statistics", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <strong id="loginLearnerCount"></strong>
      <strong id="loginProgramCount"></strong>
      <strong id="loginMaleCount"></strong>
      <strong id="loginFemaleCount"></strong>
    `;
  });

  it("renders total learners, programs tracked, male, and female public counts", () => {
    renderLoginPublicStats({
      totalLearners: 1475,
      programsTracked: 4,
      maleCount: 732,
      femaleCount: 743,
    });

    expect(document.getElementById("loginLearnerCount")?.textContent).toBe("1,475");
    expect(document.getElementById("loginProgramCount")?.textContent).toBe("4");
    expect(document.getElementById("loginMaleCount")?.textContent).toBe("732");
    expect(document.getElementById("loginFemaleCount")?.textContent).toBe("743");
  });

  it("clears the displayed counts when public statistics cannot be loaded", () => {
    renderLoginPublicStats({ totalLearners: 8, programsTracked: 2, maleCount: 4, femaleCount: 4 });
    clearLoginPublicStats();

    expect([...document.querySelectorAll("strong")].map((element) => element.textContent))
      .toEqual(["—", "—", "—", "—"]);
  });
});
