import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import connectDb from "./config/db.js";
import { parseMarkdownArticle, buildOpportunityFromImport } from "./services/contentFactory/articleImport.service.js";

dotenv.config();

// CLI import for a human-written markdown article, e.g.:
//   node src/importArticleFromMarkdown.js path/to/article.md [courseSlug] [contentType]
//
// Unlike addBlogAiEngineeringSkills2026.js (which writes straight to Blogs,
// bypassing Content Factory), this creates a ContentOpportunity in
// HUMAN_REVIEW so the article shows up in the existing admin review queue —
// it still needs a score override + approval there before it becomes a
// live Blogs post. Connects to Mongo directly rather than going through the
// admin HTTP API, since a one-off script has no session/JWT to attach.

const [, , filePath, courseSlug, contentType] = process.argv;

if (!filePath) {
  console.error("Usage: node src/importArticleFromMarkdown.js <path/to/article.md> [courseSlug] [contentType]");
  process.exit(1);
}

async function run() {
  try {
    const resolvedPath = path.resolve(filePath);
    const rawMarkdown = fs.readFileSync(resolvedPath, "utf8");

    await connectDb();
    console.log("Connected to MongoDB");

    const { articleDraft, warnings } = parseMarkdownArticle(rawMarkdown);
    for (const w of warnings) console.warn(`Warning: ${w}`);

    const opportunity = await buildOpportunityFromImport({
      articleDraft,
      courseSlug: courseSlug || null,
      contentType: contentType || undefined,
      importedBy: "cli-script",
      sourceFile: resolvedPath,
    });
    await opportunity.save();

    console.log(`Opportunity created: id=${opportunity._id} status=${opportunity.status} title="${opportunity.title}"`);
    console.log("Review, score, and approve it at /admin/content-factory (Human Review queue) to publish.");
    process.exit();
  } catch (error) {
    console.error("Error importing article:", error.message);
    process.exit(1);
  }
}

run();
