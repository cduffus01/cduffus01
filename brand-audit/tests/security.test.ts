import assert from "node:assert/strict";
import { test } from "node:test";
import { isPrivateIp, normalizeInputUrl, registrableDomain, sameSite } from "@/lib/security/url";
import { isSafeSelector, isSafeValue } from "@/lib/engine/remediation";

test("private, loopback and metadata addresses are rejected", () => {
  for (const ip of [
    "127.0.0.1", "10.0.0.5", "192.168.1.1", "172.16.0.1", "169.254.169.254",
    "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1",
  ]) {
    assert.equal(isPrivateIp(ip), true, `${ip} should be blocked`);
  }
});

test("public addresses are allowed", () => {
  for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700::1111"]) {
    assert.equal(isPrivateIp(ip), false, `${ip} should be allowed`);
  }
});

test("only http and https URLs are accepted", () => {
  assert.equal(normalizeInputUrl("file:///etc/passwd").ok, false);
  assert.equal(normalizeInputUrl("javascript:alert(1)").ok, false);
  assert.equal(normalizeInputUrl("gopher://example.com").ok, false);
  assert.equal(normalizeInputUrl("data:text/html,<h1>x</h1>").ok, false);
});

test("localhost and internal hostnames are blocked before DNS", () => {
  assert.equal(normalizeInputUrl("http://localhost:3000").ok, false);
  assert.equal(normalizeInputUrl("http://api.internal/health").ok, false);
  assert.equal(normalizeInputUrl("http://metadata.google.internal/").ok, false);
});

test("a bare domain is upgraded to https and stripped of credentials", () => {
  const result = normalizeInputUrl("user:pass@example.com/pricing#top");
  assert.equal(result.ok, true);
  assert.equal(result.url!.protocol, "https:");
  assert.equal(result.url!.username, "");
  assert.equal(result.url!.hash, "");
});

test("unusual ports are refused", () => {
  assert.equal(normalizeInputUrl("http://example.com:22").ok, false);
  assert.equal(normalizeInputUrl("https://example.com:443").ok, true);
});

test("crawl scope stays on the submitted registrable domain", () => {
  assert.equal(registrableDomain("www.example.co.uk"), "example.co.uk");
  assert.equal(registrableDomain("blog.example.com"), "example.com");
  assert.equal(
    sameSite(new URL("https://example.com/"), new URL("https://www.example.com/about")),
    true,
  );
  assert.equal(
    sameSite(new URL("https://example.com/"), new URL("https://evil.com/about")),
    false,
  );
});

test("only selectors this system generates can reach the preview stylesheet", () => {
  assert.equal(isSafeSelector("header > nav.menu > a:nth-of-type(2)"), true);
  assert.equal(isSafeSelector("#hero > h1.title"), true);
  assert.equal(isSafeSelector("h1 { } body { background: red"), false);
  assert.equal(isSafeSelector("h1</style><script>alert(1)</script>"), false);
  assert.equal(isSafeSelector("@import url(evil.css)"), false);
});

test("declaration values can't smuggle CSS out of their rule", () => {
  assert.equal(isSafeValue("#00b74f"), true);
  assert.equal(isSafeValue('"Inter", sans-serif'), true);
  assert.equal(isSafeValue("red; } body { display: none"), false);
  assert.equal(isSafeValue("url(https://evil.example/x.png)"), false);
  assert.equal(isSafeValue("expression(alert(1))"), false);
});
