import { assertEquals } from "@std/assert";
import { beforeEach, describe, it } from "@std/testing/bdd";
import { Github } from "./api_client.ts";

describe(Github.name, () => {
  describe("Set token at constructor", () => {
    beforeEach(() => {
      // reset env
      Deno.env.delete("GITHUB_TOKEN");
    });

    it("Set token by options.token", () => {
      const github = new Github({ token: "token", _workaroundDenoTest: true });
      assertEquals(github.token, "token");
    });

    it("Set token by GITHUB_TOKEN env", () => {
      Deno.env.set("GITHUB_TOKEN", "foo");
      const github = new Github({ _workaroundDenoTest: true });
      assertEquals(github.token, "foo");
    });

    it("Set undefined to token by default", () => {
      const github = new Github({ _workaroundDenoTest: true });
      assertEquals(github.token, undefined);
    });
  });

  describe("Set host at constructor", () => {
    beforeEach(() => {
      // reset env
      Deno.env.delete("GITHUB_API_URL");
      clearInterval();
    });

    it("Set baseUrl by options.host with full URL", () => {
      const github = new Github({
        host: "https://github.example.com",
        _workaroundDenoTest: true,
      });
      assertEquals(github.baseUrl, "https://github.example.com/api/v3");
    });

    it("Set baseUrl by options.host with hostname only", () => {
      const github = new Github({
        host: "github.example.com",
        _workaroundDenoTest: true,
      });
      assertEquals(github.baseUrl, "https://github.example.com/api/v3");
    });

    it("Set baseUrl by GITHUB_API_URL env", () => {
      Deno.env.set("GITHUB_API_URL", "https://github.example.com/api/v3");
      const github = new Github({ _workaroundDenoTest: true });
      assertEquals(github.baseUrl, "https://github.example.com/api/v3");
    });

    it("Set default baseUrl by default", () => {
      const github = new Github({ _workaroundDenoTest: true });
      assertEquals(github.baseUrl, "https://api.github.com");
    });

    it("Set default baseUrl when host is undefined", () => {
      const github = new Github({ host: undefined, _workaroundDenoTest: true });
      assertEquals(github.baseUrl, "https://api.github.com");
    });
  });
});
