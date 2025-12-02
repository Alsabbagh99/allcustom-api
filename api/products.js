// api/products.js
// This endpoint reads a product from Shopify by its handle:
// GET /api/products?handle=your-product-handle

const url = require('url');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  const { SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_TOKEN, SHOPIFY_API_VERSION } = process.env;

  // Check environment variables
  if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ADMIN_TOKEN || !SHOPIFY_API_VERSION) {
    res.statusCode = 500;
    res.end(JSON.stringify({
      ok: false,
      error: 'Missing Shopify environment variables on the server'
    }));
    return;
  }

  // Get ?handle= from the URL
  const parsedUrl = url.parse(req.url, true);
  const handle = parsedUrl.query.handle;

  if (!handle) {
    res.statusCode = 400;
    res.end(JSON.stringify({
      ok: false,
      error: 'Please provide ?handle=product-handle in the URL, e.g. /api/products?handle=my-watch'
    }));
    return;
  }

  const endpoint = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;

  const query = `
    query ProductByHandle($handle: String!) {
      productByHandle(handle: $handle) {
        id
        title
        handle
        descriptionHtml
        seo {
          title
          description
        }
        images(first: 10) {
          edges {
            node {
              id
              altText
              url
            }
          }
        }
      }
    }
  `;

  const variables = { handle };

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': SHOPIFY_ADMIN_TOKEN
      },
      body: JSON.stringify({ query, variables })
    });

    const data = await response.json();

    if (!response.ok || data.errors) {
      res.statusCode = 500;
      res.end(JSON.stringify({
        ok: false,
        error: 'Shopify API error',
        details: data.errors || data
      }));
      return;
    }

    if (!data.data || !data.data.productByHandle) {
      res.statusCode = 404;
      res.end(JSON.stringify({
        ok: false,
        error: `No product found with handle "${handle}"`
      }));
      return;
    }

    const product = data.data.productByHandle;

    // Simplify the response a bit
    const simplified = {
      id: product.id,
      title: product.title,
      handle: product.handle,
      descriptionHtml: product.descriptionHtml,
      seoTitle: product.seo?.title || null,
      seoDescription: product.seo?.description || null,
      images: (product.images?.edges || []).map(edge => ({
        id: edge.node.id,
        altText: edge.node.altText,
        url: edge.node.url
      }))
    };

    res.statusCode = 200;
    res.end(JSON.stringify({
      ok: true,
      product: simplified
    }, null, 2));
  } catch (err) {
    console.error(err);
    res.statusCode = 500;
    res.end(JSON.stringify({
      ok: false,
      error: 'Unexpected server error'
    }));
  }
};
