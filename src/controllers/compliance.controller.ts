const crypto = require('crypto')
const getRawBody = require('raw-body')
const webhooks_secret_key = process.env.WEBHOOKS_SECRET_KEY;

export const customerRequest = async (req: any, res: any) => {
    const shopDomain = req.get('x-shopify-shop-domain')

    const hmac = req.get('X-Shopify-Hmac-Sha256')
    const body = await getRawBody(req)

    const hash = crypto
        .createHmac('sha256', webhooks_secret_key)
        .update(body, 'utf8', 'hex')
        .digest('base64')

    if (hmac === hash) { 
        console.log("customer request");
        JSON.parse(body.toString())
    }
}

export const customerErasure = async (req: any, res: any) => {
    const shopDomain = req.get('x-shopify-shop-domain')

    const hmac = req.get('X-Shopify-Hmac-Sha256')
    const body = await getRawBody(req)

    const hash = crypto
        .createHmac('sha256', webhooks_secret_key)
        .update(body, 'utf8', 'hex')
        .digest('base64')

    if (hmac === hash) { 
        console.log("customer erasure");
        JSON.parse(body.toString())
    }
}

export const shopErasure = async (req: any, res: any) => {
    const shopDomain = req.get('x-shopify-shop-domain')

    const hmac = req.get('X-Shopify-Hmac-Sha256')
    const body = await getRawBody(req)

    const hash = crypto
        .createHmac('sha256', webhooks_secret_key)
        .update(body, 'utf8', 'hex')
        .digest('base64')

    if (hmac === hash) { 
        console.log("shop erasure");
        console.log(JSON.parse(body.toString()))
    }
}