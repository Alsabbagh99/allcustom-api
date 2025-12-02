// api/update-product.js
// This endpoint updates a product in Shopify using data sent from a GPT (or any client).
// It expects a POST request with JSON like:
// {
//   "apiKey": "your-secret",
//   "productId": "gid://shopify/Product/...",
//   "descriptionHtml": "<p>New description</p>",
//   "seoTitle": "New SEO Title",
//   "seoDescription": "New SEO description"
//   // NOTE: images are currently ignored because ProductInput doesn't support images in this API version
// }

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  const { SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_TOKEN, SHOPIFY_API_VERSION, API_SECRET_KEY } = process.env;

  // Check environment variables
  if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ADMIN_TOKEN || !SHOPIFY_API_VERSION || !API_SECRET_KEY) {
    res.statusCode = 500;
    res.end(JSON.stringify({
      ok: false,
      error: 'Missing environment variables on the server'
    }));
    return;
  }

  // Only allow POST
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end(JSON.stringify({
      ok: false,
      error: 'Method not allowed. Use POST.'
    }));
    return;
  }

  // Read request body
  let body = '';
  try {
    for await (const chunk of req) {
      body += chunk;
    }
  } catch (err) {
    res.statusCode = 400;
    res.end(JSON.stringify({
      ok: false,
      error: 'Unable to read request body'
    }));
    return;
  }

  let payload;
  try {
    payload = JSON.parse(body || '{}');
  } catch (err) {
    res.statusCode = 400;
    res.end(JSON.stringify({
      ok: false,
      error: 'Request body must be valid JSON'
    }));
    return;
  }

  const {
    apiKey,
    productId,
    descriptionHtml,
    seoTitle,
    seoDescription
    // images - ignored for now
  } = payload;

  // Simple security: check apiKey
  if (!apiKey || apiKey !== API_SECRET_KEY) {
    res.statusCode = 401;
    res.end(JSON.stringify({
      ok: false,
      error: 'Unauthorized: invalid apiKey'
    }));
    return;
  }

  if (!productId) {
    res.statusCode = 400;
    res.end(JSON.stringify({
      ok: false,
      error: 'Missing productId in request body'
    }));
    return;
  }

  // Build the productUpdate input
  const input = { id: productId };

  if (descriptionHtml) {
    input.descriptionHtml = descriptionHtml;
  }

  if (seoTitle || seoDescription) {
    input.seo = {
      title: seoTitle || null,
      description: seoDescription || null
    };
  }

  const endpoint = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;

  const mutation = `
    mutation UpdateProduct($input: ProductInput!) {
      productUpdate(input: $input) {
        product {
          id
          title
          handle
          descriptionHtml
          seo {
            title
            description
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const variables = { input };

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': SHOPIFY_ADMIN_TOKEN
      },
      body: JSON.stringify({ query: mutation, variables })
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

    const result = data.data.productUpdate;

    if (result.userErrors && result.userErrors.length > 0) {
      res.statusCode = 400;
      res.end(JSON.stringify({
        ok: false,
        error: 'Shopify user errors',
        details: result.userErrors
      }));
      return;
    }

    const product = result.product;

    const simplified = {
      id: product.id,
      title: product.title,
      handle: product.handle,
      descriptionHtml: product.descriptionHtml,
      seoTitle: product.seo?.title || null,
      seoDescription: product.seo?.description || null
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
