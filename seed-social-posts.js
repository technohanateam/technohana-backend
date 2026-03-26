import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import connectDb from "./config/db.js";
import SocialPost from "./src/models/socialPost.model.js";

const samplePosts = [
  {
    platforms: ["linkedin", "instagram"],
    text: `Master Generative AI in just 4 weeks — with live, instructor-led sessions designed for working professionals.\n\nWhether you're in tech, marketing, or ops, AI is reshaping every role. Don't get left behind.\n\n✅ Hands-on projects\n✅ Industry-recognized certificate\n✅ Group discounts up to 35%\n\nEnroll now at technohana.com — use code LAUNCH10 for 10% off.\n\n#GenerativeAI #AITraining #Technohana #UpskillNow`,
    imageUrl: "",
    status: "draft",
    scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // tomorrow
    utmParams: {
      source: "linkedin",
      medium: "social",
      campaign: "genai-launch-mar26",
      content: "launch-post-draft",
    },
    metrics: { likes: 0, comments: 0, shares: 0 },
  },
];

async function seedSocialPosts() {
  try {
    await connectDb();
    console.log("✓ Connected to MongoDB");

    const existingCount = await SocialPost.countDocuments();
    if (existingCount > 0) {
      console.log(`⚠ Found ${existingCount} existing social post(s). Skipping seed.`);
      console.log("To reseed, delete existing posts first.");
      process.exit(0);
    }

    const result = await SocialPost.insertMany(samplePosts);
    console.log(`✓ Successfully seeded ${result.length} social post(s):`);
    result.forEach((post) => {
      console.log(`  - [${post.status}] ${post.platforms.join(", ")} — "${post.text.slice(0, 60)}…"`);
    });

    console.log("\n✓ Done! View it in Admin Panel → Social Media → Posts List");
    process.exit(0);
  } catch (error) {
    console.error("✗ Error seeding social posts:", error.message);
    process.exit(1);
  }
}

seedSocialPosts();
