import express from 'express';
import { getAllBlogs } from '../controllers/blog.controller.js';
import path from "path";
import { fileURLToPath } from "url";
import { Blogs } from "../models/blogs.model.js";

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));


router.get("/blogs",getAllBlogs);
router.get("/blog/:slug", async (req, res) => {
  try {
    const blog = await Blogs.findOne({ slug: req.params.slug });
    if (!blog) {
      return res.sendFile(path.join(__dirname, "public", "index.html"));
    }

    const cleanDesc = blog.content.replace(/<\/?[^>]+(>|$)/g, "").slice(0, 150);

    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${blog.title}</title>
          <meta property="og:title" content="${blog.title}" />
          <meta property="og:description" content="${cleanDesc}..." />
          <meta property="og:image" content="https://yourdomain.com${blog.img}" />
          <meta property="og:url" content="https://yourdomain.com/blog/${blog.slug}" />
        </head>
        <body>
          <div id="root"></div>
          <script src="/main.js"></script> <!-- React bundle -->
        </body>
      </html>
    `);
  } catch (err) {
    console.error("Error:", err);
    res.sendFile(path.join(__dirname, "public", "index.html"));
  }
});

export default router;