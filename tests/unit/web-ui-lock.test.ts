import { describe, it, expect } from "vitest";
import { htmlPage } from "../../src/api/web-ui.js";

describe("htmlPage local lock-button suppression", () => {
  const page = (localUi: boolean) =>
    htmlPage({
      title: "Test · lumo-tamer",
      body: "<p>body</p>",
      page: "config",
      localUi,
    });

  it("omits the lock button and its binding for local requests", () => {
    const html = page(true);
    expect(html).not.toContain("uiLockBtn");
    expect(html).not.toContain("ui-logout");
  });

  it("renders the lock button and its binding for remote requests", () => {
    const html = page(false);
    expect(html).toContain("uiLockBtn");
    expect(html).toContain("/ui-logout");
  });
});
