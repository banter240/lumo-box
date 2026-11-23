import { describe, it, expect } from "vitest";
import { htmlPage } from "../../src/api/web-ui.js";

describe("htmlPage local lock-button suppression", () => {
  const page = (localUi: boolean) =>
    htmlPage({
      title: "Test · lumo-box",
      body: "<p>body</p>",
      page: "config",
      localUi,
    });

  it("omits the lock action for local requests", () => {
    const html = page(true);
    expect(html).toMatch(/data-actions="(?![^"]*lock)/);
  });

  it("renders the lock action for remote requests", () => {
    const html = page(false);
    expect(html).toMatch(/data-actions="[^"]*lock/);
  });
});
