import "dotenv/config";
import mongoose from "mongoose";
import Course from "../src/models/course.model.js";

const DRY_RUN = !process.argv.includes("--apply");

const slugify = (title) =>
  String(title || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const run = async () => {
  await mongoose.connect(process.env.MONGO_DB);

  const courses = await Course.find({}).lean();
  const usedSlugs = new Set(
    courses.filter((c) => c.courseSlug).map((c) => c.courseSlug)
  );
  const missing = courses.filter((c) => !c.courseSlug);

  const updates = [];
  for (const course of missing) {
    let base = slugify(course.courseTitle) || slugify(course.id);
    let slug = base;
    let n = 2;
    while (usedSlugs.has(slug)) {
      slug = `${base}-${n}`;
      n++;
    }
    usedSlugs.add(slug);
    updates.push({ id: course.id, courseTitle: course.courseTitle, slug });
  }

  console.table(updates);
  console.log(`${updates.length} course(s) would be updated.`);

  if (DRY_RUN) {
    console.log("Dry run only — pass --apply to write changes.");
  } else {
    for (const u of updates) {
      await Course.updateOne({ id: u.id }, { courseSlug: u.slug });
    }
    console.log(`Applied ${updates.length} update(s).`);
  }

  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
