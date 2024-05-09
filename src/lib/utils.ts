const crypto = require('crypto')

export const verifyHmac = (queryParams: any) => {
    const { hmac, ...params } = queryParams;
    const sortedParams = Object.keys(params)
        .sort()
        .map((key) => `${key}=${params[key]}`)
        .join('&');

    const calculatedHmac = crypto
        .createHmac('sha256', process.env.SHOPIFY_CLIENT_SECRET)
        .update(sortedParams)
        .digest('hex');

    return hmac === calculatedHmac;
}