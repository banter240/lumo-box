import { describe, it, expect } from "vitest";
import {
  accountUrlForUpstream,
  buildAccountLoginUrl,
  handoffPath,
} from "../../src/api/routes/webapp-signin.js";
import { sanitizeCookie } from "../../src/api/routes/webapp.js";

describe("sanitizeCookie", () => {
  it("drops Domain and Secure attributes for our origin", () => {
    expect(
      sanitizeCookie("p=a; Domain=.proton.me; Path=/; Secure; HttpOnly"),
    ).toBe("p=a; Path=/; HttpOnly");
  });

  it("leaves plain cookies untouched", () => {
    expect(sanitizeCookie("p=a; Path=/; SameSite=Lax")).toBe(
      "p=a; Path=/; SameSite=Lax",
    );
  });
});

describe("accountUrlForUpstream", () => {
  it("maps the production host", () => {
    expect(accountUrlForUpstream("https://lumo.proton.me")).toBe(
      "https://account.proton.me",
    );
  });

  it("maps QA environments", () => {
    expect(accountUrlForUpstream("https://lumo.brandt.proton.black")).toBe(
      "https://account.brandt.proton.black",
    );
  });

  it("rejects a non-lumo host", () => {
    expect(() => accountUrlForUpstream("https://example.com")).toThrow();
  });
});

describe("buildAccountLoginUrl", () => {
  it("carries user code, key, and child client, without a redirectUrl", () => {
    const key = Buffer.alloc(32, 7);
    const url = buildAccountLoginUrl(
      "https://account.proton.me",
      "USERCODE",
      key,
      "web-lumo",
    );
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/desktop/login");
    expect(parsed.searchParams.get("app")).toBe("lumo");
    expect(parsed.searchParams.get("pv")).toBe("3");
    expect(parsed.searchParams.get("redirectUrl")).toBeNull();
    const payload = decodeURIComponent(parsed.hash.slice("#payload=".length));
    const parts = payload.split(":");
    expect(parts[0]).toBe("0");
    expect(parts[1]).toBe("USERCODE");
    expect(Buffer.from(parts[2], "base64").equals(key)).toBe(true);
    expect(parts[3]).toBe("web-lumo");
  });

  it("rejects a client ID without a product half", () => {
    expect(() =>
      buildAccountLoginUrl(
        "https://account.proton.me",
        "CODE",
        Buffer.alloc(32),
        "lumo",
      ),
    ).toThrow();
  });
});

describe("handoffPath", () => {
  it("targets /login with unpadded base64url key", () => {
    const path = handoffPath("sel-ector", Buffer.from([0xff, 0xfe]));
    expect(path).toBe(
      "/login#selector=sel-ector&sk=__4&pv=3&p=1&returnUrl=%2F",
    );
  });
});
