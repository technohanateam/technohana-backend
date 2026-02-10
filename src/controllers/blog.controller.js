import { Blogs } from "../models/blogs.model.js";

export const getAllBlogs = async (req, res) => {
  try {
    const blog = await Blogs.find();
    return res.json(blog);
  } catch (error) {
    console.log("Error fetching all blogs : ", error);
    return res.status(500).json({
      success: false,
      message: "Error Fetching the Blogs ",
    });
  }
};

export const getBlog = async (req, res) => {
  try {
    const blog = await Blogs.findOne({ slug: req.params.slug });
    if (!blog) {
      return res.send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Blog Not Found</title>
            <meta property="og:title" content="Blog Not Found" />
            <meta property="og:description" content="This blog does not exist." />
            <meta property="og:image" content="https://yourdomain.com/default-og.png" />
            <meta property="og:url" content="https://yourdomain.com/blog/${req.params.slug}" />
          </head>
          <body><div id="root"></div><script src="/main.js"></script></body>
        </html>
      `);
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
          <script src="/main.js"></script>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("Cannot Fetch Blog by Slug", error);
    res.status(500).send("Internal Server Error");
  }
};