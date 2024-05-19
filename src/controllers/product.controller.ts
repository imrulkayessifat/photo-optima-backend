import { Image } from '@prisma/client';
import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const crypto = require('crypto')

const db = new PrismaClient();
const getRawBody = require('raw-body')

const webhooks_secret_key = process.env.WEBHOOKS_SECRET_KEY;

export const productCreate = async (req: any, res: any) => {
    const shopDomain = req.get('x-shopify-shop-domain')

    const hmac = req.get('X-Shopify-Hmac-Sha256')
    const body = await getRawBody(req)

    const hash = crypto
        .createHmac('sha256', webhooks_secret_key)
        .update(body, 'utf8', 'hex')
        .digest('base64')

    console.log(hmac === hash)

    if (hmac === hash) {
        try {
            req.body = JSON.parse(body.toString());
            const productData = req.body;
            const { id, title } = productData;

            const productId = id.toString();


            const storeCount = await db.store.findMany({
                where: {
                    name: shopDomain
                }
            })

            if (storeCount.length === 0) {
                await db.store.create({
                    data: {
                        name: shopDomain!
                    }
                })
            }

            const product = await db.product.create({
                data: {
                    id: productId,
                    storename: shopDomain!,
                    title,
                }
            })

            res.status(201).json({ data: product });
        } catch (e) {
            res.status(500).json({ error: 'An error occurred while storing product data.' });
        }
    } else {
        res.status(403).json({ error: "you don't have access" })
    }
}

export const productUpdate = async (req: Request, res: Response): Promise<void> => {
    const hmac = req.get('X-Shopify-Hmac-Sha256')

    const body = await getRawBody(req)

    const hash = crypto
        .createHmac('sha256', webhooks_secret_key)
        .update(body, 'utf8', 'hex')
        .digest('base64')

    if (hmac === hash) {
        try {
            req.body = JSON.parse(body.toString());
            const productData = req.body;
            const { id, title, images, alt } = productData;
            

            const productId = id.toString();

            let responses = [];

            for (const image of images) {
                const { id: imageId, src: url, width, height, alt } = image;
                const imageIdStr = imageId.toString();

                const existingImage = await db.image.findUnique({
                    where: { id: imageIdStr },
                });

                const newUrl = new URL(url);
                const name = newUrl.pathname.split('/').pop() || null;


                if (existingImage) {
                    let data: Image = {
                        id: imageIdStr,
                        url,
                        productId: existingImage.productId,
                        status: existingImage.status,
                        name: existingImage.name,
                        alt: existingImage.alt
                    };
                    if (alt === 'COMPRESSED') {
                        data.status = 'COMPRESSED';
                    }
                    const response = await db.image.update({
                        where: { id: imageIdStr },
                        data,
                    });
                    responses.push(response);
                } else {
                    let data: Image = {
                        id: imageIdStr,
                        url,
                        name,
                        alt,
                        productId,
                        status: 'NOT_COMPRESSED'
                    };
                    if (alt === 'COMPRESSED') {
                        data.status = 'COMPRESSED';
                    }
                    const response = await db.image.create({
                        data,
                    });
                    responses.push(response);
                }
            }


            res.status(200).json({ data: responses });

        } catch (e) {
            console.error(e);
            res.status(500).json({ error: 'An error occurred while updating product data.' });
        }
    } else {
        res.status(403).json({ error: "you don't have access" })
    }
}