const crypto = require('crypto')
const getRawBody = require('raw-body')
import { PrismaClient } from "@prisma/client";
const webhooks_secret_key = process.env.WEBHOOKS_SECRET_KEY;

const db = new PrismaClient();

export const customerRequest = async (req: any, res: any) => {
    try {

        const shopDomain = req.get('x-shopify-shop-domain')

        const hmac = req.get('X-Shopify-Hmac-Sha256')
        const body = await getRawBody(req)

        const hash = crypto
            .createHmac('sha256', webhooks_secret_key)
            .update(body, 'utf8', 'hex')
            .digest('base64')

        if (hmac === hash) {
            try {
                const data = db.store.findFirst({
                    where: {
                        name: shopDomain
                    }
                })
                res.status(201).json({ data });
            } catch (e) {
                res.status(500).json({ error: 'An error occurred while storing product data.' });
            }

        } else {
            res.status(403).json({ error: "you don't have access" })
        }
    } catch (e) {
        res.status(400).json({ error: 'something went wrong!' })
    }
}

export const customerErasure = async (req: any, res: any) => {
    try {

        const shopDomain = req.get('x-shopify-shop-domain')

        const hmac = req.get('X-Shopify-Hmac-Sha256')
        const body = await getRawBody(req)

        const hash = crypto
            .createHmac('sha256', webhooks_secret_key)
            .update(body, 'utf8', 'hex')
            .digest('base64')

        if (hmac === hash) {
            try {
                const data = db.store.delete({
                    where: {
                        name: shopDomain
                    }
                })
                res.status(201).json({ data });
            } catch (e) {
                res.status(500).json({ error: 'An error occurred while storing product data.' });
            }

        } else {
            res.status(403).json({ error: "you don't have access" })
        }
    } catch (e) {
        res.status(400).json({ error: 'something went wrong!' })
    }
}

export const shopErasure = async (req: any, res: any) => {
    try {

        const shopDomain = req.get('x-shopify-shop-domain')

        const hmac = req.get('X-Shopify-Hmac-Sha256')
        const body = await getRawBody(req)

        const hash = crypto
            .createHmac('sha256', webhooks_secret_key)
            .update(body, 'utf8', 'hex')
            .digest('base64')

        if (hmac === hash) {
            try {
                const data = db.store.delete({
                    where: {
                        name: shopDomain
                    }
                })
                res.status(201).json({ data });
            } catch (e) {
                res.status(500).json({ error: 'An error occurred while storing product data.' });
            }

        } else {
            res.status(403).json({ error: "you don't have access" })
        }
    } catch (e) {
        res.status(400).json({ error: 'something went wrong!' })
    }
}