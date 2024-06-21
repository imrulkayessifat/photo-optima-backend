import { Status } from '@prisma/client';
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
    const shopDomain = req.get('x-shopify-shop-domain')

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

            await db.product.update({
                where: {
                    id: productId
                },
                data: {
                    product_vendor: productData.vendor,
                    variant_title: productData.variants[0].title,
                    product_page_title: productData.options[0].name,
                    product_type: productData.product_type,
                    product_barcode: productData.variants[0].barcode,
                    product_title: productData.title,
                    product_sku: productData.variants[0].sku,
                }
            })

            let responses = [];

            for (const image of images) {
                const { id: imageId, src: url, width, height, alt } = image;
                const imageIdStr = imageId.toString();

                const existingImage = await db.image.findFirst({
                    where: { id: imageIdStr },
                });

                const newUrl = new URL(url);
                const name = newUrl.pathname.split('/').pop() || null;


                if (existingImage) {
                    let data = {
                        id: existingImage.id,
                        url: existingImage.url,
                        productId: existingImage.productId,
                        status: existingImage.status,
                        name: existingImage.name,
                        fileRename: existingImage.fileRename,
                        altRename: existingImage.altRename,
                        alt: existingImage.alt
                    };
                    if (alt === null) {
                        data.status = 'NOT_COMPRESSED'
                    }
                    else if (alt.split('.')[0].split('-').pop().slice(-1) === 'C') {
                        data.status = 'COMPRESSED';
                    }
                    const response = await db.image.update({
                        where: { uid: existingImage.uid },
                        data,
                    });
                    responses.push(response);
                } else {
                    let status:Status='NOT_COMPRESSED';
                    if(alt === null) {
                        status = 'NOT_COMPRESSED'
                    } else if (alt.split('.')[0].split('-').pop().slice(-1) === 'C') {
                        status = 'COMPRESSED';
                    }
                    const response = await db.image.create({
                        data: {
                            id: imageIdStr,
                            url,
                            name: alt || name,
                            alt: alt || name,
                            fileRename: false,
                            altRename: false,
                            productId,
                            status
                        },
                    });


                    responses.push(response);
                }

                const storeRes = await db.store.findFirst({
                    where: {
                        name: shopDomain
                    }
                })

                if (storeRes.autoCompression) {
                    const imageRes = await db.image.findFirst({
                        where: {
                            id: imageIdStr
                        }
                    })
                    if (imageRes.status === 'NOT_COMPRESSED') {
                        const response = fetch(`${process.env.MQSERVER}/image/compress-image`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({
                                uid: imageRes.uid,
                                productid: imageRes.productId,
                                url: imageRes.url,
                                storeName: shopDomain
                            })
                        });
                    }
                }
                if (storeRes.autoFileRename) {
                    const imageRes = await db.image.findFirst({
                        where: {
                            id: imageIdStr
                        }
                    })

                    if (imageRes.id) {
                        const req = fetch(`${process.env.MQSERVER}/rename/file-rename`, {
                            method: 'PUT',
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({
                                storeName: shopDomain,
                                id: `${imageRes.id}`,
                            })
                        })
                    }
                }

                if (storeRes.autoAltRename) {
                    const imageRes = await db.image.findFirst({
                        where: {
                            id: imageIdStr
                        }
                    })

                    if (imageRes.id) {
                        const req = fetch(`${process.env.MQSERVER}/rename/alt-rename`, {
                            method: 'PUT',
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({
                                storeName: shopDomain,
                                id: `${imageRes.id}`,
                            })
                        })
                    }
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