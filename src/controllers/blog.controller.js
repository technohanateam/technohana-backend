import { Blogs } from "../models/blogs.model.js";

const LIST_PROJECTION = { content: 0, faqs: 0, sources: 0, metaTitle: 0, metaDescription: 0, focusKeyword: 0 };

export const getAllBlogs = async (req, res) => {
  try {
    const now = new Date();
    const blogs = await Blogs.find({
      $or: [
        { published: true, scheduledAt: null },
        { published: true, scheduledAt: { $lte: now } },
      ],
    }, LIST_PROJECTION).sort({ createdAt: -1 });
    return res.json(blogs);
  } catch (error) {
    console.error("Error fetching all blogs:", error);
    return res.status(500).json({ success: false, message: "Error fetching blogs" });
  }
};

export const getBlogBySlug = async (req, res) => {
  try {
    const now = new Date();
    const blog = await Blogs.findOne({
      slug: req.params.slug,
      published: true,
      $or: [{ scheduledAt: null }, { scheduledAt: { $lte: now } }],
    });
    if (!blog) return res.status(404).json({ success: false, message: "Blog not found" });
    return res.json({ success: true, data: blog });
  } catch (error) {
    console.error("Error fetching blog by slug:", error);
    return res.status(500).json({ success: false, message: "Error fetching blog" });
  }
};

export const getBlog = async (req, res) => {
  try {
    const blog = await Blogs.findOne({ slug: req.params.slug, published: true });
    if (!blog) {
      return res.send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Blog Not Found</title>
            <meta property="og:title" content="Blog Not Found" />
            <meta property="og:description" content="This blog does not exist." />
            <meta property="og:image" content="https://technohana.in/og-image.png" />
            <meta property="og:url" content="https://technohana.in/blog/${req.params.slug}" />
          </head>
          <body><div id="root"></div><script src="/main.js"></script></body>
        </html>
      `);
    }

    const cleanDesc = (blog.content || "").replace(/<\/?[^>]+(>|$)/g, "").slice(0, 150);
    const ogImage = blog.img?.startsWith("http") ? blog.img : `https://technohana.in${blog.img || "/og-image.png"}`;

    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${blog.title}</title>
          <meta property="og:title" content="${blog.title}" />
          <meta property="og:description" content="${cleanDesc}..." />
          <meta property="og:image" content="${ogImage}" />
          <meta property="og:url" content="https://technohana.in/blog/${blog.slug}" />
        </head>
        <body>
          <div id="root"></div>
          <script src="/main.js"></script>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("Cannot fetch blog by slug:", error);
    res.status(500).send("Internal Server Error");
  }
};
