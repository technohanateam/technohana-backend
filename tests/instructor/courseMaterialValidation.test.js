import { test } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import CourseMaterial, { isAllowedLinkHost } from "../../src/models/courseMaterial.model.js";

// Schema validation runs without a DB connection.
const oid = () => new mongoose.Types.ObjectId();

const base = () => ({
  title: "Module 1 slides",
  courseId: oid(),
  instructorId: oid(),
});

const validate = (doc) => new CourseMaterial(doc).validate();

// ── link materials ────────────────────────────────────────────────────────────

test("an allowlisted https link validates", async () => {
  await validate({ ...base(), kind: "link", link: { url: "https://youtu.be/abc123", provider: "youtube" } });
});

test("http is rejected — links are rendered clickable", async () => {
  await assert.rejects(
    validate({ ...base(), kind: "link", link: { url: "http://youtu.be/abc123", provider: "youtube" } }),
    /https/
  );
});

test("a non-allowlisted host is rejected for a named provider", async () => {
  await assert.rejects(
    validate({ ...base(), kind: "link", link: { url: "https://evil.example.com/pwn", provider: "youtube" } }),
    /not allowed/
  );
});

test("provider 'other' is the documented escape hatch for unlisted hosts", async () => {
  await validate({ ...base(), kind: "link", link: { url: "https://some-college.edu/notes.pdf", provider: "other" } });
});

test("a malformed URL is rejected", async () => {
  await assert.rejects(
    validate({ ...base(), kind: "link", link: { url: "not a url", provider: "other" } }),
    /valid URL/
  );
});

test("a link material with no url is rejected", async () => {
  await assert.rejects(validate({ ...base(), kind: "link" }), /require link\.url/);
});

test("wildcard subdomains are matched by suffix, not substring", () => {
  assert.equal(isAllowedLinkHost("technohana.zoom.us"), true);
  assert.equal(isAllowedLinkHost("contoso.sharepoint.com"), true);
  // The guard must not be fooled by a lookalike that merely contains the domain.
  assert.equal(isAllowedLinkHost("zoom.us.evil.com"), false);
  assert.equal(isAllowedLinkHost("notyoutube.com"), false);
  assert.equal(isAllowedLinkHost("youtube.com.evil.net"), false);
});

// ── file materials ────────────────────────────────────────────────────────────

test("a file material needs publicId and secureUrl", async () => {
  await assert.rejects(
    validate({ ...base(), kind: "file", file: { originalName: "slides.pdf" } }),
    /publicId/
  );
});

test("a complete file material validates and drops any stray link subdoc", async () => {
  const doc = new CourseMaterial({
    ...base(),
    kind: "file",
    file: { publicId: "technohana/course-materials/x", secureUrl: "https://res.cloudinary.com/x/raw/upload/x", mimeType: "application/pdf" },
    link: { url: "https://youtu.be/abc", provider: "youtube" },
  });
  await doc.validate();
  assert.equal(doc.link, undefined, "a file material must not also carry a link");
});

test("a complete link material drops any stray file subdoc", async () => {
  const doc = new CourseMaterial({
    ...base(),
    kind: "link",
    link: { url: "https://youtu.be/abc", provider: "youtube" },
    file: { publicId: "x", secureUrl: "https://res.cloudinary.com/x" },
  });
  await doc.validate();
  assert.equal(doc.file, undefined);
});

// ── defaults ──────────────────────────────────────────────────────────────────

test("visibility defaults closed", () => {
  const doc = new CourseMaterial({ ...base(), kind: "link", link: { url: "https://youtu.be/a", provider: "youtube" } });
  assert.equal(doc.visibility, "instructor-only");
  assert.equal(doc.batchId, null, "null batchId means course-wide");
  assert.equal(doc.deletedAt, null);
});

test("kind is required", async () => {
  await assert.rejects(validate({ ...base() }), /kind/);
});
