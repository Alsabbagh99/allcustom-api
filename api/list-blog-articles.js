// api/list-blog-articles.js

const SHOPIFY_API_VERSION = "2024-07";

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res
        .status(405)
        .json({ ok: false, error: "Method not allowed. Use GET." });
    }

    const storeDomain = process.env.SHOPIFY_STORE_DOMAIN;
    const adminToken = process.env.SHOPIFY_ADMIN_TOKEN;

    if (!storeDomain || !adminToken) {
      return res.status(500).json({
        ok: false,
        error:
          "Missing environment variables. Check SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_TOKEN.",
      });
    }

    const query = `
      query listBlogArticles {
        blogs(first: 10) {
          edges {
            node {
              id
              title
              handle
              articles(first: 50) {
                edges {
                  node {
                    id
                    handle
                    title
                    seo {
                      title
                      description
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    const shopifyRes = await fetch(
      `https://${storeDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": adminToken,
        },
        body: JSON.stringify({ query }),
      }
    );

    const shopifyJson = await shopifyRes.json();

    if (!shopifyRes.ok || shopifyJson.errors) {
      console.error("Shopify listBlogArticles error:", shopifyJson);
      return res.status(500).json({
        ok: false,
        error: "Shopify API error when listing blog articles",
        details: shopifyJson.errors || shopifyJson,
      });
    }

    const blogs = shopifyJson.data?.blogs?.edges || [];

    const articles = [];
    for (const blogEdge of blogs) {
      const blog = blogEdge.node;
      const articleEdges = blog.articles?.edges || [];
      for (const aEdge of articleEdges) {
        const article = aEdge.node;
        articles.push({
          id: article.id,
          handle: article.handle,
          title: article.title,
          blogTitle: blog.title,
          seoTitle: article.seo?.title || null,
          seoDescription: article.seo?.description || null
        });
      }
    }

    return res.status(200).json({
      ok: true,
      count: articles.length,
      articles,
    });
  } catch (err) {
    console.error("Unexpected error in /api/list-blog-articles:", err);
    return res
      .status(500)
      .json({ ok: false, error: "Unexpected server error" });
  }
}
